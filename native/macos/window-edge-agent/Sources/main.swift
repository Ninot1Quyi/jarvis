import AppKit
import ApplicationServices
import Foundation

enum AgentError: LocalizedError {
    case invalidArgs(String)
    case accessibilityDenied
    case noWindowsForPID(Int32)
    case axFailure(String, AXError)
    case appleScriptFailure(String)

    var errorDescription: String? {
        switch self {
        case let .invalidArgs(msg):
            return "invalid_args: \(msg)"
        case .accessibilityDenied:
            return "accessibility_denied"
        case let .noWindowsForPID(pid):
            return "no_window_for_pid: \(pid)"
        case let .axFailure(op, err):
            return "ax_failure(\(op)): \(err.rawValue)"
        case let .appleScriptFailure(msg):
            return "applescript_failure: \(msg)"
        }
    }
}

struct PinRequest {
    var pid: Int32
    var x: Double
    var y: Double
    var width: Double
    var height: Double
}

private func value(_ args: [String], _ flag: String) -> String? {
    guard let idx = args.firstIndex(of: flag), idx + 1 < args.count else { return nil }
    return args[idx + 1]
}

private func parseRequest(from args: [String]) throws -> PinRequest {
    guard args.first == "pin" else {
        throw AgentError.invalidArgs("expected subcommand `pin`")
    }

    guard
        let pidString = value(args, "--pid"),
        let xString = value(args, "--x"),
        let yString = value(args, "--y"),
        let widthString = value(args, "--width"),
        let heightString = value(args, "--height"),
        let pid = Int32(pidString),
        let x = Double(xString),
        let y = Double(yString),
        let width = Double(widthString),
        let height = Double(heightString)
    else {
        throw AgentError.invalidArgs("missing pin args")
    }

    return PinRequest(pid: pid, x: x, y: y, width: width, height: height)
}

private func ensureAXTrusted() throws {
    let options = [kAXTrustedCheckOptionPrompt.takeRetainedValue() as String: true] as CFDictionary
    guard AXIsProcessTrustedWithOptions(options) else {
        throw AgentError.accessibilityDenied
    }
}

private func fetchAXWindows(pid: Int32) throws -> [AXUIElement] {
    let app = AXUIElementCreateApplication(pid)
    var rawValue: CFTypeRef?
    let copyErr = AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &rawValue)
    guard copyErr == .success else {
        throw AgentError.axFailure("copy_windows", copyErr)
    }
    guard let windows = rawValue as? [AXUIElement], !windows.isEmpty else {
        throw AgentError.noWindowsForPID(pid)
    }
    return windows
}

private func setPosition(window: AXUIElement, point: CGPoint) throws {
    var mutablePoint = point
    guard let posValue = AXValueCreate(.cgPoint, &mutablePoint) else {
        throw AgentError.invalidArgs("failed to create AXValue(cgPoint)")
    }
    let setErr = AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, posValue)
    guard setErr == .success else {
        throw AgentError.axFailure("set_position", setErr)
    }
}

private func setSize(window: AXUIElement, size: CGSize) throws {
    var mutableSize = size
    guard let sizeValue = AXValueCreate(.cgSize, &mutableSize) else {
        throw AgentError.invalidArgs("failed to create AXValue(cgSize)")
    }
    let setErr = AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, sizeValue)
    guard setErr == .success else {
        throw AgentError.axFailure("set_size", setErr)
    }
}

private func emitJSON(_ payload: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []) else {
        return
    }
    if let text = String(data: data, encoding: .utf8) {
        print(text)
    }
}

private func escapeAppleScript(_ value: String) -> String {
    value.replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: "\"", with: "\\\"")
}

private func tryAppleScriptFallback(pid: Int32, x: Double, y: Double, width: Double, height: Double) throws {
    let script = """
    tell application "System Events"
        set targetProc to first application process whose unix id is \(pid)
        tell targetProc
            if (count of windows) is greater than 0 then
                set position of front window to {\(Int(x)), \(Int(y))}
                set size of front window to {\(Int(width)), \(Int(height))}
            else
                error "no windows"
            end if
        end tell
    end tell
    """

    guard let appleScript = NSAppleScript(source: script) else {
        throw AgentError.appleScriptFailure("invalid script")
    }

    var errorInfo: NSDictionary?
    appleScript.executeAndReturnError(&errorInfo)
    if let errorInfo {
        throw AgentError.appleScriptFailure(errorInfo.description)
    }
}

do {
    let args = Array(CommandLine.arguments.dropFirst())
    let req = try parseRequest(from: args)
    try ensureAXTrusted()
    let point = CGPoint(x: req.x, y: req.y)
    let size = CGSize(width: req.width, height: req.height)

    var windowsCount = 0
    do {
        let windows = try fetchAXWindows(pid: req.pid)
        windowsCount = windows.count
        let target = windows[0]
        try setPosition(window: target, point: point)
        try setSize(window: target, size: size)
    } catch {
        try tryAppleScriptFallback(
            pid: req.pid,
            x: req.x,
            y: req.y,
            width: req.width,
            height: req.height
        )
    }

    emitJSON([
        "ok": true,
        "pid": req.pid,
        "x": req.x,
        "y": req.y,
        "width": req.width,
        "height": req.height,
        "windowCount": windowsCount,
    ])
    exit(0)
} catch {
    emitJSON([
        "ok": false,
        "error": error.localizedDescription,
    ])
    exit(2)
}
