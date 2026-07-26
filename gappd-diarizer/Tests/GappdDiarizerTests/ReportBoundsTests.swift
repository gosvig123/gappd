import XCTest
@testable import GappdDiarizer

final class ReportBoundsTests: XCTestCase {
    func testClipsModelOvershootToRequestedDuration() {
        let range = clippedTimeRange(start: 597.13, end: 600.068, duration: 600)
        XCTAssertEqual(range?.start, 597.13)
        XCTAssertEqual(range?.end, 600)
    }

    func testRejectsRangeOutsideRequestedDuration() {
        XCTAssertNil(clippedTimeRange(start: 600.01, end: 601, duration: 600))
    }
}
