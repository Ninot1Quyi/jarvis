#!/bin/bash
# evolve_main.sh — Main orchestrator for Dum-E self-evolution
#
# This script implements the core workflow of evolve_self.
# The Rust evolve_self tool delegates to this script for:
#   - Step 1: Git worktree creation
#   - Step 3: LLM comparison with target agents
#   - Step 4: Improvement plan generation
#   - Step 5: Applying improvements
#
# Steps 2, 6, 7 (skill loading, build, test) are handled by the Rust caller.
# Steps 8-15 (verification, version bump, merge, switch) are handled by Rust.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Parse arguments
WORKTREE_DIR=""
FOCUS="capabilities"
COMPARE_TARGETS="claude-code,codex,harness,gemini-cli,agent-s"
CURRENT_VERSION="v1.0.0"
NEXT_VERSION="v1.0.1"
STEP=""

usage() {
    cat <<EOF
Usage: evolve_main.sh [options]

Options:
  --worktree DIR       Worktree directory path
  --focus AREA         Focus: capabilities|personality|interaction|architecture
  --targets LIST       Comma-separated target agents
  --current-version V  Current version
  --next-version V     Next version
  --step NAME          Step to execute: compare|plan|apply|all

Examples:
  ./evolve_main.sh --step compare --focus capabilities
  ./evolve_main.sh --step all --worktree /path/to/worktree
EOF
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --worktree) WORKTREE_DIR="$2"; shift 2 ;;
        --focus) FOCUS="$2"; shift 2 ;;
        --targets) COMPARE_TARGETS="$2"; shift 2 ;;
        --current-version) CURRENT_VERSION="$2"; shift 2 ;;
        --next-version) NEXT_VERSION="$2"; shift 2 ;;
        --step) STEP="$2"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown option: $1"; usage; exit 1 ;;
    esac
done

# ============================================================================
# Step 3: LLM Comparison
# ============================================================================
step_compare() {
    echo "=== Step 3: Comparing against target agents ==="

    local api_key="${MINIMAX_API_KEY:-}"
    if [[ -z "$api_key" ]]; then
        # Try loading from config
        api_key=$(cat config.json 2>/dev/null | grep -o '"api_key"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
    fi

    if [[ -z "$api_key" ]]; then
        echo "Warning: MINIMAX_API_KEY not set, using mock comparison"
        cat <<'MOCK_COMPARE'
## Mock Gap Analysis

### Capabilities Gap
- **Tool registry**: Dum-E has fewer MCP integrations than claude-code
- **Streaming**: Claude Code has better incremental tool result display
- **Sub-agents**: Claude Code supports fork sub-agents, Dum-E now supports launch_subagent

### Architecture Gap
- **Observability**: Both have good tracing; Dum-E could improve event taxonomy

### Priority Improvements
1. [code] Add more MCP tool integrations — high impact, medium effort
2. [tool] Improve streaming UX for long tool outputs — medium impact, low effort
3. [prompt] Add more personality traits to SOUL.md — low impact, easy

Output as JSON:
```json
{"gaps": [{"type": "code", "target": "Add MCP integrations", "benefit": "More tools available"}]}
```
MOCK_COMPARE
        return 0
    fi

    # Read SOUL.md to understand current state
    local soul_summary=""
    if [[ -f "data/soul.md" ]]; then
        soul_summary=$(head -50 data/soul.md)
    fi

    # Build comparison prompt
    local prompt="You are comparing Dum-E (version $CURRENT_VERSION, an AI coding agent built in Rust) against these target agents: $COMPARE_TARGETS.

Focus area: $FOCUS

Current Dum-E state:
$soul_summary

Research the capabilities of each target agent (claude-code, codex, harness, gemini-cli, agent-s) and produce a structured gap analysis comparing Dum-E against these agents.

Analyze:
1. **Capabilities**: Tool set, API coverage, model support
2. **Interaction**: Input/output format, streaming, error messages
3. **Architecture**: Module design, extensibility, testability
4. **Personality**: Response style, decision-making, behavior patterns
5. **Observability**: Logging, tracing, debugging support

Output a JSON report with this structure:
{
  \"comparisons\": [
    {
      \"target\": \"agent-name\",
      \"dimension\": \"capabilities|personality|interaction|architecture\",
      \"dume_current\": \"description\",
      \"target_state\": \"description\",
      \"gaps\": [\"gap1\", \"gap2\"],
      \"priority\": \"high|medium|low\",
      \"improvement\": \"specific suggestion\"
    }
  ],
  \"priority_order\": [\"gap1\", \"gap2\"],
  \"top_improvements\": [
    {
      \"gap\": \"description\",
      \"type\": \"code|prompt|tool|architecture\",
      \"location\": \"file path or SOUL section\",
      \"benefit\": \"what this improves\"
    }
  ]
}

