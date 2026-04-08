const {
  IslandChatRole,
  makeWorkingSnapshot,
  makeIdleSnapshot,
} = require("./island-protocol");

class IslandDemoEngine {
  constructor({
    onSnapshot,
    stepIntervalMs = 1100,
    maxSteps = 5,
    conversationID = "electron-native-shell",
    autoRestartDelayMs = 1700,
    idleEmitDelayMs = 350,
  }) {
    this.onSnapshot = onSnapshot;
    this.stepIntervalMs = stepIntervalMs;
    this.maxSteps = maxSteps;
    this.conversationID = conversationID;
    this.autoRestartDelayMs = autoRestartDelayMs;
    this.idleEmitDelayMs = idleEmitDelayMs;

    this.turns = [
      {
        id: `seed-${Date.now()}`,
        role: IslandChatRole.ASSISTANT,
        text: "我在这儿，执行中你可以随时发指令。",
      },
    ];
    this.step = 0;
    this.stepTimer = null;
    this.idleTimer = null;
    this.restartTimer = null;
  }

  start() {
    if (this.stepTimer) return;
    this.stepTimer = setInterval(() => this.tick(), this.stepIntervalMs);
    this.tick();
  }

  stop() {
    if (this.stepTimer) clearInterval(this.stepTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.stepTimer = null;
    this.idleTimer = null;
    this.restartTimer = null;
    this.step = 0;
  }

  appendUserTurn(text) {
    const clean = String(text ?? "").trim();
    if (!clean) return;
    this.turns.push({
      id: `user-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      role: IslandChatRole.USER,
      text: clean,
    });
    this.turns.push({
      id: `assistant-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      role: IslandChatRole.ASSISTANT,
      text: "收到，我会按你的输入继续推进当前步骤。",
    });
    this.emitWorking(Math.max(this.step, 1));
  }

  tick() {
    this.step += 1;

    if (this.step === 2) {
      this.turns.push({
        id: `assistant-${Date.now()}-2`,
        role: IslandChatRole.ASSISTANT,
        text: "我正在执行第 2 步，若要改策略可以直接发我。",
      });
    } else if (this.step === 4) {
      this.turns.push({
        id: `assistant-${Date.now()}-4`,
        role: IslandChatRole.ASSISTANT,
        text: "已接近完成，当前在收尾校验。",
      });
    }

    const bounded = Math.min(this.step, this.maxSteps);
    this.emitWorking(bounded);

    if (this.step < this.maxSteps) return;

    if (this.stepTimer) {
      clearInterval(this.stepTimer);
      this.stepTimer = null;
    }
    this.step = 0;

    this.idleTimer = setTimeout(() => {
      this.onSnapshot(
        makeIdleSnapshot({
          detail: "5 步工作已完成，等待下一条任务。",
        })
      );
    }, this.idleEmitDelayMs);

    this.restartTimer = setTimeout(() => {
      this.start();
    }, this.autoRestartDelayMs);
  }

  emitWorking(step) {
    const snapshot = makeWorkingSnapshot({
      step,
      maxSteps: this.maxSteps,
      conversation: {
        id: this.conversationID,
        title: "Jarvis 对话",
        turns: this.turns.slice(-6),
        inputPlaceholder: this.placeholderFor(step),
        canSend: true,
        streamingReply: this.streamingReplyFor(step),
        toolCalls: this.toolCallsFor(step),
        lastSeenImage: this.seenImageFor(step),
      },
    });
    this.onSnapshot(snapshot);
  }

  streamingReplyFor(step) {
    if (step <= 1) return "我先把当前窗口标题和状态扫了一遍，准备继续收束布局。";
    if (step === 2) return "我正在把第 2 步拆开处理，优先稳定内容区，再决定工具调用怎么映射。";
    if (step === 3) return "我已经定位到关键状态切换点，接下来整理回复、工具调用和图像摘要。";
    if (step === 4) return "这一轮基本收尾了，我在做最后视觉校准，确保收回和展开不打架。";
    return "收尾校验完成，准备沉到待命态。";
  }

  toolCallsFor(step) {
    if (step <= 1) {
      return [
        { id: "tool-screenshot", name: "capture_window", status: "done", symbol: "camera.viewfinder" },
        { id: "tool-ocr", name: "read_labels", status: "running", symbol: "text.viewfinder" },
      ];
    }
    if (step === 2) {
      return [
        { id: "tool-screenshot", name: "capture_window", status: "done", symbol: "camera.viewfinder" },
        { id: "tool-layout", name: "measure_layout", status: "done", symbol: "ruler" },
        { id: "tool-patch", name: "patch_swiftui", status: "running", symbol: "hammer" },
      ];
    }
    if (step === 3) {
      return [
        { id: "tool-layout", name: "measure_layout", status: "done", symbol: "ruler" },
        { id: "tool-preview", name: "render_preview", status: "running", symbol: "play.rectangle" },
        { id: "tool-compare", name: "compare_motion", status: "queued", symbol: "arrow.left.arrow.right" },
      ];
    }
    if (step === 4) {
      return [
        { id: "tool-preview", name: "render_preview", status: "done", symbol: "play.rectangle" },
        { id: "tool-polish", name: "polish_spacing", status: "running", symbol: "wand.and.stars" },
      ];
    }
    return [
      { id: "tool-idle", name: "idle_sync", status: "done", symbol: "moon.zzz" },
    ];
  }

  seenImageFor(step) {
    if (step <= 1) {
      return {
        title: "终端窗口截图",
        subtitle: "上一轮视觉输入，重点看标题栏和底边对齐。",
        symbol: "photo.on.rectangle.angled",
      };
    }
    if (step === 2) {
      return {
        title: "灵动岛展开态",
        subtitle: "上一轮看到右上角心跳和输入区排布。",
        symbol: "rectangle.stack",
      };
    }
    if (step === 3) {
      return {
        title: "对话区裁切预览",
        subtitle: "正在比对文本、工具调用和图像摘要层级。",
        symbol: "text.below.photo",
      };
    }
    if (step === 4) {
      return {
        title: "收尾帧",
        subtitle: "最后一轮检查展开到工作态的内容收束。",
        symbol: "sparkles.rectangle.stack",
      };
    }
    return {
      title: "上一轮看到的图",
      subtitle: "任务完成，画面已缓存，Jarvis 准备休眠。",
      symbol: "moon.stars",
    };
  }

  placeholderFor(step) {
    if (step <= 2) return "扔个新要求过来，或者让我换个更野一点的做法…";
    if (step <= 4) return "想临时加戏的话，现在喊我还来得及…";
    return "给我一个新任务，最好稍微离谱一点。";
  }
}

module.exports = { IslandDemoEngine };
