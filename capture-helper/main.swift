import Foundation
import AppKit
import AVFoundation
import ScreenCaptureKit
import CoreGraphics

enum CaptureMode: String {
    case mic, system, both
}

struct Config {
    let mode: CaptureMode
    let outputDir: String
    let sampleRate: Double
    let deviceIndex: Int?
    let stopFile: String?
    let chunkSeconds: Double?
    let chunkOverlapSeconds: Double
}

@MainActor
func parseArgs() -> Config {
    var mode: CaptureMode = .both
    var outputDir = "."
    var sampleRate = 16000.0
    var deviceIndex: Int? = nil
    var stopFile: String? = nil
    var chunkSeconds: Double? = nil
    var chunkOverlapSeconds = 0.0

    let args = CommandLine.arguments
    var i = 1
    while i < args.count {
        switch args[i] {
        case "--mode":
            i += 1; mode = CaptureMode(rawValue: args[i]) ?? .both
        case "--output-dir":
            i += 1; outputDir = args[i]
        case "--sample-rate":
            i += 1; sampleRate = Double(args[i]) ?? 16000.0
        case "--device":
            i += 1; deviceIndex = Int(args[i])
        case "--stop-file":
            i += 1; stopFile = args[i]
        case "--chunk-seconds":
            chunkSeconds = Double(requiredValue(args, index: &i, option: args[i])) ?? .nan
        case "--chunk-overlap-seconds":
            chunkOverlapSeconds = Double(requiredValue(args, index: &i, option: args[i])) ?? .nan
        case "--list-devices":
            listDevices(); exit(0)
        case "--request-permissions":
            var outputPath: String? = nil
            if i + 1 < args.count && args[i + 1] == "--output" {
                i += 2
                if i < args.count { outputPath = args[i] }
            }
            requestPermissionsAndExit(outputPath: outputPath)
        case "--help":
            printUsage(); exit(0)
        default:
            break
        }
        i += 1
    }
    validateChunkConfig(seconds: chunkSeconds, overlap: chunkOverlapSeconds)
    return Config(mode: mode, outputDir: outputDir, sampleRate: sampleRate, deviceIndex: deviceIndex,
        stopFile: stopFile, chunkSeconds: chunkSeconds, chunkOverlapSeconds: chunkOverlapSeconds)
}

func requiredValue(_ args: [String], index: inout Int, option: String) -> String {
    guard index + 1 < args.count else {
        stderrPrint("error: \(option) requires a value")
        exit(2)
    }
    index += 1
    return args[index]
}

func validateChunkConfig(seconds: Double?, overlap: Double) {
    guard let seconds else { return }
    guard seconds.isFinite, seconds > 0 else {
        stderrPrint("error: --chunk-seconds must be a finite number greater than zero")
        exit(2)
    }
    guard overlap.isFinite, overlap >= 0, overlap < seconds else {
        stderrPrint("error: --chunk-overlap-seconds must be finite, non-negative, and less than --chunk-seconds")
        exit(2)
    }
}

func captureSources(_ mode: CaptureMode) -> [String] {
    switch mode {
    case .mic: return ["mic"]
    case .system: return ["system"]
    case .both: return ["mic", "system"]
    }
}

func printUsage() {
    let usage = """
    gappd-capture: Record mic and/or system audio

    Usage:
      gappd-capture --mode <mic|system|both> --output-dir <path> [options]

    Options:
      --mode <mic|system|both>  Capture mode (default: both)
      --output-dir <path>       Directory for output files
      --sample-rate <hz>        Sample rate (default: 16000)
      --device <index>          Mic device index
      --stop-file <path>        Stop when this file appears
      --chunk-seconds <sec>     Emit finalized chunk WAV files and JSON events
      --chunk-overlap-seconds <sec> Total centered overlap between chunks
      --list-devices            List available audio input devices
      --help                    Show this help

    Outputs:
      mic.wav      - Microphone audio (when mode is mic or both)
      system.wav   - System audio (when mode is system or both)

    Send SIGINT (Ctrl-C) to stop recording.
    """
    print(usage)
}

