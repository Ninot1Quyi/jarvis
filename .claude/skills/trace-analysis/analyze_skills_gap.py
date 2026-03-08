#!/usr/bin/env python3
"""
analyze_skills_gap.py

Compares eval task types vs existing Jarvis skills to identify skill development priorities.
Heuristic clustering + LLM per-task analysis on failed tasks via Gemini.
"""

import json
import os
import re
import base64
import asyncio
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image
import io
import httpx

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

API_KEY = 'sk-TfN0Js5VKZcD6O1rJSSixnTYayhIqrnhHKUHXM1mCjf3CrIc'
BASE_URL = 'https://api.duojie.games/v1'
MODEL = 'gemini-3.1-pro'
CONCURRENCY = 5
MAX_RETRIES = 3
MAX_STEPS = 30
MAX_DIM = 600

RESULTS_DIR = Path('/Users/Ninot/NinotQuyi/jarvis/results/eval-nogdrive-20260308-010648')
SKILLS_DIRS = [
    Path('/Users/Ninot/NinotQuyi/jarvis/src/skills'),
    Path('/Users/Ninot/NinotQuyi/jarvis/.claude/skills'),
]
OUTPUT_FILE = Path('/Users/Ninot/NinotQuyi/jarvis/improve/analysis/results/skills_gap_20260308.json')

# ---------------------------------------------------------------------------
# Category definitions: (category_name, app_label, keyword_list)
# ---------------------------------------------------------------------------

CATEGORY_DEFS: List[Tuple[str, str, List[str]]] = [
    (
        "libreoffice_calc",
        "LibreOffice Calc",
        ["formula", "sum", "cell", "sheet", "chart", "pivot", "sort", "filter",
         "calc", "spreadsheet", "row", "column"],
    ),
    (
        "libreoffice_impress",
        "LibreOffice Impress",
        ["slide", "presentation", "transition", "animation", "shape", "text box", "impress"],
    ),
    (
        "libreoffice_writer",
        "LibreOffice Writer",
        ["document", "paragraph", "style", "heading", "table", "writer", "format"],
    ),
    (
        "gimp",
        "GIMP",
        ["image", "layer", "filter", "export", "color", "gimp", "crop", "resize", "brush"],
    ),
    (
        "chrome_navigation",
        "Chrome",
        ["search", "navigate", "open", "visit", "go to", "url", "website"],
    ),
    (
        "chrome_settings",
        "Chrome",
        ["settings", "enable", "disable", "privacy", "extension", "bookmark", "download"],
    ),
    (
        "chrome_shopping",
        "Chrome",
        ["buy", "order", "flight", "hotel", "price", "amazon", "shopping"],
    ),
]

