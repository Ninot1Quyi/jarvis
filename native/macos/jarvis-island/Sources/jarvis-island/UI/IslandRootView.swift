import AppKit
import SwiftUI

struct IslandRootView: View {
    @ObservedObject var model: IslandViewModel
    let openCompanion: () -> Void
    let onHoverChanged: (Bool) -> Void

    @Namespace private var islandMotion

    @State private var hovering = false
    @State private var compactScaleY: CGFloat = 1
    @State private var compactBounceTask: DispatchWorkItem?
    @State private var appNameProgress: CGFloat = 0
    @State private var appNameRevealTask: DispatchWorkItem?

    private enum Layout {
        static let panelWidth: CGFloat = 640
        static let expandedHeight: CGFloat = 200

        static let compactOuterInset: CGFloat = 14
        static let compactOcclusionGuard: CGFloat = 6
        static let expandedOuterInset: CGFloat = 12
        static let expandedInnerInset: CGFloat = 12

        static let compactTopRadius: CGFloat = 6
        static let compactBottomRadius: CGFloat = 14
        static let expandedTopRadius: CGFloat = 19
        static let expandedBottomRadius: CGFloat = 24

        static let expandedSectionGap: CGFloat = 8
    }

    private let expandSpring = Animation.spring(response: 0.44, dampingFraction: 0.82, blendDuration: 0.04)
    private let collapseSpring = Animation.spring(response: 0.62, dampingFraction: 0.84, blendDuration: 0.08)
    private let compactFlowSpring = Animation.spring(response: 0.42, dampingFraction: 0.84, blendDuration: 0.06)
    private let appNameShowSpring = Animation.interactiveSpring(response: 0.26, dampingFraction: 0.9, blendDuration: 0)
    private let appNameHideSpring = Animation.interactiveSpring(response: 0.38, dampingFraction: 0.84, blendDuration: 0.06)

    private var isExpandedScene: Bool {
        model.isExpanded
    }

    private var shellShape: IslandSilhouetteShape {
        IslandSilhouetteShape(
            topCornerRadius: isExpandedScene ? Layout.expandedTopRadius : Layout.compactTopRadius,
            bottomCornerRadius: isExpandedScene ? Layout.expandedBottomRadius : Layout.compactBottomRadius
        )
    }

    private var compactHeight: CGFloat {
        max(model.closedNotchSize.height, 32)
    }

    private var notchCoreWidth: CGFloat {
        model.closedNotchSize.width
    }

    private var compactShellWidth: CGFloat {
        model.workingCompact ? model.islandWidth : notchCoreWidth
    }

    private var compactOcclusionWidth: CGFloat {
        notchCoreWidth + Layout.compactOcclusionGuard * 2
    }

    private var compactContentLaneWidth: CGFloat {
        guard model.workingCompact else { return 0 }
        let freeWidth = compactShellWidth - compactOcclusionWidth
        return max(0, freeWidth / 2)
    }

    private var compactIconSize: CGFloat {
        let base = max(16, compactHeight - 12)
        guard model.workingCompact else { return base }
        return max(14, min(base, compactContentLaneWidth - 2))
    }

    private var compactHeartbeatWidth: CGFloat {
        guard model.workingCompact else { return 32 }
        return max(18, min(24, compactContentLaneWidth - 2))
    }

    private var expandedContentWidth: CGFloat {
        max(420, Layout.panelWidth - 2 * (Layout.expandedTopRadius + Layout.expandedInnerInset))
    }

    private var heartbeatWidth: CGFloat {
        isExpandedScene ? 64 : compactHeartbeatWidth
    }

    private var heartbeatHeight: CGFloat {
        isExpandedScene ? 18 : 14
    }

    private var heartbeatCenterX: CGFloat {
        if isExpandedScene {
            return expandedContentWidth - Layout.expandedInnerInset - 8 - heartbeatWidth / 2
        }
        return compactShellWidth - 2 - heartbeatWidth / 2
    }

    private var heartbeatCenterY: CGFloat {
        if isExpandedScene {
            return max(28, compactHeight + 2) / 2
        }
        return compactHeight / 2
    }

