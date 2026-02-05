import Foundation
import ApplicationServices
import AppKit

// MARK: - Data Structures

struct ElementInfo: Codable {
    let role: String
    let subrole: String?
    let title: String
    let description: String?
    let value: String?
    let x: Double
    let y: Double
    let width: Double
    let height: Double
    let distance: Double
    let similarity: Double?  // For search mode
}

struct QueryResponse: Codable {
    let success: Bool
    let error: String?
    let elementAtPoint: ElementInfo?
    let nearbyElements: [ElementInfo]
    let queryX: Double
    let queryY: Double
    let queryTimeMs: Double
}

struct SearchResponse: Codable {
    let success: Bool
    let error: String?
    let results: [ElementInfo]
    let searchKeyword: String
    let queryTimeMs: Double
}

// MARK: - Snapshot Data Structures

struct SnapshotElementInfo: Codable {
    let role: String
    let subrole: String?
    let title: String?
    let description: String?
    let value: String?
    let identifier: String?
    let enabled: Bool?
    let focused: Bool?
    let selected: Bool?
    let expanded: Bool?
    let disclosing: Bool?
    let x: Double?
    let y: Double?
    let width: Double?
    let height: Double?
    let actions: [String]?
}

struct WindowInfo: Codable {
    let title: String?
    let role: String
    let subrole: String?
    let isMain: Bool
    let isMinimized: Bool
    let isFocused: Bool
    let x: Double?
    let y: Double?
    let width: Double?
    let height: Double?
    let identifier: String?
}

struct MenuInfo: Codable {
    let title: String?
    let role: String
    let x: Double?
    let y: Double?
    let width: Double?
    let height: Double?
    let items: [String]?
}

struct ApplicationInfo: Codable {
    let title: String?
    let bundleIdentifier: String?
    let isFrontmost: Bool
    let isHidden: Bool
    let pid: Int32
}

struct SnapshotResponse: Codable {
    let success: Bool
    let error: String?
    let timestamp: Double
    let focusedApplication: ApplicationInfo?
    let focusedWindow: WindowInfo?
    let focusedElement: SnapshotElementInfo?
    let elementAtPoint: SnapshotElementInfo?
    let windows: [WindowInfo]
    let openMenus: [MenuInfo]
    let queryTimeMs: Double
}

// MARK: - Screen Info

func getMainScreenBounds() -> CGRect {
    if let mainScreen = NSScreen.main {
        return mainScreen.frame
    }
    return CGRect(x: 0, y: 0, width: 1920, height: 1080)
}

// MARK: - Accessibility Helpers

func getStringAttribute(_ element: AXUIElement, _ attribute: String) -> String? {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    guard result == .success, let str = value as? String else { return nil }
    return str
}

func getPointAttribute(_ element: AXUIElement, _ attribute: String) -> CGPoint? {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    guard result == .success, let axValue = value else { return nil }

    var point = CGPoint.zero
    if AXValueGetValue(axValue as! AXValue, .cgPoint, &point) {
        return point
    }
    return nil
}

func getSizeAttribute(_ element: AXUIElement, _ attribute: String) -> CGSize? {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    guard result == .success, let axValue = value else { return nil }

    var size = CGSize.zero
    if AXValueGetValue(axValue as! AXValue, .cgSize, &size) {
        return size
    }
    return nil
}

func getBoolAttribute(_ element: AXUIElement, _ attribute: String) -> Bool? {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    guard result == .success, let boolValue = value as? Bool else { return nil }
    return boolValue
}

func getElementAttribute(_ element: AXUIElement, _ attribute: String) -> AXUIElement? {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    guard result == .success else { return nil }
    return (value as! AXUIElement)
}

func getElementArrayAttribute(_ element: AXUIElement, _ attribute: String) -> [AXUIElement] {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    guard result == .success, let elements = value as? [AXUIElement] else { return [] }
    return elements
}

func getActions(_ element: AXUIElement) -> [String] {
    var actionsRef: CFArray?
    let result = AXUIElementCopyActionNames(element, &actionsRef)
    guard result == .success, let actions = actionsRef as? [String] else { return [] }
    return actions
}

