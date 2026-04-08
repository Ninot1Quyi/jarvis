import Foundation

final class DemoStatusProvider: IslandStatusProviding {
    var onUpdate: ((IslandSnapshot) -> Void)?

    private var stepTimer: DispatchSourceTimer?
    private var isHovering = false
    private var isWorking = false
    private var currentStep = 0

    private let maxSteps = 5
    private let stepInterval: TimeInterval = 1.1
    private let conversationID = "demo-llm-conversation"
    private var conversationTurns: [IslandChatTurn] = []

    func start() {
        seedConversationIfNeeded()
        publishWorking(step: 3, expanded: true)
    }

    func stop() {
        stepTimer?.cancel()
        stepTimer = nil
        isWorking = false
        currentStep = 0
        conversationTurns = []
    }

    func handleHoverChanged(_ hovering: Bool) {
        isHovering = hovering

        if hovering {
            if !isWorking {
                startWorkingFlow()
                return
            }
            publishWorking(step: max(currentStep, 1), expanded: true)
            return
        }

        guard isWorking else { return }
        publishWorking(step: max(currentStep, 1), expanded: false)
    }

    func handleConversationEvent(_ event: IslandConversationEvent) {
        switch event {
        case let .send(text, conversationID):
            guard conversationID == self.conversationID else { return }
            appendTurn(role: .user, text: text)
            appendTurn(role: .assistant, text: "收到，我会按你的输入继续推进当前步骤。")
            publishWorking(step: max(currentStep, 1), expanded: true)
        case let .dismiss(conversationID):
            guard conversationID == self.conversationID else { return }
            appendTurn(role: .system, text: "你已关闭本次对话输入。")
            publishWorking(step: max(currentStep, 1), expanded: isHovering)
        }
    }

    private func startWorkingFlow() {
        isWorking = true
        currentStep = 0

        stepTimer?.cancel()
        stepTimer = DispatchSource.makeTimerSource(queue: .main)
        stepTimer?.schedule(deadline: .now(), repeating: stepInterval)
        stepTimer?.setEventHandler { [weak self] in
            self?.advanceStep()
        }
        stepTimer?.resume()
    }

