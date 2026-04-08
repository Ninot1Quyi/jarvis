import Foundation

enum IslandPhase: String, Codable {
    case idle
    case listening
    case waiting
    case working
    case approval
    case result
    case error
}

struct IslandProgress: Codable, Equatable {
    var current: Int
    var maximum: Int?

    var label: String {
        if let maximum, maximum > 0 {
            return "\(current)/\(maximum)"
        }
        return "\(current)/∞"
    }
}

enum IslandChatRole: String, Codable {
    case user
    case assistant
    case system
}

struct IslandChatTurn: Codable, Equatable, Identifiable {
    var id: String
    var role: IslandChatRole
    var text: String
}

struct IslandToolCallPayload: Codable, Equatable, Identifiable {
    var id: String
    var name: String
    var status: String
    var symbol: String
}

struct IslandSeenImagePayload: Codable, Equatable {
    var title: String
    var subtitle: String
    var symbol: String
}

struct IslandConversationPayload: Codable, Equatable {
    var id: String
    var title: String
    var turns: [IslandChatTurn]
    var inputPlaceholder: String
    var canSend: Bool
    var streamingReply: String?
    var toolCalls: [IslandToolCallPayload]?
    var lastSeenImage: IslandSeenImagePayload?
}

struct IslandSnapshot: Codable, Equatable {
    var phase: IslandPhase
    var title: String
    var detail: String
    var appName: String
    var progress: IslandProgress
    var expanded: Bool
    var conversation: IslandConversationPayload?

    init(
        phase: IslandPhase,
        title: String,
        detail: String,
        appName: String,
        progress: IslandProgress,
        expanded: Bool,
        conversation: IslandConversationPayload? = nil
    ) {
        self.phase = phase
        self.title = title
        self.detail = detail
        self.appName = appName
        self.progress = progress
        self.expanded = expanded
        self.conversation = conversation
    }

    static let idle = IslandSnapshot(
        phase: .idle,
        title: "Jarvis 已就位",
        detail: "等待新的桌面任务。",
        appName: "Finder",
        progress: IslandProgress(current: 0, maximum: nil),
        expanded: false
    )
}
