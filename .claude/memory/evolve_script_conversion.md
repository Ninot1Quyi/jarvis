---
name: evolve_tool_script_conversion
description: Converted evolve tools to use script-based implementation layer
type: reference
---

## Conversion Summary

evolve_self steps 3-5 now delegate to `skills/evolve/scripts/evolve_main.sh`, falling back to Rust LLM calls if script unavailable.

### Files Changed
- `src/tools/evolve/mod.rs`: Added `run_comparison_with_script()` and `run_apply_with_script()` helpers
- `skills/evolve/scripts/evolve_main.sh`: New script implementing compare/plan/apply workflow
- `skills/evolve/SKILL.md`: Updated with script documentation and launch_subagent section
