import AppKit
import Foundation

protocol IslandStatusProviding: AnyObject {
    var onUpdate: ((IslandSnapshot) -> Void)? { get set }
    func start()
    func stop()
    func handleHoverChanged(_ hovering: Bool)
    func handleConversationEvent(_ event: IslandConversationEvent)
}

extension IslandStatusProviding {
    func handleHoverChanged(_: Bool) {}
    func handleConversationEvent(_: IslandConversationEvent) {}
}

protocol CompanionAppControlling: AnyObject {
    func showCompanionApp()
}

final class MacCompanionAppController: CompanionAppControlling {
    func showCompanionApp() {
        if let bundleID = ProcessInfo.processInfo.environment["JARVIS_MAIN_APP_BUNDLE_ID"],
           let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) {
            NSWorkspace.shared.openApplication(at: url, configuration: .init())
            return
        }

        if let appPath = ProcessInfo.processInfo.environment["JARVIS_MAIN_APP_PATH"] {
            NSWorkspace.shared.open(URL(fileURLWithPath: appPath))
        }
    }
}
