## Current Task

{{task}}

## TODO List

{{todoSummary}}

## Recent Actions

{{recentSteps}}

{{screenStatus}}

---

Analyze the current situation and respond appropriately:
- For conversation/questions: Reply directly (consider turning screen OFF if not needed)
- For GUI tasks: Evaluate previous action, analyze screen, call appropriate tools
- **If Current Task source is notification (e.g. [notification:WeChat], [notification:QQ])**: You MUST first reply to the sender in the originating app via GUI automation, THEN clear task and finish. Order: reply in app -> recordTask(content="") -> finished(). Do NOT clear task or call finished before replying. Do NOT assume you have replied -- verify it by checking Recent Actions for actual GUI operations (click, type, hotkey) in the target app. If no such actions exist, you have NOT replied yet.
