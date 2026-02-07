import Cocoa
import ApplicationServices
import CryptoKit

setbuf(stdout, nil)

// MARK: - Accessibility Permission Check

func checkAccessibilityPermission() -> Bool {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue(): true] as CFDictionary
    return AXIsProcessTrustedWithOptions(options)
}

if !checkAccessibilityPermission() {
    let errorJSON = #"{"error":"Accessibility permission not granted. Please enable in System Settings > Privacy & Security > Accessibility."}"#
    print(errorJSON)
    exit(1)
}

// MARK: - Notification Center PID

func getNotificationCenterPID() -> pid_t? {
    for app in NSWorkspace.shared.runningApplications {
        if app.bundleIdentifier == "com.apple.notificationcenterui" {
            return app.processIdentifier
        }
    }
    return nil
}

// MARK: - AX Helpers

func getStringAttribute(_ element: AXUIElement, _ attribute: String) -> String? {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    guard result == .success else { return nil }
    return value as? String
}

func getChildren(_ element: AXUIElement) -> [AXUIElement] {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as String as CFString, &value)
    guard result == .success, let children = value as? [AXUIElement] else { return [] }
    return children
}

func getRole(_ element: AXUIElement) -> String? {
    return getStringAttribute(element, kAXRoleAttribute as String)
}

func getSubrole(_ element: AXUIElement) -> String? {
    return getStringAttribute(element, kAXSubroleAttribute as String)
}

func getValue(_ element: AXUIElement) -> String? {
    return getStringAttribute(element, kAXValueAttribute as String)
}

func getDescription(_ element: AXUIElement) -> String? {
    return getStringAttribute(element, kAXDescriptionAttribute as String)
}

// MARK: - Notification Parsing

/// Parse a notification banner window into structured data.
///
/// Banner AX structure (observed on macOS Sequoia, DND off):
///   AXWindow (the banner popup)
///     AXGroup ...
///       AXGroup subrole=AXNotificationCenterBanner desc="AppName, title, body"
///         AXStaticText value="title"
///         AXStaticText value="body"
///
/// NC panel structure (when panel is open):
///   AXWindow "Notification Center"
///     AXGroup (AXHostingView)
///       AXGroup
///         AXScrollArea
///           AXGroup
///             AXGroup subrole=AXNotificationCenterBannerStack desc="App, ..."
///             AXGroup subrole=AXNotificationCenterBanner desc="App, ..."

struct RawNotification {
    var appName: String = ""
    var title: String = ""
    var body: String = ""
}

func extractNotificationsFromWindow(_ window: AXUIElement) -> [RawNotification] {
    var results: [RawNotification] = []
    findNotificationGroups(window, &results, depth: 0)
    return results
}

func findNotificationGroups(_ element: AXUIElement, _ results: inout [RawNotification], depth: Int) {
    if depth > 15 { return }

    let subrole = getSubrole(element) ?? ""

    if subrole.hasPrefix("AXNotificationCenterBanner") {
        if let notif = parseNotificationGroup(element) {
            results.append(notif)
        }
        return
    }

    for child in getChildren(element) {
        findNotificationGroups(child, &results, depth: depth + 1)
    }
}

func parseNotificationGroup(_ element: AXUIElement) -> RawNotification? {
    let desc = getDescription(element) ?? ""
    if desc.isEmpty { return nil }

    // Extract app name: first segment before Chinese comma or English comma
    var appName = desc
    if let range = desc.range(of: "\u{FF0C}") ?? desc.range(of: ",") {
        appName = String(desc[desc.startIndex..<range.lowerBound])
    }
    appName = appName.trimmingCharacters(in: .whitespaces)

    // Collect AXStaticText values from direct children
    var texts: [String] = []
    for child in getChildren(element) {
        if getRole(child) == "AXStaticText" {
            if let val = getValue(child), !val.isEmpty {
                texts.append(val)
            }
        }
    }

    guard !texts.isEmpty else { return nil }

    // Filter out timestamp strings like "48分钟前", "2 days ago", "now"
    let timeRegexPatterns = [
        "^\\d+\\s*(seconds?|minutes?|hours?|days?|weeks?|months?)\\s*ago$",
        "^\\d+\\s*(秒|分钟|小时|天|周|个月)前$",
        "^(now|just now|yesterday|刚刚|昨天)$",
    ]
    let contentTexts = texts.filter { text in
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        for pattern in timeRegexPatterns {
            if trimmed.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil {
                return false
            }
        }
        return true
    }

    guard !contentTexts.isEmpty else { return nil }

    var notif = RawNotification()
    notif.appName = appName
    notif.title = contentTexts[0]
    notif.body = contentTexts.count > 1 ? contentTexts[1...].joined(separator: "\n") : ""
    return notif
}

