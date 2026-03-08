"""
analyze_termination.py

Analyzes when and why Jarvis agents terminate early in failed tasks.
Parses eval result directories, extracts termination info from trace .md files,
and uses an LLM to classify termination type for failed tasks.

Usage:
    python3 improve/analysis/analyze_termination.py [LIMIT]

Example:
    python3 improve/analysis/analyze_termination.py 10
"""

import json
import os
import re
import sys
import time
import base64
import io
from datetime import datetime
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

import urllib.request
import urllib.error

from PIL import Image


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

RESULTS_DIR = Path('/Users/Ninot/NinotQuyi/jarvis/results/eval-nogdrive-20260308-010648')
TRACES_BASE = Path('/Users/Ninot/NinotQuyi/jarvis/data')
OUTPUT_FILE = Path('/Users/Ninot/NinotQuyi/jarvis/improve/analysis/results/termination_analysis_20260308.json')

API_KEY = 'sk-TfN0Js5VKZcD6O1rJSSixnTYayhIqrnhHKUHXM1mCjf3CrIc'
BASE_URL = 'https://api.duojie.games/v1'
MODEL = 'gemini-3.1-pro'
CONCURRENCY = 5
MAX_RETRIES = 3
MAX_STEPS = 30         # cap steps per trace to avoid huge context
MAX_DIM = 600

TOOL_CALL_RE = re.compile(r'`([a-zA-Z_][a-zA-Z0-9_]*)\(([^`]*)\)`')


# ---------------------------------------------------------------------------
# Trace parsing helpers
# ---------------------------------------------------------------------------

def parse_trace(trace_path):
    """
    Parse a trace .md file into a list of step dicts.
    Each step has keys: 'type' (SYSTEM/USER/COMPUTER/ASSISTANT), 'content' (str).
    """
    try:
        content = open(trace_path, encoding='utf-8', errors='replace').read()
    except OSError:
        return []

    raw_steps = content.split('\n===\n')
    steps = []
    for raw in raw_steps:
        raw = raw.strip()
        if not raw:
            continue
        # Determine type from first header line
        step_type = 'UNKNOWN'
        for marker in ('## SYSTEM', '## USER', '## COMPUTER', '## ASSISTANT'):
            if raw.startswith(marker):
                step_type = marker[3:]  # strip "## "
                break
        steps.append({'type': step_type, 'content': raw})
    return steps


def extract_tool_calls(assistant_content):
    """
    Extract list of (tool_name, args_str) tuples from an ASSISTANT step content.
    Matches backtick-wrapped calls like: `tool_name({...})`
    """
    return TOOL_CALL_RE.findall(assistant_content)


def truncate(text, max_len):
    if len(text) <= max_len:
        return text
    return text[:max_len] + '...'


def extract_termination_info(steps):
    """
    Pure parsing: extract termination metadata from a list of parsed steps.
    Returns a dict with keys matching the spec.
    """
    assistant_steps = [s for s in steps if s['type'] == 'ASSISTANT']
    total_steps = len(assistant_steps)

    finished_called = False
    call_user_called = False
    termination_step = total_steps  # default: ran until end (max steps)
    termination_reason = 'max_steps'
    last_actions = []

    # Walk through all ASSISTANT steps to find finished/call_user
    for idx, step in enumerate(assistant_steps):
        calls = extract_tool_calls(step['content'])
        tool_names = [c[0] for c in calls]
        if 'finished' in tool_names and not finished_called:
            finished_called = True
            termination_step = idx + 1  # 1-based
            termination_reason = 'finished'
        if 'call_user' in tool_names and not call_user_called:
            call_user_called = True
            if not finished_called:
                termination_step = idx + 1
                termination_reason = 'call_user'

    # If no finished/call_user was found, termination_reason stays max_steps
    if not finished_called and not call_user_called:
        termination_reason = 'max_steps' if total_steps > 0 else 'unknown'
        termination_step = total_steps

    # Collect last 3 tool calls before termination
    # Look at the last few ASSISTANT steps around termination
    last_3_calls = []
    # Gather all tool calls in order, stop at termination_step
    all_calls_in_order = []
    for idx, step in enumerate(assistant_steps):
        step_num = idx + 1
        if step_num > termination_step:
            break
        for name, args in extract_tool_calls(step['content']):
            all_calls_in_order.append((name, args, step_num))

    last_3_calls = []
    for name, args, step_num in all_calls_in_order[-3:]:
        last_3_calls.append({
            'tool': name,
            'args': truncate(args, 120),
            'step': step_num,
        })

    # Last ASSISTANT step text (truncated)
    last_assistant_text = ''
    if assistant_steps:
        last_assistant_text = truncate(assistant_steps[-1]['content'], 500)

    steps_used_pct = 0.0
    if total_steps > 0:
        steps_used_pct = round(termination_step / total_steps * 100, 1)

    return {
        'total_steps': total_steps,
        'finished_called': finished_called,
        'call_user_called': call_user_called,
        'termination_step': termination_step,
        'termination_reason': termination_reason,
        'last_actions': last_3_calls,
        'last_assistant_text': last_assistant_text,
        'steps_used_pct': steps_used_pct,
    }


