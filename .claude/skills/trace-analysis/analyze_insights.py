#!/usr/bin/env python3
"""
analyze_insights.py

Intelligent multi-pass analysis of all 4 eval result JSONs.
Simulates human analyst workflow: overview -> patterns -> drill-down -> LLM synthesis.

Usage:
    python3 .claude/skills/trace-analysis/analyze_insights.py

Output:
    improve/analysis/results/insights_report.md  -- human-readable markdown report
    improve/analysis/results/insights_data.json  -- structured data for further use
"""

import json
import re
import asyncio
import io
import sys
from collections import defaultdict, Counter
from pathlib import Path
from datetime import datetime

import httpx

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

API_KEY = 'sk-TfN0Js5VKZcD6O1rJSSixnTYayhIqrnhHKUHXM1mCjf3CrIc'
BASE_URL = 'https://api.duojie.games/v1'
MODEL = 'gemini-3.1-pro'
MAX_RETRIES = 3

RESULTS_DIR = Path('/Users/Ninot/NinotQuyi/jarvis/improve/analysis/results')
OUTPUT_MD = RESULTS_DIR / 'insights_report.md'
OUTPUT_JSON = RESULTS_DIR / 'insights_data.json'

FILES = {
    'knowledge': RESULTS_DIR / 'knowledge_analysis.json',
    'termination': RESULTS_DIR / 'termination_analysis_20260308.json',
    'tools': RESULTS_DIR / 'tool_analysis_20260308.json',
    'skills_gap': RESULTS_DIR / 'skills_gap_20260308.json',
}


# ---------------------------------------------------------------------------
# LLM helper
# ---------------------------------------------------------------------------

async def ask_llm(client: httpx.AsyncClient, prompt: str, context: str,
                  max_tokens: int = 1200) -> str:
    """Send a focused question + context to Gemini, return text response."""
    messages = [
        {
            'role': 'system',
            'content': (
                'You are a senior AI systems analyst reviewing evaluation results '
                'for "Jarvis", an AI agent that controls a computer GUI. '
                'Be concise, data-driven, and actionable. '
                'Focus on patterns that can directly improve the agent.'
            )
        },
        {
            'role': 'user',
            'content': f'{context}\n\n---\n\n{prompt}'
        }
    ]
    payload = {
        'model': MODEL,
        'messages': messages,
        'max_tokens': max_tokens,
        'temperature': 0.1,
    }
    for attempt in range(MAX_RETRIES):
        try:
            resp = await client.post(
                f'{BASE_URL}/chat/completions',
                json=payload,
                headers={
                    'Authorization': f'Bearer {API_KEY}',
                    'content-type': 'application/json',
                },
                timeout=120.0,
            )
            resp.raise_for_status()
            return resp.json()['choices'][0]['message']['content'].strip()
        except Exception as e:
            if attempt < MAX_RETRIES - 1:
                await asyncio.sleep(2 ** attempt)
            else:
                return f'[LLM ERROR: {e}]'


# ---------------------------------------------------------------------------
# Pass 1: Load and extract structured summaries (no LLM, pure code)
# ---------------------------------------------------------------------------

def load_knowledge(path: Path) -> dict:
    d = json.loads(path.read_text())
    results = d.get('results', [])

    # Top missing knowledge / capabilities (already aggregated)
    top_knowledge = d.get('top_missing_knowledge', [])[:15]
    top_caps = d.get('top_missing_capabilities', [])[:15]

    # Failure reason distribution
    reason_counts = Counter(r.get('failure_reason', '')[:80] for r in results if r.get('failure_reason'))
    top_reasons = reason_counts.most_common(10)

    # Key insights per task (short)
    key_insights = [r.get('key_insight', '') for r in results if r.get('key_insight')]

    # Group missing knowledge by app (from task instruction -> app hint)
    app_knowledge: dict = defaultdict(list)
    for r in results:
        instr = r.get('instruction', '').lower()
        if 'calc' in instr or 'spreadsheet' in instr or 'cell' in instr or 'sheet' in instr:
            app = 'libreoffice_calc'
        elif 'impress' in instr or 'slide' in instr or 'presentation' in instr:
            app = 'libreoffice_impress'
        elif 'writer' in instr or 'document' in instr or 'paragraph' in instr:
            app = 'libreoffice_writer'
        elif 'gimp' in instr or 'image' in instr or 'layer' in instr:
            app = 'gimp'
        else:
            app = 'chrome'
        for item in r.get('missing_knowledge', []):
            app_knowledge[app].append(item)

    # Deduplicate per app
    app_knowledge_dedup = {}
    for app, items in app_knowledge.items():
        seen = set()
        deduped = []
        for item in items:
            key = item[:60]
            if key not in seen:
                seen.add(key)
                deduped.append(item)
        app_knowledge_dedup[app] = deduped[:20]

    return {
        'total': len(results),
        'top_missing_knowledge': top_knowledge,
        'top_missing_capabilities': top_caps,
        'top_failure_reasons': top_reasons,
        'key_insights_sample': key_insights[:20],
        'app_knowledge': app_knowledge_dedup,
    }