Be specific and actionable. Prioritize high-impact, low-effort improvements first."

    # Call LLM API
    local base_url="${MINIMAX_BASE_URL:-https://api.minimax.chat}"
    local model="${MINIMAX_MODEL:-MiniMax-Text-01}"

    local response
    response=$(curl -s -X POST "$base_url/v1/text/chatcompletion_v2" \
        -H "Authorization: Bearer $api_key" \
        -H "Content-Type: application/json" \
        -d "{
            \"model\": \"$model\",
            \"messages\": [{\"role\": \"user\", \"content\": $prompt}],
            \"max_tokens\": 4096,
            \"temperature\": 0.3
        }" 2>/dev/null) || true

    # Extract content from response
    local content
    content=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('choices',[{}])[0].get('message',{}).get('content',''))" 2>/dev/null) || true

    if [[ -z "$content" ]]; then
        echo "Warning: LLM call failed, using mock comparison"
        echo "Mock comparison output"
    else
        echo "$content"
    fi
}

# ============================================================================
# Step 4: Generate Improvement Plan
# ============================================================================
step_plan() {
    echo "=== Step 4: Generating improvement plan ==="

    local comparison="$1"
    if [[ -z "$comparison" ]]; then
        echo "Error: No comparison result provided"
        return 1
    fi

    local api_key="${MINIMAX_API_KEY:-}"

    # Extract top improvements from comparison
    local prompt="Based on this gap analysis, extract the top 3-5 specific, actionable improvements for Dum-E.

Gap Analysis:
$comparison

For each improvement, identify:
1. Type: code | prompt | tool | architecture
2. Target: what specifically to change
3. Benefit: what this improves

Output as a simple list, one improvement per line:
IMPROVEMENT: [type] [target] - [benefit]

Prioritize by impact × ease of implementation."

    if [[ -z "$api_key" ]]; then
        cat <<'MOCK_PLAN'
IMPROVEMENT: [code] Add launch_subagent tool for parallel task execution - Allows delegating independent work to sub-agents
IMPROVEMENT: [prompt] Enhance SOUL.md with more personality traits - Richer agent character and behavior
IMPROVEMENT: [tool] Add MiniMax MCP integrations - More tools available to the agent
MOCK_PLAN
        return 0
    fi

    local base_url="${MINIMAX_BASE_URL:-https://api.minimax.chat}"
    local model="${MINIMAX_MODEL:-MiniMax-Text-01}"

    local response
    response=$(curl -s -X POST "$base_url/v1/text/chatcompletion_v2" \
        -H "Authorization: Bearer $api_key" \
        -H "Content-Type: application/json" \
        -d "{
            \"model\": \"$model\",
            \"messages\": [{\"role\": \"user\", \"content\": $prompt}],
            \"max_tokens\": 1024,
            \"temperature\": 0.3
        }" 2>/dev/null) || true

    local content
    content=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('choices',[{}])[0].get('message',{}).get('content',''))" 2>/dev/null) || true

    if [[ -z "$content" ]]; then
        echo "Warning: LLM call failed, using mock plan"
        echo "IMPROVEMENT: [code] General improvement needed - Review and enhance core capabilities"
    else
        echo "$content"
    fi
}

# ============================================================================
# Step 5: Apply Improvements (generate code changes)
# ============================================================================
step_apply() {
    echo "=== Step 5: Applying improvements ==="

    local plan="$1"
    local worktree="${WORKTREE_DIR:-$PROJECT_ROOT}"

    if [[ ! -d "$worktree" ]]; then
        echo "Error: Worktree directory does not exist: $worktree"
        return 1
    fi

    echo "Worktree: $worktree"
    echo "Plan: $plan"
    echo ""
    echo "Note: Code changes should be applied by the Rust evolve_self tool"
    echo "This script provides guidance but the Rust tool executes changes."

    # Output a summary of what should be changed
    echo ""
    echo "=== Recommended Changes Summary ==="
    echo "$plan" | while IFS= read -r line; do
        if [[ "$line" =~ IMPROVEMENT:\ *(.*) ]]; then
            echo "  - ${BASH_REMATCH[1]}"
        fi
    done
}

# ============================================================================
# Main
# ============================================================================
case "$STEP" in
    compare)
        step_compare
        ;;
    plan)
        step_compare | step_plan
        ;;
    apply)
        step_compare | step_plan | step_apply
        ;;
    all)
        local comparison
        comparison=$(step_compare)
        local plan
        plan=$(echo "$comparison" | step_plan)
        step_apply "$plan"
        ;;
    "")
        echo "Error: --step is required"
        usage
        exit 1
        ;;
    *)
        echo "Error: Unknown step: $STEP"
        usage
        exit 1
        ;;
esac
