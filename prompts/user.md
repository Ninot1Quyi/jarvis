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

**MANDATORY -- Notification task handling:**
When you receive a notification message (from `<notification>` channel, e.g. WeChat, QQ, Slack):
1. **IMMEDIATELY call `recordTask`** with `source` set to the notification origin (e.g. `source: "notification:QQ"`) and `content` describing what to do. This is NOT optional.
2. **Reply to the sender in the ORIGINATING app** via GUI automation (open the app, find the conversation, type and send). The originating app is the one in the notification, NOT a different app.
3. **Only after replying**, call `recordTask(content="")` to clear, then stop calling tools to signal completion.

Do NOT skip `recordTask`. Do NOT reply in a different app than the notification source. Do NOT signal completion before actually replying via GUI. Verify your reply by checking Recent Actions for actual GUI operations (click, type, hotkey) in the target app.
