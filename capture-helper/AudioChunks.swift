import Foundation

struct AudioChunkEvent: Encodable {
    let type = "audio_chunk"
    let source: String
    let path: String
    let start: Double
    let end: Double
}

final class AudioChunker {
    private let source: String
    private let dir: String
    private let sampleRate: UInt32
    private let maxFrames: UInt32
    private var writer: WAVWriter?
    private var index: UInt32 = 0
    private var chunkStartFrame: UInt64 = 0
    private var chunkFrames: UInt32 = 0

    init?(source: String, outputDir: String, sampleRate: UInt32, seconds: Double?) {
        guard let seconds, seconds > 0 else { return nil }
        self.source = source
        self.dir = (outputDir as NSString).appendingPathComponent("chunks")
        self.sampleRate = sampleRate
        self.maxFrames = max(1, UInt32(seconds * Double(sampleRate)))
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    }

    func write(data: Data) {
        var offset = 0
        while offset < data.count {
            ensureWriter()
            let roomBytes = Int(maxFrames - chunkFrames) * 2
            let count = min(roomBytes, data.count - offset)
            writer?.writeRaw(data: data.subdata(in: offset..<(offset + count)))
            chunkFrames += UInt32(count / 2)
            offset += count
            if chunkFrames >= maxFrames { finishChunk() }
        }
    }

    func finish() { finishChunk() }

    private func ensureWriter() {
        guard writer == nil else { return }
        index += 1
        writer = try? WAVWriter(path: chunkPath(), sampleRate: sampleRate, channels: 1)
    }

    private func finishChunk() {
        guard let current = writer, chunkFrames > 0 else { return }
        current.finalize()
        emitChunk(path: chunkPath(), frames: chunkFrames)
        chunkStartFrame += UInt64(chunkFrames)
        chunkFrames = 0
        writer = nil
    }

    private func chunkPath() -> String {
        return (dir as NSString).appendingPathComponent(String(format: "%@-%06d.wav", source, index))
    }

    private func emitChunk(path: String, frames: UInt32) {
        let start = Double(chunkStartFrame) / Double(sampleRate)
        let end = Double(chunkStartFrame + UInt64(frames)) / Double(sampleRate)
        let event = AudioChunkEvent(source: source, path: path, start: start, end: end)
        guard let data = try? JSONEncoder().encode(event), let line = String(data: data, encoding: .utf8) else { return }
        print(line)
    }
}