func hasInputStreams(_ deviceID: AudioDeviceID) -> Bool {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyStreams,
        mScope: kAudioDevicePropertyScopeInput,
        mElement: kAudioObjectPropertyElementMain
    )
    var size: UInt32 = 0
    return AudioObjectGetPropertyDataSize(deviceID, &address, 0, nil, &size) == noErr
        && size >= MemoryLayout<AudioStreamID>.size
}

func defaultInputDevice() -> AudioDeviceID? {
    var deviceID: AudioDeviceID = 0
    var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultInputDevice,
        mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var size = UInt32(MemoryLayout<AudioDeviceID>.size)
    let status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &deviceID)
    return status == noErr ? deviceID : nil
}

func listDevices() {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDevices,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var size: UInt32 = 0
    AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size)
    let count = Int(size) / MemoryLayout<AudioDeviceID>.size
    var ids = [AudioDeviceID](repeating: 0, count: count)
    AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &ids)

    var defaultID: AudioDeviceID = 0
    var defAddr = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultInputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var defSize = UInt32(MemoryLayout<AudioDeviceID>.size)
    AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &defAddr, 0, nil, &defSize, &defaultID)

    var idx = 0
    for id in ids {
        guard hasInputStreams(id) else { continue }

        var nameAddr = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyDeviceNameCFString,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var name: CFString?
        var nameSize = UInt32(MemoryLayout<CFString?>.size)
        let nameStatus = withUnsafeMutablePointer(to: &name) {
            AudioObjectGetPropertyData(id, &nameAddr, 0, nil, &nameSize, $0)
        }

        let deviceName = nameStatus == noErr ? name as String? ?? "Unknown" : "Unknown"
        let def = id == defaultID ? " (default)" : ""
        print("  [\(idx)] \(deviceName)\(def)")
        idx += 1
    }
}

// MARK: - WAV Writer

func outputPathDirectory(_ path: String) -> String {
    return (path as NSString).deletingLastPathComponent
}

class WAVWriter {
    private let fileHandle: FileHandle
    private let filePath: String
    private let sampleRate: UInt32
    private let channels: UInt16
    private let bitsPerSample: UInt16
    private let chunker: AudioChunker?
    private var dataSize: UInt32 = 0

    init(path: String, sampleRate: UInt32, channels: UInt16 = 1, bitsPerSample: UInt16 = 16, chunker: AudioChunker? = nil) throws {
        self.filePath = path
        self.sampleRate = sampleRate
        self.channels = channels
        self.bitsPerSample = bitsPerSample
        self.chunker = chunker
        FileManager.default.createFile(atPath: path, contents: nil)
        self.fileHandle = try FileHandle(forWritingTo: URL(fileURLWithPath: path))
        writeHeader()
    }

    private func writeHeader() {
        var header = Data(count: 44)
        let byteRate = sampleRate * UInt32(channels) * UInt32(bitsPerSample / 8)
        let blockAlign = channels * (bitsPerSample / 8)

        header.replaceSubrange(0..<4, with: "RIFF".data(using: .ascii)!)
        header.replaceSubrange(4..<8, with: withUnsafeBytes(of: UInt32(0).littleEndian) { Data($0) })
        header.replaceSubrange(8..<12, with: "WAVE".data(using: .ascii)!)
        header.replaceSubrange(12..<16, with: "fmt ".data(using: .ascii)!)
        header.replaceSubrange(16..<20, with: withUnsafeBytes(of: UInt32(16).littleEndian) { Data($0) })
        header.replaceSubrange(20..<22, with: withUnsafeBytes(of: UInt16(1).littleEndian) { Data($0) })
        header.replaceSubrange(22..<24, with: withUnsafeBytes(of: channels.littleEndian) { Data($0) })
        header.replaceSubrange(24..<28, with: withUnsafeBytes(of: sampleRate.littleEndian) { Data($0) })
        header.replaceSubrange(28..<32, with: withUnsafeBytes(of: byteRate.littleEndian) { Data($0) })
        header.replaceSubrange(32..<34, with: withUnsafeBytes(of: blockAlign.littleEndian) { Data($0) })
        header.replaceSubrange(34..<36, with: withUnsafeBytes(of: bitsPerSample.littleEndian) { Data($0) })
        header.replaceSubrange(36..<40, with: "data".data(using: .ascii)!)
        header.replaceSubrange(40..<44, with: withUnsafeBytes(of: UInt32(0).littleEndian) { Data($0) })
        fileHandle.write(header)
    }

