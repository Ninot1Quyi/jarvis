#!/usr/bin/env python3
"""
Analyze tool usage patterns from Jarvis eval traces.

Phase 1: Pure parsing of tool call statistics for ALL tasks.
Phase 2: LLM analysis (Gemini) per FAILED task - sends full trace as conversation history.
"""

import json
import base64
import asyncio
import re
import os
import sys
import io
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from PIL import Image
import httpx

# ---- Config ----
API_KEY = 'sk-TfN0Js5VKZcD6O1rJSSixnTYayhIqrnhHKUHXM1mCjf3CrIc'
BASE_URL = 'https://api.duojie.games/v1'
MODEL = 'gemini-3.1-pro'
CONCURRENCY = 5
MAX_RETRIES = 3
MAX_STEPS = 30
MAX_DIM = 600

RESULTS_DIR = Path('/Users/Ninot/NinotQuyi/jarvis/results/eval-nogdrive-20260308-010648')
TRACES_BASE = Path('/Users/Ninot/NinotQuyi/jarvis/data')
OUTPUT_FILE = Path('/Users/Ninot/NinotQuyi/jarvis/improve/analysis/results/tool_analysis_20260308.json')
CLICK_ANALYSIS_FILE = Path('/Users/Ninot/NinotQuyi/jarvis/improve/analysis/click_analysis.json')

TOOL_PATTERN = re.compile(r'- `(\w+)\(')


# ---------------------------------------------------------------------------
# Image helpers
# ---------------------------------------------------------------------------

def compress_image(path):
    try:
        img = Image.open(path)
        if img.mode in ('RGBA', 'LA', 'P'):
            img = img.convert('RGB')
        img.thumbnail((MAX_DIM, MAX_DIM))
        buf = io.BytesIO()
        img.save(buf, format='JPEG', quality=75)
        return base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return None


def resolve_screenshot(rel_path, trace_path):
    abs_path = (trace_path.parent / rel_path).resolve()
    return str(abs_path)


# ---------------------------------------------------------------------------
# Pure parsing
# ---------------------------------------------------------------------------

def load_json(path):
    if not path.exists():
        return None
    try:
        with open(path) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def determine_success(result_data):
    result = result_data.get('result', 0)
    done = result_data.get('done', False)
    try:
        r = float(result)
    except (TypeError, ValueError):
        r = 0.0
    return r >= 1.0 or (done and r > 0)


def parse_trace(trace_path_str):
    """
    Parse a trace .md file split by '\n===\n'.
    Returns (tool_call_counts, assistant_step_count).
    """
    tool_counts = defaultdict(int)
    assistant_steps = 0

    path = Path(trace_path_str)
    if not path.exists():
        return dict(tool_counts), assistant_steps

    try:
        content = path.read_text(encoding='utf-8', errors='replace')
    except OSError:
        return dict(tool_counts), assistant_steps

    sections = content.split('\n===\n')
    for section in sections:
        if '## ASSISTANT' not in section:
            continue
        assistant_steps += 1
        for tool_name in TOOL_PATTERN.findall(section):
            tool_counts[tool_name] += 1

    return dict(tool_counts), assistant_steps


def collect_all_tasks():
    """Load and parse every task in RESULTS_DIR (pass and fail)."""
    tasks = []
    if not RESULTS_DIR.exists():
        return tasks

    for uuid in os.listdir(RESULTS_DIR):
        task_dir = RESULTS_DIR / uuid
        if not task_dir.is_dir():
            continue

        config_data = load_json(task_dir / 'task_config.json')
        result_data = load_json(task_dir / 'result.json')

        if config_data is None or result_data is None:
            continue

        app = config_data.get('snapshot', 'unknown')
        instruction = result_data.get('instruction', config_data.get('instruction', ''))
        task_success = determine_success(result_data)
        trace_path_str = result_data.get('trace_path_local', '')

        # Resolve trace path
        trace_path = None
        if trace_path_str:
            p = Path(trace_path_str)
            if p.exists():
                trace_path = p
            else:
                fallback = TRACES_BASE / 'traces' / Path(trace_path_str).name
                if fallback.exists():
                    trace_path = fallback

        tool_counts, steps = parse_trace(str(trace_path)) if trace_path else ({}, 0)

        total_calls = sum(tool_counts.values())
        used_bash = tool_counts.get('bash', 0) > 0
        used_find_element = tool_counts.get('find_element', 0) > 0

        tasks.append({
            'task_id': uuid,
            'app': app,
            'instruction': instruction,
            'task_success': task_success,
            'trace_path': str(trace_path) if trace_path else '',
            'parse': {
                'tool_call_counts': tool_counts,
                'total_tool_calls': total_calls,
                'used_bash': used_bash,
                'used_find_element': used_find_element,
                'steps': steps,
            },
        })

    return tasks


