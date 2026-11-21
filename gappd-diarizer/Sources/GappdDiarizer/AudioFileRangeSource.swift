import AVFoundation
import FluidAudio
import Foundation

/// Reads a frame range of compacted Meeting audio (FLAC) through Core Audio.
/// It decodes to Int16 and scales like PCM16RangeSource, so WAV and FLAC give the same samples.
final class AudioFileRangeSource: AudioSampleSource, @unchecked Sendable {
    let sampleCount: Int
    private let file: AVAudioFile
    private let startFrame: Int
    private let lock = NSLock()

    init(url: URL, startFrame: Int, frameCount: Int) throws {
        guard startFrame >= 0, frameCount >= 0 else { throw RangeSourceError.invalidRange }
        let (endFrame, overflow) = startFrame.addingReportingOverflow(frameCount)
        guard !overflow else { throw RangeSourceError.invalidRange }
        guard let opened = try? AVAudioFile(forReading: url, commonFormat: .pcmFormatInt16, interleaved: true),
              opened.processingFormat.channelCount == 1, opened.processingFormat.sampleRate == 16_000 else {
            throw RangeSourceError.unavailable
        }
        guard AVAudioFramePosition(endFrame) <= opened.length else { throw RangeSourceError.invalidRange }
        file = opened
        self.startFrame = startFrame
        sampleCount = frameCount
    }

    func copySamples(into destination: UnsafeMutablePointer<Float>, offset: Int, count: Int) throws {
        let (_, overflow) = offset.addingReportingOverflow(count)
        guard offset >= 0, count >= 0, !overflow, offset <= sampleCount,
              count == 0 || offset < sampleCount else {
            throw RangeSourceError.invalidRange
        }
        guard count > 0 else { return }
        let available = min(count, sampleCount - offset)
        try withSamples(offset: offset, count: available) { samples in
            for index in 0..<available { destination[index] = Float(samples[index]) / 32768 }
        }
    }

    /// Gives `body` the decoded Int16 samples of the range. AVAudioFile keeps one read position, so reads are serialized.
    /// Core Audio FLAC reads may return fewer frames than requested per call, so read in a loop until the full range is collected.
    func withSamples(offset: Int, count: Int, _ body: (UnsafePointer<Int16>) throws -> Void) throws {
        lock.lock()
        defer { lock.unlock() }
        var collected = [Int16](repeating: 0, count: count)
        var filled = 0
        file.framePosition = AVAudioFramePosition(startFrame + offset)
        while filled < count {
            let remaining = count - filled
            guard let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(remaining)) else {
                throw RangeSourceError.shortRead
            }
            do {
                try file.read(into: buffer, frameCount: AVAudioFrameCount(remaining))
            } catch {
                throw RangeSourceError.shortRead
            }
            let readFrames = Int(buffer.frameLength)
            guard readFrames > 0, readFrames <= remaining, let samples = buffer.int16ChannelData?[0] else {
                throw RangeSourceError.shortRead
            }
            collected.withUnsafeMutableBufferPointer { dst in
                dst.baseAddress!.advanced(by: filled).update(from: samples, count: readFrames)
            }
            filled += readFrames
        }
        try collected.withUnsafeBufferPointer { ptr in
            guard let base = ptr.baseAddress else { throw RangeSourceError.shortRead }
            try body(base)
        }
    }
}

/// Opens retained Meeting audio: the capture WAV, or its compacted FLAC copy.
func openAudioRange(url: URL, startFrame: Int, frameCount: Int) throws -> any AudioSampleSource {
    if url.pathExtension.lowercased() == "flac" {
        return try AudioFileRangeSource(url: url, startFrame: startFrame, frameCount: frameCount)
    }
    return try PCM16RangeSource(url: url, startFrame: startFrame, frameCount: frameCount)
}