    func write(pcmBuffer: AVAudioPCMBuffer) {
        guard let floatData = pcmBuffer.floatChannelData else { return }
        let frameCount = Int(pcmBuffer.frameLength)
        var int16Data = Data(count: frameCount * 2)
        for i in 0..<frameCount {
            let sample = max(-1.0, min(1.0, floatData[0][i]))
            let int16 = Int16(sample * 32767.0)
            int16Data[i * 2] = UInt8(int16 & 0xFF)
            int16Data[i * 2 + 1] = UInt8((int16 >> 8) & 0xFF)
        }
        writeRaw(data: int16Data)
    }

    func writeRaw(data: Data) {
        fileHandle.write(data)
        dataSize += UInt32(data.count)
        chunker?.write(data: data)
    }

    func finalize() {
        chunker?.finish()
        let fileSize = dataSize + 36
        fileHandle.seek(toFileOffset: 4)
        fileHandle.write(withUnsafeBytes(of: fileSize.littleEndian) { Data($0) })
        fileHandle.seek(toFileOffset: 40)
        fileHandle.write(withUnsafeBytes(of: dataSize.littleEndian) { Data($0) })
        fileHandle.closeFile()
    }
}

// MARK: - Mic Recorder

final class MicRecorder: @unchecked Sendable {
    private var audioUnit: AudioUnit?
    private var writer: WAVWriter?
    private let sampleRate: Double
    private let requestedDevice: Int?
    private let chunkSeconds: Double?
    private let chunkOverlapSeconds: Double
    private var sourceFormat: AVAudioFormat?
    private var targetFormat: AVAudioFormat?
    private var converter: AVAudioConverter?
    private(set) var isRunning = false

    init(sampleRate: Double, deviceIndex: Int?, chunkSeconds: Double?, chunkOverlapSeconds: Double) {
        self.sampleRate = sampleRate
        self.requestedDevice = deviceIndex
        self.chunkSeconds = chunkSeconds
        self.chunkOverlapSeconds = chunkOverlapSeconds
    }

