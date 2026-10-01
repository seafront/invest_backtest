// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "BacktestCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "BacktestCore", targets: ["BacktestCore"])],
    targets: [
        .target(name: "BacktestCore"),
        .testTarget(
            name: "BacktestCoreTests",
            dependencies: ["BacktestCore"],
            resources: [.copy("Fixtures"), .copy("Yahoo"), .copy("Optimizer")]
        ),
    ]
)
