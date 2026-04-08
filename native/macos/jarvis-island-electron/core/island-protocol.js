const IslandPhase = Object.freeze({
  IDLE: "idle",
  LISTENING: "listening",
  WAITING: "waiting",
  WORKING: "working",
  APPROVAL: "approval",
  RESULT: "result",
  ERROR: "error",
});

const IslandChatRole = Object.freeze({
  USER: "user",
  ASSISTANT: "assistant",
  SYSTEM: "system",
});

function withLineBreak(snapshot) {
  return `${JSON.stringify(snapshot)}\n`;
}

function makeWorkingSnapshot({
  step,
  maxSteps,
  appName,
  title,
  detail,
  expanded = false,
  conversation,
}) {
  return {
    phase: IslandPhase.WORKING,
    title: title ?? "正在执行 Demo 工作流",
    detail: detail ?? `第 ${step} / ${maxSteps} 步：处理中…`,
    appName: appName ?? "Jarvis Demo",
    progress: { current: step, maximum: maxSteps },
    expanded,
    conversation: conversation ?? null,
  };
}

function makeIdleSnapshot({
  appName = "Jarvis zzz",
  title = "Jarvis 已就位",
  detail = "等待新的桌面任务。",
  expanded = false,
} = {}) {
  return {
    phase: IslandPhase.IDLE,
    title,
    detail,
    appName,
    progress: { current: 0, maximum: null },
    expanded,
    conversation: null,
  };
}

module.exports = {
  IslandPhase,
  IslandChatRole,
  withLineBreak,
  makeWorkingSnapshot,
  makeIdleSnapshot,
};