    private func selectedDevice() -> AudioDeviceID? {
        guard let idx = requestedDevice else { return defaultInputDevice() }
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var size: UInt32 = 0
        AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size)
        let count = Int(size) / MemoryLayout<AudioDeviceID>.size
        var ids = [AudioDeviceID](repeating: 0, count: count)
        AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &ids)

        let inputDevices = ids.filter(hasInputStreams)

        guard idx >= 0, idx < inputDevices.count else {
            print("  warning: device index \(idx) out of range, using default")
            return nil
        }
        print("  mic device set to index \(idx)")
        return inputDevices[idx]
    }

    func start(outputPath: String) throws {
        let unit = try makeAudioUnit()
        let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1)!
        let chunker = AudioChunker(source: "mic", outputDir: outputPathDirectory(outputPath), sampleRate: UInt32(sampleRate), seconds: chunkSeconds, overlapSeconds: chunkOverlapSeconds)
        do {
            let source = try configure(unit, device: selectedDevice())
            writer = try WAVWriter(path: outputPath, sampleRate: UInt32(sampleRate), channels: 1, chunker: chunker)
            audioUnit = unit
            sourceFormat = source
            targetFormat = format
            converter = AVAudioConverter(from: source, to: format)
            try require(AudioUnitInitialize(unit), "initialize microphone")
            try require(AudioOutputUnitStart(unit), "start microphone")
            isRunning = true
        } catch {
            AudioComponentInstanceDispose(unit)
            throw error
        }
    }

    func restart() throws {
        guard let audioUnit else { throw captureError("microphone is unavailable") }
        try require(AudioOutputUnitStart(audioUnit), "restart microphone")
        isRunning = true
    }

    func verifyRunning() throws {
        guard isRunning else { throw captureError("microphone capture stopped during startup") }
    }

    func stop() {
        if let audioUnit {
            AudioOutputUnitStop(audioUnit)
            AudioUnitUninitialize(audioUnit)
            AudioComponentInstanceDispose(audioUnit)
        }
        audioUnit = nil
        isRunning = false
        writer?.finalize()
        writer = nil
        converter = nil
    }

    private func makeAudioUnit() throws -> AudioUnit {
        var description = AudioComponentDescription(componentType: kAudioUnitType_Output,
            componentSubType: kAudioUnitSubType_HALOutput, componentManufacturer: kAudioUnitManufacturer_Apple,
            componentFlags: 0, componentFlagsMask: 0)
        guard let component = AudioComponentFindNext(nil, &description) else { throw captureError("microphone component unavailable") }
        var unit: AudioUnit?
        try require(AudioComponentInstanceNew(component, &unit), "create microphone")
        guard let unit else { throw captureError("microphone component unavailable") }
        return unit
    }

    private func configure(_ unit: AudioUnit, device: AudioDeviceID?) throws -> AVAudioFormat {
        var enabled: UInt32 = 1
        var disabled: UInt32 = 0
        try require(AudioUnitSetProperty(unit, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Input, 1,
            &enabled, UInt32(MemoryLayout.size(ofValue: enabled))), "enable microphone input")
        try require(AudioUnitSetProperty(unit, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Output, 0,
            &disabled, UInt32(MemoryLayout.size(ofValue: disabled))), "disable microphone output")
        if var device {
            try require(AudioUnitSetProperty(unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0,
                &device, UInt32(MemoryLayout.size(ofValue: device))), "select microphone")
        }
        let format = try nativeFormat(unit)
        var stream = format.streamDescription.pointee
        try require(AudioUnitSetProperty(unit, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Output, 1,
            &stream, UInt32(MemoryLayout.size(ofValue: stream))), "set microphone format")
        var callback = AURenderCallbackStruct(inputProc: Self.inputCallback,
            inputProcRefCon: Unmanaged.passUnretained(self).toOpaque())
        try require(AudioUnitSetProperty(unit, kAudioOutputUnitProperty_SetInputCallback, kAudioUnitScope_Global, 0,
            &callback, UInt32(MemoryLayout.size(ofValue: callback))), "install microphone callback")
        return format
    }

    private func nativeFormat(_ unit: AudioUnit) throws -> AVAudioFormat {
        var stream = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout.size(ofValue: stream))
        try require(AudioUnitGetProperty(unit, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Input, 1,
            &stream, &size), "read microphone format")
        let channels = max(1, stream.mChannelsPerFrame)
        guard let format = AVAudioFormat(standardFormatWithSampleRate: stream.mSampleRate, channels: channels) else {
            throw captureError("microphone format unavailable")
        }
        return format
    }

    private static let inputCallback: AURenderCallback = { ref, flags, time, _, frames, _ in
        Unmanaged<MicRecorder>.fromOpaque(ref).takeUnretainedValue().capture(flags, time, frames)
    }

    private func capture(_ flags: UnsafeMutablePointer<AudioUnitRenderActionFlags>,
                         _ time: UnsafePointer<AudioTimeStamp>, _ frames: UInt32) -> OSStatus {
        guard let audioUnit, let sourceFormat,
              let buffer = AVAudioPCMBuffer(pcmFormat: sourceFormat, frameCapacity: frames) else { return -1 }
        buffer.frameLength = frames
        let status = AudioUnitRender(audioUnit, flags, time, 1, frames, buffer.mutableAudioBufferList)
        if status == noErr { writeConverted(buffer) }
        return status
    }

    private func writeConverted(_ input: AVAudioPCMBuffer) {
        guard let converter, let targetFormat else { return }
        let ratio = targetFormat.sampleRate / input.format.sampleRate
        let capacity = AVAudioFrameCount(Double(input.frameLength) * ratio) + 1
        guard let output = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: capacity) else { return }
        var error: NSError?
        nonisolated(unsafe) let converterInput = input
        nonisolated(unsafe) var consumed = false
        converter.convert(to: output, error: &error) { _, status in
            guard !consumed else { status.pointee = .noDataNow; return nil }
            consumed = true
            status.pointee = .haveData
            return converterInput
        }
        if error == nil && output.frameLength > 0 { writer?.write(pcmBuffer: output) }
    }

    private func require(_ status: OSStatus, _ operation: String) throws {
        if status != noErr { throw captureError("\(operation) failed (CoreAudio \(status))") }
    }

    private func captureError(_ message: String) -> NSError {
        NSError(domain: "GappdCapture", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}

// MARK: - System Audio Recorder

// install runs before capture; write and finalize run only on sampleQueue.
private final class SystemWriterState: @unchecked Sendable {
    private var writer: WAVWriter?

    func install(_ writer: WAVWriter) { self.writer = writer }
    func write(_ data: Data) { writer?.writeRaw(data: data) }

    func finalize() {
        let writer = writer
        self.writer = nil
        writer?.finalize()
    }
}

class SystemAudioRecorder: NSObject, SCStreamOutput {
    private var stream: SCStream?
    private let writerState = SystemWriterState()
    private let sampleRate: Double
    private let chunkSeconds: Double?
    private let chunkOverlapSeconds: Double
    private let sampleQueue = DispatchQueue(label: "dev.gappd.capture.system-audio")

    init(sampleRate: Double, chunkSeconds: Double?, chunkOverlapSeconds: Double) {
        self.sampleRate = sampleRate
        self.chunkSeconds = chunkSeconds
        self.chunkOverlapSeconds = chunkOverlapSeconds
    }

    @MainActor
    func start(outputPath: String) async throws {
        let chunker = AudioChunker(source: "system", outputDir: outputPathDirectory(outputPath), sampleRate: UInt32(sampleRate), seconds: chunkSeconds, overlapSeconds: chunkOverlapSeconds)
        let writer = try WAVWriter(path: outputPath, sampleRate: UInt32(sampleRate), channels: 1, chunker: chunker)
        writerState.install(writer)

        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)

        let display = content.displays.first!
        let filter = SCContentFilter(display: display, excludingWindows: [])

        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.sampleRate = Int(sampleRate)
        config.channelCount = 1
        config.excludesCurrentProcessAudio = true

        stream = SCStream(filter: filter, configuration: config, delegate: nil)
        try stream!.addStreamOutput(self, type: .audio, sampleHandlerQueue: sampleQueue)
        try await stream!.startCapture()
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio else { return }
        guard let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else { return }

        let length = CMBlockBufferGetDataLength(blockBuffer)
        var data = Data(count: length)
        _ = data.withUnsafeMutableBytes { ptr in
            CMBlockBufferCopyDataBytes(blockBuffer, atOffset: 0, dataLength: length, destination: ptr.baseAddress!)
        }

        convertAndWrite(data: data, sampleBuffer: sampleBuffer)
    }

    private func convertAndWrite(data: Data, sampleBuffer: CMSampleBuffer) {
        guard let formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer) else { return }
        guard let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc) else { return }

        let isFloat = asbd.pointee.mFormatFlags & kAudioFormatFlagIsFloat != 0
        let bytesPerSample = Int(asbd.pointee.mBitsPerChannel / 8)
        let numChannels = Int(asbd.pointee.mChannelsPerFrame)
        let numFrames = data.count / (bytesPerSample * numChannels)

        var int16Data = Data(count: numFrames * 2)

        data.withUnsafeBytes { rawPtr in
            if isFloat && bytesPerSample == 4 {
                let floatPtr = rawPtr.bindMemory(to: Float.self)
                for i in 0..<numFrames {
                    let sample = max(-1.0, min(1.0, floatPtr[i * numChannels]))
                    let int16 = Int16(sample * 32767.0)
                    int16Data[i * 2] = UInt8(int16 & 0xFF)
                    int16Data[i * 2 + 1] = UInt8((int16 >> 8) & 0xFF)
                }
            } else if isFloat && bytesPerSample == 8 {
                let doublePtr = rawPtr.bindMemory(to: Float64.self)
                for i in 0..<numFrames {
                    let sample = max(-1.0, min(1.0, Float(doublePtr[i * numChannels])))
                    let int16 = Int16(sample * 32767.0)
                    int16Data[i * 2] = UInt8(int16 & 0xFF)
                    int16Data[i * 2 + 1] = UInt8((int16 >> 8) & 0xFF)
                }
            } else if !isFloat && bytesPerSample == 2 {
                let int16Ptr = rawPtr.bindMemory(to: Int16.self)
                for i in 0..<numFrames {
                    let val = int16Ptr[i * numChannels]
                    int16Data[i * 2] = UInt8(val & 0xFF)
                    int16Data[i * 2 + 1] = UInt8((val >> 8) & 0xFF)
                }
            }
        }

        writerState.write(int16Data)
    }

    @MainActor
    func stop() async throws {
        var stopError: Error?
        do { try await stream?.stopCapture() } catch { stopError = error }
        let state = writerState
        await withCheckedContinuation { continuation in
            sampleQueue.async {
                state.finalize()
                continuation.resume()
            }
        }
        if let stopError { throw stopError }
    }
}

