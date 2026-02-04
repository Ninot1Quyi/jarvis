import Foundation
import ApplicationServices
import AppKit

// MARK: - Data Structures

struct ElementInfo: Codable {
    let role: String
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

                // Only include elements with some similarity
                if maxSim > 0.1 && info.width >= 5 && info.height >= 5 {
                    let infoWithSim = ElementInfo(
                        role: info.role,
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

// MARK: - Main

func main() {
    let startTime = Date()
    let screenBounds = getMainScreenBounds()

    // Parse arguments
    var mode = "query"  // "query" or "search"
    var queryX: Double = 0
    var queryY: Double = 0
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
            mode = args[i]
        case "--search":
            i += 1
            searchKeyword = args[i]
            mode = "search"
        case "--x":
            i += 1
            queryX = Double(args[i]) ?? 0
        case "--y":
            i += 1
            queryY = Double(args[i]) ?? 0
        case "--count":
            i += 1
            maxCount = Int(args[i]) ?? 5
        case "--distance":
            i += 1
            maxDistance = Double(args[i]) ?? 200
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

    if mode == "search" {
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
        let queryPoint = CGPoint(x: queryX, y: queryY)
        let systemWide = AXUIElementCreateSystemWide()

        var elementRef: AXUIElement?
        let result = AXUIElementCopyElementAtPosition(systemWide, Float(queryX), Float(queryY), &elementRef)

        guard result == .success, let element = elementRef else {
            let response = QueryResponse(
                success: false,
                error: "No element found at position (\(queryX), \(queryY))",
                elementAtPoint: nil,
                nearbyElements: [],
                queryX: queryX,
                queryY: queryY,
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
            queryX: queryX,
            queryY: queryY,
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

main()