def load_termination(path: Path) -> dict:
    d = json.loads(path.read_text())
    results = d.get('results', [])

    type_counts = d.get('termination_type_counts', {})
    avg_steps = d.get('avg_steps_used', 0)
    premature = d.get('premature_stop_tasks', [])

    # Per termination type: collect suggested fixes
    fixes_by_type: dict = defaultdict(list)
    evidence_by_type: dict = defaultdict(list)
    for r in results:
        llm = r.get('llm') or {}
        ttype = llm.get('termination_type', 'UNKNOWN')
        fix = llm.get('suggested_fix', '')
        evidence = llm.get('evidence', '')
        if fix:
            fixes_by_type[ttype].append(fix)
        if evidence:
            evidence_by_type[ttype].append(evidence[:100])

    # Top fixes per type (deduplicated)
    top_fixes: dict = {}
    for ttype, fixes in fixes_by_type.items():
        fc = Counter(f[:80] for f in fixes)
        top_fixes[ttype] = fc.most_common(5)

    # WRONG_COMPLETION details: what did agent think was done?
    wrong_completion_tasks = [
        {
            'task_id': r['task_id'][:8],
            'instruction': r.get('instruction', '')[:100],
            'evidence': (r.get('llm') or {}).get('evidence', '')[:150],
            'fix': (r.get('llm') or {}).get('suggested_fix', '')[:100],
        }
        for r in results
        if (r.get('llm') or {}).get('termination_type') == 'WRONG_COMPLETION'
    ]

    # MAX_STEPS tasks: what was agent still trying to do?
    max_steps_tasks = [
        {
            'task_id': r['task_id'][:8],
            'instruction': r.get('instruction', '')[:100],
            'fix': (r.get('llm') or {}).get('suggested_fix', '')[:100],
        }
        for r in results
        if (r.get('llm') or {}).get('termination_type') == 'MAX_STEPS_HIT'
    ]

    return {
        'total': len(results),
        'type_counts': type_counts,
        'avg_steps': avg_steps,
        'premature_count': len(premature),
        'top_fixes_by_type': top_fixes,
        'wrong_completion_sample': wrong_completion_tasks[:10],
        'max_steps_sample': max_steps_tasks[:10],
        'evidence_by_type': {k: v[:5] for k, v in evidence_by_type.items()},
    }


