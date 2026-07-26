import Darwin
import FluidAudio
import Foundation

enum RangeSourceError: Error { case unavailable, invalidRange, shortRead }

final class PCM16RangeSource: AudioSampleSource, @unchecked Sendable {
    let sampleCount: Int
    private let file: FileHandle
    private let startFrame: Int

    init(url: URL, startFrame: Int, frameCount: Int) throws {
        guard startFrame >= 0, frameCount >= 0 else { throw RangeSourceError.invalidRange }
        let (endFrame, frameOverflow) = startFrame.addingReportingOverflow(frameCount)
        let (payloadBytes, byteOverflow) = endFrame.multipliedReportingOverflow(by: 2)
        let (endByte, headerOverflow) = payloadBytes.addingReportingOverflow(44)
        guard !frameOverflow, !byteOverflow, !headerOverflow else { throw RangeSourceError.invalidRange }
        guard let opened = try? FileHandle(forReadingFrom: url) else { throw RangeSourceError.unavailable }
        var info = stat()
        guard Darwin.fstat(opened.fileDescriptor, &info) == 0, off_t(endByte) <= info.st_size else {
            try? opened.close()
            throw RangeSourceError.invalidRange
        }
        file = opened
        self.startFrame = startFrame
        sampleCount = frameCount
    }

    deinit { try? file.close() }

    func copySamples(into destination: UnsafeMutablePointer<Float>, offset: Int, count: Int) throws {
        let (_, overflow) = offset.addingReportingOverflow(count)
        guard offset >= 0, count >= 0, !overflow, offset <= sampleCount,
              count == 0 || offset < sampleCount else {
            throw RangeSourceError.invalidRange
        }
        guard count > 0 else { return }
        let available = min(count, sampleCount - offset)
        var bytes = [UInt8](repeating: 0, count: available * 2)
        let position = off_t(44 + (startFrame + offset) * 2)
        let readCount = bytes.withUnsafeMutableBytes {
            Darwin.pread(file.fileDescriptor, $0.baseAddress!, $0.count, position)
        }
        guard readCount == bytes.count else { throw RangeSourceError.shortRead }
        for index in 0..<available {
            let bits = UInt16(bytes[index * 2]) | UInt16(bytes[index * 2 + 1]) << 8
            destination[index] = Float(Int16(bitPattern: bits)) / 32768
        }
    }
}
