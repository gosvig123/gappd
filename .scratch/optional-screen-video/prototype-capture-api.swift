// THROWAWAY PROTOTYPE: one interactive window/display video test, never production capture.
import AppKit
import ScreenCaptureKit

// Picker filters are Objective-C references. Transfer only the selected immutable filter to the main actor.
private struct PickedSource: @unchecked Sendable { let filter: SCContentFilter }

@MainActor
final class VideoProbe: NSObject, SCContentSharingPickerObserver, SCRecordingOutputDelegate {
    private var stream: SCStream?
    private var output: SCRecordingOutput?
    private let destination: URL
    private var stopping = false
    private let seconds: Double

    init(destination: URL, seconds: Double) {
        self.destination = destination
        self.seconds = seconds
    }

    func selectSource() {
        let picker = SCContentSharingPicker.shared
        picker.add(self)
        picker.isActive = true
        picker.defaultConfiguration.allowedPickerModes = [.singleWindow, .singleDisplay]
        print("Select a window or display. Cancel exits without recording.")
        picker.present()
    }

    nonisolated func contentSharingPicker(_ picker: SCContentSharingPicker, didUpdateWith filter: SCContentFilter, for existingStream: SCStream?) {
        let selected = PickedSource(filter: filter)
        Task { @MainActor in
            SCContentSharingPicker.shared.remove(self)
            let style = selected.filter.style
            print("Selected source: \(style == .window ? "window" : style == .display ? "display" : "other")")
            let config = SCStreamConfiguration()
            config.capturesAudio = false // Independent of Gappd's existing system WAV capture.
            config.width = 1280
            config.height = 720
            config.minimumFrameInterval = CMTime(value: 1, timescale: 15)
            let video = SCStream(filter: selected.filter, configuration: config, delegate: nil)
            let recording = SCRecordingOutputConfiguration()
            recording.outputURL = destination
            recording.outputFileType = .mov
            let output = SCRecordingOutput(configuration: recording, delegate: self)
            do {
                try video.addRecordingOutput(output)
                self.stream = video
                self.output = output
                try await video.startCapture()
                print("Stream started; awaiting stop or source loss.")
            } catch {
                print("Stream could not start: \(error)")
                exit(1)
            }
        }
    }

    nonisolated func contentSharingPicker(_ picker: SCContentSharingPicker, didCancelFor stream: SCStream?) {
        print("Picker cancelled; no video was recorded")
        exit(2)
    }

    nonisolated func contentSharingPickerStartDidFailWithError(_ error: Error) {
        print("Picker could not start: \(error)")
        exit(1)
    }

    nonisolated func recordingOutputDidStartRecording(_ recordingOutput: SCRecordingOutput) {
        print("Recording started")
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(seconds))
            await stop()
        }
    }

    nonisolated func recordingOutput(_ recordingOutput: SCRecordingOutput, didFailWithError error: Error) {
        print("Recording failed: \(error)")
        exit(1)
    }

    nonisolated func recordingOutputDidFinishRecording(_ recordingOutput: SCRecordingOutput) {
        Task { @MainActor in
            print("Recording finalized; requested stop: \(stopping)")
            exit(0)
        }
    }

    private func stop() async {
        guard !stopping else { return }
        stopping = true
        let start = Date()
        do {
            try await stream?.stopCapture()
            print("stopCapture returned in \(Date().timeIntervalSince(start)) seconds; awaiting file callback")
        } catch {
            print("stopCapture failed: \(error)")
            exit(1)
        }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(15))
            print("Recording completion callback not received within 15 seconds")
            exit(1)
        }
    }
}

@main
struct PrototypeCapture {
    @MainActor static func main() {
        guard (2...3).contains(CommandLine.arguments.count) else {
            print("Usage: prototype-capture <new-output.mov> [seconds]")
            exit(2)
        }
        let destination = URL(fileURLWithPath: CommandLine.arguments[1])
        guard !FileManager.default.fileExists(atPath: destination.path) else {
            print("Refusing to overwrite existing file")
            exit(2)
        }
        setbuf(stdout, nil)
        NSApplication.shared.setActivationPolicy(.regular)
        let probe = VideoProbe(destination: destination, seconds: CommandLine.arguments.count == 3 ? Double(CommandLine.arguments[2]) ?? 5 : 5)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            NSApp.activate(ignoringOtherApps: true)
            print("App active: \(NSApp.isActive)")
            probe.selectSource()
        }
        withExtendedLifetime(probe) { NSApp.run() }
    }
}