// MARK: - Permission Checks

func stderrPrint(_ message: String) {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
}

@MainActor
func requestPermissionsAndExit(outputPath: String? = nil) {
    let micBefore = AVCaptureDevice.authorizationStatus(for: .audio)
    let micAfter = requestMicrophoneAccessIfNeeded(micBefore)
    let screenBefore = CGPreflightScreenCaptureAccess()
    if !screenBefore { _ = CGRequestScreenCaptureAccess() }
    let screenAfter = CGPreflightScreenCaptureAccess()

    let json = permissionJSON(micBefore: micBefore, micAfter: micAfter, screenBefore: screenBefore, screenAfter: screenAfter)
    if let path = outputPath {
        try? json.write(toFile: path, atomically: true, encoding: .utf8)
    } else {
        print(json)
    }
    exit(micAfter == .authorized && screenAfter ? 0 : 126)
}

func permissionJSON(micBefore: AVAuthorizationStatus, micAfter: AVAuthorizationStatus, screenBefore: Bool, screenAfter: Bool) -> String {
    let micStr = micAfter == .authorized ? "granted" : "denied"
    let screenStr = screenAfter ? "granted" : "denied"
    let screenBeforeStr = screenBefore ? "granted" : "denied"
    let screenAfterStr = screenAfter ? "granted" : "denied"
    return "{\"microphone\":\"\(micStr)\",\"screen\":\"\(screenStr)\",\"microphoneStatusBefore\":\"\(authorizationName(micBefore))\",\"microphoneStatusAfter\":\"\(authorizationName(micAfter))\",\"screenStatusBefore\":\"\(screenBeforeStr)\",\"screenStatusAfter\":\"\(screenAfterStr)\"}"
}

