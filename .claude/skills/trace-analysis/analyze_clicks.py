#!/usr/bin/env python3
"""
Parallel LLM click accuracy analysis using full conversation context.

For each click action, sends to the LLM:
- All screenshots from the COMPUTER step BEFORE the action (showing the state before)
- The ASSISTANT step text (showing what actions were taken, including the click)
- All screenshots from the COMPUTER step AFTER the action (showing the result)

The LLM judges whether the expected UI change happened after the click,
based purely on visual before/after comparison — not coordinate calculation.

Uses gemini-3.1-pro via OpenAI-compatible API at https://api.duojie.games

Output: improve/analysis/click_analysis.json
"""

import json
import os
import base64
import asyncio
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

INPUT_FILE = Path('/Users/Ninot/NinotQuyi/jarvis/improve/analysis/clicks.json')
OUTPUT_FILE = Path('/Users/Ninot/NinotQuyi/jarvis/improve/analysis/click_analysis.json')

CONCURRENCY = 5
MAX_RETRIES = 3
MAX_DIM = 800
# Max screenshots to include per side (before/after) to limit token cost
# No limit: send all before/after screenshots (max 3 per side in practice)


def compress_image(path: str):
    try:
        img = Image.open(path)
        if img.mode in ('RGBA', 'LA', 'P'):
            img = img.convert('RGB')
        img.thumbnail((MAX_DIM, MAX_DIM))
        buf = io.BytesIO()
        img.save(buf, format='JPEG', quality=80)
        return base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return None


def img_msg(b64: str):
    return {'type': 'image_url', 'image_url': {'url': f'data:image/jpeg;base64,{b64}'}}


def txt_msg(text: str):
    return {'type': 'text', 'text': text}


def build_content(click: dict):
    """
    Build the message content for the LLM.
    Structure:
      [Before screenshots] -> label -> [Agent actions text] -> label -> [After screenshots] -> question
    """
    content = []

    # --- Before screenshots (show state before the click) ---
    before_shots = [p for p in click.get('before_screenshots', []) if Path(p).exists()]

    # keep all before shots

    if before_shots:
        content.append(txt_msg(f'[BEFORE - {len(before_shots)} screenshot(s) showing state before the action]'))
        for path in before_shots:
            b64 = compress_image(path)
            if b64:
                content.append(img_msg(b64))

    # --- Agent actions (what was clicked) ---
    coord = click['coordinate']
    desc = click['desc']
    total = click.get('total_clicks_in_step', 1)
    idx = click.get('click_index_in_step', 0)

    action_text = f'[AGENT ACTION]\nTask: {click["instruction"]}\n'
    if total > 1:
        action_text += f'The agent performed {total} actions in this step. This analysis is for action #{idx+1}:\n'
    action_text += f'click(coordinate=[{coord[0]}, {coord[1]}], desc="{desc}")\n'
    if click.get('before_recent_actions'):
        action_text += f'\nPrevious actions (for context):\n{click["before_recent_actions"]}'
    content.append(txt_msg(action_text))

    # --- After screenshots (show result of the click) ---
    after_shots = [p for p in click.get('after_screenshots', []) if Path(p).exists()]
    # keep all after shots

    if after_shots:
        content.append(txt_msg(f'[AFTER - {len(after_shots)} screenshot(s) showing state after the action]'))
        for path in after_shots:
            b64 = compress_image(path)
            if b64:
                content.append(img_msg(b64))

    if not any(c['type'] == 'image_url' for c in content):
        return None

    # --- Question ---
    content.append(txt_msg(
        f'Based on the before and after screenshots above, did the click action produce the expected UI change?\n'
        f'The agent intended to click: "{desc}"\n\n'
        f'Focus on: did the screen change in the way you would expect if "{desc}" was successfully clicked?\n'
        f'- If yes (expected change happened) -> HIT\n'
        f'- If no (screen did not change as expected, wrong element clicked, or no change at all) -> MISS\n'
        f'- If you cannot determine from the screenshots -> UNCERTAIN\n\n'
        f'Reply in this exact format:\n'
        f'VERDICT: <HIT|MISS|UNCERTAIN>\n'
        f'REASON: <1-2 sentences explaining what changed or did not change in the screenshots>'
    ))

    return content


async def analyze_click(
    client: httpx.AsyncClient,
    click: dict,
    index: int,
    semaphore: asyncio.Semaphore,
    done_count: list,
    count_lock: asyncio.Lock,
    total: int,
    start_time: float,
):
    async with semaphore:
        content = build_content(click)
        if content is None:
            async with count_lock:
                done_count[0] += 1
                done = done_count[0]
            print(f"  [{done:04d}/{total:04d}] {click['task_id'][:8]} coord={click['coordinate']} -> SKIP")
            return {**click, 'llm_verdict': 'SKIP', 'llm_reason': 'No screenshots available', 'llm_index': index}

        payload = {
            'model': MODEL,
            'max_tokens': 300,
            'messages': [{'role': 'user', 'content': content}]
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
                    timeout=120.0
                )
                resp.raise_for_status()
                data = resp.json()
                text = data['choices'][0]['message']['content'].strip()

                verdict = 'UNCERTAIN'
                reason = text
                for line in text.split('\n'):
                    line = line.strip()
                    if line.startswith('VERDICT:'):
                        v = line.replace('VERDICT:', '').strip().upper()
                        if v in ('HIT', 'MISS', 'UNCERTAIN'):
                            verdict = v
                    elif line.startswith('REASON:'):
                        reason = line.replace('REASON:', '').strip()

                async with count_lock:
                    done_count[0] += 1
                    done = done_count[0]
                print(f"  [{done:04d}/{total:04d}] {click['task_id'][:8]} coord={click['coordinate']} -> {verdict}")
                if done % 50 == 0:
                    elapsed = time.monotonic() - start_time
                    rate = done / elapsed if elapsed > 0 else 0
                    remaining = (total - done) / rate if rate > 0 else 0
                    pct = done / total * 100
                    eta_min = round(remaining / 60)
                    print(f"  Progress: {done}/{total} done ({pct:.1f}%), ETA: ~{eta_min} min")
                return {**click, 'llm_verdict': verdict, 'llm_reason': reason, 'llm_index': index}

            except Exception as e:
                last_err = str(e)[:200]
                if attempt < MAX_RETRIES - 1:
                    wait = 2 ** attempt
                    print(f"  [{index:04d}] {click['task_id'][:8]} RETRY {attempt+1} in {wait}s: {last_err[:60]}")
                    await asyncio.sleep(wait)

        async with count_lock:
            done_count[0] += 1
            done = done_count[0]
        print(f"  [{done:04d}/{total:04d}] {click['task_id'][:8]} coord={click['coordinate']} -> FAILED: {last_err[:60]}")
        return {**click, 'llm_verdict': 'ERROR', 'llm_reason': last_err, 'llm_index': index}