# ---------------------------------------------------------------------------
# LLM analysis helpers
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
    return str((Path(trace_path).parent / rel_path).resolve())


def build_messages(trace_path, instruction):
    """
    Convert trace into OpenAI multi-turn message history (same approach as analyze_knowledge.py).
    Final user message asks for termination analysis.
    """
    try:
        content = open(trace_path, encoding='utf-8', errors='replace').read()
    except Exception as e:
        return None, str(e)

    steps = content.split('\n===\n')
    messages = []

    system_step = steps[0] if steps else ''
    messages.append({'role': 'system', 'content': system_step[:800].strip()})

    step_count = 0
    pending_user_text = None

    for step in steps[1:]:
        if step_count >= MAX_STEPS:
            break

        if '## USER' in step:
            m = re.search(r'<tui>(.*?)</tui>', step, re.DOTALL)
            pending_user_text = (m.group(1).strip() if m else step.strip()[-500:])[:500]

        elif '## COMPUTER' in step:
            recent = ''
            m = re.search(r'## Recent Actions\n(.*?)(?=\n## |\n---|\Z)', step, re.DOTALL)
            if m:
                recent = m.group(1).strip()

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
                parts.append({'type': 'text', 'text': f'[Screen state after actions]\n{recent}'})
            parts.extend(img_content)
            if not parts:
                parts.append({'type': 'text', 'text': '[Screen state]'})

            if messages and messages[-1]['role'] == 'user':
                prev = messages[-1]['content']
                messages[-1]['content'] = (prev if isinstance(prev, list) else [{'type': 'text', 'text': prev}]) + parts
            else:
                messages.append({'role': 'user', 'content': parts})
            step_count += 1

        elif '## ASSISTANT' in step:
            tool_calls = re.findall(r'- `(\w+)\((.*?)\)`', step, re.DOTALL)
            if tool_calls:
                calls_text = '\n'.join(f'{n}({a[:200]})' for n, a in tool_calls)
                assistant_text = f'[Actions taken]\n{calls_text}'
                if messages and messages[-1]['role'] == 'assistant':
                    messages[-1]['content'] += '\n' + assistant_text
                else:
                    messages.append({'role': 'assistant', 'content': assistant_text})
            step_count += 1

    # Final analysis question
    messages.append({
        'role': 'user',
        'content': (
            f'The task was: "{instruction}"\n\n'
            f'The task was NOT completed successfully. '
            f'Looking back at all the steps and screenshots above, analyze why the agent stopped:\n\n'
            f'1. At what point did execution go wrong, and why?\n'
            f'2. Was the termination appropriate (agent hit its limit) or premature (agent gave up too early)?\n'
            f'3. Could the agent have continued and succeeded with more steps or a different approach?\n\n'
            f'Classify the termination type:\n'
            f'- MAX_STEPS_HIT: ran out of steps, was still making progress\n'
            f'- WRONG_COMPLETION: called finished() but task was incomplete\n'
            f'- LOST_CONTEXT: forgot the original goal mid-execution\n'
            f'- TOOL_FAILURE: got stuck due to tool errors or unresponsive UI\n'
            f'- PREMATURE_STOP: stopped early without a good reason\n'
            f'- CAPABILITY_GAP: correctly identified it cannot complete the task\n\n'
            f'Respond in this exact JSON format:\n'
            f'{{\n'
            f'  "termination_type": "...",\n'
            f'  "failure_step": "brief description of which step went wrong",\n'
            f'  "evidence": "direct quote or observation from the trace",\n'
            f'  "could_have_continued": true/false,\n'
            f'  "suggested_fix": "one concrete actionable fix"\n'
            f'}}'
        )
    })

    return messages, None