def load_tools(path: Path) -> dict:
    d = json.loads(path.read_text())
    results = d.get('results', [])

    # Global tool frequency
    global_freq = d.get('global_tool_frequency', [])
    key_insights = d.get('key_insights', [])
    llm_insights = d.get('llm_insights', {})
    by_app = d.get('by_app', {})

    # Per-app stats summary
    app_summary = {}
    for app, stats in by_app.items():
        n = stats.get('total', 0)
        app_summary[app] = {
            'total': n,
            'pass': stats.get('pass', 0),
            'pass_rate': round(stats.get('pass', 0) / n * 100) if n else 0,
            'bash_rate': round(stats.get('bash_usage_rate', 0) * 100),
            'find_element_rate': round(stats.get('find_element_usage_rate', 0) * 100),
            'avg_steps_fail': stats.get('avg_steps_fail', 0),
        }

    # LLM: tool mistakes and missed tools
    tool_mistakes = Counter()
    missed_tools = Counter()
    bash_opps = []
    fe_opps = []
    for r in results:
        llm = r.get('llm') or {}
        if 'error' in llm:
            continue
        for m in llm.get('tool_mistakes', []):
            tool_mistakes[m[:60]] += 1
        for m in llm.get('missed_tools', []):
            missed_tools[m[:40]] += 1
        if llm.get('bash_opportunity'):
            bash_opps.append(r.get('instruction', '')[:80])
        if llm.get('find_element_opportunity'):
            fe_opps.append(r.get('instruction', '')[:80])

    # Also check llm_insights aggregation
    agg_missed = (llm_insights.get('top_missed_tools') or [])[:10]
    bash_opp_rate = llm_insights.get('bash_opportunity_rate', 0)
    fe_opp_rate = llm_insights.get('find_element_opportunity_rate', 0)
    common_mistakes = (llm_insights.get('common_tool_mistakes') or [])[:10]

    return {
        'total': len(results),
        'global_freq': global_freq[:15],
        'key_insights': key_insights,
        'app_summary': app_summary,
        'top_tool_mistakes': tool_mistakes.most_common(10),
        'top_missed_tools': agg_missed,
        'bash_opportunity_rate': bash_opp_rate,
        'find_element_opportunity_rate': fe_opp_rate,
        'common_mistakes': common_mistakes,
        'bash_opportunity_tasks': bash_opps[:10],
        'find_element_opportunity_tasks': fe_opps[:10],
    }


def load_skills_gap(path: Path) -> dict:
    d = json.loads(path.read_text())
    roadmap = d.get('skill_roadmap', [])
    mcp_opps = d.get('mcp_opportunities', [])
    llm_insights = d.get('llm_insights', {})
    summary = d.get('summary', {})
    results = d.get('results', [])

    # Per-category LLM knowledge gaps
    cat_knowledge: dict = defaultdict(list)
    cat_topics: dict = defaultdict(list)
    for r in results:
        cat = r.get('category', 'other')
        llm = r.get('llm') or {}
        for item in llm.get('missing_ui_knowledge', []):
            cat_knowledge[cat].append(item)
        for item in llm.get('missing_domain_knowledge', []):
            cat_knowledge[cat].append(item)
        for topic in llm.get('skill_md_topics', []):
            cat_topics[cat].append(topic)

    # Deduplicate
    cat_knowledge_dedup = {}
    for cat, items in cat_knowledge.items():
        seen = set()
        deduped = []
        for item in items:
            key = item[:60]
            if key not in seen:
                seen.add(key)
                deduped.append(item)
        cat_knowledge_dedup[cat] = deduped[:15]

    cat_topics_top = {}
    for cat, topics in cat_topics.items():
        tc = Counter(t[:80] for t in topics)
        cat_topics_top[cat] = tc.most_common(8)

    top_global_topics = llm_insights.get('top_skill_md_topics', [])[:15]

    return {
        'total': len(results),
        'summary': summary,
        'roadmap': roadmap,
        'mcp_opportunities': mcp_opps,
        'cat_knowledge': cat_knowledge_dedup,
        'cat_topics': cat_topics_top,
        'top_global_topics': top_global_topics,
    }


# ---------------------------------------------------------------------------
# Pass 2: LLM synthesis — one focused question per dimension
# ---------------------------------------------------------------------------

