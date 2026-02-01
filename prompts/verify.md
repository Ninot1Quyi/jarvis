# Verify Prompt

你需要验证任务是否已经完成。

## 任务

{{task}}

## 执行历史

{{steps}}

## 当前屏幕

[截图将作为图片附件发送]

---

请判断任务是否已经完成。

如果完成，调用 `verify_success` 工具。
如果未完成，调用 `verify_failed` 工具并说明原因。