    private var heartbeatVisible: Bool {
        model.isExpanded || model.workingCompact
    }

    private var shadowColor: Color {
        (isExpandedScene || hovering) ? .black.opacity(0.7) : .clear
    }

    private var shadowRadius: CGFloat {
        isExpandedScene ? 6 : 4
    }

    var body: some View {
        ZStack(alignment: .top) {
            VStack(spacing: 0) {
                shellView

                if !isExpandedScene {
                    Rectangle()
                        .fill(.clear)
                        .frame(
                            width: notchCoreWidth,
                            height: max(0, model.panelSize.height - compactHeight - 8)
                        )
                }
            }
        }
        .padding(.bottom, 8)
        .frame(maxWidth: model.panelSize.width, maxHeight: model.panelSize.height, alignment: .top)
        .compositingGroup()
        .background(Color.clear)
    }

    private var shellView: some View {
        shellSceneView
            .frame(alignment: .top)
            .padding(
                .horizontal,
                isExpandedScene ? Layout.expandedTopRadius : Layout.compactOuterInset
            )
            .padding([.horizontal, .bottom], isExpandedScene ? Layout.expandedOuterInset : 0)
            .frame(height: isExpandedScene ? Layout.expandedHeight : compactHeight, alignment: .top)
            .background(.black)
            .clipShape(shellShape, style: FillStyle(antialiased: true))
            .shadow(color: shadowColor, radius: shadowRadius)
            .animation(isExpandedScene ? expandSpring : collapseSpring, value: isExpandedScene)
            .animation(.smooth, value: hovering)
            .animation(compactFlowSpring, value: model.workingCompact)
            .contentShape(Rectangle())
            .onHover { isHovering in
                hovering = isHovering
                model.handleHover(isHovering)
                onHoverChanged(isHovering)
            }
            .onTapGesture {
                openCompanion()
            }
            .onChange(of: model.workingCompact) { working in
                compactBounceTask?.cancel()
                guard working else {
                    compactScaleY = 1
                    return
                }

                compactScaleY = 1
                withAnimation(.spring(response: 0.14, dampingFraction: 0.72)) {
                    compactScaleY = 1.015
                }

                let settleTask = DispatchWorkItem {
                    withAnimation(.easeOut(duration: 0.14)) {
                        compactScaleY = 1
                    }
                }
                compactBounceTask = settleTask
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.09, execute: settleTask)
            }
            .onChange(of: model.isExpanded) { expanded in
                appNameRevealTask?.cancel()

                if expanded {
                    let revealAction = {
                        withAnimation(appNameShowSpring) {
                            appNameProgress = 1
                        }
                    }

                    if appNameProgress > 0.02 {
                        revealAction()
                    } else {
                        let task = DispatchWorkItem {
                            guard model.isExpanded else { return }
                            revealAction()
                        }
                        appNameRevealTask = task
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2, execute: task)
                    }
                } else {
                    withAnimation(appNameHideSpring) {
                        appNameProgress = 0
                    }
                }
            }
            .onAppear {
                appNameProgress = model.isExpanded ? 1 : 0
            }
    }

    @ViewBuilder
    private var shellSceneView: some View {
        VStack(alignment: .leading, spacing: isExpandedScene ? Layout.expandedSectionGap : 0) {
            if isExpandedScene {
                expandedHeader
                    .zIndex(1)
                if model.isExpanded {
                    expandedBody
                        .transition(.opacity)
                }
            } else {
                compactHeader
            }
        }
        .frame(width: isExpandedScene ? expandedContentWidth : compactShellWidth, alignment: .top)
        .overlay(alignment: .topLeading) {
            heartbeatOverlay
        }
    }

    private var heartbeatOverlay: some View {
        IslandHeartbeatView(
            pulse: model.pulse,
            compact: !isExpandedScene,
            compactWidth: isExpandedScene ? nil : compactHeartbeatWidth,
            active: model.snapshot.phase == .working || model.snapshot.phase == .waiting
        )
        .position(x: heartbeatCenterX, y: heartbeatCenterY)
        .opacity(heartbeatVisible ? 1 : 0)
        .animation(isExpandedScene ? expandSpring : collapseSpring, value: isExpandedScene)
        .animation(compactFlowSpring, value: model.workingCompact)
        .animation(.easeOut(duration: 0.12), value: heartbeatVisible)
        .allowsHitTesting(false)
    }

    private var compactHeader: some View {
        HStack(spacing: 0) {
            compactLeadingAccessory

            ZStack {
                notchCenterCutout
            }
            .frame(width: compactOcclusionWidth, height: compactHeight, alignment: .center)

            compactTrailingAccessory
        }
        .frame(width: compactShellWidth, height: compactHeight, alignment: .center)
        .scaleEffect(x: 1, y: compactScaleY, anchor: .top)
    }

    @ViewBuilder
    private var compactLeadingAccessory: some View {
        if model.workingCompact {
            HStack(spacing: 0) {
                appBadge(size: compactIconSize, cornerRadius: 7)
                    .matchedGeometryEffect(id: "island.appIcon", in: islandMotion)
            }
            .frame(width: compactContentLaneWidth, alignment: .leading)
            .offset(x: -2, y: -2)
            .opacity(1)
            .scaleEffect(1, anchor: .leading)
        } else {
            Color.clear
                .frame(width: compactContentLaneWidth, height: compactHeight)
        }
    }

    @ViewBuilder
    private var compactTrailingAccessory: some View {
        if model.workingCompact {
            Color.clear
                .frame(width: compactHeartbeatWidth, height: heartbeatHeight)
                .padding(.trailing, 2)
                .frame(width: compactContentLaneWidth, alignment: .trailing)
            .opacity(1)
            .scaleEffect(1, anchor: .trailing)
        } else {
            Color.clear
                .frame(width: compactContentLaneWidth, height: compactHeight)
        }
    }

    private var expandedHeader: some View {
        HStack(spacing: 0) {
            HStack(spacing: 8) {
                appBadge(size: 20, cornerRadius: 6)
                    .matchedGeometryEffect(id: "island.appIcon", in: islandMotion)

                Text(model.frontmostAppName)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .opacity(appNameProgress)
                    .offset(y: (1 - appNameProgress) * -10)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            notchCenterCutout

            Color.clear
                .frame(width: heartbeatWidth, height: heartbeatHeight)
                .padding(.trailing, 8)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(.horizontal, Layout.expandedInnerInset)
        .frame(height: max(28, compactHeight + 2), alignment: .center)
        .frame(width: expandedContentWidth, alignment: .top)
    }

    private var expandedBody: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 14) {
                IslandSeenImageStack(image: activeSeenImage)
                    .frame(width: 124, height: 74, alignment: .leading)

                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .top, spacing: 8) {
                        Text(streamingPanelText)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(.white)
                            .lineLimit(2)
                            .frame(maxWidth: .infinity, alignment: .topLeading)
                            .animation(.spring(response: 0.34, dampingFraction: 0.88, blendDuration: 0.06), value: streamingPanelText)

                        Text(model.snapshot.progress.label)
                            .font(.system(size: 11, weight: .medium, design: .rounded))
                            .foregroundStyle(.white.opacity(0.56))
                            .monospacedDigit()
                            .padding(.top, 2)
                    }

                    IslandToolDigestGrid(calls: activeToolCalls)
                }
                .frame(maxWidth: .infinity, minHeight: 74, alignment: .topLeading)
            }
            .frame(maxWidth: .infinity, minHeight: 74, alignment: .topLeading)

            IslandComposerPanel(
                draft: $model.conversationDraft,
                placeholder: composerPlaceholder,
                canSend: model.activeConversation?.canSend ?? true,
                onSend: model.submitConversationMessage
            )
        }
        .padding(.horizontal, 18)
        .padding(.top, 2)
        .padding(.bottom, 10)
        .frame(width: expandedContentWidth, alignment: .top)
    }

    private var streamingPanelText: String {
        if let text = model.activeConversation?.streamingReply, !text.isEmpty {
            return text
        }
        if let lastAssistant = model.activeConversation?.turns.last(where: { $0.role == .assistant })?.text {
            return lastAssistant
        }
        return model.snapshot.phase == .idle ? "Jarvis zzz" : model.snapshot.title
    }

    private var activeToolCalls: [IslandToolCallPayload] {
        model.activeConversation?.toolCalls ?? []
    }

    private var activeSeenImage: IslandSeenImagePayload? {
        model.activeConversation?.lastSeenImage
    }

    private var composerPlaceholder: String {
        model.activeConversation?.inputPlaceholder ?? "给我一个稍微离谱、但真的能做的需求。"
    }

    private var notchCenterCutout: some View {
        IslandSilhouetteShape(
            topCornerRadius: Layout.compactTopRadius,
            bottomCornerRadius: Layout.compactBottomRadius
        )
            .fill(Color.black)
            .frame(width: notchCoreWidth, height: compactHeight + 1)
            .offset(y: -0.5)
    }

    private func appBadge(size: CGFloat, cornerRadius: CGFloat) -> some View {
        let shell = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)

        return Group {
            if let icon = NSWorkspace.shared.frontmostApplication?.icon {
                Image(nsImage: icon)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } else {
                JarvisFaceView()
            }
        }
        .frame(width: size, height: size)
        .background(shell.fill(.white.opacity(0.03)))
        .clipShape(shell)
        .overlay {
            shell.strokeBorder(.white.opacity(0.14), lineWidth: 0.5)
        }
    }
}

