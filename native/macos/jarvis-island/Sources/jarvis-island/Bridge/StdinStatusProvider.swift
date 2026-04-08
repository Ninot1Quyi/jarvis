import Foundation

final class StdinStatusProvider: IslandStatusProviding {
    var onUpdate: ((IslandSnapshot) -> Void)?

    private let queue = DispatchQueue(label: "jarvis.island.stdin")
    private var running = false

    func start() {
        running = true
        queue.async { [weak self] in
            self?.readLoop()
        }
    }

    func stop() {
        running = false
    }

    private func readLoop() {
        while running, let line = readLine(strippingNewline: true) {
            guard let data = line.data(using: .utf8) else { continue }
            if let snapshot = try? JSONDecoder().decode(IslandSnapshot.self, from: data) {
                DispatchQueue.main.async { [weak self] in
                    self?.onUpdate?(snapshot)
                }
            }
        }
    }
}