# Skill content outlines keyed by category name
SKILL_OUTLINES: Dict[str, List[str]] = {
    "libreoffice_calc": [
        "Navigate cells using Name Box and keyboard shortcuts (Ctrl+Home, Ctrl+End, arrow keys)",
        "Enter and edit formulas: SUM, AVERAGE, IF, VLOOKUP, INDEX/MATCH with correct syntax",
        "Apply cell formatting: number formats, borders, fill color, merge cells",
        "Work with sheets: insert, rename, move, copy, reference across sheets",
        "Create and modify charts: select data, choose chart type, configure axes and labels",
    ],
    "libreoffice_impress": [
        "Insert and manage slides: add, delete, reorder, duplicate via slide panel",
        "Edit text boxes and shapes: select, resize, reposition, align with snapping",
        "Apply slide transitions and element animations via the sidebar or menu",
        "Work with master slides and themes for consistent formatting",
        "Export presentation to PDF or other formats",
    ],
    "libreoffice_writer": [
        "Apply paragraph and character styles from the Styles deck or Format menu",
        "Insert and format tables: rows, columns, borders, cell shading",
        "Use headings for document structure and generate table of contents",
        "Find and replace text with optional regex support",
        "Export document to PDF or DOCX format",
    ],
    "gimp": [
        "Open, import, and export images to common formats (PNG, JPEG, TIFF)",
        "Work with layers: create, delete, rename, merge, reorder, set blend modes",
        "Apply filters and effects from the Filters menu with correct parameter settings",
        "Use selection tools (Rectangle, Ellipse, Free Select, Fuzzy Select) and transform selections",
        "Adjust colors: Levels, Curves, Hue-Saturation, Brightness-Contrast via Colors menu",
    ],
    "chrome_navigation": [
        "Focus the address bar (Ctrl+L or F6) and navigate to URLs directly",
        "Use search engines: type query in address bar, handle auto-suggest correctly",
        "Open and switch tabs: Ctrl+T (new), Ctrl+W (close), Ctrl+Tab (next tab)",
        "Handle page load states: wait for DOMContentLoaded before interacting",
        "Read and extract information from web pages after navigation",
    ],
    "chrome_settings": [
        "Access Chrome settings via address bar (chrome://settings) or menu (three-dot)",
        "Toggle privacy and security settings: cookies, site permissions, safe browsing",
        "Manage extensions: enable, disable, remove via chrome://extensions",
        "Configure bookmarks: add, organize into folders, export/import",
        "Set download location and manage download preferences",
    ],
    "chrome_shopping": [
        "Navigate to e-commerce sites and use search/filter to find products",
        "Extract product details: price, availability, specifications from page content",
        "Search for flights and hotels using booking sites with date and destination inputs",
        "Compare prices across multiple tabs or search results",
        "Handle login prompts and cart operations if required by the task",
    ],
}

# MCP opportunity rules: (category, keyword_patterns, mcp_suggestion)
MCP_RULES: List[Tuple[str, List[str], str]] = [
    (
        "chrome_navigation",
        ["search", "navigate", "website", "url", "visit"],
        "browser-use or Playwright MCP server for reliable browser automation without screenshot dependency",
    ),
    (
        "chrome_shopping",
        ["buy", "order", "flight", "hotel", "price", "amazon", "shopping"],
        "browser-use MCP with structured data extraction for e-commerce and travel booking tasks",
    ),
    (
        "chrome_settings",
        ["settings", "extension", "download"],
        "Playwright MCP for Chrome DevTools Protocol access to chrome:// pages",
    ),
    (
        "gimp",
        ["image", "export", "resize", "crop", "color"],
        "filesystem MCP for direct image file manipulation as an alternative to GIMP GUI",
    ),
    (
        "libreoffice_calc",
        ["formula", "spreadsheet", "cell"],
        "filesystem MCP with openpyxl/xlrd for programmatic spreadsheet manipulation bypassing GUI",
    ),
    (
        "libreoffice_writer",
        ["document", "format"],
        "filesystem MCP with python-docx for programmatic document manipulation",
    ),
]

# ---------------------------------------------------------------------------
# Image compression
# ---------------------------------------------------------------------------

def compress_image(path: str) -> Optional[str]:
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


def resolve_screenshot(rel_path: str, trace_path: Path) -> str:
    abs_path = (trace_path.parent / rel_path).resolve()
    return str(abs_path)


# ---------------------------------------------------------------------------
# Build messages for LLM (skills gap version)
# ---------------------------------------------------------------------------