private struct IslandToolDigestGrid: View {
    let calls: [IslandToolCallPayload]

    private let columns = [
        GridItem(.flexible(minimum: 96, maximum: 150), spacing: 8, alignment: .leading),
        GridItem(.flexible(minimum: 96, maximum: 150), spacing: 8, alignment: .leading),
    ]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: 6) {
            ForEach(Array(calls.prefix(4))) { call in
                HStack(alignment: .center, spacing: 6) {
                    Circle()
                        .fill(statusColor(for: call.status))
                        .frame(width: 5, height: 5)

                    Text(compactLabel(for: call))
                        .lineLimit(1)
                }
                .font(.system(size: 10.5, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.78))
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 28, alignment: .topLeading)
        .opacity(calls.isEmpty ? 0 : 1)
    }

    private func compactLabel(for call: IslandToolCallPayload) -> String {
        switch call.status {
        case "running":
            return "\(call.name) 中"
        case "queued":
            return "\(call.name) 待"
        default:
            return call.name
        }
    }

    private func statusColor(for status: String) -> Color {
        switch status {
        case "running":
            return Color(red: 1, green: 0.38, blue: 0.28)
        case "queued":
            return .white.opacity(0.34)
        default:
            return .green.opacity(0.82)
        }
    }
}

private struct IslandSeenImageStack: View {
    let image: IslandSeenImagePayload?

