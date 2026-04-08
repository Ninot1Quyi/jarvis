import AppKit
import Combine
import SwiftUI

@MainActor
final class IslandWindowController {
    let model = IslandViewModel()
    private let panel: IslandPanel
    private let provider: IslandStatusProviding
    private let companionController: CompanionAppControlling
    private var cancellables = Set<AnyCancellable>()

    init(provider: IslandStatusProviding, companionController: CompanionAppControlling) {
        self.provider = provider
        self.companionController = companionController
        model.refreshScreenMetrics(screen: NSScreen.main ?? NSScreen.screens.first)
        model.refreshFrontmostApp()
        self.panel = IslandPanel(frame: NSRect(origin: .zero, size: model.panelSize))

        let rootView = IslandRootView(
            model: model,
            openCompanion: { [weak companionController] in
                companionController?.showCompanionApp()
            },
            onHoverChanged: { [weak provider] hovering in
                provider?.handleHoverChanged(hovering)
            }
        )
        panel.contentView = NSHostingView(rootView: rootView)
        panel.orderFrontRegardless()
        relocate()

        provider.onUpdate = { [weak self] snapshot in
            self?.model.receive(snapshot)
        }
        model.onConversationEvent = { [weak provider] event in
            provider?.handleConversationEvent(event)
        }
        provider.start()

        model.$closedNotchSize
            .sink { [weak self] _ in
                self?.relocate()
            }
            .store(in: &cancellables)

        NSWorkspace.shared.notificationCenter.addObserver(
            self,
            selector: #selector(repositionOnAppSwitch),
            name: NSWorkspace.activeSpaceDidChangeNotification,
            object: nil
        )
        NSWorkspace.shared.notificationCenter.addObserver(
            self,
            selector: #selector(repositionOnAppSwitch),
            name: NSWorkspace.didActivateApplicationNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(repositionOnAppSwitch),
            name: NSApplication.didChangeScreenParametersNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(repositionOnResize),
            name: NSWindow.didResizeNotification,
            object: panel
        )
    }

    @objc private func repositionOnAppSwitch() {
        model.refreshFrontmostApp()
        model.refreshScreenMetrics(screen: NSScreen.main ?? NSScreen.screens.first)
        relocate()
    }

    @objc private func repositionOnResize() {
        relocate()
    }

    private func relocate() {
        guard let screen = NSScreen.main ?? NSScreen.screens.first else { return }
        let scale = max(screen.backingScaleFactor, 1)
        let xRaw = screen.frame.origin.x + (screen.frame.width / 2) - model.panelSize.width / 2
        let yRaw = screen.frame.origin.y + screen.frame.height - model.panelSize.height
        let origin = NSPoint(
            x: (xRaw * scale).rounded() / scale,
            y: (yRaw * scale).rounded() / scale
        )
        panel.setFrame(NSRect(origin: origin, size: model.panelSize), display: true, animate: false)
        panel.orderFrontRegardless()
    }
}
