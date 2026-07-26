import Foundation

struct AudioChunkEvent: Encodable {
    let type = "audio_chunk"
    let source: String
    let path: String
    let start: Double
    let end: Double
    let canonicalStart: Double
    let canonicalEnd: Double
}

struct AudioChunkFailure: Encodable {
    let type = "audio_chunk"
    let source: String
    let error: String
}

struct AudioChunkSourceComplete: Encodable {
    let type = "audio_chunk_source_complete"
    let source: String
    let count: UInt32
    let canonicalEnd: Double
}

struct AudioChunkStreamComplete: Encodable {
    let type = "audio_chunk_stream_complete"
    let sources: [String]
}

func emitAudioChunkStreamComplete(sources: [String]) {
    printAudioChunkEvent(AudioChunkStreamComplete(sources: sources))
}

private func printAudioChunkEvent<T: Encodable>(_ value: T) {
    guard let data = try? JSONEncoder().encode(value),
          let line = String(data: data, encoding: .utf8) else { return }
    FileHandle.standardOutput.write(Data((line + "\n").utf8))
}

final class AudioChunker {
    private let source: String
    private let dir: String
    private let sampleRate: UInt64
    private let chunkFrames: UInt64
    private let contextFrames: UInt64
    private var pcm = Data()
    private var index: UInt32 = 0
    private var windowStart: UInt64 = 0
    private var canonicalStart: UInt64 = 0
    private var totalFrames: UInt64 = 0
    private var finished = false

    init?(source: String, outputDir: String, sampleRate: UInt32, seconds: Double?, overlapSeconds: Double) {
        guard let seconds, seconds.isFinite, seconds > 0,
              overlapSeconds.isFinite, overlapSeconds >= 0, overlapSeconds < seconds else { return nil }
        self.source = source
        self.dir = (outputDir as NSString).appendingPathComponent("chunks")
        self.sampleRate = UInt64(sampleRate)
        self.chunkFrames = max(1, UInt64(seconds * Double(sampleRate)))
        self.contextFrames = UInt64(overlapSeconds * Double(sampleRate)) / 2
        guard (try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)) != nil else { return nil }
    }

    func write(data: Data) {
        let completeBytes = data.count - data.count % 2
        guard completeBytes > 0 else { return }
        pcm.append(data.prefix(completeBytes))
        totalFrames += UInt64(completeBytes / 2)
        emitCompleteWindows()
    }

    func finish() {
        guard !finished else { return }
        finished = true
        emitCompleteWindows()
        emitFinalWindows()
        pcm.removeAll(keepingCapacity: false)
        printAudioChunkEvent(AudioChunkSourceComplete(
            source: source, count: index, canonicalEnd: seconds(totalFrames)))
    }

    private func emitFinalWindows() {
        while totalFrames > canonicalStart + chunkFrames {
            let canonicalEnd = canonicalStart + chunkFrames
            _ = emitWindow(canonicalEnd: canonicalEnd, windowEnd: totalFrames)
            advance(after: canonicalEnd)
        }
        guard totalFrames > canonicalStart else { return }
        _ = emitWindow(canonicalEnd: totalFrames, windowEnd: totalFrames)
    }

    private func emitCompleteWindows() {
        while totalFrames >= canonicalStart + chunkFrames + contextFrames {
            let canonicalEnd = canonicalStart + chunkFrames
            _ = emitWindow(canonicalEnd: canonicalEnd, windowEnd: canonicalEnd + contextFrames)
            advance(after: canonicalEnd)
        }
    }

    private func emitWindow(canonicalEnd: UInt64, windowEnd: UInt64) -> Bool {
        let byteCount = Int((windowEnd - windowStart) * 2)
        guard pcm.count >= byteCount else { emitFailure("incomplete PCM window"); return false }
        index += 1
        let path = chunkPath()
        guard let writer = try? WAVWriter(path: path, sampleRate: UInt32(sampleRate), channels: 1) else {
            emitFailure("could not create chunk WAV"); return false
        }
        writer.writeRaw(data: pcm.prefix(byteCount))
        writer.finalize()
        emitEvent(path: path, canonicalEnd: canonicalEnd, windowEnd: windowEnd)
        return true
    }

    private func advance(after canonicalEnd: UInt64) {
        let nextStart = canonicalEnd > contextFrames ? canonicalEnd - contextFrames : 0
        let discardedFrames = nextStart - windowStart
        pcm.removeFirst(Int(discardedFrames * 2))
        windowStart = nextStart
        canonicalStart = canonicalEnd
    }

    private func chunkPath() -> String {
        (dir as NSString).appendingPathComponent(String(format: "%@-%06d.wav", source, index))
    }

    private func seconds(_ frames: UInt64) -> Double {
        Double(frames) / Double(sampleRate)
    }

    private func emitEvent(path: String, canonicalEnd: UInt64, windowEnd: UInt64) {
        let event = AudioChunkEvent(source: source, path: path, start: seconds(windowStart),
            end: seconds(windowEnd), canonicalStart: seconds(canonicalStart), canonicalEnd: seconds(canonicalEnd))
        printAudioChunkEvent(event)
    }

    private func emitFailure(_ message: String) {
        printAudioChunkEvent(AudioChunkFailure(source: source, error: message))
    }
}