func getPid(_ element: AXUIElement) -> pid_t {
    var pid: pid_t = 0
    AXUIElementGetPid(element, &pid)
    return pid
}

func getChildren(_ element: AXUIElement) -> [AXUIElement] {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &value)
    guard result == .success, let children = value as? [AXUIElement] else { return [] }
    return children
}

func getParent(_ element: AXUIElement) -> AXUIElement? {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, kAXParentAttribute as CFString, &value)
    guard result == .success else { return nil }
    return (value as! AXUIElement)
}

func getElementInfo(_ element: AXUIElement, queryPoint: CGPoint, screenBounds: CGRect, similarity: Double? = nil) -> ElementInfo? {
    guard let position = getPointAttribute(element, kAXPositionAttribute),
          let size = getSizeAttribute(element, kAXSizeAttribute) else {
        return nil
    }

    let maxDimension = max(screenBounds.width, screenBounds.height) * 2
    if size.width > maxDimension || size.height > maxDimension {
        return nil
    }
    if size.width <= 0 || size.height <= 0 {
        return nil
    }

    let centerX = position.x + size.width / 2
    let centerY = position.y + size.height / 2

    let margin: CGFloat = 500
    if centerX < -margin || centerX > screenBounds.width + margin ||
       centerY < -margin || centerY > screenBounds.height + margin {
        return nil
    }

    let role = getStringAttribute(element, kAXRoleAttribute) ?? "Unknown"
    let subrole = getStringAttribute(element, kAXSubroleAttribute)

    var title = getStringAttribute(element, kAXTitleAttribute) ?? ""
    if title.isEmpty {
        title = getStringAttribute(element, kAXDescriptionAttribute) ?? ""
    }
    if title.isEmpty {
        if role == "AXStaticText" || role == "AXTextField" {
            title = getStringAttribute(element, kAXValueAttribute) ?? ""
        }
    }

    let description = getStringAttribute(element, kAXDescriptionAttribute)
    let value = getStringAttribute(element, kAXValueAttribute)

    let dx = centerX - queryPoint.x
    let dy = centerY - queryPoint.y
    let distance = sqrt(dx * dx + dy * dy)

    return ElementInfo(
        role: role,
        subrole: subrole,
        title: title,
        description: description,
        value: value,
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        distance: distance,
        similarity: similarity
    )
}

// MARK: - String Similarity

func levenshteinDistance(_ s1: String, _ s2: String) -> Int {
    let s1 = Array(s1.lowercased())
    let s2 = Array(s2.lowercased())
    let m = s1.count
    let n = s2.count

    if m == 0 { return n }
    if n == 0 { return m }

    var dp = Array(repeating: Array(repeating: 0, count: n + 1), count: m + 1)

    for i in 0...m { dp[i][0] = i }
    for j in 0...n { dp[0][j] = j }

    for i in 1...m {
        for j in 1...n {
            if s1[i-1] == s2[j-1] {
                dp[i][j] = dp[i-1][j-1]
            } else {
                dp[i][j] = min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]) + 1
            }
        }
    }

    return dp[m][n]
}

func calculateSimilarity(_ keyword: String, _ text: String) -> Double {
    if text.isEmpty { return 0.0 }
    if keyword.isEmpty { return 0.0 }

    let keywordLower = keyword.lowercased()
    let textLower = text.lowercased()

    // Exact match
    if textLower == keywordLower { return 1.0 }

    // Contains match
    if textLower.contains(keywordLower) { return 0.9 }
    if keywordLower.contains(textLower) { return 0.8 }

    // Levenshtein similarity
    let distance = levenshteinDistance(keyword, text)
    let maxLen = max(keyword.count, text.count)
    let similarity = 1.0 - (Double(distance) / Double(maxLen))

    return max(0, similarity)
}

// MARK: - Search Functions