# ---------------------------------------------------------------------------
# Per-app statistics (pure parsing)
# ---------------------------------------------------------------------------

def load_click_miss_rates(tasks):
    click_data = load_json(CLICK_ANALYSIS_FILE)
    if click_data is None or 'clicks' not in click_data:
        return {}

    task_app = {t['task_id']: t['app'] for t in tasks}
    app_hits = defaultdict(int)
    app_misses = defaultdict(int)

    for click in click_data['clicks']:
        task_id = click.get('task_id', '')
        app = task_app.get(task_id)
        if app is None:
            continue
        verdict = click.get('llm_verdict', '')
        if verdict == 'MISS':
            app_misses[app] += 1
        elif verdict == 'HIT':
            app_hits[app] += 1

    miss_rates = {}
    for app in set(list(app_hits.keys()) + list(app_misses.keys())):
        total = app_hits[app] + app_misses[app]
        if total > 0:
            miss_rates[app] = round(app_misses[app] / total, 4)
        else:
            miss_rates[app] = 0.0

    return miss_rates


def safe_avg(values):
    if not values:
        return 0.0
    return round(sum(values) / len(values), 2)


def top_tools_for_tasks(tasks_list, top_n=10):
    total_calls = defaultdict(int)
    tasks_using = defaultdict(int)
    n = len(tasks_list)

    for task in tasks_list:
        for tool, count in task['parse']['tool_call_counts'].items():
            total_calls[tool] += count
            if count > 0:
                tasks_using[tool] += 1

    ranked = sorted(total_calls.keys(), key=lambda t: total_calls[t], reverse=True)
    result = []
    for tool in ranked[:top_n]:
        result.append({
            'tool': tool,
            'count': total_calls[tool],
            'pct_of_tasks': round(tasks_using[tool] / n * 100, 1) if n > 0 else 0.0,
        })
    return result


def build_app_stats(tasks, click_miss_rates):
    by_app = defaultdict(list)
    for task in tasks:
        by_app[task['app']].append(task)

    app_stats = {}
    for app, app_tasks in by_app.items():
        pass_tasks = [t for t in app_tasks if t['task_success']]
        fail_tasks = [t for t in app_tasks if not t['task_success']]

        bash_users = sum(1 for t in app_tasks if t['parse']['used_bash'])
        fe_users = sum(1 for t in app_tasks if t['parse']['used_find_element'])
        n = len(app_tasks)

        app_stats[app] = {
            'total': n,
            'pass': len(pass_tasks),
            'fail': len(fail_tasks),
            'avg_steps_pass': safe_avg([t['parse']['steps'] for t in pass_tasks]),
            'avg_steps_fail': safe_avg([t['parse']['steps'] for t in fail_tasks]),
            'bash_usage_rate': round(bash_users / n, 4) if n > 0 else 0.0,
            'find_element_usage_rate': round(fe_users / n, 4) if n > 0 else 0.0,
            'click_miss_rate': click_miss_rates.get(app, None),
            'top_tools': top_tools_for_tasks(app_tasks),
            'pass_top_tools': top_tools_for_tasks(pass_tasks) if pass_tasks else [],
            'fail_top_tools': top_tools_for_tasks(fail_tasks) if fail_tasks else [],
        }

    return app_stats


def build_global_tool_frequency(tasks):
    total_calls = defaultdict(int)
    tasks_using = defaultdict(int)
    n = len(tasks)

    for task in tasks:
        for tool, count in task['parse']['tool_call_counts'].items():
            total_calls[tool] += count
            if count > 0:
                tasks_using[tool] += 1

    ranked = sorted(total_calls.keys(), key=lambda t: total_calls[t], reverse=True)
    return [
        {
            'tool': tool,
            'total_calls': total_calls[tool],
            'tasks_using': tasks_using[tool],
            'pct_of_tasks': round(tasks_using[tool] / n * 100, 1) if n > 0 else 0.0,
        }
        for tool in ranked
    ]


