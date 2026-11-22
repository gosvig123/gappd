import XCTest
@testable import GappdDiarizer

final class DiarizerConfigTests: XCTestCase {
    func testEnablesGuardedShortSegments() {
        let config = makeOfflineDiarizerConfig()
        XCTAssertEqual(config.clusteringThreshold, 0.7)
        XCTAssertEqual(config.minSegmentDuration, 0.75)
        XCTAssertTrue(config.exposeChunkEmbeddings)
    }
}