def call_llm(messages, retries=MAX_RETRIES):
    """
    Call the LLM API with a messages list and return parsed JSON dict, or None on failure.
    """
    payload = json.dumps({
        'model': MODEL,
        'messages': messages,
        'max_tokens': 600,
        'temperature': 0.0,
    }).encode('utf-8')

    url = BASE_URL.rstrip('/') + '/chat/completions'

    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                url,
                data=payload,
                headers={
                    'Authorization': f'Bearer {API_KEY}',
                    'Content-Type': 'application/json',
                },
                method='POST',
            )
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = json.loads(resp.read().decode('utf-8'))

            text = body['choices'][0]['message']['content'].strip()

            # Strip markdown code fences if present
            if text.startswith('```'):
                lines = text.splitlines()
                text = '\n'.join(lines[1:-1]) if len(lines) > 2 else text

            parsed = json.loads(text)
            # Normalise field types
            if 'could_have_continued' in parsed:
                val = parsed['could_have_continued']
                if isinstance(val, str):
                    parsed['could_have_continued'] = val.lower() in ('true', '1', 'yes')
            return parsed

        except (urllib.error.URLError, json.JSONDecodeError, KeyError, Exception) as exc:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
            else:
                return {
                    'termination_type': 'UNKNOWN',
                    'evidence': f'LLM call failed: {exc}',
                    'could_have_continued': False,
                    'suggested_fix': 'n/a',
                }


# ---------------------------------------------------------------------------
# Per-task analysis
# ---------------------------------------------------------------------------