def build_messages(trace_path: Path, instruction: str, app: str) -> Tuple[Optional[List[Dict]], Optional[str]]:
    """
    Convert trace into OpenAI message history for skills gap analysis.

    - Split on '\n===\n'
    - SYSTEM step -> system message (first 800 chars)
    - USER step: buffer text in pending_user_text, merge into next COMPUTER step
    - COMPUTER step -> user message: [Task text if buffered] + [Recent Actions text] + ALL screenshots as image_url
    - ASSISTANT step -> assistant message: tool calls text
    - Merge consecutive same-role messages
    - Final user message asks the analysis question
    """
    try:
        content = trace_path.read_text(encoding='utf-8')
    except Exception as e:
        return None, "Cannot read trace: {}".format(e)

    steps = content.split('\n===\n')
    messages: List[Dict] = []

    # System message: first step truncated to 800 chars
    system_step = steps[0] if steps else ''
    system_text = system_step[:800].strip()
    messages.append({'role': 'system', 'content': system_text})

    step_count = 0
    pending_user_text: Optional[str] = None

    for step in steps[1:]:
        if step_count >= MAX_STEPS:
            break

        if '## USER' in step:
            # Buffer task text to merge into next COMPUTER step
            m = re.search(r'<tui>(.*?)</tui>', step, re.DOTALL)
            pending_user_text = m.group(1).strip() if m else step.strip()[-500:]
            pending_user_text = pending_user_text[:500]

        elif '## COMPUTER' in step:
            # Recent actions text
            recent = ''
            m = re.search(r'## Recent Actions\n(.*?)(?=\n## |\n---|\Z)', step, re.DOTALL)
            if m:
                recent = m.group(1).strip()

            # ALL screenshots (no limit)
            imgs = re.findall(r'!\[screen\]\((.*?)\)', step)
            img_content = []
            for rel in imgs:
                abs_path = resolve_screenshot(rel, trace_path)
                if Path(abs_path).exists():
                    b64 = compress_image(abs_path)
                    if b64:
                        img_content.append({
                            'type': 'image_url',
                            'image_url': {'url': 'data:image/jpeg;base64,{}'.format(b64)}
                        })

            parts: List[Dict] = []
            if pending_user_text:
                parts.append({'type': 'text', 'text': '[Task] {}'.format(pending_user_text)})
                pending_user_text = None
            if recent:
                parts.append({'type': 'text', 'text': '[Recent Actions]\n{}'.format(recent)})
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
            # Tool calls text
            tool_calls = re.findall(r'- `(\w+)\((.*?)\)`', step, re.DOTALL)
            if tool_calls:
                calls_text = '\n'.join('{name}({args})'.format(
                    name=name, args=args[:200]) for name, args in tool_calls)
                assistant_text = '[Actions taken]\n{}'.format(calls_text)
                if messages and messages[-1]['role'] == 'assistant':
                    messages[-1]['content'] += '\n' + assistant_text
                else:
                    messages.append({'role': 'assistant', 'content': assistant_text})
            step_count += 1

    # Final analysis question
    final_q = (
        'The task was: "{}"\n'
        'The task was NOT completed successfully.\n'
        'The app being used: {}\n\n'
        'Looking at all steps and screenshots above, analyze what skill/knowledge gaps caused the failure:\n\n'
        '1. What specific application features or UI workflows did the agent not know how to use?\n'
        '2. What domain knowledge (keyboard shortcuts, menu locations, file formats, web navigation patterns) was missing?\n'
        '3. What should a SKILL.md file for this application cover to prevent this failure?\n\n'
        'Respond in this exact JSON format:\n'
        '{{\n'
        '  "app_category": "libreoffice_calc|libreoffice_impress|libreoffice_writer|gimp|chrome_navigation|chrome_settings|chrome_shopping",\n'
        '  "missing_ui_knowledge": ["specific UI workflow 1", "specific UI workflow 2"],\n'
        '  "missing_domain_knowledge": ["keyboard shortcut X does Y", "menu path is A > B > C"],\n'
        '  "skill_md_topics": ["topic 1 to add to SKILL.md", "topic 2"],\n'
        '  "skill_priority": "critical|high|medium|low",\n'
        '  "key_insight": "one sentence summary"\n'
        '}}'
    ).format(instruction, app)

    messages.append({'role': 'user', 'content': final_q})

    return messages, None


# ---------------------------------------------------------------------------
# LLM call per task
# ---------------------------------------------------------------------------