async def synthesize_all(client: httpx.AsyncClient, knowledge: dict,
                         termination: dict, tools: dict, skills: dict) -> dict:
    print('  [LLM] Synthesizing termination patterns...')
    term_ctx = f"""
Termination type distribution (121 failed tasks):
{json.dumps(termination['type_counts'], indent=2)}

Average steps used: {termination['avg_steps']}
Tasks where agent could have continued: {termination['premature_count']}/121

Top suggested fixes by type:
{json.dumps({k: [f[0] for f in v[:3]] for k, v in termination['top_fixes_by_type'].items()}, indent=2)}

WRONG_COMPLETION sample (agent called finished() incorrectly):
{json.dumps(termination['wrong_completion_sample'][:5], indent=2)}

MAX_STEPS_HIT sample:
{json.dumps(termination['max_steps_sample'][:5], indent=2)}
"""
    term_analysis = await ask_llm(client,
        'Based on this data: (1) What is the #1 systemic fix for WRONG_COMPLETION? '
        '(2) For MAX_STEPS_HIT, is the issue step count limit or inefficient execution? '
        '(3) What single prompt/system change would most reduce premature stops? '
        'Be specific and cite evidence from the data.',
        term_ctx, max_tokens=800)

    print('  [LLM] Synthesizing tool usage patterns...')
    tools_ctx = f"""
Per-app pass rates and tool usage:
{json.dumps(tools['app_summary'], indent=2)}

Global tool frequency (top 10):
{json.dumps([f"{e['tool']}: {e['total_calls']} calls ({e['pct_of_tasks']}% of tasks)" for e in tools['global_freq'][:10]], indent=2)}

Bash opportunity rate (tasks where bash would have helped): {tools['bash_opportunity_rate']}
find_element opportunity rate: {tools['find_element_opportunity_rate']}

Top tool mistakes:
{json.dumps(tools['top_tool_mistakes'][:8], indent=2)}

Key insights from pure parsing:
{json.dumps(tools['key_insights'], indent=2)}
"""
    tools_analysis = await ask_llm(client,
        'Based on this data: (1) Which apps have the worst tool strategy mismatch? '
        '(2) Is the bash underuse a prompt issue or a knowledge issue? '
        '(3) What are the top 3 concrete tool usage changes that would improve pass rate most? '
        'Cite specific numbers.',
        tools_ctx, max_tokens=800)

    print('  [LLM] Synthesizing knowledge gaps...')
    knowledge_ctx = f"""
Top missing knowledge items (frequency across 121 failed tasks):
{json.dumps(knowledge['top_missing_knowledge'][:12], indent=2)}

Top missing capabilities:
{json.dumps(knowledge['top_missing_capabilities'][:12], indent=2)}

Missing knowledge by app:
{json.dumps({app: items[:5] for app, items in knowledge['app_knowledge'].items()}, indent=2)}

Sample key insights from per-task analysis:
{chr(10).join(f'- {s}' for s in knowledge['key_insights_sample'][:12])}
"""
    knowledge_analysis = await ask_llm(client,
        'Based on this data: (1) What are the top 3 SKILL.md files to create immediately? '
        '(2) For LibreOffice Calc specifically, list the 5 most critical knowledge items to add. '
        '(3) What knowledge gap, if fixed, would have the highest impact on pass rate? '
        'Be concrete — suggest actual content for skill files.',
        knowledge_ctx, max_tokens=1000)

    print('  [LLM] Synthesizing skill gaps and roadmap...')
    skills_ctx = f"""
Skill gap roadmap (sorted by priority score = fail_count * (1 - success_rate)):
{json.dumps([{
    'category': r['category'],
    'task_count': r['task_count'],
    'pass_count': r['pass_count'],
    'success_rate': f"{r['success_rate']:.1%}",
    'has_skill': r['has_skill'],
    'priority': r['priority'],
    'score': r['priority_score'],
} for r in skills['roadmap']], indent=2)}

Top skill_md topics requested by LLM across all failed tasks:
{json.dumps([f"({e['count']}x) {e['topic']}" for e in skills['top_global_topics'][:12]], indent=2)}

MCP opportunities:
{json.dumps(skills['mcp_opportunities'], indent=2)}

Summary: {skills['summary']}
"""
    skills_analysis = await ask_llm(client,
        'Based on this data: (1) Prioritize the top 4 skill files to write (exact filenames and key sections). '
        '(2) For LibreOffice Calc with 0% success rate, what approach would work best: '
        '    GUI automation skill, bash/openpyxl automation, or MCP tool? '
        '(3) Which MCP opportunity has the best ROI? '
        'Give a concrete 4-week improvement roadmap.',
        skills_ctx, max_tokens=1000)

    print('  [LLM] Final integrated synthesis...')
    integrated_ctx = f"""
TERMINATION ANALYSIS SUMMARY:
{term_analysis}

TOOL USAGE ANALYSIS SUMMARY:
{tools_analysis}

KNOWLEDGE GAP ANALYSIS SUMMARY:
{knowledge_analysis}

SKILL GAP ANALYSIS SUMMARY:
{skills_analysis}

Raw key stats:
- Total failed tasks analyzed: 121
- WRONG_COMPLETION: {termination['type_counts'].get('WRONG_COMPLETION', 0)} (34%)
- MAX_STEPS_HIT: {termination['type_counts'].get('MAX_STEPS_HIT', 0)} (31%)
- PREMATURE_STOP: {termination['type_counts'].get('PREMATURE_STOP', 0)} (30%)
- Average steps per failed task: {termination['avg_steps']}
- 0 out of 7 task categories have any skill file
- LibreOffice Calc: 0% pass rate (47 tasks)
"""
    final_synthesis = await ask_llm(client,
        'You have read 4 analysis dimensions of a failing AI agent. '
        'Produce a final executive report with: '
        '(1) Root cause diagnosis — why is Jarvis failing at 79%? '
        '(2) The single highest-leverage fix (one thing). '
        '(3) A prioritized 3-phase improvement plan (week 1, week 2-3, month 2). '
        '(4) Expected pass rate improvement after each phase. '
        'Be bold and specific. No hedging.',
        integrated_ctx, max_tokens=1200)

    return {
        'termination_analysis': term_analysis,
        'tools_analysis': tools_analysis,
        'knowledge_analysis': knowledge_analysis,
        'skills_analysis': skills_analysis,
        'final_synthesis': final_synthesis,
    }