def analyze_task(task_dir, existing_results_by_id):
    """
    Analyze one task directory. Returns a result dict or None if skipped.
    task_dir: Path to one task result directory.
    existing_results_by_id: dict of task_id -> existing result (for incremental skip).
    """
    rpath = task_dir / 'result.json'
    if not rpath.exists():
        return None

    rj = json.load(open(rpath))
    task_id = rj.get('task_id', task_dir.name)
    instruction = rj.get('instruction', '')
    score = float(rj.get('result', 0))
    is_failed = score == 0.0

    if not is_failed:
        return None

    # Incremental resume: skip if already analyzed
    if task_id in existing_results_by_id:
        return existing_results_by_id[task_id]

    trace_path = rj.get('trace_path_local', '')
    if not trace_path or not os.path.exists(trace_path):
        # Try vm path structure
        vm_path = rj.get('trace_path_vm', '')
        if vm_path:
            # attempt to map vm path to local
            local_candidate = Path(str(vm_path).replace('/home/user/jarvis', '/Users/Ninot/NinotQuyi/jarvis'))
            if local_candidate.exists():
                trace_path = str(local_candidate)

    if not trace_path or not os.path.exists(trace_path):
        return {
            'task_id': task_id,
            'instruction': instruction,
            'score': score,
            'trace_found': False,
            'parse': None,
            'llm': None,
        }

    steps = parse_trace(trace_path)
    parse_info = extract_termination_info(steps)

    task_info = {'instruction': instruction}

    messages, err = build_messages(trace_path, instruction)
    if messages is None:
        return {
            'task_id': task_id,
            'instruction': instruction,
            'score': score,
            'trace_found': True,
            'parse': parse_info,
            'llm': {'termination_type': 'UNKNOWN', 'evidence': err,
                    'could_have_continued': False, 'suggested_fix': 'n/a'},
        }
    llm_info = call_llm(messages)

    return {
        'task_id': task_id,
        'instruction': instruction,
        'score': score,
        'trace_found': True,
        'parse': parse_info,
        'llm': llm_info,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def load_existing_output():
    """Load existing output file for incremental resume."""
    if not OUTPUT_FILE.exists():
        return {}
    try:
        data = json.loads(OUTPUT_FILE.read_text())
        results = data.get('results', [])
        return {r['task_id']: r for r in results if 'task_id' in r}
    except (json.JSONDecodeError, KeyError):
        return {}


def save_output(results, generated_at):
    """Compute aggregate stats and write output JSON."""
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    analyzed = [r for r in results if r.get('llm') is not None]

    termination_type_counts = {}
    total_steps_list = []
    premature_stop_tasks = []

    for r in analyzed:
        llm = r.get('llm') or {}
        ttype = llm.get('termination_type', 'UNKNOWN')
        termination_type_counts[ttype] = termination_type_counts.get(ttype, 0) + 1

        parse = r.get('parse') or {}
        if parse.get('total_steps'):
            total_steps_list.append(parse['total_steps'])

        if llm.get('could_have_continued') is True:
            premature_stop_tasks.append({
                'task_id': r['task_id'],
                'termination_type': ttype,
                'suggested_fix': llm.get('suggested_fix', ''),
                'instruction': r.get('instruction', ''),
            })

    avg_steps = round(sum(total_steps_list) / len(total_steps_list), 2) if total_steps_list else 0.0

    output = {
        'generated_at': generated_at,
        'total_failed_analyzed': len(analyzed),
        'termination_type_counts': termination_type_counts,
        'avg_steps_used': avg_steps,
        'premature_stop_tasks': premature_stop_tasks,
        'results': results,
    }
    OUTPUT_FILE.write_text(json.dumps(output, indent=2, ensure_ascii=False))


def main():
    limit = None
    if len(sys.argv) > 1:
        try:
            limit = int(sys.argv[1])
        except ValueError:
            print(f'Warning: could not parse limit argument "{sys.argv[1]}", ignoring.')

    generated_at = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
    existing = load_existing_output()

    # Collect failed task directories
    task_dirs = sorted(
        [p for p in RESULTS_DIR.iterdir() if p.is_dir() and (p / 'result.json').exists()],
        key=lambda p: p.name,
    )

    # Filter to failed tasks only (quick pre-scan without loading traces)
    failed_task_dirs = []
    for td in task_dirs:
        try:
            rj = json.load(open(td / 'result.json'))
            if float(rj.get('result', 0)) == 0.0:
                failed_task_dirs.append(td)
        except (json.JSONDecodeError, OSError):
            continue

    if limit is not None:
        failed_task_dirs = failed_task_dirs[:limit]

    total = len(failed_task_dirs)
    print(f'Analyzing {total} failed tasks (limit={limit})...')

    # Load any previously-saved results that are NOT in our current batch
    # so we can write them back to the output file unchanged.
    all_results_by_id = dict(existing)  # will be updated in-place

    completed_count = 0

    def worker(td):
        return analyze_task(td, existing)

    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        future_to_dir = {pool.submit(worker, td): td for td in failed_task_dirs}
        for future in as_completed(future_to_dir):
            result = future.result()
            if result is None:
                continue

            completed_count += 1
            task_id = result['task_id']
            all_results_by_id[task_id] = result

            llm = result.get('llm') or {}
            ttype = llm.get('termination_type', 'NO_TRACE' if not result.get('trace_found') else 'PARSE_ONLY')
            fix = llm.get('suggested_fix', '')

            pct = round(completed_count / total * 100)
            print(f'[{completed_count:03d}/{total:03d} {pct:3d}%] {task_id[:8]} -> {ttype} | {fix[:50]}')

            # Save incrementally after each result
            save_output(list(all_results_by_id.values()), generated_at)

    print(f'\nDone. Output written to: {OUTPUT_FILE}')

    # Final summary
    final_data = json.loads(OUTPUT_FILE.read_text())
    print(f'Total failed analyzed: {final_data["total_failed_analyzed"]}')
    print(f'Avg steps used: {final_data["avg_steps_used"]}')
    print('Termination type counts:')
    for k, v in sorted(final_data['termination_type_counts'].items(), key=lambda x: -x[1]):
        print(f'  {k}: {v}')
    print(f'Premature stops (could_have_continued=true): {len(final_data["premature_stop_tasks"])}')


if __name__ == '__main__':
    main()