func searchUITree(keyword: String, maxCount: Int, screenBounds: CGRect) -> [ElementInfo] {
    var results: [(element: ElementInfo, similarity: Double)] = []
    var visited = Set<String>()

    func visit(_ element: AXUIElement, depth: Int) {
        guard depth < 15 else { return }

        if let info = getElementInfo(element, queryPoint: .zero, screenBounds: screenBounds) {
            let key = "\(info.role)_\(Int(info.x))_\(Int(info.y))_\(Int(info.width))_\(Int(info.height))"

            if !visited.contains(key) {
                visited.insert(key)

                // Calculate similarity based on title, description, and value
                var maxSim = 0.0
                if !info.title.isEmpty {
                    maxSim = max(maxSim, calculateSimilarity(keyword, info.title))
                }
                if let desc = info.description, !desc.isEmpty {
                    maxSim = max(maxSim, calculateSimilarity(keyword, desc))
                }
                if let val = info.value, !val.isEmpty {
                    maxSim = max(maxSim, calculateSimilarity(keyword, val) * 0.8)  // Lower weight for value
                }

                // Only include elements with meaningful similarity
                // 0.5 threshold filters out unrelated matches from Levenshtein distance
                if maxSim > 0.5 && info.width >= 5 && info.height >= 5 {
                    let infoWithSim = ElementInfo(
                        role: info.role,
                        subrole: info.subrole,
                        title: info.title,
                        description: info.description,
                        value: info.value,
                        x: info.x,
                        y: info.y,
                        width: info.width,
                        height: info.height,
                        distance: 0,
                        similarity: maxSim
                    )
                    results.append((infoWithSim, maxSim))
                }
            }
        }

        for child in getChildren(element) {
            visit(child, depth: depth + 1)
        }
    }

    // Get all running applications and search their UI
    let systemWide = AXUIElementCreateSystemWide()
    var focusedAppRef: AnyObject?
    AXUIElementCopyAttributeValue(systemWide, kAXFocusedApplicationAttribute as CFString, &focusedAppRef)

    if let app = focusedAppRef as! AXUIElement? {
        visit(app, depth: 0)
    }

    // Sort by similarity and return top N
    results.sort { $0.similarity > $1.similarity }
    return Array(results.prefix(maxCount).map { $0.element })
}

func collectNearbyElements(
    from element: AXUIElement,
    queryPoint: CGPoint,
    maxDistance: Double,
    maxCount: Int,
    includeNonInteractive: Bool,
    screenBounds: CGRect
) -> [ElementInfo] {
    var elements: [ElementInfo] = []
    var visited = Set<String>()

    let interactiveRoles: Set<String> = [
        "AXButton", "AXTextField", "AXTextArea", "AXCheckBox",
        "AXRadioButton", "AXComboBox", "AXMenuItem", "AXTab",
        "AXSlider", "AXLink", "AXPopUpButton", "AXMenuButton",
        "AXIncrementor", "AXColorWell", "AXDisclosureTriangle",
        "AXDockItem", "AXMenuBarItem"
    ]

    func visit(_ el: AXUIElement, depth: Int) {
        guard depth < 10 else { return }

        if let info = getElementInfo(el, queryPoint: queryPoint, screenBounds: screenBounds) {
            let key = "\(info.role)_\(Int(info.x))_\(Int(info.y))_\(Int(info.width))_\(Int(info.height))"

            if !visited.contains(key) && info.distance <= maxDistance {
                visited.insert(key)

                let isInteractive = interactiveRoles.contains(info.role)
                if includeNonInteractive || isInteractive {
                    if info.width >= 5 && info.height >= 5 {
                        elements.append(info)
                    }
                }
            }
        }

        for child in getChildren(el) {
            visit(child, depth: depth + 1)
        }
    }

    var container = element
    for _ in 0..<3 {
        if let parent = getParent(container) {
            container = parent
        } else {
            break
        }
    }

    visit(container, depth: 0)

    elements.sort { $0.distance < $1.distance }
    return Array(elements.prefix(maxCount))
}

// MARK: - Snapshot Functions

