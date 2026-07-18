import Foundation
import XCTest
@testable import GappdDiarizer

final class PCM16RangeSourceTests: XCTestCase {
    private let samples: [Int16] = [.min, -16384, -1, 0, 16384, .max]

    func testFirstRange() throws { try check(start: 0, count: 2) }
    func testInteriorRange() throws { try check(start: 2, count: 3) }
    func testFinalRange() throws { try check(start: 4, count: 2) }

    func testRejectsShortRead() throws {
        let url = try fixture()
        defer { try? FileManager.default.removeItem(at: url) }
        let source = try PCM16RangeSource(url: url, startFrame: 0, frameCount: samples.count)
        let handle = try FileHandle(forWritingTo: url)
        try handle.truncate(atOffset: 46)
        try handle.close()
        var output = [Float](repeating: 0, count: samples.count)
        XCTAssertThrowsError(try output.withUnsafeMutableBufferPointer {
            try source.copySamples(into: $0.baseAddress!, offset: 0, count: samples.count)
        })
    }

    private func check(start: Int, count: Int) throws {
        let url = try fixture()
        defer { try? FileManager.default.removeItem(at: url) }
        let source = try PCM16RangeSource(url: url, startFrame: start, frameCount: count)
        XCTAssertEqual(source.sampleCount, count)
        var output = [Float](repeating: 0, count: count)
        try output.withUnsafeMutableBufferPointer {
            try source.copySamples(into: $0.baseAddress!, offset: 0, count: count)
        }
        XCTAssertEqual(output, samples[start..<start + count].map { Float($0) / 32768 })
    }

    private func fixture() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav")
        var bytes = [UInt8](repeating: 0, count: 44)
        for sample in samples {
            let bits = UInt16(bitPattern: sample)
            bytes += [UInt8(bits & 255), UInt8(bits >> 8)]
        }
        try Data(bytes).write(to: url)
        return url
    }
}
