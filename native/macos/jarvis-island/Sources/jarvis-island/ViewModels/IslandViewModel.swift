import AppKit
import Foundation
import SwiftUI

enum IslandConversationEvent {
    case send(text: String, conversationID: String)
    case dismiss(conversationID: String)
}

@MainActor
final class IslandViewModel: ObservableObject {
    @Published var snapshot: IslandSnapshot = .idle
    @Published var isExpanded = false
    @Published var workingCompact = false
    @Published var pulse = 0
    @Published var closedNotchSize = CGSize(width: 185, height: 32)
    @Published var frontmostAppName = NSWorkspace.shared.frontmostApplication?.localizedName ?? "Jarvis"
    @Published var activeConversation: IslandConversationPayload?
    @Published var conversationDraft = ""

    let panelSize = CGSize(width: 640, height: 252)

    var onConversationEvent: ((IslandConversationEvent) -> Void)?

    private var hovering = false
    private var lastHoverActivationAt = Date.distantPast
    private var pendingHoverOpenTask: DispatchWorkItem?
    private var pendingCloseTask: DispatchWorkItem?
    private var pendingBusyToIdleSettleTask: DispatchWorkItem?
    private let hoverRetentionWindow: TimeInterval = 0.28

    private enum IslandLayoutMode {
        case compact
        case compactWorking
        case expanded
    }

    private var effectivelyHovering: Bool {
        hovering || Date().timeIntervalSince(lastHoverActivationAt) < hoverRetentionWindow
    }

    func refreshScreenMetrics(screen: NSScreen?) {
        guard let screen else { return }
        closedNotchSize = CGSize(
            width: resolveNotchWidth(from: screen),
            height: resolveNotchHeight(from: screen)
        )
    }

    func refreshFrontmostApp() {
        frontmostAppName = NSWorkspace.shared.frontmostApplication?.localizedName ?? snapshot.appName
    }

    var islandWidth: CGFloat {
        switch currentLayoutMode {
        case .expanded:
            return 640
        case .compact:
            return closedNotchSize.width
        case .compactWorking:
            let sideLane = max(32, closedNotchSize.height)
            return closedNotchSize.width + sideLane * 2
        }
    }

    func receive(_ nextSnapshot: IslandSnapshot) {
        let previousPhase = snapshot.phase
        snapshot = nextSnapshot
        pulse += 1
        syncConversation(with: nextSnapshot)

        cancelTransientTasks()

        let busyToIdle = shouldUseBusyToIdleMotion(previous: previousPhase, next: nextSnapshot.phase)
        if busyToIdle, !hovering {
            apply(layout: .compact, animated: true)
            return
        }

        let targetLayout = targetLayoutMode(for: nextSnapshot)
        if busyToIdle {
            applyBusyToIdleMotion(target: targetLayout)
            return
        }

        apply(layout: targetLayout, animated: false)
    }

    func handleHover(_ isHovering: Bool) {
        hovering = isHovering
        if isHovering {
            lastHoverActivationAt = Date()
        }
        pendingBusyToIdleSettleTask?.cancel()

        if isHovering {
            pendingCloseTask?.cancel()

            if workingCompact {
                apply(layout: .expanded, animated: false)
                return
            }

            guard !isExpanded else { return }
            scheduleHoverExpansion()
            return
        }

        pendingHoverOpenTask?.cancel()
        scheduleHoverCollapse()
    }

    func collapseToIsland() {
        handleHover(false)
    }

    func submitConversationMessage() {
        guard var conversation = activeConversation else { return }

        let text = conversationDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, conversation.canSend else { return }

        let newTurn = IslandChatTurn(
            id: UUID().uuidString,
            role: .user,
            text: text
        )
        conversation.turns.append(newTurn)
        activeConversation = conversation
        conversationDraft = ""
        onConversationEvent?(.send(text: text, conversationID: conversation.id))
    }

    func dismissConversation() {
        guard let conversation = activeConversation else { return }
        activeConversation = nil
        onConversationEvent?(.dismiss(conversationID: conversation.id))
    }

    private var currentLayoutMode: IslandLayoutMode {
        if isExpanded { return .expanded }
        if workingCompact { return .compactWorking }
        return .compact
    }

