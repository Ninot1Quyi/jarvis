(function () {
  const LayoutMode = {
    COMPACT: "compact",
    COMPACT_WORKING: "compactWorking",
    EXPANDED: "expanded",
  };

  const Phase = {
    IDLE: "idle",
    WORKING: "working",
    WAITING: "waiting",
    LISTENING: "listening",
    APPROVAL: "approval",
    RESULT: "result",
    ERROR: "error",
  };

  const Layout = {
    panelWidth: 640,
    panelHeight: 252,
    expandedHeight: 200,
    compactTopRadius: 6,
    compactBottomRadius: 14,
    expandedTopRadius: 19,
    expandedBottomRadius: 24,
    notchWidth: 185,
    notchHeight: 32,
  };

  const state = {
    snapshot: idleSnapshot(),
    activeConversation: null,
    conversationDraft: "",
    layoutMode: LayoutMode.COMPACT,
    hovering: false,
    lastHoverActivationAt: 0,
    hoverRetentionWindow: 280,
    pendingHoverOpenTask: null,
    pendingCloseTask: null,
    pendingBusyToIdleSettleTask: null,
    appNameRevealTask: null,
    pulse: 0,
    lastPulseRendered: 0,
    previousPhase: Phase.IDLE,
    previousLayoutMode: LayoutMode.COMPACT,
    demo: {
      stepTimer: null,
      isWorking: false,
      currentStep: 0,
      maxSteps: 5,
      stepInterval: 1100,
      conversationID: "demo-llm-conversation",
      conversationTurns: [],
      externalDriven: false,
    },
  };

  const panelEl = document.getElementById("panel");
  const shellEl = document.getElementById("shell");
  const compactIconLaneEl = document.getElementById("compactIconLane");
  const compactPulseLaneEl = document.getElementById("compactPulseLane");
  const expandedSceneEl = document.getElementById("expandedScene");
  const appNameEl = document.getElementById("appName");
  const heartbeatEl = document.getElementById("heartbeat");
  const streamTextEl = document.getElementById("streamText");
  const progressLabelEl = document.getElementById("progressLabel");
  const toolGridEl = document.getElementById("toolGrid");
  const seenImageStackEl = document.getElementById("seenImageStack");
  const composerInputEl = document.getElementById("composerInput");

  shellEl.addEventListener("mouseenter", () => handleHoverChanged(true));
  shellEl.addEventListener("mouseleave", () => handleHoverChanged(false));

  composerInputEl.addEventListener("input", (event) => {
    state.conversationDraft = event.target.value;
  });

  composerInputEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    if (event.shiftKey) return;
    event.preventDefault();
    submitConversationMessage();
  });

  function idleSnapshot() {
    return {
      phase: Phase.IDLE,
      title: "Jarvis 已就位",
      detail: "等待新的桌面任务。",
      appName: "Jarvis",
      progress: { current: 0, maximum: null },
      expanded: false,
      conversation: null,
    };
  }

  function progressLabel(progress) {
    if (!progress) return "0/∞";
    if (typeof progress.maximum === "number" && progress.maximum > 0) {
      return `${progress.current}/${progress.maximum}`;
    }
    return `${progress.current}/∞`;
  }

  function clearTask(taskName) {
    if (!state[taskName]) return;
    clearTimeout(state[taskName]);
    state[taskName] = null;
  }

  function cancelTransientTasks() {
    clearTask("pendingHoverOpenTask");
    clearTask("pendingCloseTask");
    clearTask("pendingBusyToIdleSettleTask");
  }

  function effectivelyHovering() {
    return (
      state.hovering ||
      Date.now() - state.lastHoverActivationAt < state.hoverRetentionWindow
    );
  }

  function applyLayout(layoutMode) {
    state.layoutMode = layoutMode;
  }

  function targetLayoutMode(snapshot) {
    if (!snapshot) return LayoutMode.COMPACT;
    switch (snapshot.phase) {
      case Phase.WORKING:
      case Phase.WAITING:
        return effectivelyHovering() || snapshot.expanded
          ? LayoutMode.EXPANDED
          : LayoutMode.COMPACT_WORKING;
      case Phase.APPROVAL:
      case Phase.RESULT:
      case Phase.ERROR:
      case Phase.LISTENING:
        return LayoutMode.EXPANDED;
      default:
        return effectivelyHovering() || snapshot.expanded
          ? LayoutMode.EXPANDED
          : LayoutMode.COMPACT;
    }
  }

  function shouldUseBusyToIdleMotion(previous, next) {
    const wasBusy = previous === Phase.WORKING || previous === Phase.WAITING;
    return wasBusy && next === Phase.IDLE;
  }

  function applyBusyToIdleMotion(targetLayout) {
    if (targetLayout !== LayoutMode.COMPACT) {
      applyLayout(targetLayout);
      render();
      return;
    }

    if (!state.hovering) {
      applyLayout(LayoutMode.COMPACT);
      render();
      return;
    }

    if (state.layoutMode === LayoutMode.COMPACT_WORKING) {
      applyLayout(LayoutMode.COMPACT);
      render();
      return;
    }

    applyLayout(LayoutMode.COMPACT_WORKING);
    render();

    clearTask("pendingBusyToIdleSettleTask");
    state.pendingBusyToIdleSettleTask = setTimeout(() => {
      if (effectivelyHovering()) return;
      applyLayout(LayoutMode.COMPACT);
      render();
    }, 120);
  }

  function syncConversation(snapshot) {
    if (!snapshot.conversation) {
      state.activeConversation = null;
      state.conversationDraft = "";
      return;
    }

    if (!state.activeConversation || state.activeConversation.id !== snapshot.conversation.id) {
      state.conversationDraft = "";
    }
    state.activeConversation = snapshot.conversation;
  }

  function receiveSnapshot(nextSnapshot) {
    const previous = state.snapshot;
    state.previousPhase = previous.phase;
    state.snapshot = nextSnapshot;
    syncConversation(nextSnapshot);
    state.pulse += 1;

    cancelTransientTasks();

    const busyToIdle = shouldUseBusyToIdleMotion(
      state.previousPhase,
      nextSnapshot.phase
    );

    if (busyToIdle && !state.hovering) {
      applyLayout(LayoutMode.COMPACT);
      render();
      return;
    }

    const target = targetLayoutMode(nextSnapshot);
    if (busyToIdle) {
      applyBusyToIdleMotion(target);
      return;
    }

    applyLayout(target);
    render();
  }

  function scheduleHoverExpansion() {
    clearTask("pendingHoverOpenTask");
    state.pendingHoverOpenTask = setTimeout(() => {
      if (!effectivelyHovering()) return;
      if (state.layoutMode === LayoutMode.COMPACT_WORKING) return;
      applyLayout(LayoutMode.EXPANDED);
      render();
    }, 160);
  }

  function scheduleHoverCollapse() {
    clearTask("pendingCloseTask");
    state.pendingCloseTask = setTimeout(() => {
      if (effectivelyHovering()) return;
      const busy =
        state.snapshot.phase === Phase.WORKING ||
        state.snapshot.phase === Phase.WAITING;
      applyLayout(busy ? LayoutMode.COMPACT_WORKING : LayoutMode.COMPACT);
      render();
    }, 180);
  }

  function handleHoverChanged(hovering) {
    if (state.hovering === hovering) return;

    state.hovering = hovering;
    if (hovering) {
      state.lastHoverActivationAt = Date.now();
    }
    clearTask("pendingBusyToIdleSettleTask");

    if (hovering) {
      clearTask("pendingCloseTask");
      if (state.layoutMode === LayoutMode.COMPACT_WORKING) {
        applyLayout(LayoutMode.EXPANDED);
        render();
      } else if (state.layoutMode !== LayoutMode.EXPANDED) {
        scheduleHoverExpansion();
      }
      onDemoHoverChanged(true);
      return;
    }

    clearTask("pendingHoverOpenTask");
    scheduleHoverCollapse();
    onDemoHoverChanged(false);
  }

  function streamingPanelText() {
    const conversation = state.activeConversation;
    if (conversation && conversation.streamingReply) {
      return conversation.streamingReply;
    }
    if (conversation && conversation.turns && conversation.turns.length > 0) {
      for (let i = conversation.turns.length - 1; i >= 0; i -= 1) {
        if (conversation.turns[i].role === "assistant") {
          return conversation.turns[i].text;
        }
      }
    }
    return state.snapshot.phase === Phase.IDLE ? "Jarvis zzz" : state.snapshot.title;
  }

  function activeToolCalls() {
    if (!state.activeConversation || !Array.isArray(state.activeConversation.toolCalls)) {
      return [];
    }
    return state.activeConversation.toolCalls;
  }

  function activeSeenImage() {
    if (!state.activeConversation) return null;
    return state.activeConversation.lastSeenImage || null;
  }

  function composerPlaceholder() {
    if (!state.activeConversation) {
      return "给我一个稍微离谱、但真的能做的需求。";
    }
    return (
      state.activeConversation.inputPlaceholder ||
      "给我一个稍微离谱、但真的能做的需求。"
    );
  }

  function symbolEmoji(symbolName) {
    const mapping = {
      "camera.viewfinder": "📸",
      "text.viewfinder": "🔎",
      ruler: "📏",
      hammer: "🛠",
      "play.rectangle": "▶",
      "arrow.left.arrow.right": "↔",
      "wand.and.stars": "✨",
      "moon.zzz": "🌙",
      "photo.on.rectangle.angled": "🖼",
      "rectangle.stack": "🗂",
      "text.below.photo": "🧾",
      "sparkles.rectangle.stack": "📚",
      "moon.stars": "🌌",
    };
    return mapping[symbolName] || "🖼";
  }

  function renderSeenImageStack(image) {
    const title = image && image.title ? image.title : "视觉上下文已缓存";
    const symbol = symbolEmoji(image && image.symbol ? image.symbol : "");

    seenImageStackEl.innerHTML = `
      <div class="img-layer layer-0"></div>
      <div class="img-layer layer-1"></div>
      <div class="img-layer layer-2"></div>
      <div class="img-main">
        <div class="img-main-lines">
          <div class="img-main-line"></div>
          <div class="img-main-line"></div>
        </div>
        <div class="img-main-bottom">
          <div class="img-title">${escapeHtml(title)}</div>
          <div class="img-symbol">${escapeHtml(symbol)}</div>
        </div>
      </div>
    `;
  }

  function compactToolLabel(call) {
    if (call.status === "running") return `${call.name} 中`;
    if (call.status === "queued") return `${call.name} 待`;
    return call.name;
  }

  function toolStatusColor(status) {
    if (status === "running") return "rgba(255,97,71,0.95)";
    if (status === "queued") return "rgba(255,255,255,0.35)";
    return "rgba(44,208,117,0.95)";
  }

  function renderToolGrid(calls) {
    if (!calls.length) {
      toolGridEl.innerHTML = "";
      return;
    }

    const items = calls.slice(0, 4).map((call) => {
      const label = compactToolLabel(call);
      const dot = toolStatusColor(call.status);
      return `
        <div class="tool-item" title="${escapeHtml(call.name)}">
          <span class="tool-dot" style="background:${dot}"></span>
          <span>${escapeHtml(label)}</span>
        </div>
      `;
    });

    toolGridEl.innerHTML = items.join("");
  }

  function triggerHeartbeatPulse(active) {
    heartbeatEl.classList.toggle("active", !!active);
    if (!active) return;
    if (state.lastPulseRendered === state.pulse) return;
    state.lastPulseRendered = state.pulse;

    heartbeatEl.classList.remove("pulse-burst");
    window.requestAnimationFrame(() => {
      heartbeatEl.classList.add("pulse-burst");
      setTimeout(() => {
        heartbeatEl.classList.remove("pulse-burst");
      }, 160);
    });
  }

  function updateShellGeometry() {
    const expanded = state.layoutMode === LayoutMode.EXPANDED;
    const compactWorking = state.layoutMode === LayoutMode.COMPACT_WORKING;

    let width = Layout.notchWidth;
    if (expanded) {
      width = Layout.panelWidth;
    } else if (compactWorking) {
      const sideLane = Math.max(32, Layout.notchHeight);
      width = Layout.notchWidth + sideLane * 2;
    }

    const height = expanded ? Layout.expandedHeight : Layout.notchHeight;
    const topRadius = expanded ? Layout.expandedTopRadius : Layout.compactTopRadius;
    const bottomRadius = expanded
      ? Layout.expandedBottomRadius
      : Layout.compactBottomRadius;

    shellEl.style.setProperty("--shell-width", `${width}px`);
    shellEl.style.setProperty("--shell-height", `${height}px`);
    shellEl.style.setProperty("--top-radius", `${topRadius}px`);
    shellEl.style.setProperty("--bottom-radius", `${bottomRadius}px`);
  }

  function updateLayoutClassnames() {
    const expanded = state.layoutMode === LayoutMode.EXPANDED;
    const compactWorking = state.layoutMode === LayoutMode.COMPACT_WORKING;
    shellEl.classList.toggle("mode-expanded", expanded);
    shellEl.classList.toggle("mode-compact", !expanded);
    shellEl.classList.toggle("compact-working", compactWorking);

    compactIconLaneEl.style.opacity = compactWorking ? "1" : "0";
    compactPulseLaneEl.style.opacity = compactWorking ? "1" : "0";
    compactIconLaneEl.style.transform = compactWorking ? "scale(1)" : "scale(0.9)";
    compactPulseLaneEl.style.transform = compactWorking ? "scale(1)" : "scale(0.9)";

    expandedSceneEl.style.pointerEvents = expanded ? "auto" : "none";
  }

  function handleAppNameAnimation() {
    const expanded = state.layoutMode === LayoutMode.EXPANDED;
    if (expanded) {
      clearTask("appNameRevealTask");
      appNameEl.classList.remove("show");
      state.appNameRevealTask = setTimeout(() => {
        if (state.layoutMode !== LayoutMode.EXPANDED) return;
        appNameEl.classList.add("show");
      }, 200);
      return;
    }

    clearTask("appNameRevealTask");
    appNameEl.classList.remove("show");
  }

  function render() {
    updateShellGeometry();
    updateLayoutClassnames();

    const conversation = state.activeConversation;
    const streamText = streamingPanelText();
    const tools = activeToolCalls();
    const seenImage = activeSeenImage();

    appNameEl.textContent = state.snapshot.appName || "Jarvis";
    streamTextEl.textContent = streamText;
    progressLabelEl.textContent = progressLabel(state.snapshot.progress);
    renderToolGrid(tools);
    renderSeenImageStack(seenImage);

    composerInputEl.placeholder = composerPlaceholder();
    if (document.activeElement !== composerInputEl) {
      composerInputEl.value = state.conversationDraft;
    }
    composerInputEl.disabled = !(conversation ? conversation.canSend !== false : true);

    const heartbeatVisible =
      state.layoutMode === LayoutMode.EXPANDED ||
      state.layoutMode === LayoutMode.COMPACT_WORKING;
    const active =
      state.snapshot.phase === Phase.WORKING || state.snapshot.phase === Phase.WAITING;

    heartbeatEl.style.opacity = heartbeatVisible ? "1" : "0";
    triggerHeartbeatPulse(active);

    if (state.previousLayoutMode !== state.layoutMode) {
      handleAppNameAnimation();
    }
    state.previousLayoutMode = state.layoutMode;
  }

  function appendTurn(role, text) {
    state.demo.conversationTurns.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      role,
      text,
    });
  }

  function seedConversationIfNeeded() {
    if (state.demo.conversationTurns.length) return;
    state.demo.conversationTurns = [
      {
        id: `${Date.now()}-seed`,
        role: "assistant",
        text: "我在这儿，执行中你可以随时发指令。",
      },
    ];
  }

  function streamingReplyFor(step) {
    if (step <= 1) {
      return "我先把当前窗口的标题、输入区和右上角状态都扫了一遍，准备继续收束布局。";
    }
    if (step === 2) {
      return "我正在把第 2 步拆开处理，优先稳定内容区，再决定工具调用结果怎么映射到灵动岛里。";
    }
    if (step === 3) {
      return "我已经定位到关键状态切换点，接下来会整理展开态里的 LLM 回复、工具调用和上一轮图像。";
    }
    if (step === 4) {
      return "这一轮基本收尾了，我在做最后的视觉校准，确保展开和收回不打架。";
    }
    return "收尾校验完成，准备把结果沉到待命态。";
  }

  function toolCallsFor(step) {
    if (step <= 1) {
      return [
        { id: "tool-screenshot", name: "capture_window", status: "done" },
        { id: "tool-ocr", name: "read_labels", status: "running" },
      ];
    }
    if (step === 2) {
      return [
        { id: "tool-screenshot", name: "capture_window", status: "done" },
        { id: "tool-layout", name: "measure_layout", status: "done" },
        { id: "tool-patch", name: "patch_swiftui", status: "running" },
      ];
    }
    if (step === 3) {
      return [
        { id: "tool-layout", name: "measure_layout", status: "done" },
        { id: "tool-preview", name: "render_preview", status: "running" },
        { id: "tool-compare", name: "compare_motion", status: "queued" },
      ];
    }
    if (step === 4) {
      return [
        { id: "tool-preview", name: "render_preview", status: "done" },
        { id: "tool-polish", name: "polish_spacing", status: "running" },
      ];
    }
    return [{ id: "tool-idle", name: "idle_sync", status: "done" }];
  }

  function lastSeenImageFor(step) {
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

  function playfulPlaceholderFor(step) {
    if (step <= 2) {
      return "扔个新要求过来，或者让我换个更野一点的做法…";
    }
    if (step <= 4) {
      return "想临时加戏的话，现在喊我还来得及…";
    }
    return "给我一个新任务，最好稍微离谱一点。";
  }

  function publishWorking(step, expanded) {
    seedConversationIfNeeded();
    const conversation = {
      id: state.demo.conversationID,
      title: "Jarvis 对话",
      turns: state.demo.conversationTurns.slice(-6),
      inputPlaceholder: playfulPlaceholderFor(step),
      canSend: true,
      streamingReply: streamingReplyFor(step),
      toolCalls: toolCallsFor(step),
      lastSeenImage: lastSeenImageFor(step),
    };

    receiveSnapshot({
      phase: Phase.WORKING,
      title: "正在执行 Demo 工作流",
      detail: `第 ${step} / ${state.demo.maxSteps} 步：处理中…`,
      appName: "Jarvis Demo",
      progress: { current: step, maximum: state.demo.maxSteps },
      expanded,
      conversation,
    });
  }

  function publishIdle(detail, expanded) {
    receiveSnapshot({
      phase: Phase.IDLE,
      title: "Jarvis 已就位",
      detail,
      appName: "Jarvis zzz",
      progress: { current: 0, maximum: null },
      expanded,
      conversation: null,
    });
  }

  function stopDemoFlow() {
    if (state.demo.stepTimer) {
      clearInterval(state.demo.stepTimer);
      state.demo.stepTimer = null;
    }
    state.demo.isWorking = false;
    state.demo.currentStep = 0;
  }

  function advanceDemoStep() {
    if (!state.demo.isWorking) return;

    state.demo.currentStep += 1;
    const bounded = Math.min(state.demo.currentStep, state.demo.maxSteps);

    if (bounded === 2) {
      appendTurn("assistant", "我正在执行第 2 步，若要改策略可以直接在输入框发我。");
    } else if (bounded === 4) {
      appendTurn("assistant", "已接近完成，当前在收尾校验。");
    }

    publishWorking(bounded, state.hovering);

    if (state.demo.currentStep < state.demo.maxSteps) return;

    stopDemoFlow();
    setTimeout(() => {
      publishIdle("5 步工作已完成，等待下一条任务。", state.hovering);
    }, 350);
  }

  function startDemoFlow() {
    if (state.demo.externalDriven) return;
    state.demo.isWorking = true;
    state.demo.currentStep = 0;
    if (state.demo.stepTimer) {
      clearInterval(state.demo.stepTimer);
    }
    state.demo.stepTimer = setInterval(advanceDemoStep, state.demo.stepInterval);
    advanceDemoStep();
  }

  function onDemoHoverChanged(hovering) {
    if (state.demo.externalDriven) return;
    if (hovering) {
      if (!state.demo.isWorking) {
        startDemoFlow();
      } else {
        publishWorking(Math.max(state.demo.currentStep, 1), true);
      }
      return;
    }

    if (!state.demo.isWorking) return;
    publishWorking(Math.max(state.demo.currentStep, 1), false);
  }

  function submitConversationMessage() {
    const conversation = state.activeConversation;
    if (!conversation) return;
    const text = state.conversationDraft.trim();
    if (!text || conversation.canSend === false) return;

    appendTurn("user", text);
    appendTurn("assistant", "收到，我会按你的输入继续推进当前步骤。");
    state.conversationDraft = "";
    if (window.islandHost && window.islandHost.sendConversationEvent) {
      window.islandHost.sendConversationEvent({
        type: "send",
        text,
        conversationID: conversation.id,
      });
    }
    publishWorking(Math.max(state.demo.currentStep, 1), true);
  }

  function normalizeIncomingSnapshot(payload) {
    if (!payload || typeof payload !== "object") return idleSnapshot();
    return {
      phase: payload.phase || Phase.IDLE,
      title: payload.title || "Jarvis 已就位",
      detail: payload.detail || "",
      appName: payload.appName || "Jarvis",
      progress: payload.progress || { current: 0, maximum: null },
      expanded: !!payload.expanded,
      conversation: payload.conversation || null,
    };
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function hookBridge() {
    if (!window.islandHost) return;
    if (window.islandHost.onSnapshot) {
      window.islandHost.onSnapshot((payload) => {
        state.demo.externalDriven = true;
        stopDemoFlow();
        receiveSnapshot(normalizeIncomingSnapshot(payload));
      });
    }
    if (window.islandHost.onBridgeError) {
      window.islandHost.onBridgeError((line) => {
        console.warn("[island bridge] invalid line:", line);
      });
    }
  }

  function init() {
    panelEl.style.setProperty("--panel-width", `${Layout.panelWidth}px`);
    panelEl.style.setProperty("--panel-height", `${Layout.panelHeight}px`);
    hookBridge();
    render();

    seedConversationIfNeeded();
    publishWorking(2, true);
  }

  init();
})();