func getSnapshotElementInfo(_ element: AXUIElement) -> SnapshotElementInfo {
    let role = getStringAttribute(element, kAXRoleAttribute) ?? "Unknown"
    let subrole = getStringAttribute(element, kAXSubroleAttribute)
    let title = getStringAttribute(element, kAXTitleAttribute)
    let description = getStringAttribute(element, kAXDescriptionAttribute)
    let value = getStringAttribute(element, kAXValueAttribute)
    let identifier = getStringAttribute(element, kAXIdentifierAttribute)
    let enabled = getBoolAttribute(element, kAXEnabledAttribute)
    let focused = getBoolAttribute(element, kAXFocusedAttribute)
    let selected = getBoolAttribute(element, kAXSelectedAttribute)
    let expanded = getBoolAttribute(element, kAXExpandedAttribute)
    let disclosing = getBoolAttribute(element, kAXDisclosingAttribute)
    let position = getPointAttribute(element, kAXPositionAttribute)
    let size = getSizeAttribute(element, kAXSizeAttribute)
    let actions = getActions(element)

    return SnapshotElementInfo(
        role: role,
        subrole: subrole,
        title: title,
        description: description,
        value: value,
        identifier: identifier,
        enabled: enabled,
        focused: focused,
        selected: selected,
        expanded: expanded,
        disclosing: disclosing,
        x: position.map { Double($0.x) },
        y: position.map { Double($0.y) },
        width: size.map { Double($0.width) },
        height: size.map { Double($0.height) },
        actions: actions.isEmpty ? nil : actions
    )
}

func getWindowInfo(_ window: AXUIElement, focusedWindow: AXUIElement?) -> WindowInfo {
    let title = getStringAttribute(window, kAXTitleAttribute)
    let role = getStringAttribute(window, kAXRoleAttribute) ?? "AXWindow"
    let subrole = getStringAttribute(window, kAXSubroleAttribute)
    let isMain = getBoolAttribute(window, kAXMainAttribute) ?? false
    let isMinimized = getBoolAttribute(window, kAXMinimizedAttribute) ?? false
    let position = getPointAttribute(window, kAXPositionAttribute)
    let size = getSizeAttribute(window, kAXSizeAttribute)
    let identifier = getStringAttribute(window, kAXIdentifierAttribute)

    // Check if this window is the focused window
    var isFocused = false
    if let focused = focusedWindow {
        isFocused = CFEqual(window, focused)
    }

    return WindowInfo(
        title: title,
        role: role,
        subrole: subrole,
        isMain: isMain,
        isMinimized: isMinimized,
        isFocused: isFocused,
        x: position.map { Double($0.x) },
        y: position.map { Double($0.y) },
        width: size.map { Double($0.width) },
        height: size.map { Double($0.height) },
        identifier: identifier
    )
}

func getApplicationInfo(_ app: AXUIElement) -> ApplicationInfo {
    let title = getStringAttribute(app, kAXTitleAttribute)
    let isFrontmost = getBoolAttribute(app, kAXFrontmostAttribute) ?? false
    let isHidden = getBoolAttribute(app, kAXHiddenAttribute) ?? false
    let pid = getPid(app)

    // Get bundle identifier from running application
    var bundleIdentifier: String? = nil
    if let runningApp = NSRunningApplication(processIdentifier: pid) {
        bundleIdentifier = runningApp.bundleIdentifier
    }

    return ApplicationInfo(
        title: title,
        bundleIdentifier: bundleIdentifier,
        isFrontmost: isFrontmost,
        isHidden: isHidden,
        pid: pid
    )
}

