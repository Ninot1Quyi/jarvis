#!/usr/bin/env python3
"""
Analyze what knowledge/capabilities Jarvis is missing, based on failed task traces.

For each failed task, sends the complete trace as a conversation history to Gemini
(every step with its screenshots), then asks: "You failed this task. Looking back at
all steps, what knowledge and capabilities are you missing? How would you complete it?"

Output: improve/analysis/results/knowledge_analysis.json
Each record: task_id, instruction, trace_path, missing_knowledge, improvement_plan, raw_response
"""

import json
import base64
import asyncio
import re
import time
from pathlib import Path
from datetime import datetime

from PIL import Image
import io
import httpx

# ---- Config ----
API_KEY = 'sk-TfN0Js5VKZcD6O1rJSSixnTYayhIqrnhHKUHXM1mCjf3CrIc'
BASE_URL = 'https://api.duojie.games/v1'
MODEL = 'gemini-3.1-pro'

RESULTS_DIR = Path('/Users/Ninot/NinotQuyi/jarvis/results/eval-nogdrive-20260308-010648')
TRACES_BASE = Path('/Users/Ninot/NinotQuyi/jarvis/data')
OUTPUT_DIR = Path('/Users/Ninot/NinotQuyi/jarvis/improve/analysis/results')
OUTPUT_FILE = OUTPUT_DIR / 'knowledge_analysis.json'

CONCURRENCY = 5
MAX_RETRIES = 3
MAX_DIM = 600          # smaller to fit more screenshots in context
MAX_STEPS = 30         # cap steps per trace to avoid huge context


def compress_image(path: str):
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


def resolve_screenshot(rel_path: str, trace_path: Path):
    abs_path = (trace_path.parent / rel_path).resolve()
    return str(abs_path)


def build_messages(trace_path: Path, instruction: str):
    """
    Convert trace into OpenAI message history.
    Each COMPUTER step becomes a 'user' message (with its screenshot).
    Each ASSISTANT step becomes an 'assistant' message (tool calls text).
    System prompt is included as system message.
    Final user message asks for knowledge gap analysis.
    """
    try:
        content = trace_path.read_text(encoding='utf-8')
    except Exception as e:
        return None, f"Cannot read trace: {e}"

    steps = content.split('\n===\n')
    messages = []

    # System message: just the first step (SYSTEM prompt) truncated
    system_step = steps[0] if steps else ''
    # Extract just essential part of system prompt (first 800 chars)
    system_text = system_step[:800].strip()
    messages.append({'role': 'system', 'content': system_text})

    step_count = 0
    pending_user_text = None  # buffer USER step text, merge into next COMPUTER step

    for i, step in enumerate(steps[1:], 1):
        if step_count >= MAX_STEPS:
            break

        if '## USER' in step:
            # Buffer the task text — will be prepended to the next COMPUTER step
            # to avoid consecutive user messages which are invalid in OpenAI API
            m = re.search(r'<tui>(.*?)</tui>', step, re.DOTALL)
            pending_user_text = m.group(1).strip() if m else step.strip()[-500:]
            pending_user_text = pending_user_text[:500]

        elif '## COMPUTER' in step:
            # Computer step: recent actions + screenshot
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
            # If there's a buffered user task text, prepend it
            if pending_user_text:
                parts.append({'type': 'text', 'text': f'[Task] {pending_user_text}'})
                pending_user_text = None
            if recent:
                parts.append({'type': 'text', 'text': f'[Screen state after actions]\n{recent}'})
            parts.extend(img_content)
            if not parts:
                parts.append({'type': 'text', 'text': '[Screen state]'})

            # Avoid consecutive user messages: if last message is also user, merge
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
            # Assistant step: tool calls — avoid consecutive assistant messages
            tool_calls = re.findall(r'- `(\w+)\((.*?)\)`', step, re.DOTALL)
            if tool_calls:
                calls_text = '\n'.join(f'{name}({args[:200]})' for name, args in tool_calls)
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
            f'Looking back at all the steps and screenshots above, analyze as the agent:\n\n'
            f'1. What went wrong in my execution?\n'
            f'2. What knowledge or capabilities am I missing that prevented task completion?\n'
            f'3. What specific information, skills, or strategies would I need to complete this task?\n\n'
            f'Respond in this exact JSON format:\n'
            f'{{\n'
            f'  "failure_reason": "brief description of what went wrong",\n'
            f'  "missing_knowledge": ["item1", "item2", ...],\n'
            f'  "missing_capabilities": ["item1", "item2", ...],\n'
            f'  "improvement_plan": ["concrete step 1", "concrete step 2", ...],\n'
            f'  "key_insight": "one sentence summarizing the core issue"\n'
            f'}}'
        )
    })

    return messages, None


