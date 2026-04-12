// swift-tools-version:5.7
import PackageDescription

let package = Package(
    name: "ax-query",
    platforms: [
        .macOS(.v10_15)
    ],
    targets: [
        .executableTarget(
            name: "ax-query",
            path: "Sources/ax-query"
        )
    ]
)
