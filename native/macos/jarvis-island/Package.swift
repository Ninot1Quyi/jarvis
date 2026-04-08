// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "jarvis-island",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "jarvis-island", targets: ["jarvis-island"]),
    ],
    targets: [
        .executableTarget(
            name: "jarvis-island",
            path: "Sources/jarvis-island"
        ),
    ]
)
