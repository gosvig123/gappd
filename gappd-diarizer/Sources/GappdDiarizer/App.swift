import Darwin
import FluidAudio
import Foundation

private let revision = "300165b240c45375add402265f62410b6df33cf1"
private let engine = "fluidaudio-offline-vbx"

private struct Cluster: Codable { let localClusterID: String; let centroid: [Double] }
private struct Span: Codable {
    let localClusterID: String
    let startSeconds, endSeconds, qualityScore, identityScore: Double
}
private struct Report: Codable {
    let schemaVersion: Int
    let engine, engineRevision: String
    let requestedStartFrame, requestedFrameCount: Int
    let clusters: [Cluster]
    let spans: [Span]
}

@main enum GappdDiarizer {
    static func main() async {
        let args = Array(CommandLine.arguments.dropFirst())
        if args == ["--version"] {
            emit(["schemaVersion": 1, "engine": engine, "engineRevision": revision] as [String: Any])
            return
        }
        guard args.count == 4 else {
            fail("usage: gappd-diarizer <audio-path> <start-frame> <frame-count> <models-directory>", 64)
        }
        guard let start = Int(args[1]), let count = Int(args[2]), start >= 0, count > 0 else {
            fail("error: config: invalid frame range", 64)
        }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: args[3], isDirectory: &isDirectory), isDirectory.boolValue else {
            fail("error: config: models directory unavailable", 66)
        }
        let source: PCM16RangeSource
        do { source = try PCM16RangeSource(url: URL(fileURLWithPath: args[0]), startFrame: start, frameCount: count) }
        catch { fail("error: config: audio range unavailable", 66) }

        let watchdog = Task.detached {
            while !Task.isCancelled {
                if let bytes = SystemInfo.currentResidentMemoryBytes(), bytes > 450 * 1024 * 1024 {
                    let message = Array("error: resource_exhausted\n".utf8)
                    message.withUnsafeBytes { _ = Darwin.write(STDERR_FILENO, $0.baseAddress!, $0.count) }
                    Darwin._exit(75)
                }
                try? await Task.sleep(for: .milliseconds(100))
            }
        }
        defer { watchdog.cancel() }
        do {
            ModelHub.offlineMode = true
            var config = OfflineDiarizerConfig(clusteringThreshold: 0.6)
            config.exposeChunkEmbeddings = true
            let manager = OfflineDiarizerManager(config: config)
            let models = try await OfflineDiarizerModels.load(from: URL(fileURLWithPath: args[3]))
            manager.initialize(models: models)
            let report: Report
            do {
                report = makeReport(try await manager.process(audioSource: source, audioLoadingSeconds: 0), start: start, count: count)
            } catch OfflineDiarizationError.noSpeechDetected {
                report = Report(schemaVersion: 1, engine: engine, engineRevision: revision,
                                requestedStartFrame: start, requestedFrameCount: count, clusters: [], spans: [])
            }
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
            FileHandle.standardOutput.write(try encoder.encode(report))
            FileHandle.standardOutput.write(Data("\n".utf8))
        } catch {
            fail("error: engine: diarization failed", 70)
        }
    }

    private static func makeReport(_ result: DiarizationResult, start: Int, count: Int) -> Report {
        let grouped = Dictionary(grouping: result.segments, by: \.speakerId)
        let ids = grouped.keys.sorted()
        let clusters = ids.map { id -> Cluster in
            let segments = grouped[id]!, total = segments.reduce(0.0) { $0 + max(0.001, Double($1.durationSeconds)) }
            let centroid = segments[0].embedding.indices.map { index in
                segments.reduce(0.0) { $0 + Double($1.embedding[index]) * max(0.001, Double($1.durationSeconds)) } / total
            }
            return Cluster(localClusterID: id, centroid: centroid)
        }
        let centroids = Dictionary(uniqueKeysWithValues: clusters.map { ($0.localClusterID, $0.centroid) })
        let observations = result.chunkEmbeddings ?? []
        let spans = result.segments.map { segment -> Span in
            let scores = observations.filter {
                $0.speakerId == segment.speakerId && min(Double(segment.endTimeSeconds), $0.endTimeSeconds) > max(Double(segment.startTimeSeconds), $0.startTimeSeconds)
            }.map { observation -> Double in
                let alternatives = ids.filter { $0 != observation.speakerId }
                guard !alternatives.isEmpty else { return 1 }
                let assigned = cosine(observation.embedding256, centroids[observation.speakerId]!)
                let second = alternatives.map { cosine(observation.embedding256, centroids[$0]!) }.max()!
                return min(clamp((assigned - 0.5) / 0.5), clamp((assigned - second) / 0.15))
            }
            return Span(localClusterID: segment.speakerId, startSeconds: Double(segment.startTimeSeconds),
                        endSeconds: Double(segment.endTimeSeconds), qualityScore: Double(segment.qualityScore),
                        identityScore: scores.min() ?? 0)
        }
        return Report(schemaVersion: 1, engine: engine, engineRevision: revision,
                      requestedStartFrame: start, requestedFrameCount: count, clusters: clusters, spans: spans)
    }

    private static func cosine(_ left: [Float], _ right: [Double]) -> Double {
        let dot = zip(left, right).reduce(0.0) { $0 + Double($1.0) * $1.1 }
        let norms = sqrt(left.reduce(0.0) { $0 + Double($1) * Double($1) } * right.reduce(0.0) { $0 + $1 * $1 })
        return norms == 0 ? -1 : dot / norms
    }
    private static func clamp(_ value: Double) -> Double { min(1, max(0, value)) }
    private static func emit(_ object: Any) {
        FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]))
        FileHandle.standardOutput.write(Data("\n".utf8))
    }
    private static func fail(_ message: String, _ status: Int32) -> Never {
        FileHandle.standardError.write(Data("\(message)\n".utf8)); Darwin.exit(status)
    }
}