async def main():
    data = json.loads(INPUT_FILE.read_text())
    all_clicks = data['clicks']

    # Only analyze clicks that have at least one before and one after screenshot
    clicks = [
        c for c in all_clicks
        if any(Path(p).exists() for p in c.get('before_screenshots', []))
        and any(Path(p).exists() for p in c.get('after_screenshots', []))
    ]
    skipped = len(all_clicks) - len(clicks)
    print(f"Loaded {len(all_clicks)} clicks, skipping {skipped} without screenshots")

    # Incremental: skip already-analyzed clicks
    existing = {}
    if OUTPUT_FILE.exists():
        try:
            prev = json.loads(OUTPUT_FILE.read_text())
            for r in prev.get('clicks', []):
                if r.get('llm_verdict') not in ('ERROR', None):
                    key = (r['task_id'], r['step_index'], r['click_index_in_step'])
                    existing[key] = r
            print(f"Resuming: {len(existing)} already done")
        except Exception as e:
            print(f"Could not load existing results: {e}")

    to_analyze = []
    already_done = []
    for i, c in enumerate(clicks):
        key = (c['task_id'], c['step_index'], c['click_index_in_step'])
        if key in existing:
            already_done.append({**existing[key], 'llm_index': i})
        else:
            to_analyze.append((i, c))

    print(f"Already done: {len(already_done)}, To analyze: {len(to_analyze)}")
    print(f"Model: {MODEL}  Concurrency: {CONCURRENCY}  All screenshots sent (no limit)")
    print(f"Started: {datetime.now().strftime('%H:%M:%S')}")

    new_results = []
    if to_analyze:
        semaphore = asyncio.Semaphore(CONCURRENCY)
        done_count = [0]
        count_lock = asyncio.Lock()
        start_time = time.monotonic()
        async with httpx.AsyncClient() as client:
            tasks = [
                analyze_click(client, c, i, semaphore, done_count, count_lock, len(to_analyze), start_time)
                for i, c in to_analyze
            ]
            new_results = await asyncio.gather(*tasks)

    # Merge and sort by original index
    result_map = {r['llm_index']: r for r in already_done}
    for r in new_results:
        result_map[r['llm_index']] = r
    results = [result_map[i] for i in sorted(result_map)]

    total = len(results)
    hit      = sum(1 for r in results if r['llm_verdict'] == 'HIT')
    miss     = sum(1 for r in results if r['llm_verdict'] == 'MISS')
    uncertain= sum(1 for r in results if r['llm_verdict'] == 'UNCERTAIN')
    error    = sum(1 for r in results if r['llm_verdict'] in ('ERROR', 'SKIP'))

    hits_fail  = sum(1 for r in results if r['llm_verdict'] == 'HIT'  and not r['task_success'])
    miss_fail  = sum(1 for r in results if r['llm_verdict'] == 'MISS' and not r['task_success'])
    hits_pass  = sum(1 for r in results if r['llm_verdict'] == 'HIT'  and r['task_success'])
    miss_pass  = sum(1 for r in results if r['llm_verdict'] == 'MISS' and r['task_success'])

    summary = {
        'generated_at': datetime.now().isoformat(),
        'model': MODEL,
        'method': 'visual_change_detection',
        'total_clicks_analyzed': total,
        'hit': hit,
        'miss': miss,
        'uncertain': uncertain,
        'error_or_skip': error,
        'hit_rate_pct': round(hit / total * 100, 1) if total else 0,
        'miss_rate_pct': round(miss / total * 100, 1) if total else 0,
        'in_failed_tasks': {'hit': hits_fail, 'miss': miss_fail},
        'in_successful_tasks': {'hit': hits_pass, 'miss': miss_pass},
        'extraction_summary': data.get('summary', {}),
    }

    OUTPUT_FILE.write_text(json.dumps({'summary': summary, 'clicks': results}, indent=2, ensure_ascii=False))

    print()
    print('=' * 60)
    print(f"Total: {total}")
    print(f"  HIT:       {hit}  ({summary['hit_rate_pct']}%)")
    print(f"  MISS:      {miss}  ({summary['miss_rate_pct']}%)")
    print(f"  UNCERTAIN: {uncertain}")
    print(f"  ERROR:     {error}")
    print(f"In FAILED tasks:  HIT={hits_fail}  MISS={miss_fail}")
    print(f"In SUCCESS tasks: HIT={hits_pass}  MISS={miss_pass}")
    print(f"Output: {OUTPUT_FILE}")


if __name__ == '__main__':
    asyncio.run(main())
