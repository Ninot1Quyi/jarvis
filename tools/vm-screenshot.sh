#!/bin/bash
# 截取 Parallels macOS 虚拟机屏幕截图
# 用法: ./vm-screenshot.sh [输出路径]

OUTPUT="${1:-/tmp/vm_screenshot.png}"
VM_NAME="macOS"

prlctl capture "$VM_NAME" --file "$OUTPUT" 2>/dev/null

if [ $? -eq 0 ]; then
    echo "$OUTPUT"
else
    echo "截图失败" >&2
    exit 1
fi