    var body: some View {
        ZStack(alignment: .topLeading) {
            ForEach(0..<3, id: \.self) { layer in
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [
                                Color.white.opacity(0.05 - Double(layer) * 0.01),
                                Color.white.opacity(0.015),
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(.white.opacity(0.05), lineWidth: 1)
                    )
                    .frame(width: 96, height: 58)
                    .offset(x: CGFloat(12 - layer * 5), y: CGFloat(layer * 5))
            }

            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [
                            Color.white.opacity(0.12),
                            Color.white.opacity(0.045),
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(.white.opacity(0.09), lineWidth: 1)
                )
                .frame(width: 96, height: 58)
                .overlay(alignment: .topLeading) {
                    VStack(alignment: .leading, spacing: 0) {
                        RoundedRectangle(cornerRadius: 3, style: .continuous)
                            .fill(.white.opacity(0.16))
                            .frame(width: 32, height: 4)

                        RoundedRectangle(cornerRadius: 3, style: .continuous)
                            .fill(.white.opacity(0.09))
                            .frame(width: 52, height: 4)

                        Spacer(minLength: 0)
                    }
                    .padding(8)
                }
                .overlay(alignment: .bottomLeading) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(image?.title ?? "视觉上下文已缓存")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.92))
                            .lineLimit(1)
                    }
                    .padding(8)
                }
                .overlay(alignment: .topTrailing) {
                    if let image {
                        Image(systemName: image.symbol)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(.white.opacity(0.78))
                            .padding(8)
                    }
                }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

