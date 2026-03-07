#!/bin/bash
# tmux-auto-attach.sh
# 自动监控并连接到最新的 jarvis_eval tmux 会话

SESSION_PREFIX="jarvis_eval_"
CHECK_INTERVAL=5

echo "Starting tmux auto-attach monitor..."
echo "Will auto-connect to latest ${SESSION_PREFIX}* session"
echo ""

while true; do
    # 查找最新的 jarvis_eval 会话
    LATEST_SESSION=$(tmux list-sessions 2>/dev/null | grep "$SESSION_PREFIX" | sort -t'_' -k2 -n | tail -1 | cut -d: -f1)

    if [ -n "$LATEST_SESSION" ]; then
        CURRENT_ATTACHED=$(tmux list-panes -s -t "$LATEST_SESSION" -F "#{pane_active}" 2>/dev/null || echo "0")

        # 如果没有 pane 连接到它，显示提示
        if [ "$CURRENT_ATTACHED" != "1" ]; then
            echo "[$(date '+%H:%M:%S')] Found session: $LATEST_SESSION (not attached)"
        fi
    else
        echo "[$(date '+%H:%M:%S')] No ${SESSION_PREFIX}* sessions found"
    fi

    sleep $CHECK_INTERVAL
done