def find_underused_tools(global_freq, threshold_pct=10.0):
    return [
        entry['tool']
        for entry in global_freq
        if entry['pct_of_tasks'] < threshold_pct
    ]


def generate_key_insights(by_app, global_freq):
    insights = []

    for app, stats in by_app.items():
        n = stats['total']
        if n == 0:
            continue

        pass_rate = stats['pass'] / n
        bash_rate = stats['bash_usage_rate']
        fe_rate = stats['find_element_usage_rate']
        miss_rate = stats.get('click_miss_rate')

        app_label = app.replace('_', ' ').title()

        if pass_rate == 0.0 and bash_rate < 0.1 and n >= 3:
            insights.append(
                f"{app_label}: 0% pass rate with {bash_rate*100:.0f}% bash usage "
                f"({n} tasks) - bash automation may help"
            )

        if pass_rate == 0.0 and fe_rate < 0.2 and n >= 3:
            insights.append(
                f"{app_label}: 0% pass rate with {fe_rate*100:.0f}% find_element usage "
                f"({n} tasks) - semantic element finding underutilized"
            )

        if miss_rate is not None and miss_rate > 0.2:
            insights.append(
                f"{app_label}: high click miss rate {miss_rate*100:.1f}% "
                f"- coordinate-based clicking is unreliable for this app"
            )

        if pass_rate < 0.2 and miss_rate is not None and miss_rate > 0.15 and n >= 3:
            insights.append(
                f"{app_label}: pass rate {pass_rate*100:.0f}% correlates with "
                f"click miss rate {miss_rate*100:.1f}% - fix clicking accuracy first"
            )

        avg_pass = stats['avg_steps_pass']
        avg_fail = stats['avg_steps_fail']
        if avg_pass > 0 and avg_fail > 0 and avg_fail > avg_pass * 1.5 and stats['fail'] >= 3:
            insights.append(
                f"{app_label}: failed tasks average {avg_fail:.1f} steps vs "
                f"{avg_pass:.1f} for successes - agent loops without progress"
            )

    fe_global = next((e for e in global_freq if e['tool'] == 'find_element'), None)
    if fe_global and fe_global['pct_of_tasks'] < 30.0:
        insights.append(
            f"find_element used in only {fe_global['pct_of_tasks']}% of all tasks "
            f"- consider promoting semantic element finding in system prompt"
        )

    bash_global = next((e for e in global_freq if e['tool'] == 'bash'), None)
    if bash_global and bash_global['pct_of_tasks'] < 20.0:
        insights.append(
            f"bash used in only {bash_global['pct_of_tasks']}% of all tasks "
            f"- shell automation could accelerate many tasks"
        )

    return insights


# ---------------------------------------------------------------------------
# LLM message building
# ---------------------------------------------------------------------------

ANALYSIS_QUESTION_TEMPLATE = (
    'The task was: "{instruction}"\n'
    'The task was NOT completed successfully.\n\n'
    'Looking at all steps and screenshots above, analyze the tool usage:\n\n'
    '1. Which tools were used? Were they the right choices for this task?\n'
    '2. Which tools were NOT used but SHOULD have been (e.g., bash+openpyxl instead of GUI clicks for spreadsheets, find_element instead of hardcoded coordinates, locate before clicking)?\n'
    '3. What specific tool usage mistakes led to failure?\n\n'
    'Respond in this exact JSON format:\n'
    '{{\n'
    '  "tools_used": ["tool1", "tool2"],\n'
    '  "tools_should_have_used": ["bash", "find_element"],\n'
    '  "tool_mistakes": ["description of mistake 1", "description of mistake 2"],\n'
    '  "bash_opportunity": true/false,\n'
    '  "find_element_opportunity": true/false,\n'
    '  "key_insight": "one sentence summary of the core tool usage problem"\n'
    '}}'
)