    private func advanceStep() {
        guard isWorking else { return }

        currentStep += 1
        let boundedStep = min(currentStep, maxSteps)

        if boundedStep == 2 {
            appendTurn(role: .assistant, text: "我正在执行第 2 步，若要改策略可以直接在输入框发我。")
        } else if boundedStep == 4 {
            appendTurn(role: .assistant, text: "已接近完成，当前在收尾校验。")
        }

        publishWorking(step: boundedStep, expanded: isHovering)

        guard currentStep >= maxSteps else { return }

        isWorking = false
        stepTimer?.cancel()
        stepTimer = nil
        currentStep = 0

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
            self?.publishIdle(
                detail: "5 步工作已完成，等待下一条任务。",
                expanded: self?.isHovering ?? false
            )
        }
    }

    private func publishWorking(step: Int, expanded: Bool) {
        seedConversationIfNeeded()

        let conversation = IslandConversationPayload(
            id: conversationID,
            title: "Jarvis 对话",
            turns: Array(conversationTurns.suffix(6)),
            inputPlaceholder: playfulPlaceholder(for: step),
            canSend: true,
            streamingReply: streamingReply(for: step),
            toolCalls: toolCalls(for: step),
            lastSeenImage: lastSeenImage(for: step)
        )

        onUpdate?(
            IslandSnapshot(
                phase: .working,
                title: "正在执行 Demo 工作流",
                detail: "第 \(step) / \(maxSteps) 步：处理中…",
                appName: "Jarvis Demo",
                progress: .init(current: step, maximum: maxSteps),
                expanded: expanded,
                conversation: conversation
            )
        )
    }

    private func publishIdle(detail: String, expanded: Bool) {
        onUpdate?(
            IslandSnapshot(
                phase: .idle,
                title: "Jarvis 已就位",
                detail: detail,
                appName: "Finder",
                progress: .init(current: 0, maximum: nil),
                expanded: expanded,
                conversation: nil
            )
        )
    }

    private func seedConversationIfNeeded() {
        guard conversationTurns.isEmpty else { return }
        conversationTurns = [
            IslandChatTurn(
                id: UUID().uuidString,
                role: .assistant,
                text: "我在这儿，执行中你可以随时发指令。"
            ),
        ]
    }

    private func appendTurn(role: IslandChatRole, text: String) {
        conversationTurns.append(
            IslandChatTurn(id: UUID().uuidString, role: role, text: text)
        )
    }

    private func streamingReply(for step: Int) -> String {
        switch step {
        case 0...1:
            return "我先把当前窗口的标题、输入区和右上角状态都扫了一遍，准备继续往下收束布局。"
        case 2:
            return "我正在把第 2 步拆开处理，优先稳定内容区，再决定工具调用结果怎么映射到灵动岛里。"
        case 3:
            return "我已经定位到关键状态切换点，接下来会整理完全展开态里的 LLM 回复、工具调用和上一轮图像摘要。"
        case 4:
            return "这一轮基本收尾了，我在做最后的视觉校准，确保收回和展开不会互相打架。"
        default:
            return "收尾校验完成，准备把结果沉到待命态。"
        }
    }

    private func toolCalls(for step: Int) -> [IslandToolCallPayload] {
        switch step {
        case 0...1:
            return [
                .init(id: "tool-screenshot", name: "capture_window", status: "done", symbol: "camera.viewfinder"),
                .init(id: "tool-ocr", name: "read_labels", status: "running", symbol: "text.viewfinder"),
            ]
        case 2:
            return [
                .init(id: "tool-screenshot", name: "capture_window", status: "done", symbol: "camera.viewfinder"),
                .init(id: "tool-layout", name: "measure_layout", status: "done", symbol: "ruler"),
                .init(id: "tool-patch", name: "patch_swiftui", status: "running", symbol: "hammer"),
            ]
        case 3:
            return [
                .init(id: "tool-layout", name: "measure_layout", status: "done", symbol: "ruler"),
                .init(id: "tool-preview", name: "render_preview", status: "running", symbol: "play.rectangle"),
                .init(id: "tool-compare", name: "compare_motion", status: "queued", symbol: "arrow.left.arrow.right"),
            ]
        case 4:
            return [
                .init(id: "tool-preview", name: "render_preview", status: "done", symbol: "play.rectangle"),
                .init(id: "tool-polish", name: "polish_spacing", status: "running", symbol: "wand.and.stars"),
            ]
        default:
            return [
                .init(id: "tool-idle", name: "idle_sync", status: "done", symbol: "moon.zzz"),
            ]
        }
    }

    private func lastSeenImage(for step: Int) -> IslandSeenImagePayload {
        switch step {
        case 0...1:
            return .init(
                title: "终端窗口截图",
                subtitle: "上一轮视觉输入，重点看标题栏和底边对齐。",
                symbol: "photo.on.rectangle.angled"
            )
        case 2:
            return .init(
                title: "灵动岛展开态",
                subtitle: "上一轮看到右上角心跳和输入区的排布。",
                symbol: "rectangle.stack"
            )
        case 3:
            return .init(
                title: "对话区裁切预览",
                subtitle: "正在比对文本、工具调用和图像摘要的层级。",
                symbol: "text.below.photo"
            )
        case 4:
            return .init(
                title: "收尾帧",
                subtitle: "最后一轮检查展开到工作态的内容收束。",
                symbol: "sparkles.rectangle.stack"
            )
        default:
            return .init(
                title: "上一轮看到的图",
                subtitle: "任务完成，画面已缓存，Jarvis 准备休眠。",
                symbol: "moon.stars"
            )
        }
    }

    private func playfulPlaceholder(for step: Int) -> String {
        switch step {
        case 0...2:
            return "扔个新要求过来，或者让我换个更野一点的做法…"
        case 3...4:
            return "想临时加戏的话，现在喊我还来得及…"
        default:
            return "给我一个新任务，最好稍微离谱一点。"
        }
    }
}
