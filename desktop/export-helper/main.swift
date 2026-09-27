import AVFoundation
import Foundation

@main struct ExportRecording {
    static func main() async {
        do {
            guard CommandLine.arguments.count == 8,
                  let videoStart = Double(CommandLine.arguments[5]),
                  let micStart = Double(CommandLine.arguments[6]),
                  let systemStart = Double(CommandLine.arguments[7]),
                  [videoStart, micStart, systemStart].allSatisfy({ $0.isFinite && $0 > 0 }) else {
                throw ExportError.invalidInput
            }
            let paths = Array(CommandLine.arguments[1...4])
            let origin = min(videoStart, micStart, systemStart)
            let composition = AVMutableComposition()
            let video = AVURLAsset(url: URL(fileURLWithPath: paths[0]))
            let mic = AVURLAsset(url: URL(fileURLWithPath: paths[1]))
            let system = AVURLAsset(url: URL(fileURLWithPath: paths[2]))
            _ = try await insert(video, type: .video, start: videoStart - origin, into: composition)
            let micTrack = try await insert(mic, type: .audio, start: micStart - origin, into: composition)
            let systemTrack = try await insert(system, type: .audio, start: systemStart - origin, into: composition)
            guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
                throw ExportError.invalidInput
            }
            let mix = AVMutableAudioMix()
            mix.inputParameters = [micTrack, systemTrack].map { track in
                let parameters = AVMutableAudioMixInputParameters(track: track)
                parameters.setVolume(1, at: .zero)
                return parameters
            }
            exporter.audioMix = mix
            try await exporter.export(to: URL(fileURLWithPath: paths[3]), as: .mp4)
        } catch {
            fputs("Export recording failed: \(error)\n", stderr)
            exit(1)
        }
    }

    static func insert(_ asset: AVAsset, type: AVMediaType, start: Double, into composition: AVMutableComposition) async throws -> AVMutableCompositionTrack {
        guard let source = try await asset.loadTracks(withMediaType: type).first,
              let target = composition.addMutableTrack(withMediaType: type, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            throw ExportError.missingTrack(type.rawValue)
        }
        let duration = try await asset.load(.duration)
        guard duration.isValid && duration.seconds > 0 else { throw ExportError.invalidInput }
        try target.insertTimeRange(CMTimeRange(start: .zero, duration: duration), of: source, at: CMTime(seconds: start, preferredTimescale: 60000))
        if type == .video { target.preferredTransform = try await source.load(.preferredTransform) }
        return target
    }
}

enum ExportError: Error {
    case invalidInput
    case missingTrack(String)
}
