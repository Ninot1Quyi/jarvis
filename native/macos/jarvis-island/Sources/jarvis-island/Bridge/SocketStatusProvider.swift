import Darwin
import Foundation

final class SocketStatusProvider: IslandStatusProviding {
    private struct SocketConversationEvent: Encodable {
        let type: String
        let event: String
        let text: String?
        let conversationID: String
        let timestamp: String
    }

    var onUpdate: ((IslandSnapshot) -> Void)?

    private let socketPath: String
    private let queue = DispatchQueue(label: "jarvis.island.socket")
    private var running = false

    private var serverFD: Int32 = -1
    private var acceptSource: DispatchSourceRead?
    private var clientSources: [Int32: DispatchSourceRead] = [:]
    private var clientBuffers: [Int32: Data] = [:]

    init(socketPath: String) {
        self.socketPath = socketPath
    }

    func start() {
        guard !running else { return }
        running = true
        queue.async { [weak self] in
            self?.startServer()
        }
    }

    func stop() {
        queue.async { [weak self] in
            guard let self else { return }
            self.running = false
            self.shutdownServer()
        }
    }

    func handleConversationEvent(_ event: IslandConversationEvent) {
        queue.async { [weak self] in
            guard let self else { return }
            switch event {
            case let .send(text, conversationID):
                self.sendConversationEvent(
                    SocketConversationEvent(
                        type: "conversation_event",
                        event: "send",
                        text: text,
                        conversationID: conversationID,
                        timestamp: ISO8601DateFormatter().string(from: Date())
                    )
                )
            case let .dismiss(conversationID):
                self.sendConversationEvent(
                    SocketConversationEvent(
                        type: "conversation_event",
                        event: "dismiss",
                        text: nil,
                        conversationID: conversationID,
                        timestamp: ISO8601DateFormatter().string(from: Date())
                    )
                )
            }
        }
    }

    private func startServer() {
        cleanupSocketFile()

        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { return }
        serverFD = fd

        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)

        let maxPathLen = MemoryLayout.size(ofValue: addr.sun_path)
        socketPath.withCString { rawPtr in
            let pathBytes = strlen(rawPtr)
            if pathBytes < maxPathLen {
                withUnsafeMutablePointer(to: &addr.sun_path) { sunPathPtr in
                    _ = strncpy(
                        UnsafeMutableRawPointer(sunPathPtr).assumingMemoryBound(to: CChar.self),
                        rawPtr,
                        maxPathLen - 1
                    )
                }
            }
        }

        let bindResult = withUnsafePointer(to: &addr) { addrPtr -> Int32 in
            addrPtr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                bind(fd, sockPtr, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard bindResult == 0 else {
            close(fd)
            serverFD = -1
            return
        }

        guard listen(fd, 8) == 0 else {
            close(fd)
            serverFD = -1
            cleanupSocketFile()
            return
        }

        setNonBlocking(fd)

        let source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: queue)
        source.setEventHandler { [weak self] in
            self?.acceptClients()
        }
        source.setCancelHandler { [weak self] in
            guard let self else { return }
            if self.serverFD >= 0 {
                close(self.serverFD)
                self.serverFD = -1
            }
            self.cleanupSocketFile()
        }
        acceptSource = source
        source.resume()
    }

    private func acceptClients() {
        guard running else { return }

        while true {
            var addr = sockaddr()
            var addrLen: socklen_t = socklen_t(MemoryLayout<sockaddr>.size)
            let clientFD = accept(serverFD, &addr, &addrLen)
            if clientFD < 0 {
                if errno == EAGAIN || errno == EWOULDBLOCK {
                    break
                }
                break
            }

            setNonBlocking(clientFD)
            clientBuffers[clientFD] = Data()

            let source = DispatchSource.makeReadSource(fileDescriptor: clientFD, queue: queue)
            source.setEventHandler { [weak self] in
                self?.readFromClient(clientFD)
            }
            source.setCancelHandler { [weak self] in
                guard let self else { return }
                self.clientBuffers.removeValue(forKey: clientFD)
                self.clientSources.removeValue(forKey: clientFD)
                close(clientFD)
            }
            clientSources[clientFD] = source
            source.resume()
        }
    }

    private func readFromClient(_ fd: Int32) {
        guard running else { return }
        var buffer = [UInt8](repeating: 0, count: 4096)

        while true {
            let count = read(fd, &buffer, buffer.count)
            if count > 0 {
                clientBuffers[fd, default: Data()].append(buffer, count: count)
                parseLines(for: fd)
                continue
            }

            if count == 0 {
                closeClient(fd)
                return
            }

            if errno == EAGAIN || errno == EWOULDBLOCK {
                return
            }

            closeClient(fd)
            return
        }
    }

    private func parseLines(for fd: Int32) {
        guard var data = clientBuffers[fd] else { return }

        while let newlineIndex = data.firstIndex(of: 0x0A) {
            let lineData = data.prefix(upTo: newlineIndex)
            data.removeSubrange(...newlineIndex)
            guard !lineData.isEmpty else { continue }

            if let snapshot = try? JSONDecoder().decode(IslandSnapshot.self, from: lineData) {
                DispatchQueue.main.async { [weak self] in
                    self?.onUpdate?(snapshot)
                }
            }
        }

        clientBuffers[fd] = data
    }

    private func closeClient(_ fd: Int32) {
        if let source = clientSources[fd] {
            source.cancel()
        } else {
            close(fd)
            clientBuffers.removeValue(forKey: fd)
        }
    }

    private func shutdownServer() {
        acceptSource?.cancel()
        acceptSource = nil

        for (_, source) in clientSources {
            source.cancel()
        }
        clientSources.removeAll()
        clientBuffers.removeAll()

        if serverFD >= 0 {
            close(serverFD)
            serverFD = -1
        }

        cleanupSocketFile()
    }

    private func sendConversationEvent(_ event: SocketConversationEvent) {
        guard !clientSources.isEmpty else { return }
        guard let data = try? JSONEncoder().encode(event) else { return }

        var packet = data
        packet.append(0x0A)

        for fd in clientSources.keys {
            let wrote = packet.withUnsafeBytes { rawBuffer -> Bool in
                guard let baseAddress = rawBuffer.baseAddress else { return false }
                var sent = 0
                while sent < rawBuffer.count {
                    let ptr = baseAddress.advanced(by: sent)
                    let result = write(fd, ptr, rawBuffer.count - sent)
                    if result > 0 {
                        sent += Int(result)
                        continue
                    }
                    if errno == EAGAIN || errno == EWOULDBLOCK {
                        return true
                    }
                    return false
                }
                return true
            }
            if !wrote {
                closeClient(fd)
            }
        }
    }

    private func setNonBlocking(_ fd: Int32) {
        let flags = fcntl(fd, F_GETFL, 0)
        _ = fcntl(fd, F_SETFL, flags | O_NONBLOCK)
    }

    private func cleanupSocketFile() {
        _ = unlink(socketPath)
    }
}