async def analyze_task(
    client: httpx.AsyncClient,
    task_info: Dict[str, Any],
    index: int,
    semaphore: asyncio.Semaphore,
    counter: List[int],
    total: int,
) -> Dict[str, Any]:
    async with semaphore:
        task_id = task_info['task_id']
        instruction = task_info['instruction']
        app = task_info['app']
        category = task_info['category']
        trace_path = Path(task_info['trace_path_local'])

        messages, err = build_messages(trace_path, instruction, app)
        if messages is None:
            counter[0] += 1
            pct = counter[0] / total * 100
            print('[{:03d}/{} {:.0f}%] {}... -> ERROR: {}'.format(
                counter[0], total, pct, task_id[:8], err))
            return {
                'task_id': task_id,
                'instruction': instruction,
                'app': app,
                'task_success': False,
                'category': category,
                'llm': {'error': err},
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
                    '{}/chat/completions'.format(BASE_URL),
                    json=payload,
                    headers={
                        'Authorization': 'Bearer {}'.format(API_KEY),
                        'content-type': 'application/json',
                    },
                    timeout=180.0,
                )
                resp.raise_for_status()
                data = resp.json()
                text = data['choices'][0]['message']['content'].strip()

                parsed: Dict[str, Any] = {}
                try:
                    m = re.search(r'\{[\s\S]*\}', text)
                    if m:
                        parsed = json.loads(m.group(0))
                except Exception:
                    parsed = {'raw': text}

                counter[0] += 1
                pct = counter[0] / total * 100
                key_insight = parsed.get('key_insight', '')
                print('[{:03d}/{} {:.0f}%] {} -> OK | {}'.format(
                    counter[0], total, pct, task_id[:8], key_insight[:60]))

                return {
                    'task_id': task_id,
                    'instruction': instruction,
                    'app': app,
                    'task_success': False,
                    'category': category,
                    'llm': {
                        'app_category': parsed.get('app_category', ''),
                        'missing_ui_knowledge': parsed.get('missing_ui_knowledge', []),
                        'missing_domain_knowledge': parsed.get('missing_domain_knowledge', []),
                        'skill_md_topics': parsed.get('skill_md_topics', []),
                        'skill_priority': parsed.get('skill_priority', ''),
                        'key_insight': parsed.get('key_insight', ''),
                    },
                }

            except Exception as e:
                last_err = str(e)[:200]
                if attempt < MAX_RETRIES - 1:
                    wait = 2 ** attempt
                    print('[{:03d}] RETRY {} in {}s: {}'.format(index, attempt + 1, wait, last_err[:60]))
                    await asyncio.sleep(wait)

        counter[0] += 1
        pct = counter[0] / total * 100
        print('[{:03d}/{} {:.0f}%] {} -> FAILED: {}'.format(
            counter[0], total, pct, task_id[:8], last_err[:60]))
        return {
            'task_id': task_id,
            'instruction': instruction,
            'app': app,
            'task_success': False,
            'category': category,
            'llm': {'error': last_err},
        }


# ---------------------------------------------------------------------------
# Step 1: Load existing skills
# ---------------------------------------------------------------------------

def load_skills(skills_dirs: List[Path]) -> List[Dict[str, str]]:
    skills: List[Dict[str, str]] = []
    for base in skills_dirs:
        if not base.exists():
            continue
        for root, dirs, files in os.walk(base):
            if 'SKILL.md' in files:
                skill_path = Path(root) / 'SKILL.md'
                name, description = _parse_skill_md(skill_path)
                skills.append({
                    "name": name,
                    "directory": str(Path(root)),
                    "description": description,
                })
    return skills


def _parse_skill_md(path: Path) -> Tuple[str, str]:
    try:
        text = path.read_text(encoding='utf-8', errors='replace')
    except OSError:
        return path.parent.name, ""

    name = path.parent.name
    frontmatter_match = re.match(r'^---\s*\n(.*?)\n---', text, re.DOTALL)
    if frontmatter_match:
        fm = frontmatter_match.group(1)
        name_match = re.search(r'^name:\s*["\']?(.+?)["\']?\s*$', fm, re.MULTILINE)
        if name_match:
            name = name_match.group(1).strip().strip('"\'')

    body_start = frontmatter_match.end() if frontmatter_match else 0
    description = text[body_start:body_start + 200].strip().replace('\n', ' ')
    return name, description


