import AppKit
import AVFoundation
import CoreMedia
import ScreenCaptureKit

private struct PickedSource: @unchecked Sendable { let filter: SCContentFilter }
private struct VideoEvent: Encodable {
    let type: String
    var sourceType: String? = nil
    var hostSeconds: Double? = nil
    var reason: String? = nil
}

private func emit(_ event: VideoEvent) {
    guard let data = try? JSONEncoder().encode(event) else { return }
    FileHandle.standardOutput.write(data + Data([10]))
}

@MainActor
private final class VideoRecorder: NSObject, SCContentSharingPickerObserver, SCRecordingOutputDelegate, SCStreamOutput, SCStreamDelegate {
    private let dir: URL
    private var stream: SCStream?
    private var output: SCRecordingOutput?
    private var selectedType: String?
    private var startedAt: Double?
    private var lastFrame: Double?
    private var stopping = false
    private var finished = false
    private var diskTimer: Timer?

    init(dir: URL) { self.dir = dir }

    func present() {
        let picker = SCContentSharingPicker.shared
        picker.add(self)
        picker.defaultConfiguration.allowedPickerModes = [.singleWindow, .singleDisplay]
        picker.isActive = true
        picker.present()
        let notifications = NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.willSleepNotification, NSWorkspace.sessionDidResignActiveNotification] {
            notifications.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.stop(reason: "Mac locked or sleeping") }
            }
        }
    }

    nonisolated func contentSharingPicker(_ picker: SCContentSharingPicker, didUpdateWith filter: SCContentFilter, for existingStream: SCStream?) {
        let selected = PickedSource(filter: filter)
        Task { @MainActor in
            SCContentSharingPicker.shared.remove(self)
            let style = selected.filter.style
            guard style == .window || style == .display else { self.fail("Unsupported source"); return }
            self.selectedType = style == .window ? "window" : "display"
            let free = try? self.dir.resourceValues(forKeys: [.volumeAvailableCapacityKey]).volumeAvailableCapacity
            guard let free, free >= 2_147_483_648 else {
                emit(VideoEvent(type: "video_skipped", reason: "Insufficient disk space for Screen video"))
                exit(0)
            }
            let configuration = SCStreamConfiguration()
            configuration.capturesAudio = false
            let width = max(1, selected.filter.contentRect.width)
            let height = max(1, selected.filter.contentRect.height)
            let scale = min(1, 1920 / width, 1080 / height)
            configuration.width = Int(width * scale)
            configuration.height = Int(height * scale)
            configuration.minimumFrameInterval = CMTime(value: 1, timescale: 15)
            let stream = SCStream(filter: selected.filter, configuration: configuration, delegate: self)
            let recording = SCRecordingOutputConfiguration()
            recording.outputURL = self.dir.appendingPathComponent("screen.in-progress.mov")
            recording.outputFileType = .mov
            do {
                let output = SCRecordingOutput(configuration: recording, delegate: self)
                try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: DispatchQueue(label: "dev.gappd.video.frames"))
                try stream.addRecordingOutput(output)
                self.stream = stream
                self.output = output
                try await stream.startCapture()
                self.diskTimer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in
                    Task { @MainActor in self?.checkDisk() }
                }
            } catch { self.fail("Screen video could not start: \(error)") }
        }
    }

    nonisolated func contentSharingPicker(_ picker: SCContentSharingPicker, didCancelFor stream: SCStream?) {
        Task { @MainActor in
            SCContentSharingPicker.shared.remove(self)
            emit(VideoEvent(type: "video_cancelled"))
            exit(0)
        }
    }

    nonisolated func contentSharingPickerStartDidFailWithError(_ error: Error) {
        Task { @MainActor in self.fail("Source selection failed: \(error)") }
    }

    nonisolated func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sampleBuffer.isValid else { return }
        let seconds = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
        guard seconds.isFinite && seconds > 0 else { return }
        Task { @MainActor in
            if self.startedAt == nil {
                self.startedAt = seconds
                emit(VideoEvent(type: "video_started", sourceType: self.selectedType, hostSeconds: seconds))
            }
            self.lastFrame = seconds
        }
    }

    nonisolated func recordingOutputDidFinishRecording(_ recordingOutput: SCRecordingOutput) {
        Task { @MainActor in
            guard !self.finished else { return }
            self.diskTimer?.invalidate()
            if !self.stopping { emit(VideoEvent(type: "video_ended", reason: "Selected source ended")) }
            let partial = self.dir.appendingPathComponent("screen.in-progress.mov")
            let final = self.dir.appendingPathComponent("screen.mov")
            do {
                try FileManager.default.moveItem(at: partial, to: final)
                self.finished = true
                emit(VideoEvent(type: "video_finalized", sourceType: self.selectedType,
                    hostSeconds: self.lastFrame ?? CMTimeGetSeconds(CMClockGetTime(CMClockGetHostTimeClock()))))
                exit(0)
            } catch { self.fail("Video finalization failed: \(error)") }
        }
    }

    nonisolated func recordingOutput(_ recordingOutput: SCRecordingOutput, didFailWithError error: Error) {
        Task { @MainActor in self.fail("Video write failed: \(error)") }
    }

    nonisolated func stream(_ stream: SCStream, didStopWithError error: Error) {
        Task { @MainActor in self.stop(reason: "Source ended: \(error)") }
    }

    func stop(reason: String? = nil) {
        guard !stopping && !finished else { return }
        stopping = true
        diskTimer?.invalidate()
        guard stream != nil else {
            SCContentSharingPicker.shared.remove(self)
            emit(VideoEvent(type: "video_cancelled"))
            exit(0)
        }
        if let reason { emit(VideoEvent(type: "video_ended", reason: reason)) }
        Task {
            do { try await stream?.stopCapture() }
            catch { emit(VideoEvent(type: "video_ended", reason: "Video stream stopped: \(error)")); return }
            // stopCapture returns before the recording-finished delegate. The parent owns the bounded wait.
        }
    }

    func checkDisk() {
        do {
            let capacity = try dir.resourceValues(forKeys: [.volumeAvailableCapacityKey]).volumeAvailableCapacity
            guard let capacity else { stop(reason: "Could not check free disk space"); return }
            if capacity <= 1_073_741_824 { stop(reason: "Low disk space") }
        } catch { stop(reason: "Could not check free disk space") }
    }

    func fail(_ reason: String) {
        guard !finished else { return }
        diskTimer?.invalidate()
        emit(VideoEvent(type: "video_failed", reason: reason))
        exit(1)
    }
}