# ---------------------------------------------------------------------------
# Pass 3: Write markdown report
# ---------------------------------------------------------------------------

def write_report(knowledge: dict, termination: dict, tools: dict,
                 skills: dict, synthesis: dict) -> str:
    lines = []

    def h1(t): lines.append(f'\n# {t}\n')
    def h2(t): lines.append(f'\n## {t}\n')
    def h3(t): lines.append(f'\n### {t}\n')
    def p(t): lines.append(t)
    def sep(): lines.append('\n---\n')

    lines.append(f'# Jarvis Eval Analysis Report')
    lines.append(f'Generated: {datetime.now().strftime("%Y-%m-%d %H:%M")}')
    lines.append(f'Dataset: 177 tasks, 121 failed, 4 analysis dimensions\n')
    sep()

    # --- SECTION 1: EXECUTIVE SUMMARY ---
    h1('Executive Summary (LLM Synthesized)')
    p(synthesis['final_synthesis'])
    sep()

    # --- SECTION 2: TERMINATION ---
    h1('Termination Behavior Analysis')
    tc = termination['type_counts']
    total = sum(tc.values())
    h2('Distribution')
    for ttype, count in sorted(tc.items(), key=lambda x: -x[1]):
        pct = round(count / total * 100)
        bar = '█' * (pct // 5)
        p(f'- **{ttype}**: {count} ({pct}%) {bar}')
    p(f'\n**Average steps per failed task**: {termination["avg_steps"]}')
    p(f'**Tasks that could have continued**: {termination["premature_count"]}/121 ({round(termination["premature_count"]/121*100)}%)')

    h2('LLM Diagnosis')
    p(synthesis['termination_analysis'])

    h2('WRONG_COMPLETION — Sample Evidence')
    for t in termination['wrong_completion_sample'][:5]:
        p(f'- `{t["task_id"]}` {t["instruction"][:70]}')
        p(f'  - Evidence: {t["evidence"][:120]}')
        p(f'  - Fix: {t["fix"][:100]}')
    sep()

    # --- SECTION 3: TOOL USAGE ---
    h1('Tool Usage Analysis')
    h2('Per-App Pass Rate & Tool Strategies')
    p('| App | Tasks | Pass% | Bash% | find_el% | Avg Steps (fail) |')
    p('|-----|-------|-------|-------|----------|-----------------|')
    for app, s in sorted(tools['app_summary'].items(), key=lambda x: -x[1]['total']):
        p(f'| {app} | {s["total"]} | {s["pass_rate"]}% | {s["bash_rate"]}% | {s["find_element_rate"]}% | {s["avg_steps_fail"]} |')

    h2('Top Tool Calls (Global)')
    for e in tools['global_freq'][:10]:
        p(f'- `{e["tool"]}`: {e["total_calls"]} calls, used in {e["pct_of_tasks"]}% of tasks')

    p(f'\n**Bash opportunity rate**: {tools["bash_opportunity_rate"]} (tasks where bash would have helped)')
    p(f'**find_element opportunity rate**: {tools["find_element_opportunity_rate"]}')

    h2('LLM Diagnosis')
    p(synthesis['tools_analysis'])

    if tools['top_tool_mistakes']:
        h2('Top Tool Mistakes (from per-task LLM)')
        for mistake, count in tools['top_tool_mistakes'][:8]:
            p(f'- ({count}x) {mistake}')
    sep()

    # --- SECTION 4: KNOWLEDGE GAPS ---
    h1('Knowledge Gap Analysis')
    h2('Top Missing Knowledge Items')
    for item in knowledge['top_missing_knowledge'][:12]:
        p(f'- ({item["count"]}x) {item["item"]}')

    h2('Top Missing Capabilities')
    for item in knowledge['top_missing_capabilities'][:10]:
        p(f'- ({item["count"]}x) {item["item"]}')

    h2('Missing Knowledge by App')
    for app, items in knowledge['app_knowledge'].items():
        h3(app)
        for item in items[:8]:
            p(f'- {item}')

    h2('LLM Diagnosis')
    p(synthesis['knowledge_analysis'])
    sep()

    # --- SECTION 5: SKILL GAPS ---
    h1('Skill Gap Analysis')
    h2('Priority Roadmap')
    p('| Category | Tasks | Pass% | Has Skill | Priority | Score |')
    p('|----------|-------|-------|-----------|----------|-------|')
    for r in skills['roadmap']:
        p(f'| {r["category"]} | {r["task_count"]} | {r["success_rate"]:.0%} | {"YES" if r["has_skill"] else "NO"} | {r["priority"].upper()} | {r["priority_score"]:.1f} |')

    h2('Top SKILL.md Topics Needed')
    for entry in skills['top_global_topics'][:12]:
        count = entry.get('count', 0)
        topic = entry.get('topic', '')
        apps = ', '.join(entry.get('apps', []))
        p(f'- ({count}x) {topic} [{apps}]')

    h2('MCP Opportunities')
    for opp in skills['mcp_opportunities']:
        p(f'- **{opp["category"]}** ({opp["matched_task_count"]} tasks): {opp["mcp_suggestion"]}')

    h2('LLM Diagnosis')
    p(synthesis['skills_analysis'])
    sep()

    # --- SECTION 6: PER-APP DETAILED KNOWLEDGE ---
    h1('Per-App Required Knowledge (for Skill Files)')
    for cat, items in skills['cat_knowledge'].items():
        if not items:
            continue
        h2(cat)
        for item in items[:12]:
            p(f'- {item}')

    report = '\n'.join(lines)
    return report


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main():
    print('Phase 1: Loading and parsing result files...')

    for name, path in FILES.items():
        if not path.exists():
            print(f'  MISSING: {path}')
            sys.exit(1)
        print(f'  OK: {name} ({path.stat().st_size // 1024} KB)')

    print()
    print('Phase 1a: Extracting structured summaries...')
    knowledge = load_knowledge(FILES['knowledge'])
    termination = load_termination(FILES['termination'])
    tools = load_tools(FILES['tools'])
    skills = load_skills_gap(FILES['skills_gap'])
    print(f'  knowledge: {knowledge["total"]} tasks, {len(knowledge["top_missing_knowledge"])} top items')
    print(f'  termination: {termination["total"]} tasks, {termination["type_counts"]}')
    print(f'  tools: {tools["total"]} tasks, bash_opp={tools["bash_opportunity_rate"]}')
    print(f'  skills: {skills["total"]} tasks, {len(skills["roadmap"])} categories')

    print()
    print('Phase 2: LLM synthesis (5 focused questions)...')
    async with httpx.AsyncClient() as client:
        synthesis = await synthesize_all(client, knowledge, termination, tools, skills)
    print('  Done.')

    print()
    print('Phase 3: Writing report...')
    report_md = write_report(knowledge, termination, tools, skills, synthesis)
    OUTPUT_MD.write_text(report_md, encoding='utf-8')
    print(f'  Report: {OUTPUT_MD} ({len(report_md) // 1024} KB)')

    # Save structured data
    structured = {
        'generated_at': datetime.now().isoformat(),
        'knowledge': knowledge,
        'termination': termination,
        'tools': tools,
        'skills': skills,
        'synthesis': synthesis,
    }
    OUTPUT_JSON.write_text(json.dumps(structured, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f'  Data: {OUTPUT_JSON}')

    print()
    print('=' * 60)
    print('FINAL SYNTHESIS PREVIEW:')
    print('=' * 60)
    print(synthesis['final_synthesis'][:1500])


if __name__ == '__main__':
    asyncio.run(main())