func authorizationName(_ status: AVAuthorizationStatus) -> String {
    switch status {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .notDetermined: return "notDetermined"
    case .restricted: return "restricted"
    @unknown default: return "unknown"
    }
}

@MainActor
func requestMicrophoneAccessIfNeeded(_ status: AVAuthorizationStatus) -> AVAuthorizationStatus {
    guard status == .notDetermined else { return status }
    activateForPermissionPrompt()
    let finished = DispatchSemaphore(value: 0)
    AVCaptureDevice.requestAccess(for: .audio) { _ in finished.signal() }
    while finished.wait(timeout: .now()) == .timedOut {
        RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.1))
    }
    return AVCaptureDevice.authorizationStatus(for: .audio)
}

@MainActor
func activateForPermissionPrompt() {
    NSApplication.shared.setActivationPolicy(.accessory)
    NSApp.activate(ignoringOtherApps: true)
}

@MainActor
func checkMicPermission() {
    let status = AVCaptureDevice.authorizationStatus(for: .audio)
    switch status {
    case .authorized:
        return
    case .notDetermined:
        if requestMicrophoneAccessIfNeeded(status) != .authorized {
            stderrPrint("error: Microphone access denied.\n  Grant permission: System Settings → Privacy & Security → Microphone → enable GappdCapture")
            exit(126)
        }
    case .denied, .restricted:
        stderrPrint("error: Microphone access denied.\n  Grant permission: System Settings → Privacy & Security → Microphone → enable GappdCapture")
        exit(126)
    @unknown default:
        return
    }
}

