// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "window-edge-agent",
    platforms: [
        .macOS(.v13),
    ],
    products: [
        .executable(name: "window-edge-agent", targets: ["window-edge-agent"]),
    ],
    targets: [
        .executableTarget(
            name: "window-edge-agent",
            path: "Sources"
        ),
    ]
)