# ---------------------------------------------------------------------------
# Step 2: Load eval tasks
# ---------------------------------------------------------------------------

def load_tasks(results_dir: Path) -> List[Dict[str, Any]]:
    tasks: List[Dict[str, Any]] = []
    for task_dir in sorted(results_dir.iterdir()):
        if not task_dir.is_dir():
            continue
        config_path = task_dir / 'task_config.json'
        result_path = task_dir / 'result.json'
        if not config_path.exists():
            continue

        try:
            config = json.loads(config_path.read_text(encoding='utf-8'))
        except (OSError, json.JSONDecodeError):
            continue

        result: Dict[str, Any] = {}
        if result_path.exists():
            try:
                result = json.loads(result_path.read_text(encoding='utf-8'))
            except (OSError, json.JSONDecodeError):
                pass

        success = bool(result.get('result', 0.0) >= 1.0) if result else False
        trace_path_local = result.get('trace_path_local', '') if result else ''

        tasks.append({
            "task_id": config.get('id', task_dir.name),
            "snapshot": config.get('snapshot', 'unknown'),
            "instruction": config.get('instruction', ''),
            "evaluator_func": config.get('evaluator', {}).get('func', ''),
            "success": success,
            "result_score": float(result.get('result', 0.0)) if result else 0.0,
            "trace_path_local": trace_path_local,
        })
    return tasks


# ---------------------------------------------------------------------------
# Step 3 & 4: Cluster tasks and compute stats
# ---------------------------------------------------------------------------

def _primary_category(task: Dict[str, Any]) -> str:
    """
    Assign the most specific matching category based on snapshot then keywords.
    Snapshot-first routing ensures Calc/Impress/Writer tasks do not bleed into
    Chrome categories even if instruction mentions generic words.
    """
    snapshot = task['snapshot'].lower()
    instruction = task['instruction'].lower()

    if 'calc' in snapshot:
        return 'libreoffice_calc'
    if 'impress' in snapshot:
        return 'libreoffice_impress'
    if 'writer' in snapshot:
        return 'libreoffice_writer'
    if 'gimp' in snapshot:
        return 'gimp'

    if 'chrome' in snapshot:
        for cat, _app, keywords in CATEGORY_DEFS:
            if 'chrome' in cat:
                if any(kw in instruction for kw in keywords):
                    return cat
        return 'chrome_navigation'

    for cat, _app, keywords in CATEGORY_DEFS:
        if any(kw in instruction for kw in keywords):
            return cat

    return 'other'


def cluster_tasks(
    tasks: List[Dict[str, Any]],
    skills: List[Dict[str, str]],
) -> Dict[str, Dict[str, Any]]:
    skill_by_name: Dict[str, str] = {s['name'].lower(): s['name'] for s in skills}

    category_map: Dict[str, Dict[str, Any]] = {}
    for cat, app, _ in CATEGORY_DEFS:
        category_map[cat] = {
            "category": cat,
            "app": app,
            "tasks": [],
            "task_count": 0,
            "pass_count": 0,
            "fail_count": 0,
            "success_rate": 0.0,
            "has_skill": False,
            "skill_name": None,
            "priority_score": 0.0,
        }

    category_map['other'] = {
        "category": "other",
        "app": "unknown",
        "tasks": [],
        "task_count": 0,
        "pass_count": 0,
        "fail_count": 0,
        "success_rate": 0.0,
        "has_skill": False,
        "skill_name": None,
        "priority_score": 0.0,
    }

    for task in tasks:
        cat = _primary_category(task)
        if cat not in category_map:
            cat = 'other'
        entry = category_map[cat]
        entry['tasks'].append(task['task_id'])
        entry['task_count'] += 1
        if task['success']:
            entry['pass_count'] += 1
        else:
            entry['fail_count'] += 1

    for cat, entry in category_map.items():
        tc = entry['task_count']
        entry['success_rate'] = round(entry['pass_count'] / tc, 4) if tc > 0 else 0.0
        fail = entry['fail_count']
        sr = entry['success_rate']
        entry['priority_score'] = round(fail * (1.0 - sr), 4)

        for sname_lower, sname_orig in skill_by_name.items():
            if (cat.replace('_', '') in sname_lower.replace('-', '').replace('_', '')
                    or cat in sname_lower
                    or sname_lower in cat):
                entry['has_skill'] = True
                entry['skill_name'] = sname_orig
                break

    return category_map


