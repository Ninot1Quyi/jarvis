import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var controller: IslandWindowController?
    private var statusItem: NSStatusItem?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        let provider: IslandStatusProviding
        if let socketPath = resolveSocketPath() {
            provider = SocketStatusProvider(socketPath: socketPath)
        } else if CommandLine.arguments.contains("--stdin") {
            provider = StdinStatusProvider()
        } else {
            provider = DemoStatusProvider()
        }
        controller = IslandWindowController(
            provider: provider,
            companionController: MacCompanionAppController()
        )
        setupStatusItem()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    private func setupStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = item.button {
            let image = NSImage(systemSymbolName: "capsule.portrait.fill", accessibilityDescription: "Jarvis Island")
            image?.isTemplate = true
            button.image = image
            button.toolTip = "Jarvis Island"
        }

        let menu = NSMenu()
        menu.addItem(
            withTitle: "打开完整应用",
            action: #selector(openCompanionApp),
            keyEquivalent: ""
        )
        menu.addItem(.separator())
        menu.addItem(
            withTitle: "退出 Jarvis Island",
            action: #selector(quitApp),
            keyEquivalent: "q"
        )
        item.menu = menu
        statusItem = item
    }

    @objc private func openCompanionApp() {
        if let bundleID = ProcessInfo.processInfo.environment["JARVIS_MAIN_APP_BUNDLE_ID"],
           let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) {
            NSWorkspace.shared.openApplication(at: url, configuration: .init())
            return
        }

        if let appPath = ProcessInfo.processInfo.environment["JARVIS_MAIN_APP_PATH"] {
            NSWorkspace.shared.open(URL(fileURLWithPath: appPath))
        }
    }

    @objc private func quitApp() {
        NSApp.terminate(nil)
    }

    private func resolveSocketPath() -> String? {
        let args = CommandLine.arguments
        if let idx = args.firstIndex(of: "--socket"), idx + 1 < args.count {
            return args[idx + 1]
        }
        if let envPath = ProcessInfo.processInfo.environment["JARVIS_ISLAND_SOCKET_PATH"], !envPath.isEmpty {
            return envPath
        }
        return nil
    }
}
