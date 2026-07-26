import AVFoundation
import CoreMedia
import Foundation
import Speech

struct Transcript: Encodable {
    let segments: [TranscriptSegment]
}

struct TranscriptSegment: Encodable {
    let start: Double
    let end: Double
    let text: String
    let words: [TranscriptWord]
}

struct TranscriptWord: Encodable {
    let start: Double
    let end: Double
    let text: String
}

struct AssetStatus: Encodable {
    let locale: String
    let installed: Bool
}

enum Command {
    case transcribe(URL, Locale)
    case prepare(Locale)
    case status(Locale)
}

enum TranscriptionError: Error, CustomStringConvertible {
    case missingAudioPath
    case speechUnavailable
    case unsupportedLocale(String)
    case modelUnavailable(String)

    var description: String {
        switch self {
        case .missingAudioPath:
            "usage: apple-speech-transcriber <audio-path> [locale] | --prepare [locale] | --status [locale]"
        case .speechUnavailable:
            "Apple SpeechTranscriber is unavailable on this Mac"
        case .unsupportedLocale(let locale):
            "Apple SpeechTranscriber does not support locale \(locale)"
        case .modelUnavailable(let locale):
            "Apple speech model for \(locale) is not installed and could not be downloaded"
        }
    }
}

@available(macOS 26.0, *)
@main
struct AppleSpeechTranscriberCLI {
    static func main() async {
        do {
            try await run()
        } catch {
            FileHandle.standardError.write(Data("error: \(error)\n".utf8))
            Foundation.exit(1)
        }
    }

    static func run() async throws {
        switch try commandFromArguments() {
        case .transcribe(let audioURL, let locale):
            try await writeJSON(transcribe(audioURL, locale: locale))
        case .prepare(let locale):
            try await writeJSON(prepare(locale))
        case .status(let locale):
            let status = try await status(locale)
            try writeJSON(status)
            if !status.installed { Foundation.exit(2) }
        }
    }

    static func commandFromArguments() throws -> Command {
        guard CommandLine.arguments.count >= 2 else { throw TranscriptionError.missingAudioPath }
        if CommandLine.arguments[1] == "--prepare" { return .prepare(localeArgument(2)) }
        if CommandLine.arguments[1] == "--status" { return .status(localeArgument(2)) }
        return .transcribe(URL(fileURLWithPath: CommandLine.arguments[1]), localeArgument(2))
    }

    static func localeArgument(_ index: Int) -> Locale {
        Locale(identifier: CommandLine.arguments.dropFirst(index).first ?? "en_US")
    }

    static func transcribe(_ audioURL: URL, locale: Locale) async throws -> Transcript {
        guard SpeechTranscriber.isAvailable else { throw TranscriptionError.speechUnavailable }
        let transcriber = try await configuredTranscriber(locale)
        let segments = try await collectSegments(audioURL, transcriber)
        return Transcript(segments: segments)
    }

    static func configuredTranscriber(_ locale: Locale) async throws -> SpeechTranscriber {
        let transcriber = try await transcriberFor(locale)
        try await ensureModel(transcriber, locale: Locale(identifier: transcriber.selectedLocales[0].identifier))
        return transcriber
    }

    static func prepare(_ locale: Locale) async throws -> AssetStatus {
        let transcriber = try await transcriberFor(locale)
        try await ensureModel(transcriber, locale: Locale(identifier: transcriber.selectedLocales[0].identifier))
        return AssetStatus(locale: transcriber.selectedLocales[0].identifier, installed: true)
    }

    static func status(_ locale: Locale) async throws -> AssetStatus {
        let transcriber = try await transcriberFor(locale)
        let installed = await AssetInventory.status(forModules: [transcriber]) == .installed
        return AssetStatus(locale: transcriber.selectedLocales[0].identifier, installed: installed)
    }

    static func transcriberFor(_ locale: Locale) async throws -> SpeechTranscriber {
        guard let supported = await SpeechTranscriber.supportedLocale(equivalentTo: locale) else {
            throw TranscriptionError.unsupportedLocale(locale.identifier)
        }
        return SpeechTranscriber(locale: supported, transcriptionOptions: [], reportingOptions: [], attributeOptions: [.audioTimeRange])
    }

    static func ensureModel(_ transcriber: SpeechTranscriber, locale: Locale) async throws {
        if await AssetInventory.status(forModules: [transcriber]) == .installed { return }
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
            try await request.downloadAndInstall()
        }
        if await AssetInventory.status(forModules: [transcriber]) != .installed {
            throw TranscriptionError.modelUnavailable(locale.identifier)
        }
    }

    static func collectSegments(_ audioURL: URL, _ transcriber: SpeechTranscriber) async throws -> [TranscriptSegment] {
        let collector = Task { try await finalSegments(from: transcriber) }
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        let audioFile = try AVAudioFile(forReading: audioURL)
        if let last = try await analyzer.analyzeSequence(from: audioFile) {
            try await analyzer.finalizeAndFinish(through: last)
        } else {
            await analyzer.cancelAndFinishNow()
        }
        return try await collector.value
    }

    static func finalSegments(from transcriber: SpeechTranscriber) async throws -> [TranscriptSegment] {
        var segments: [TranscriptSegment] = []
        for try await result in transcriber.results where result.isFinal {
            if let segment = segment(from: result) { segments.append(segment) }
        }
        return segments
    }

    static func segment(from result: SpeechTranscriber.Result) -> TranscriptSegment? {
        let text = String(result.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return nil }
        let words = result.text.runs.compactMap { run -> TranscriptWord? in
            guard let range = run.audioTimeRange else { return nil }
            let word = String(result.text[run.range].characters)
            return TranscriptWord(start: seconds(range.start), end: seconds(range.end), text: word)
        }
        return TranscriptSegment(start: seconds(result.range.start), end: seconds(result.range.end), text: text, words: words)
    }

    static func seconds(_ time: CMTime) -> Double {
        let value = CMTimeGetSeconds(time)
        return value.isFinite ? value : 0
    }

    static func writeJSON<T: Encodable>(_ value: T) throws {
        let data = try JSONEncoder().encode(value)
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
    }
}
