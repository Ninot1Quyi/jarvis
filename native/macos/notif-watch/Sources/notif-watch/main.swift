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

// MARK: - JSON Escape

func escape(_ s: String) -> String {
    var result = ""
    result.reserveCapacity(s.count)
    for ch in s.unicodeScalars {
        switch ch {
        case "\\": result += "\\\\"
        case "\"": result += "\\\""
        case "\n": result += "\\n"
        case "\r": result += "\\r"
        case "\t": result += "\\t"
        default:
            if ch.value < 0x20 {
                result += String(format: "\\u%04x", ch.value)
            } else {
                result += String(ch)
            }
        }
    }
    return result
}

func sha256Hex(_ input: String) -> String {
    let data = Data(input.utf8)
    let hash = SHA256.hash(data: data)
    return hash.prefix(8).map { String(format: "%02x", $0) }.joined()
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

// ============================================================
// MARK: - Part 1: System Notification Banner Detection
// ============================================================

struct RawNotification: Hashable {
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

    var appName = desc
    if let range = desc.range(of: "\u{FF0C}") ?? desc.range(of: ",") {
        appName = String(desc[desc.startIndex..<range.lowerBound])
    }
    appName = appName.trimmingCharacters(in: .whitespaces)

    var texts: [String] = []
    for child in getChildren(element) {
        if getRole(child) == "AXStaticText" {
            if let val = getValue(child), !val.isEmpty {
                texts.append(val)
            }
        }
    }
    guard !texts.isEmpty else { return nil }

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

var lastSeenBanners = Set<RawNotification>()

func scanBannersAndEmit(_ ncApp: AXUIElement) {
    var windowsValue: AnyObject?
    let result = AXUIElementCopyAttributeValue(ncApp, kAXWindowsAttribute as String as CFString, &windowsValue)

    guard result == .success, let windows = windowsValue as? [AXUIElement] else {
        lastSeenBanners.removeAll()
        return
    }

    var currentSet = Set<RawNotification>()
    for window in windows {
        for notif in extractNotificationsFromWindow(window) {
            currentSet.insert(notif)
        }
    }

    let newNotifications = currentSet.subtracting(lastSeenBanners)
    for notif in newNotifications {
        let id = sha256Hex("\(notif.appName)\(notif.title)\(notif.body)")
        let timestamp = Int(Date().timeIntervalSince1970)
        let json = "{\"type\":\"notification\",\"id\":\"\(escape(id))\",\"appName\":\"\(escape(notif.appName))\",\"title\":\"\(escape(notif.title))\",\"body\":\"\(escape(notif.body))\",\"timestamp\":\(timestamp)}"
        print(json)
    }

    lastSeenBanners = currentSet
}

/// Serialize the full AX tree of an element into a flat string array.
/// Each entry is "role:value" or "role:description" for every node.
func serializeAXTree(_ element: AXUIElement) -> [String] {
    var lines: [String] = []
    walkTree(element, &lines)

    // Some apps (QQ, Electron-based) don't include windows in kAXChildrenAttribute.
    // Explicitly fetch windows and traverse them too.
    // Duplicates are harmless since computeAXDiff uses occurrence counting.
    var windowsValue: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, kAXWindowsAttribute as String as CFString, &windowsValue)
    if result == .success, let windows = windowsValue as? [AXUIElement] {
        for window in windows {
            walkTree(window, &lines)
        }
    }

    return lines
}

func walkTree(_ element: AXUIElement, _ lines: inout [String]) {
    let role = getRole(element) ?? ""
    let value = getValue(element) ?? ""
    let desc = getDescription(element) ?? ""
    let title = getStringAttribute(element, "AXTitle" as String) ?? ""

    // Skip nodes with no text content
    if !title.isEmpty || !value.isEmpty || !desc.isEmpty {
        var parts: [String] = []
        if !role.isEmpty { parts.append(role) }
        if !title.isEmpty { parts.append("t=\(title)") }
        if !value.isEmpty { parts.append("v=\(value)") }
        if !desc.isEmpty { parts.append("d=\(desc)") }
        lines.append(parts.joined(separator: "|"))
    }

    for child in getChildren(element) {
        walkTree(child, &lines)
    }
}

// ============================================================
// MARK: - Main
// ============================================================

// --snapshot mode: one-shot AX tree dump of focused app
if CommandLine.arguments.contains("--snapshot") {
    guard let frontApp = NSWorkspace.shared.frontmostApplication else {
        print(#"{"error":"No focused application"}"#)
        exit(1)
    }
    let appName = frontApp.localizedName ?? "Unknown"
    let bundleId = frontApp.bundleIdentifier ?? ""
    let pid = frontApp.processIdentifier
    let axApp = AXUIElementCreateApplication(pid)
    let lines = serializeAXTree(axApp)

    let linesJSON = lines.map { "\"\(escape($0))\"" }.joined(separator: ",")
    print("{\"appName\":\"\(escape(appName))\",\"bundleId\":\"\(escape(bundleId))\",\"lines\":[\(linesJSON)]}")
    exit(0)
}

guard let ncPid = getNotificationCenterPID() else {
    print(#"{"error":"NotificationCenter process not found"}"#)
    exit(1)
}

let ncApp = AXUIElementCreateApplication(ncPid)

// AXObserver for event-driven banner detection (fast path)
var observer: AXObserver?
let callback: AXObserverCallback = { (_, element, notification, refcon) in
    guard let refcon = refcon else { return }
    let ncApp = Unmanaged<AXUIElement>.fromOpaque(refcon).takeUnretainedValue()
    Timer.scheduledTimer(withTimeInterval: 0.3, repeats: false) { _ in
        scanBannersAndEmit(ncApp)
    }
}

let createResult = AXObserverCreate(ncPid, callback, &observer)
guard createResult == .success, let observer = observer else {
    print(#"{"error":"Failed to create AXObserver"}"#)
    exit(1)
}

let ncAppRef = Unmanaged.passUnretained(ncApp).toOpaque()

let axNotifications: [String] = [
    kAXWindowCreatedNotification as String,
    kAXFocusedUIElementChangedNotification as String,
    kAXLayoutChangedNotification as String,
]
for notifName in axNotifications {
    AXObserverAddNotification(observer, ncApp, notifName as CFString, ncAppRef)
}

CFRunLoopAddSource(CFRunLoopGetCurrent(), AXObserverGetRunLoopSource(observer), .defaultMode)

// Timer 1: Banner fallback scan (1s)
Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in
    scanBannersAndEmit(ncApp)
}

// Signal ready
print(#"{"status":"ready","pid":\#(ncPid)}"#)

// Run forever
RunLoop.main.run()