async def analyze_task(client: httpx.AsyncClient, task_info: dict, index: int,
                       semaphore: asyncio.Semaphore, counter: list, total: int):
    async with semaphore:
        task_id = task_info['task_id']
        instruction = task_info['instruction']
        trace_path = Path(task_info['trace_path_local'])

        messages, err = build_messages(trace_path, instruction)
        if messages is None:
            counter[0] += 1
            pct = counter[0] / total * 100
            print(f'  [{counter[0]:03d}/{total}] {task_id[:8]} -> ERROR: {err}')
            return {
                'task_id': task_id,
                'instruction': instruction,
                'trace_path': str(trace_path),
                'error': err,
                'missing_knowledge': [],
                'missing_capabilities': [],
                'improvement_plan': [],
                'failure_reason': 'Could not read trace',
                'key_insight': '',
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

                # Parse JSON from response
                parsed = {}
                try:
                    # Extract JSON block if wrapped in markdown
                    m = re.search(r'\{[\s\S]*\}', text)
                    if m:
                        parsed = json.loads(m.group(0))
                except Exception:
                    parsed = {'raw': text}

                counter[0] += 1
                pct = counter[0] / total * 100
                print(f'  [{counter[0]:03d}/{total} {pct:.0f}%] {task_id[:8]} -> OK | {parsed.get("key_insight", "")[:60]}')

                return {
                    'task_id': task_id,
                    'instruction': instruction,
                    'trace_path': str(trace_path),
                    'failure_reason': parsed.get('failure_reason', ''),
                    'missing_knowledge': parsed.get('missing_knowledge', []),
                    'missing_capabilities': parsed.get('missing_capabilities', []),
                    'improvement_plan': parsed.get('improvement_plan', []),
                    'key_insight': parsed.get('key_insight', ''),
                    'raw_response': text,
                }

            except Exception as e:
                last_err = str(e)[:200]
                if attempt < MAX_RETRIES - 1:
                    wait = 2 ** attempt
                    print(f'  [{index:03d}] RETRY {attempt+1} in {wait}s: {last_err[:60]}')
                    await asyncio.sleep(wait)

        counter[0] += 1
        print(f'  [{counter[0]:03d}/{total}] {task_id[:8]} -> FAILED: {last_err[:60]}')
        return {
            'task_id': task_id,
            'instruction': instruction,
            'trace_path': str(trace_path),
            'error': last_err,
            'missing_knowledge': [],
            'missing_capabilities': [],
            'improvement_plan': [],
            'failure_reason': 'API error',
            'key_insight': '',
        }


def collect_failed_tasks(limit=None):
    """Collect failed tasks that have a local trace file."""
    tasks = []
    task_dirs = sorted(RESULTS_DIR.iterdir()) if RESULTS_DIR.exists() else []

    for td in task_dirs:
        rf = td / 'result.json'
        if not rf.exists():
            continue
        try:
            r = json.loads(rf.read_text())
        except Exception:
            continue

        result = float(r.get('result', 0) or 0)
        done = bool(r.get('done', False))
        passed = result >= 1.0 or (done and result > 0)
        if passed:
            continue  # only failed tasks

        trace_local = r.get('trace_path_local', '')
        if not trace_local:
            continue

        trace_path = Path(trace_local)
        if not trace_path.exists():
            fallback = TRACES_BASE / 'traces' / Path(trace_local).name
            if fallback.exists():
                trace_path = fallback
            else:
                continue

        tasks.append({
            'task_id': r.get('task_id', td.name),
            'instruction': r.get('instruction', ''),
            'trace_path_local': str(trace_path),
            'task_result': result,
        })

        if limit and len(tasks) >= limit:
            break

    return tasks


async def main(limit=None):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    tasks = collect_failed_tasks(limit=limit)
    print(f'Found {len(tasks)} failed tasks with traces')

    # Load existing results for resume
    existing = {}
    if OUTPUT_FILE.exists():
        try:
            prev = json.loads(OUTPUT_FILE.read_text())
            for r in prev.get('results', []):
                if not r.get('error'):
                    existing[r['task_id']] = r
            print(f'Resuming: {len(existing)} already done')
        except Exception:
            pass

    to_analyze = [(i, t) for i, t in enumerate(tasks) if t['task_id'] not in existing]
    already_done = [existing[t['task_id']] for t in tasks if t['task_id'] in existing]

    total = len(to_analyze)
    print(f'Already done: {len(already_done)}, To analyze: {total}')
    print(f'Model: {MODEL}  Concurrency: {CONCURRENCY}')
    print(f'Started: {datetime.now().strftime("%H:%M:%S")}')
    print()

    counter = [0]  # mutable for sharing across coroutines
    new_results = []
    if to_analyze:
        semaphore = asyncio.Semaphore(CONCURRENCY)
        async with httpx.AsyncClient() as client:
            coros = [analyze_task(client, t, i, semaphore, counter, total) for i, t in to_analyze]
            new_results = await asyncio.gather(*coros)

    all_results = already_done + list(new_results)

    # Aggregate: count most common missing knowledge items
    knowledge_freq = {}
    capability_freq = {}
    for r in all_results:
        for item in r.get('missing_knowledge', []):
            knowledge_freq[item] = knowledge_freq.get(item, 0) + 1
        for item in r.get('missing_capabilities', []):
            capability_freq[item] = capability_freq.get(item, 0) + 1

    top_knowledge = sorted(knowledge_freq.items(), key=lambda x: -x[1])[:20]
    top_capabilities = sorted(capability_freq.items(), key=lambda x: -x[1])[:20]

    output = {
        'generated_at': datetime.now().isoformat(),
        'model': MODEL,
        'total_tasks_analyzed': len(all_results),
        'top_missing_knowledge': [{'item': k, 'count': v} for k, v in top_knowledge],
        'top_missing_capabilities': [{'item': k, 'count': v} for k, v in top_capabilities],
        'results': all_results,
    }

    OUTPUT_FILE.write_text(json.dumps(output, indent=2, ensure_ascii=False))

    print()
    print('=' * 60)
    print(f'Tasks analyzed: {len(all_results)}')
    print(f'Top missing knowledge:')
    for item, cnt in top_knowledge[:10]:
        print(f'  ({cnt}x) {item}')
    print(f'Top missing capabilities:')
    for item, cnt in top_capabilities[:10]:
        print(f'  ({cnt}x) {item}')
    print(f'Output: {OUTPUT_FILE}')


if __name__ == '__main__':
    import sys
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else None
    asyncio.run(main(limit=limit))