def build_messages(trace_path, instruction):
    """
    Convert trace into OpenAI message history.
    - system step -> system message (first 800 chars)
    - USER step: buffer text, merge into next COMPUTER step
    - COMPUTER step -> user message: [Task text] + [Recent Actions] + ALL screenshots
    - ASSISTANT step -> assistant message: tool calls text
    - Merge consecutive same-role messages
    - Final user message asks the analysis question
    """
    try:
        content = trace_path.read_text(encoding='utf-8')
    except Exception as e:
        return None, f"Cannot read trace: {e}"

    steps = content.split('\n===\n')
    messages = []

    # System message: first step truncated to 800 chars
    system_step = steps[0] if steps else ''
    system_text = system_step[:800].strip()
    messages.append({'role': 'system', 'content': system_text})

    step_count = 0
    pending_user_text = None

    for step in steps[1:]:
        if step_count >= MAX_STEPS:
            break

        if '## USER' in step:
            m = re.search(r'<tui>(.*?)</tui>', step, re.DOTALL)
            pending_user_text = m.group(1).strip() if m else step.strip()[-500:]
            pending_user_text = pending_user_text[:500]

        elif '## COMPUTER' in step:
            recent = ''
            m = re.search(r'## Recent Actions\n(.*?)(?=\n## |\n---|\Z)', step, re.DOTALL)
            if m:
                recent = m.group(1).strip()

            # ALL screenshots, no limit
            imgs = re.findall(r'!\[screen\]\((.*?)\)', step)
            img_content = []
            for rel in imgs:
                abs_path = resolve_screenshot(rel, trace_path)
                if Path(abs_path).exists():
                    b64 = compress_image(abs_path)
                    if b64:
                        img_content.append({
                            'type': 'image_url',
                            'image_url': {'url': f'data:image/jpeg;base64,{b64}'}
                        })

            parts = []
            if pending_user_text:
                parts.append({'type': 'text', 'text': f'[Task] {pending_user_text}'})
                pending_user_text = None
            if recent:
                parts.append({'type': 'text', 'text': f'[Recent Actions]\n{recent}'})
            parts.extend(img_content)
            if not parts:
                parts.append({'type': 'text', 'text': '[Screen state]'})

            # Merge consecutive user messages
            if messages and messages[-1]['role'] == 'user':
                prev = messages[-1]['content']
                if isinstance(prev, list):
                    messages[-1]['content'] = prev + parts
                else:
                    messages[-1]['content'] = [{'type': 'text', 'text': prev}] + parts
            else:
                messages.append({'role': 'user', 'content': parts})
            step_count += 1

        elif '## ASSISTANT' in step:
            tool_calls = re.findall(r'- `(\w+)\((.*?)\)`', step, re.DOTALL)
            if tool_calls:
                calls_text = '\n'.join(
                    f'{name}({args[:200]})' for name, args in tool_calls
                )
                assistant_text = f'[Actions taken]\n{calls_text}'
                if messages and messages[-1]['role'] == 'assistant':
                    messages[-1]['content'] += '\n' + assistant_text
                else:
                    messages.append({'role': 'assistant', 'content': assistant_text})
            step_count += 1

    # Final analysis question
    question = ANALYSIS_QUESTION_TEMPLATE.format(instruction=instruction)
    messages.append({'role': 'user', 'content': question})

    return messages, None


# ---------------------------------------------------------------------------
# LLM call
# ---------------------------------------------------------------------------

