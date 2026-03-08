#!/usr/bin/env python3
"""
Extract all click actions with full conversation context from eval traces.

For each click, extracts:
- The COMPUTER step before the click (all screenshots + recent actions text)
- The ASSISTANT step containing the click (tool calls text)
- The COMPUTER step after the click (all screenshots + recent actions text)

This gives the LLM full context to judge whether the click caused the expected UI change.

Output: improve/analysis/clicks.json
"""

import json
import re
import sys
from pathlib import Path

RESULTS_DIR = Path('/Users/Ninot/NinotQuyi/jarvis/results/eval-nogdrive-20260308-010648')
TRACES_BASE = Path('/Users/Ninot/NinotQuyi/jarvis/data')
OUTPUT_FILE = Path('/Users/Ninot/NinotQuyi/jarvis/improve/analysis/clicks.json')


def resolve_screenshot(rel_path: str, trace_path: Path):
    trace_dir = trace_path.parent
    abs_path = (trace_dir / rel_path).resolve()
    return str(abs_path)


def extract_screenshots(step_text: str, trace_path: Path):
    """Return list of absolute screenshot paths found in a step."""
    refs = re.findall(r'!\[screen\]\((.*?)\)', step_text)
    return [resolve_screenshot(r, trace_path) for r in refs]


def extract_recent_actions(step_text: str):
    """Extract the Recent Actions section text from a COMPUTER step."""
    m = re.search(r'## Recent Actions\n(.*?)(?=\n## |\n---|\Z)', step_text, re.DOTALL)
    return m.group(1).strip() if m else ''


def extract_clicks_from_trace(trace_path: Path, task_id: str, instruction: str,
                               task_result: float, task_done: bool):
    try:
        content = trace_path.read_text(encoding='utf-8')
    except Exception as e:
        print(f"  [WARN] Cannot read trace {trace_path}: {e}")
        return []

    steps = content.split('\n===\n')
    task_success = task_result >= 1.0 or (task_done and task_result > 0)
    clicks = []

    for i, step in enumerate(steps):
        if '## ASSISTANT' not in step:
            continue

        # Find all click tool calls in this ASSISTANT step
        tool_click_matches = re.findall(r'- `click\((\{.*?\})\)`', step)
        if not tool_click_matches:
            continue

        # COMPUTER step before (context + before screenshots)
        before_step = steps[i - 1] if i > 0 else ''
        before_screenshots = extract_screenshots(before_step, trace_path)
        before_actions = extract_recent_actions(before_step)

        # COMPUTER step after (result screenshots)
        after_step = steps[i + 1] if i + 1 < len(steps) else ''
        after_screenshots = extract_screenshots(after_step, trace_path)
        after_actions = extract_recent_actions(after_step)

        # The click that was just executed appears as the LAST click in after_step recent actions
        # Parse click results from after_step
        recent_clicks = re.findall(r'\[click\] (\{.*?\}) -> (success|failed)', after_step)
        result_by_coord = {}
        for rc_json, rc_status in recent_clicks:
            try:
                rc = json.loads(rc_json)
                result_by_coord[str(rc.get('coordinate', ''))] = rc_status
            except Exception:
                pass

        # The ASSISTANT step text (tool calls)
        assistant_text = step.strip()

        for j, tc_json in enumerate(tool_click_matches):
            try:
                tc = json.loads(tc_json)
            except Exception:
                try:
                    tc = json.loads(tc_json + '}')
                except Exception:
                    continue

            coord = tc.get('coordinate', [])
            desc = tc.get('desc', '')
            click_result = result_by_coord.get(str(coord), 'unknown')

            # For multi-click steps: before is same for all, after is same for all
            # (limitation: can't tell exactly which screenshot corresponds to which click)
            clicks.append({
                'task_id': task_id,
                'instruction': instruction,
                'task_result': task_result,
                'task_done': task_done,
                'task_success': task_success,
                'trace_path': str(trace_path),
                'step_index': i,
                'click_index_in_step': j,
                'total_clicks_in_step': len(tool_click_matches),
                'coordinate': coord,
                'desc': desc,
                'click_result': click_result,
                # Full context for LLM analysis
                'before_screenshots': before_screenshots,
                'after_screenshots': after_screenshots,
                'before_recent_actions': before_actions,
                'after_recent_actions': after_actions,
                'assistant_tool_calls': assistant_text,
                # Convenience: single before/after (last before, last after)
                'before_screenshot': before_screenshots[-1] if before_screenshots else None,
                'after_screenshot': after_screenshots[-1] if after_screenshots else None,
            })

    return clicks


def main():
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    task_dirs = [d for d in RESULTS_DIR.iterdir() if d.is_dir()]
    print(f"Found {len(task_dirs)} task result folders")

    all_clicks = []
    processed = 0
    skipped_no_result = 0
    skipped_no_trace = 0

    for task_dir in sorted(task_dirs):
        result_file = task_dir / 'result.json'
        if not result_file.exists():
            skipped_no_result += 1
            continue

        try:
            result = json.loads(result_file.read_text())
        except Exception as e:
            print(f"  [WARN] {result_file}: {e}")
            continue

        task_id = result.get('task_id', task_dir.name)
        instruction = result.get('instruction', '')
        task_result = float(result.get('result', 0.0) or 0.0)
        task_done = bool(result.get('done', False))
        trace_path_local = result.get('trace_path_local', '')

        if not trace_path_local:
            skipped_no_trace += 1
            continue

        trace_path = Path(trace_path_local)
        if not trace_path.exists():
            fallback = TRACES_BASE / 'traces' / Path(trace_path_local).name
            if fallback.exists():
                trace_path = fallback
            else:
                print(f"  [WARN] Trace not found: {trace_path_local}")
                skipped_no_trace += 1
                continue

        clicks = extract_clicks_from_trace(trace_path, task_id, instruction, task_result, task_done)
        all_clicks.extend(clicks)
        processed += 1

        status = 'PASS' if (task_result >= 1.0 or (task_done and task_result > 0)) else 'FAIL'
        print(f"  [{status}] {task_id[:8]}  clicks={len(clicks)}  trace={trace_path.name}")

    summary = {
        'total_tasks_processed': processed,
        'skipped_no_result': skipped_no_result,
        'skipped_no_trace': skipped_no_trace,
        'total_clicks': len(all_clicks),
        'clicks_in_successful_tasks': sum(1 for c in all_clicks if c['task_success']),
        'clicks_in_failed_tasks': sum(1 for c in all_clicks if not c['task_success']),
    }

    OUTPUT_FILE.write_text(json.dumps({'summary': summary, 'clicks': all_clicks}, indent=2, ensure_ascii=False))

    print()
    print('=' * 60)
    print(f"Tasks processed: {processed}")
    print(f"Total clicks: {len(all_clicks)}")
    print(f"Output: {OUTPUT_FILE}")


if __name__ == '__main__':
    main()
