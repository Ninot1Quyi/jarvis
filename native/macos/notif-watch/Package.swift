// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "notif-watch",
    platforms: [.macOS(.v10_15)],
    targets: [
        .executableTarget(
            name: "notif-watch",
            path: "Sources/notif-watch"
        ),
    ]
)