# ---------------------------------------------------------------------------
# Step 5: Generate skill roadmap
# ---------------------------------------------------------------------------

def _priority_label(score: float) -> str:
    if score > 20:
        return 'critical'
    if score > 10:
        return 'high'
    if score > 5:
        return 'medium'
    return 'low'


def build_roadmap(category_map: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    roadmap = []
    for cat, entry in category_map.items():
        if entry['task_count'] == 0:
            continue
        score = entry['priority_score']
        roadmap.append({
            "category": cat,
            "app": entry['app'],
            "task_count": entry['task_count'],
            "pass_count": entry['pass_count'],
            "fail_count": entry['fail_count'],
            "success_rate": entry['success_rate'],
            "has_skill": entry['has_skill'],
            "skill_name": entry['skill_name'],
            "priority_score": score,
            "priority": _priority_label(score),
            "recommended_skill_content": SKILL_OUTLINES.get(cat, [
                "Document common task patterns observed in eval failures",
                "Provide step-by-step interaction sequences for the application",
                "Cover error recovery strategies",
            ]),
        })
    roadmap.sort(key=lambda x: x['priority_score'], reverse=True)
    return roadmap


# ---------------------------------------------------------------------------
# Step 6: MCP opportunities
# ---------------------------------------------------------------------------

def find_mcp_opportunities(
    tasks: List[Dict[str, Any]],
    category_map: Dict[str, Dict[str, Any]],
) -> List[Dict[str, Any]]:
    opportunities: List[Dict[str, Any]] = []
    seen: set = set()

    for cat, kws, suggestion in MCP_RULES:
        entry = category_map.get(cat, {})
        if entry.get('task_count', 0) == 0:
            continue

        matched_tasks = []
        for task in tasks:
            if _primary_category(task) != cat:
                continue
            instr = task['instruction'].lower()
            if any(kw in instr for kw in kws):
                matched_tasks.append(task['task_id'])

        if not matched_tasks or suggestion in seen:
            continue
        seen.add(suggestion)

        opportunities.append({
            "category": cat,
            "app": entry.get('app', ''),
            "matched_task_count": len(matched_tasks),
            "mcp_suggestion": suggestion,
        })

    opportunities.sort(key=lambda x: x['matched_task_count'], reverse=True)
    return opportunities


# ---------------------------------------------------------------------------
# Output and summary
# ---------------------------------------------------------------------------

def build_summary(
    tasks: List[Dict[str, Any]],
    category_map: Dict[str, Dict[str, Any]],
    roadmap: List[Dict[str, Any]],
) -> Dict[str, Any]:
    cats_with_skill = sum(1 for e in category_map.values() if e['has_skill'] and e['task_count'] > 0)
    cats_without_skill = sum(1 for e in category_map.values() if not e['has_skill'] and e['task_count'] > 0)

    highest_gap = ""
    for item in roadmap:
        if not item['has_skill'] and item['task_count'] > 0:
            highest_gap = item['category']
            break

    return {
        "total_tasks": len(tasks),
        "categories_with_skill": cats_with_skill,
        "categories_without_skill": cats_without_skill,
        "highest_priority_gap": highest_gap,
    }


def print_summary_table(
    roadmap: List[Dict[str, Any]],
    summary: Dict[str, Any],
) -> None:
    col_widths = {
        "category": 24,
        "app": 20,
        "tasks": 6,
        "pass": 5,
        "fail": 5,
        "success_rate": 12,
        "has_skill": 10,
        "priority": 10,
        "score": 8,
    }

    def row(*cells: str) -> str:
        cols = list(col_widths.values())
        parts = []
        for cell, width in zip(cells, cols):
            parts.append(str(cell).ljust(width))
        return " ".join(parts)

    header = row(
        "Category", "App", "Tasks", "Pass", "Fail",
        "SuccessRate", "HasSkill", "Priority", "Score",
    )
    separator = "-" * len(header)

    print()
    print("=== Jarvis Skills Gap Analysis ===")
    print("Results dir : {}".format(RESULTS_DIR))
    print("Generated at: {}".format(datetime.now(timezone.utc).isoformat()))
    print()
    print(separator)
    print(header)
    print(separator)

    for item in roadmap:
        print(row(
            item['category'],
            item['app'],
            str(item['task_count']),
            str(item['pass_count']),
            str(item['fail_count']),
            "{:.1%}".format(item['success_rate']),
            "YES" if item['has_skill'] else "NO",
            item['priority'].upper(),
            "{:.1f}".format(item['priority_score']),
        ))
    print(separator)
    print()
    print("Total tasks              : {}".format(summary['total_tasks']))
    print("Categories with skill    : {}".format(summary['categories_with_skill']))
    print("Categories without skill : {}".format(summary['categories_without_skill']))
    print("Highest priority gap     : {}".format(summary['highest_priority_gap']))
    print()


# ---------------------------------------------------------------------------
# Aggregate LLM insights across all results
# ---------------------------------------------------------------------------

def aggregate_llm_insights(results: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Aggregate per-task LLM results into top topics and by-app knowledge gaps."""
    topic_counts: Dict[str, Dict[str, Any]] = {}
    by_app: Dict[str, List[str]] = defaultdict(list)

    for r in results:
        llm = r.get('llm', {})
        if 'error' in llm:
            continue

        app_cat = llm.get('app_category', r.get('category', ''))

        for topic in llm.get('skill_md_topics', []):
            if topic not in topic_counts:
                topic_counts[topic] = {'topic': topic, 'count': 0, 'apps': []}
            topic_counts[topic]['count'] += 1
            if app_cat and app_cat not in topic_counts[topic]['apps']:
                topic_counts[topic]['apps'].append(app_cat)

        for item in llm.get('missing_domain_knowledge', []):
            by_app[app_cat].append(item)
        for item in llm.get('missing_ui_knowledge', []):
            by_app[app_cat].append(item)

    top_topics = sorted(topic_counts.values(), key=lambda x: x['count'], reverse=True)

    # Deduplicate and cap by-app items
    by_app_dedup: Dict[str, List[str]] = {}
    for app_cat, items in by_app.items():
        seen_items: set = set()
        deduped = []
        for item in items:
            if item not in seen_items:
                seen_items.add(item)
                deduped.append(item)
        by_app_dedup[app_cat] = deduped[:30]

    return {
        'top_skill_md_topics': top_topics,
        'by_app_missing_knowledge': by_app_dedup,
    }


# ---------------------------------------------------------------------------
# Collect failed tasks that need LLM analysis
# ---------------------------------------------------------------------------

def collect_failed_tasks_for_llm(
    tasks: List[Dict[str, Any]],
    limit: Optional[int],
) -> List[Dict[str, Any]]:
    """Return failed tasks with a valid local trace path, enriched with category."""
    result = []
    for task in tasks:
        if task['success']:
            continue
        trace_path_local = task.get('trace_path_local', '')
        if not trace_path_local:
            continue
        tp = Path(trace_path_local)
        if not tp.exists():
            continue
        result.append({
            'task_id': task['task_id'],
            'instruction': task['instruction'],
            'app': task['snapshot'],
            'category': _primary_category(task),
            'trace_path_local': str(tp),
        })
        if limit and len(result) >= limit:
            break
    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main(limit: Optional[int] = None) -> None:
    print("Loading existing skills...")
    skills = load_skills(SKILLS_DIRS)
    print("  Found {} skill(s)".format(len(skills)))

    print("Loading eval tasks...")
    tasks = load_tasks(RESULTS_DIR)
    print("  Found {} task(s)".format(len(tasks)))

    print("Clustering tasks and computing statistics...")
    category_map = cluster_tasks(tasks, skills)

    print("Building skill roadmap...")
    roadmap = build_roadmap(category_map)

    print("Identifying MCP opportunities...")
    mcp_opps = find_mcp_opportunities(tasks, category_map)

    summary = build_summary(tasks, category_map, roadmap)

    # Print heuristic table immediately
    print_summary_table(roadmap, summary)

    # ---------------------------------------------------------------------------
    # LLM analysis of failed tasks
    # ---------------------------------------------------------------------------
    failed_tasks = collect_failed_tasks_for_llm(tasks, limit)
    print("Failed tasks with traces: {}".format(len(failed_tasks)))

    # Load existing results for incremental resume
    existing_results: Dict[str, Dict[str, Any]] = {}
    if OUTPUT_FILE.exists():
        try:
            prev_data = json.loads(OUTPUT_FILE.read_text(encoding='utf-8'))
            for r in prev_data.get('results', []):
                if 'error' not in r.get('llm', {}):
                    existing_results[r['task_id']] = r
            print("Resuming: {} already done".format(len(existing_results)))
        except Exception:
            pass

    to_analyze = [(i, t) for i, t in enumerate(failed_tasks)
                  if t['task_id'] not in existing_results]
    already_done = [existing_results[t['task_id']] for t in failed_tasks
                    if t['task_id'] in existing_results]

    total = len(to_analyze)
    print("Already done: {}, To analyze: {}".format(len(already_done), total))
    print("Model: {}  Concurrency: {}".format(MODEL, CONCURRENCY))
    print("Started: {}".format(datetime.now().strftime("%H:%M:%S")))
    print()

    counter = [0]
    new_results: List[Dict[str, Any]] = []
    if to_analyze:
        semaphore = asyncio.Semaphore(CONCURRENCY)
        async with httpx.AsyncClient() as client:
            coros = [
                analyze_task(client, t, i, semaphore, counter, total)
                for i, t in to_analyze
            ]
            new_results = list(await asyncio.gather(*coros))

    all_results = already_done + new_results

    llm_insights = aggregate_llm_insights(all_results)

    # Serialize category_map without raw task id lists
    serializable_cats: Dict[str, Any] = {}
    for cat, entry in category_map.items():
        if entry['task_count'] == 0:
            continue
        serializable_cats[cat] = {k: v for k, v in entry.items() if k != 'tasks'}

    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model": MODEL,
        "existing_skills": skills,
        "task_categories": serializable_cats,
        "skill_roadmap": roadmap,
        "mcp_opportunities": mcp_opps,
        "summary": summary,
        "llm_insights": llm_insights,
        "results": all_results,
    }

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding='utf-8')
    print("JSON output written to: {}".format(OUTPUT_FILE))

    # Print LLM aggregation summary
    print()
    print("=== LLM Insights Summary ===")
    print("Top skill_md_topics:")
    for entry in llm_insights['top_skill_md_topics'][:10]:
        print("  ({}x) {} [{}]".format(
            entry['count'], entry['topic'], ', '.join(entry['apps'])))
    print()
    print("Missing knowledge by app:")
    for app_cat, items in llm_insights['by_app_missing_knowledge'].items():
        print("  {}:".format(app_cat))
        for item in items[:5]:
            print("    - {}".format(item))


if __name__ == '__main__':
    limit_arg: Optional[int] = int(sys.argv[1]) if len(sys.argv) > 1 else None
    asyncio.run(main(limit=limit_arg))