func checkScreenRecordingPermission() {
    if CGPreflightScreenCaptureAccess() { return }
    _ = CGRequestScreenCaptureAccess()
    stderrPrint("error: Screen & System Audio Recording access required for system audio capture.\n  A System Settings window should have opened — enable GappdCapture, then re-run.\n  Manual path: System Settings → Privacy & Security → Screen & System Audio Recording → enable GappdCapture")
    exit(126)
}

func watchStopFile(_ path: String, stopSemaphore: DispatchSemaphore) {
    DispatchQueue.global().async {
        while true {
            if FileManager.default.fileExists(atPath: path) { stopSemaphore.signal(); return }
            Thread.sleep(forTimeInterval: 0.25)
        }
    }
}

// MARK: - Main

if CommandLine.arguments.contains("--observe-meetings") {
    runMeetingObserver()
}

let config = parseArgs()

if config.mode == .mic || config.mode == .both {
    checkMicPermission()
}

if config.mode == .system || config.mode == .both {
    checkScreenRecordingPermission()
}

let micRecorder: MicRecorder? = (config.mode == .mic || config.mode == .both)
    ? MicRecorder(sampleRate: config.sampleRate, deviceIndex: config.deviceIndex, chunkSeconds: config.chunkSeconds,
        chunkOverlapSeconds: config.chunkOverlapSeconds) : nil

let systemRecorder: SystemAudioRecorder? = (config.mode == .system || config.mode == .both)
    ? SystemAudioRecorder(sampleRate: config.sampleRate, chunkSeconds: config.chunkSeconds,
        chunkOverlapSeconds: config.chunkOverlapSeconds) : nil

let stopSemaphore = DispatchSemaphore(value: 0)

let sigintSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
signal(SIGINT, SIG_IGN)
sigintSource.setEventHandler {
    stopSemaphore.signal()
}
sigintSource.resume()

if let stopFile = config.stopFile {
    watchStopFile(stopFile, stopSemaphore: stopSemaphore)
}

Task { @MainActor in
    if let sys = systemRecorder {
        let sysPath = (config.outputDir as NSString).appendingPathComponent("system.wav")
        do {
            try await sys.start(outputPath: sysPath)
            print("● System audio recording to \(sysPath)")
        } catch {
            stderrPrint("error: could not start system audio capture: \(error)")
            exit(1)
        }
    }

    if let mic = micRecorder {
        let micPath = (config.outputDir as NSString).appendingPathComponent("mic.wav")
        do {
            try mic.start(outputPath: micPath)
            try await Task.sleep(nanoseconds: 250_000_000)
            if !mic.isRunning {
                try mic.restart()
                try await Task.sleep(nanoseconds: 250_000_000)
            }
            try mic.verifyRunning()
            print("● Mic recording to \(micPath)")
        } catch {
            stderrPrint("error: could not start microphone capture: \(error)")
            exit(1)
        }
    }

    emitCaptureReady(sources: captureSources(config.mode))
    DispatchQueue.global().async {
        stopSemaphore.wait()
        Task { @MainActor in
            emitCaptureStopAcknowledged()
            print("\n● Stopping...")
            micRecorder?.stop()
            do {
                try await systemRecorder?.stop()
                if config.chunkSeconds != nil {
                    emitAudioChunkStreamComplete(sources: captureSources(config.mode))
                }
                print("● Capture stopped")
                exit(0)
            } catch {
                stderrPrint("error: could not stop system audio capture cleanly: \(error)")
                exit(1)
            }
        }
    }
}

dispatchMain()