async def analyze_task_llm(client, task, index, semaphore, counter, total):
    async with semaphore:
        task_id = task['task_id']
        instruction = task['instruction']
        trace_path = Path(task['trace_path'])

        messages, err = build_messages(trace_path, instruction)
        if messages is None:
            counter[0] += 1
            pct = counter[0] / total * 100
            print(f'  [{counter[0]:03d}/{total} {pct:.0f}%] {task_id[:8]} -> ERROR: {err}')
            return {
                'task_id': task_id,
                'instruction': instruction,
                'app': task['app'],
                'task_success': task['task_success'],
                'parse': task['parse'],
                'llm': None,
                'error': err,
            }

        payload = {
            'model': MODEL,
            'max_tokens': 800,
            'messages': messages,
        }

        last_err = ''
        for attempt in range(MAX_RETRIES):
            try:
                resp = await client.post(
                    f'{BASE_URL}/chat/completions',
                    json=payload,
                    headers={
                        'Authorization': f'Bearer {API_KEY}',
                        'content-type': 'application/json',
                    },
                    timeout=180.0
                )
                resp.raise_for_status()
                data = resp.json()
                text = data['choices'][0]['message']['content'].strip()

                parsed = {}
                try:
                    m = re.search(r'\{[\s\S]*\}', text)
                    if m:
                        parsed = json.loads(m.group(0))
                except Exception:
                    parsed = {'raw': text}

                llm_result = {
                    'tools_used': parsed.get('tools_used', []),
                    'tools_should_have_used': parsed.get('tools_should_have_used', []),
                    'tool_mistakes': parsed.get('tool_mistakes', []),
                    'bash_opportunity': bool(parsed.get('bash_opportunity', False)),
                    'find_element_opportunity': bool(parsed.get('find_element_opportunity', False)),
                    'key_insight': parsed.get('key_insight', ''),
                }

                counter[0] += 1
                pct = counter[0] / total * 100
                print(
                    f'  [{counter[0]:03d}/{total} {pct:.0f}%] {task_id[:8]} -> OK | '
                    f'{llm_result["key_insight"][:60]}'
                )

                return {
                    'task_id': task_id,
                    'instruction': instruction,
                    'app': task['app'],
                    'task_success': task['task_success'],
                    'parse': task['parse'],
                    'llm': llm_result,
                }

            except Exception as e:
                last_err = str(e)[:200]
                if attempt < MAX_RETRIES - 1:
                    wait = 2 ** attempt
                    print(f'  [{index:03d}] RETRY {attempt+1} in {wait}s: {last_err[:60]}')
                    await asyncio.sleep(wait)

        counter[0] += 1
        pct = counter[0] / total * 100
        print(f'  [{counter[0]:03d}/{total} {pct:.0f}%] {task_id[:8]} -> FAILED: {last_err[:60]}')
        return {
            'task_id': task_id,
            'instruction': instruction,
            'app': task['app'],
            'task_success': task['task_success'],
            'parse': task['parse'],
            'llm': None,
            'error': last_err,
        }


# ---------------------------------------------------------------------------
# Aggregation of LLM results
# ---------------------------------------------------------------------------