@main
struct VideoHelper {
    @MainActor static func main() async {
        if CommandLine.arguments.count == 3 && CommandLine.arguments[1] == "--inspect" {
            let movie = URL(fileURLWithPath: CommandLine.arguments[2])
            let asset = AVURLAsset(url: movie)
            do {
                let playable = try await asset.load(.isPlayable)
                let duration = CMTimeGetSeconds(try await asset.load(.duration))
                guard playable && duration.isFinite && duration > 0 else { exit(1) }
                emit(VideoEvent(type: "video_inspected", hostSeconds: duration))
                return
            } catch { exit(1) }
        }
        if CommandLine.arguments.count == 4 && CommandLine.arguments[1] == "--compact" {
            let source = URL(fileURLWithPath: CommandLine.arguments[2])
            let destination = URL(fileURLWithPath: CommandLine.arguments[3])
            do {
                let compacted = try await Task.detached(priority: .utility) {
                    try await Compactor.compact(source: source, destination: destination)
                }.value
                emit(VideoEvent(type: compacted ? "video_compacted" : "video_compact_unneeded"))
                return
            } catch {
                fputs("Screen video compaction failed: \(error)\n", stderr)
                exit(1)
            }
        }
        guard CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--output-dir" else {
            fputs("Usage: gappd-video --output-dir <meeting-session-dir> | --inspect <movie> | --compact <movie> <new-movie>\n", stderr)
            exit(2)
        }
        let dir = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
        guard FileManager.default.fileExists(atPath: dir.path),
              !FileManager.default.fileExists(atPath: dir.appendingPathComponent("screen.in-progress.mov").path),
              !FileManager.default.fileExists(atPath: dir.appendingPathComponent("screen.mov").path) else { exit(2) }
        let free = try? dir.resourceValues(forKeys: [.volumeAvailableCapacityKey]).volumeAvailableCapacity
        guard let free, free >= 2_147_483_648 else {
            emit(VideoEvent(type: "video_skipped", reason: "Insufficient disk space for Screen video"))
            return
        }
        NSApplication.shared.setActivationPolicy(.regular)
        let recorder = VideoRecorder(dir: dir)
        signal(SIGINT, SIG_IGN)
        let stopSignal = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
        stopSignal.setEventHandler { recorder.stop() }
        stopSignal.resume()
        DispatchQueue.main.async {
            NSApp.activate(ignoringOtherApps: true)
            recorder.present()
        }
        withExtendedLifetime((recorder, stopSignal)) { NSApp.run() }
    }
}