// MARK: - Hash & JSON Output

func generateID(appName: String, title: String, body: String) -> String {
    let input = "\(appName)\(title)\(body)"
    let data = Data(input.utf8)
    let hash = SHA256.hash(data: data)
    return hash.prefix(8).map { String(format: "%02x", $0) }.joined()
}

var reportedIDs = Set<String>()

func emitNewNotifications(_ notifications: [RawNotification]) {
    for notif in notifications {
        let id = generateID(appName: notif.appName, title: notif.title, body: notif.body)
        if reportedIDs.contains(id) { continue }
        reportedIDs.insert(id)

        func escape(_ s: String) -> String {
            return s
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "\"", with: "\\\"")
                .replacingOccurrences(of: "\n", with: "\\n")
                .replacingOccurrences(of: "\r", with: "\\r")
                .replacingOccurrences(of: "\t", with: "\\t")
        }

        let timestamp = Int(Date().timeIntervalSince1970)
        let json = "{\"id\":\"\(escape(id))\",\"appName\":\"\(escape(notif.appName))\",\"title\":\"\(escape(notif.title))\",\"body\":\"\(escape(notif.body))\",\"timestamp\":\(timestamp)}"
        print(json)
    }

    // Prevent unbounded growth
    if reportedIDs.count > 1000 {
        reportedIDs.removeAll()
    }
}

// MARK: - AXObserver: Event-Driven Notification Detection

/// When DND is off, each incoming notification creates a transient banner window
/// in the NotificationCenter process. We use AXObserver to listen for
/// kAXWindowCreatedNotification on that process. When fired, we immediately
/// read the new window's AX tree to extract notification content.
///
/// Edge case: rapid successive notifications may reuse the same window
/// (NC replaces the banner content instead of creating a new window).
/// To handle this, after each event we schedule follow-up scans to catch
/// content changes in existing windows.

func scanAllWindows(_ ncApp: AXUIElement) {
    var windowsValue: AnyObject?
    let result = AXUIElementCopyAttributeValue(ncApp, kAXWindowsAttribute as String as CFString, &windowsValue)
    guard result == .success, let windows = windowsValue as? [AXUIElement] else { return }

    for window in windows {
        let notifications = extractNotificationsFromWindow(window)
        emitNewNotifications(notifications)
    }
}

/// Pending follow-up scan timer. Cancelled and rescheduled on each new event.
var followUpTimer: DispatchSourceTimer?

func scheduleFollowUpScans(_ ncApp: AXUIElement) {
    followUpTimer?.cancel()

    // Scan again at 1s, 3s, 5s after the event to catch rapid successive banners
    let delays = [1, 3, 5]
    for delay in delays {
        DispatchQueue.main.asyncAfter(deadline: .now() + .seconds(delay)) {
            scanAllWindows(ncApp)
        }
    }
}

func handleWindowCreated(_ ncApp: AXUIElement) {
    // Use async delay instead of usleep to keep the RunLoop responsive.
    // Blocking the RunLoop with usleep causes subsequent AXObserver events to be lost.
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(300)) {
        scanAllWindows(ncApp)
        scheduleFollowUpScans(ncApp)
    }
}

guard let ncPid = getNotificationCenterPID() else {
    print(#"{"error":"NotificationCenter process not found"}"#)
    exit(1)
}

let ncApp = AXUIElementCreateApplication(ncPid)

// Create AXObserver
var observer: AXObserver?
let callback: AXObserverCallback = { (_, element, notification, refcon) in
    guard let refcon = refcon else { return }
    let ncApp = Unmanaged<AXUIElement>.fromOpaque(refcon).takeUnretainedValue()
    handleWindowCreated(ncApp)
}

let createResult = AXObserverCreate(ncPid, callback, &observer)
guard createResult == .success, let observer = observer else {
    print(#"{"error":"Failed to create AXObserver"}"#)
    exit(1)
}

// Pass ncApp as refcon so the callback can use it
let ncAppRef = Unmanaged.passUnretained(ncApp).toOpaque()

// Listen for window creation and UI changes on the NC app element
let notifications: [String] = [
    kAXWindowCreatedNotification as String,
    kAXFocusedUIElementChangedNotification as String,
    kAXLayoutChangedNotification as String,
]
for notifName in notifications {
    let addResult = AXObserverAddNotification(observer, ncApp, notifName as CFString, ncAppRef)
    if addResult != .success && addResult != .notificationAlreadyRegistered {
        // Non-fatal: some notifications may not be supported
    }
}

// Add observer to run loop
CFRunLoopAddSource(CFRunLoopGetCurrent(), AXObserverGetRunLoopSource(observer), .defaultMode)

// Signal ready
print(#"{"status":"ready","pid":\#(ncPid)}"#)

// Run forever
RunLoop.main.run()