def aggregate_llm_insights(llm_results):
    missed_tool_freq = defaultdict(int)
    bash_opportunity_count = 0
    fe_opportunity_count = 0
    all_mistakes = []
    n = len(llm_results)

    for r in llm_results:
        llm = r.get('llm')
        if not llm:
            continue
        for tool in llm.get('tools_should_have_used', []):
            missed_tool_freq[tool] += 1
        if llm.get('bash_opportunity'):
            bash_opportunity_count += 1
        if llm.get('find_element_opportunity'):
            fe_opportunity_count += 1
        for mistake in llm.get('tool_mistakes', []):
            all_mistakes.append(mistake)

    top_missed = sorted(missed_tool_freq.items(), key=lambda x: -x[1])
    top_missed_list = [{'tool': t, 'count': c} for t, c in top_missed]

    # Deduplicate common mistakes (keep most frequent exact strings)
    mistake_freq = defaultdict(int)
    for m in all_mistakes:
        mistake_freq[m] += 1
    common_mistakes = [
        m for m, _ in sorted(mistake_freq.items(), key=lambda x: -x[1])[:20]
    ]

    return {
        'top_missed_tools': top_missed_list,
        'bash_opportunity_rate': round(bash_opportunity_count / n, 4) if n > 0 else 0.0,
        'find_element_opportunity_rate': round(fe_opportunity_count / n, 4) if n > 0 else 0.0,
        'common_tool_mistakes': common_mistakes,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main(limit=None):
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    print("Collecting all tasks (pure parsing)...")
    all_tasks = collect_all_tasks()
    print(f"  Found {len(all_tasks)} tasks total")

    print("Loading click miss rates...")
    click_miss_rates = load_click_miss_rates(all_tasks)
    print(f"  Click data for {len(click_miss_rates)} apps")

    print("Building per-app statistics...")
    by_app = build_app_stats(all_tasks, click_miss_rates)

    print("Building global tool frequency...")
    global_freq = build_global_tool_frequency(all_tasks)

    print("Finding underused tools...")
    underused = find_underused_tools(global_freq)

    print("Generating heuristic key insights...")
    key_insights = generate_key_insights(by_app, global_freq)

    # Identify failed tasks with a trace for LLM analysis
    failed_with_trace = [
        t for t in all_tasks
        if not t['task_success'] and t['trace_path']
    ]
    if limit:
        failed_with_trace = failed_with_trace[:limit]

    print(f"Failed tasks with trace: {len(failed_with_trace)}")

    # Load existing LLM results for incremental resume
    existing_llm = {}
    if OUTPUT_FILE.exists():
        try:
            prev = json.loads(OUTPUT_FILE.read_text())
            for r in prev.get('results', []):
                if r.get('llm') and not r.get('error'):
                    existing_llm[r['task_id']] = r
            print(f"Resuming: {len(existing_llm)} LLM results already done")
        except Exception:
            pass

    to_analyze = [
        (i, t) for i, t in enumerate(failed_with_trace)
        if t['task_id'] not in existing_llm
    ]
    already_done_llm = [
        existing_llm[t['task_id']] for t in failed_with_trace
        if t['task_id'] in existing_llm
    ]

    total_llm = len(to_analyze)
    print(f"Already done: {len(already_done_llm)}, To analyze: {total_llm}")
    print(f"Model: {MODEL}  Concurrency: {CONCURRENCY}")
    print(f"Started: {datetime.now().strftime('%H:%M:%S')}")
    print()

    counter = [0]
    new_llm_results = []
    if to_analyze:
        semaphore = asyncio.Semaphore(CONCURRENCY)
        async with httpx.AsyncClient() as client:
            coros = [
                analyze_task_llm(client, t, i, semaphore, counter, total_llm)
                for i, t in to_analyze
            ]
            new_llm_results = await asyncio.gather(*coros)

    all_llm_results = already_done_llm + list(new_llm_results)

    llm_insights = aggregate_llm_insights(all_llm_results)

    output = {
        'generated_at': datetime.now().isoformat(),
        'model': MODEL,
        'total_tasks_analyzed': len(all_llm_results),
        'by_app': by_app,
        'global_tool_frequency': global_freq,
        'underused_tools': underused,
        'key_insights': key_insights,
        'llm_insights': llm_insights,
        'results': all_llm_results,
    }

    OUTPUT_FILE.write_text(json.dumps(output, indent=2, ensure_ascii=False))

    # Summary
    print()
    print("=" * 60)
    print("TOOL USAGE ANALYSIS SUMMARY")
    print("=" * 60)
    print(f"Generated at : {output['generated_at']}")
    print(f"Total tasks  : {len(all_tasks)}")
    print(f"LLM analyzed : {len(all_llm_results)} failed tasks")
    print()

    print("PER-APP RESULTS:")
    for app, stats in by_app.items():
        n = stats['total']
        pass_pct = stats['pass'] / n * 100 if n > 0 else 0
        miss = stats['click_miss_rate']
        miss_str = f"{miss*100:.1f}%" if miss is not None else "n/a"
        print(
            f"  {app:<25} "
            f"pass={stats['pass']}/{n} ({pass_pct:.0f}%)  "
            f"bash={stats['bash_usage_rate']*100:.0f}%  "
            f"find_el={stats['find_element_usage_rate']*100:.0f}%  "
            f"miss={miss_str}"
        )

    print()
    print("TOP 10 TOOLS (global):")
    for entry in global_freq[:10]:
        print(
            f"  {entry['tool']:<20} "
            f"calls={entry['total_calls']:>5}  "
            f"tasks={entry['tasks_using']:>4}  "
            f"({entry['pct_of_tasks']}% of tasks)"
        )

    print()
    print(f"UNDERUSED TOOLS (<10% of tasks): {underused}")

    print()
    print("KEY INSIGHTS (heuristic):")
    for insight in key_insights:
        print(f"  - {insight}")

    print()
    print("LLM INSIGHTS:")
    print(f"  bash_opportunity_rate      : {llm_insights['bash_opportunity_rate']:.1%}")
    print(f"  find_element_opportunity_rate: {llm_insights['find_element_opportunity_rate']:.1%}")
    print(f"  Top missed tools:")
    for entry in llm_insights['top_missed_tools'][:5]:
        print(f"    ({entry['count']}x) {entry['tool']}")

    print()
    print(f"Output written to: {OUTPUT_FILE}")


if __name__ == '__main__':
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else None
    asyncio.run(main(limit=limit))