private struct IslandHeartbeatView: View {
    let pulse: Int
    let compact: Bool
    let compactWidth: CGFloat?
    let active: Bool

    @State private var pulseEnergy: CGFloat = 0

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: compact ? 7 : 8, style: .continuous)
                .fill(.white.opacity(compact ? 0.03 : 0.04))

            heartbeatTrace(
                color: Color(red: 1, green: 0.21, blue: 0.26),
                glowOpacity: active ? 0.42 : 0.28
            )
        }
        .frame(width: compact ? (compactWidth ?? 32) : 64, height: compact ? 14 : 18)
        .overlay(
            RoundedRectangle(cornerRadius: compact ? 7 : 8, style: .continuous)
                .stroke(.white.opacity(0.08), lineWidth: 0.8)
        )
        .onAppear {
            pulseEnergy = active ? 0.16 : 0.12
        }
        .onChange(of: active) { isActive in
            withAnimation(.easeOut(duration: 0.18)) {
                pulseEnergy = isActive ? 0.16 : 0.12
            }
        }
        .onChange(of: pulse) { _ in
            guard active else { return }
            withAnimation(.easeOut(duration: 0.09)) {
                pulseEnergy = 1
            }
            withAnimation(.spring(response: 0.42, dampingFraction: 0.74, blendDuration: 0.04).delay(0.06)) {
                pulseEnergy = 0.16
            }
        }
    }

    private func heartbeatTrace(color: Color, glowOpacity: Double) -> some View {
        IslandHeartbeatLine(energy: pulseEnergy)
            .stroke(
                color,
                style: StrokeStyle(
                    lineWidth: compact ? 1.4 : 1.8,
                    lineCap: .round,
                    lineJoin: .round
                )
            )
            .padding(.horizontal, compact ? 3 : 5)
            .shadow(color: color.opacity(glowOpacity), radius: compact ? 2 : 3)
    }
}

private struct IslandHeartbeatLine: Shape {
    var energy: CGFloat

    var animatableData: CGFloat {
        get { energy }
        set { energy = newValue }
    }

    func path(in rect: CGRect) -> Path {
        let baseline = rect.midY
        let normalizedEnergy = min(max(energy, 0), 1)
        let amplitude = rect.height * (0.13 + 0.42 * normalizedEnergy)
        let width = rect.width

        var path = Path()
        path.move(to: CGPoint(x: 0, y: baseline))
        path.addLine(to: CGPoint(x: width * 0.16, y: baseline))
        path.addLine(to: CGPoint(x: width * 0.24, y: baseline - amplitude * 0.42))
        path.addLine(to: CGPoint(x: width * 0.31, y: baseline + amplitude * 0.55))
        path.addLine(to: CGPoint(x: width * 0.40, y: baseline - amplitude))
        path.addLine(to: CGPoint(x: width * 0.49, y: baseline + amplitude * 0.9))
        path.addLine(to: CGPoint(x: width * 0.60, y: baseline - amplitude * 0.35))
        path.addLine(to: CGPoint(x: width * 0.70, y: baseline))
        path.addLine(to: CGPoint(x: width, y: baseline))
        return path
    }
}

private struct IslandComposerPanel: View {
    @Binding var draft: String
    let placeholder: String
    let canSend: Bool
    let onSend: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            TextField(placeholder, text: $draft, axis: .vertical)
                .textFieldStyle(.plain)
                .lineLimit(1...3)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(canSend ? .white : .white.opacity(0.5))
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(.white.opacity(0.07))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .stroke(.white.opacity(0.12), lineWidth: 1)
                        )
                )
                .disabled(!canSend)
                .onSubmit {
                    guard canSend else { return }
                    onSend()
                }

        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
    }
}