    private func targetLayoutMode(for snapshot: IslandSnapshot) -> IslandLayoutMode {
        switch snapshot.phase {
        case .working, .waiting:
            if effectivelyHovering || snapshot.expanded {
                return .expanded
            }
            return .compactWorking
        case .approval, .result, .error, .listening:
            return .expanded
        case .idle:
            if effectivelyHovering || snapshot.expanded {
                return .expanded
            }
            return .compact
        }
    }

    private func shouldUseBusyToIdleMotion(previous: IslandPhase, next: IslandPhase) -> Bool {
        let wasBusy = (previous == .working || previous == .waiting)
        return wasBusy && next == .idle
    }

    private func applyBusyToIdleMotion(target: IslandLayoutMode) {
        guard target == .compact else {
            apply(layout: target, animated: true)
            return
        }

        // Outside hover: collapse to idle in one pass (no staged shell transition).
        guard hovering else {
            apply(layout: .compact, animated: true)
            return
        }

        if currentLayoutMode == .compactWorking {
            withAnimation(.spring(response: 0.50, dampingFraction: 0.82, blendDuration: 0.06)) {
                applyLayoutWithoutAnimation(.compact)
            }
            return
        }

        withAnimation(.spring(response: 0.34, dampingFraction: 0.88, blendDuration: 0.04)) {
            applyLayoutWithoutAnimation(.compactWorking)
        }

        let settleTask = DispatchWorkItem { [weak self] in
            guard let self, !self.effectivelyHovering else { return }
            withAnimation(.spring(response: 0.62, dampingFraction: 0.82, blendDuration: 0.08)) {
                self.applyLayoutWithoutAnimation(.compact)
            }
        }
        pendingBusyToIdleSettleTask = settleTask
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12, execute: settleTask)
    }

    private func apply(layout: IslandLayoutMode, animated: Bool) {
        if animated {
            withAnimation(.spring(response: 0.52, dampingFraction: 0.84, blendDuration: 0.06)) {
                applyLayoutWithoutAnimation(layout)
            }
        } else {
            applyLayoutWithoutAnimation(layout)
        }
    }

    private func applyLayoutWithoutAnimation(_ layout: IslandLayoutMode) {
        switch layout {
        case .expanded:
            isExpanded = true
            workingCompact = false
        case .compactWorking:
            isExpanded = false
            workingCompact = true
        case .compact:
            isExpanded = false
            workingCompact = false
        }
    }

    private func syncConversation(with snapshot: IslandSnapshot) {
        guard let incoming = snapshot.conversation else {
            activeConversation = nil
            conversationDraft = ""
            return
        }

        if activeConversation?.id != incoming.id {
            conversationDraft = ""
        }
        activeConversation = incoming
    }

    private func scheduleHoverExpansion() {
        let task = DispatchWorkItem { [weak self] in
            guard let self, self.effectivelyHovering, !self.workingCompact else { return }
            self.apply(layout: .expanded, animated: false)
        }
        pendingHoverOpenTask?.cancel()
        pendingHoverOpenTask = task
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.16, execute: task)
    }

    private func scheduleHoverCollapse() {
        let task = DispatchWorkItem { [weak self] in
            guard let self, !self.effectivelyHovering else { return }

            let target: IslandLayoutMode
            switch self.snapshot.phase {
            case .working, .waiting:
                target = .compactWorking
            default:
                target = .compact
            }
            self.apply(layout: target, animated: false)
        }
        pendingCloseTask?.cancel()
        pendingCloseTask = task
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.18, execute: task)
    }

    private func cancelTransientTasks() {
        pendingHoverOpenTask?.cancel()
        pendingCloseTask?.cancel()
        pendingBusyToIdleSettleTask?.cancel()
    }

    private func resolveNotchWidth(from screen: NSScreen) -> CGFloat {
        guard
            let leftInset = screen.auxiliaryTopLeftArea?.width,
            let rightInset = screen.auxiliaryTopRightArea?.width
        else {
            return 185
        }
        return screen.frame.width - leftInset - rightInset + 4
    }

    private func resolveNotchHeight(from screen: NSScreen) -> CGFloat {
        if screen.safeAreaInsets.top > 0 {
            return max(30, screen.safeAreaInsets.top)
        }
        return max(30, screen.frame.maxY - screen.visibleFrame.maxY)
    }
}