func findOpenMenus(_ app: AXUIElement) -> [MenuInfo] {
    var menus: [MenuInfo] = []

    func findMenusRecursive(_ element: AXUIElement, depth: Int) {
        guard depth < 10 else { return }

        let role = getStringAttribute(element, kAXRoleAttribute) ?? ""

        // Check if this is a menu (popup menu, context menu, etc.)
        if role == "AXMenu" {
            let title = getStringAttribute(element, kAXTitleAttribute)
            let position = getPointAttribute(element, kAXPositionAttribute)
            let size = getSizeAttribute(element, kAXSizeAttribute)

            // Get menu item titles
            var items: [String] = []
            for child in getChildren(element) {
                let childRole = getStringAttribute(child, kAXRoleAttribute) ?? ""
                if childRole == "AXMenuItem" {
                    if let itemTitle = getStringAttribute(child, kAXTitleAttribute), !itemTitle.isEmpty {
                        items.append(itemTitle)
                    }
                }
            }

            menus.append(MenuInfo(
                title: title,
                role: role,
                x: position.map { Double($0.x) },
                y: position.map { Double($0.y) },
                width: size.map { Double($0.width) },
                height: size.map { Double($0.height) },
                items: items.isEmpty ? nil : items
            ))
        }

        // Continue searching in children
        for child in getChildren(element) {
            findMenusRecursive(child, depth: depth + 1)
        }
    }

    // Search from menu bar
    if let menuBar = getElementAttribute(app, kAXMenuBarAttribute) {
        for menuBarItem in getChildren(menuBar) {
            // Check if menu bar item has an open menu
            for child in getChildren(menuBarItem) {
                findMenusRecursive(child, depth: 0)
            }
        }
    }

    // Also check for shown menu UI element (context menus, popups)
    if let shownMenu = getElementAttribute(app, kAXShownMenuUIElementAttribute) {
        findMenusRecursive(shownMenu, depth: 0)
    }

    // Search windows for popup menus
    for window in getElementArrayAttribute(app, kAXWindowsAttribute) {
        findMenusRecursive(window, depth: 0)
    }

    return menus
}

func captureSnapshot(queryX: Double?, queryY: Double?, screenBounds: CGRect) -> SnapshotResponse {
    let startTime = Date()
    let systemWide = AXUIElementCreateSystemWide()

    // Get focused application
    var focusedAppRef: AnyObject?
    AXUIElementCopyAttributeValue(systemWide, kAXFocusedApplicationAttribute as CFString, &focusedAppRef)

    guard let app = focusedAppRef as! AXUIElement? else {
        return SnapshotResponse(
            success: false,
            error: "No focused application found",
            timestamp: Date().timeIntervalSince1970,
            focusedApplication: nil,
            focusedWindow: nil,
            focusedElement: nil,
            elementAtPoint: nil,
            windows: [],
            openMenus: [],
            queryTimeMs: Date().timeIntervalSince(startTime) * 1000
        )
    }

    let appInfo = getApplicationInfo(app)

    // Get focused window
    let focusedWindowRef = getElementAttribute(app, kAXFocusedWindowAttribute)
    var focusedWindowInfo: WindowInfo? = nil
    if let focusedWindow = focusedWindowRef {
        focusedWindowInfo = getWindowInfo(focusedWindow, focusedWindow: focusedWindowRef)
    }

    // Get focused element
    let focusedElementRef = getElementAttribute(app, kAXFocusedUIElementAttribute)
    var focusedElementInfo: SnapshotElementInfo? = nil
    if let focusedElement = focusedElementRef {
        focusedElementInfo = getSnapshotElementInfo(focusedElement)
    }

    // Get element at point (if coordinates provided)
    var elementAtPointInfo: SnapshotElementInfo? = nil
    if let x = queryX, let y = queryY {
        var elementRef: AXUIElement?
        let result = AXUIElementCopyElementAtPosition(systemWide, Float(x), Float(y), &elementRef)
        if result == .success, let element = elementRef {
            elementAtPointInfo = getSnapshotElementInfo(element)
        }
    }

    // Get all windows
    var windowInfos: [WindowInfo] = []
    for window in getElementArrayAttribute(app, kAXWindowsAttribute) {
        windowInfos.append(getWindowInfo(window, focusedWindow: focusedWindowRef))
    }

    // Find open menus
    let openMenus = findOpenMenus(app)

    return SnapshotResponse(
        success: true,
        error: nil,
        timestamp: Date().timeIntervalSince1970,
        focusedApplication: appInfo,
        focusedWindow: focusedWindowInfo,
        focusedElement: focusedElementInfo,
        elementAtPoint: elementAtPointInfo,
        windows: windowInfos,
        openMenus: openMenus,
        queryTimeMs: Date().timeIntervalSince(startTime) * 1000
    )
}

// MARK: - Main

func main() {
    let startTime = Date()
    let screenBounds = getMainScreenBounds()

    // Parse arguments
    var mode = "query"  // "query", "search", or "snapshot"
    var queryX: Double? = nil
    var queryY: Double? = nil
    var maxCount: Int = 5
    var maxDistance: Double = 200
    var includeNonInteractive = false
    var searchKeyword = ""

    let args = CommandLine.arguments
    var i = 1
    while i < args.count {
        switch args[i] {
        case "--mode":
            i += 1
            if i < args.count {
                mode = args[i]
            }
        case "--snapshot":
            mode = "snapshot"
        case "--search":
            i += 1
            if i < args.count {
                searchKeyword = args[i]
            }
            mode = "search"
        case "--x":
            i += 1
            if i < args.count {
                queryX = Double(args[i])
            }
        case "--y":
            i += 1
            if i < args.count {
                queryY = Double(args[i])
            }
        case "--count":
            i += 1
            if i < args.count {
                maxCount = Int(args[i]) ?? 5
            }
        case "--distance":
            i += 1
            if i < args.count {
                maxDistance = Double(args[i]) ?? 200
            }
        case "--include-non-interactive":
            includeNonInteractive = true
        default:
            break
        }
        i += 1
    }

    // Check accessibility permissions
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: false] as CFDictionary
    guard AXIsProcessTrustedWithOptions(options) else {
        let errorResponse = "{\"success\": false, \"error\": \"Accessibility permission not granted\"}"
        print(errorResponse)
        return
    }

    if mode == "snapshot" {
        // Snapshot mode
        let response = captureSnapshot(queryX: queryX, queryY: queryY, screenBounds: screenBounds)
        printSnapshotJSON(response)
    } else if mode == "search" {
        // Search mode
        let results = searchUITree(keyword: searchKeyword, maxCount: maxCount, screenBounds: screenBounds)

        let response = SearchResponse(
            success: true,
            error: nil,
            results: results,
            searchKeyword: searchKeyword,
            queryTimeMs: Date().timeIntervalSince(startTime) * 1000
        )
        printSearchJSON(response)
    } else {
        // Query mode (original behavior)
        let qX = queryX ?? 0
        let qY = queryY ?? 0
        let queryPoint = CGPoint(x: qX, y: qY)
        let systemWide = AXUIElementCreateSystemWide()

        var elementRef: AXUIElement?
        let result = AXUIElementCopyElementAtPosition(systemWide, Float(qX), Float(qY), &elementRef)

        guard result == .success, let element = elementRef else {
            let response = QueryResponse(
                success: false,
                error: "No element found at position (\(qX), \(qY))",
                elementAtPoint: nil,
                nearbyElements: [],
                queryX: qX,
                queryY: qY,
                queryTimeMs: Date().timeIntervalSince(startTime) * 1000
            )
            printQueryJSON(response)
            return
        }

        let elementAtPoint = getElementInfo(element, queryPoint: queryPoint, screenBounds: screenBounds)

        let nearbyElements = collectNearbyElements(
            from: element,
            queryPoint: queryPoint,
            maxDistance: maxDistance,
            maxCount: maxCount,
            includeNonInteractive: includeNonInteractive,
            screenBounds: screenBounds
        )

        let response = QueryResponse(
            success: true,
            error: nil,
            elementAtPoint: elementAtPoint,
            nearbyElements: nearbyElements,
            queryX: qX,
            queryY: qY,
            queryTimeMs: Date().timeIntervalSince(startTime) * 1000
        )

        printQueryJSON(response)
    }
}

func printQueryJSON(_ response: QueryResponse) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]

    if let data = try? encoder.encode(response),
       let json = String(data: data, encoding: .utf8) {
        print(json)
    } else {
        print("{\"success\": false, \"error\": \"Failed to encode response\"}")
    }
}

func printSearchJSON(_ response: SearchResponse) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]

    if let data = try? encoder.encode(response),
       let json = String(data: data, encoding: .utf8) {
        print(json)
    } else {
        print("{\"success\": false, \"error\": \"Failed to encode response\"}")
    }
}

func printSnapshotJSON(_ response: SnapshotResponse) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]

    if let data = try? encoder.encode(response),
       let json = String(data: data, encoding: .utf8) {
        print(json)
    } else {
        print("{\"success\": false, \"error\": \"Failed to encode response\"}")
    }
}

main()
