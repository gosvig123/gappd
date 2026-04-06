import Foundation
import AVFoundation
import ScreenCaptureKit

enum CaptureMode: String {
    case mic, system, both
}

struct Config {
    let mode: CaptureMode
    let outputDir: String
    let sampleRate: Double
    let deviceIndex: Int?
}

func parseArgs() -> Config {
    var mode: CaptureMode = .both
    var outputDir = "."
    var sampleRate = 16000.0
    var deviceIndex: Int? = nil

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
        case "--list-devices":
            listDevices(); exit(0)
        case "--help":
            printUsage(); exit(0)
        default:
            break
        }
        i += 1
    }
    return Config(mode: mode, outputDir: outputDir, sampleRate: sampleRate, deviceIndex: deviceIndex)
}

func printUsage() {
    let usage = """
    grn-capture: Record mic and/or system audio

    Usage:
      grn-capture --mode <mic|system|both> --output-dir <path> [options]

    Options:
      --mode <mic|system|both>  Capture mode (default: both)
      --output-dir <path>       Directory for output files
      --sample-rate <hz>        Sample rate (default: 16000)
      --device <index>          Mic device index
      --list-devices            List available audio input devices
      --help                    Show this help

    Outputs:
      mic.wav      - Microphone audio (when mode is mic or both)
      system.wav   - System audio (when mode is system or both)

    Send SIGINT (Ctrl-C) to stop recording.
    """
    print(usage)
}

func listDevices() {
    let devices = AVCaptureDevice.DiscoverySession(
        deviceTypes: [.microphone, .external],
        mediaType: .audio,
        position: .unspecified
    ).devices
    for (i, device) in devices.enumerated() {
        let current = device.uniqueID == AVCaptureDevice.default(for: .audio)?.uniqueID ? " (default)" : ""
        print("  [\(i)] \(device.localizedName)\(current)")
    }
}

// MARK: - WAV Writer

class WAVWriter {
    private let fileHandle: FileHandle
    private let filePath: String
    private let sampleRate: UInt32
    private let channels: UInt16
    private let bitsPerSample: UInt16
    private var dataSize: UInt32 = 0

    init(path: String, sampleRate: UInt32, channels: UInt16 = 1, bitsPerSample: UInt16 = 16) throws {
        self.filePath = path
        self.sampleRate = sampleRate
        self.channels = channels
        self.bitsPerSample = bitsPerSample
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
        fileHandle.write(int16Data)
        dataSize += UInt32(int16Data.count)
    }

    func writeRaw(data: Data) {
        fileHandle.write(data)
        dataSize += UInt32(data.count)
    }

    func finalize() {
        let fileSize = dataSize + 36
        fileHandle.seek(toFileOffset: 4)
        fileHandle.write(withUnsafeBytes(of: fileSize.littleEndian) { Data($0) })
        fileHandle.seek(toFileOffset: 40)
        fileHandle.write(withUnsafeBytes(of: dataSize.littleEndian) { Data($0) })
        fileHandle.closeFile()
    }
}

// MARK: - Mic Recorder

class MicRecorder {
    private let engine = AVAudioEngine()
    private var writer: WAVWriter?
    private let sampleRate: Double

    init(sampleRate: Double, deviceIndex: Int?) {
        self.sampleRate = sampleRate
        if let idx = deviceIndex {
            setInputDevice(index: idx)
        }
    }

    private func setInputDevice(index: Int) {
        let devices = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.microphone, .external],
            mediaType: .audio,
            position: .unspecified
        ).devices
        guard index < devices.count else { return }

        let device = devices[index]
        if let audioID = audioDeviceID(for: device.uniqueID) {
            var deviceID = audioID
            let size = UInt32(MemoryLayout<AudioDeviceID>.size)
            let status = AudioUnitSetProperty(
                engine.inputNode.audioUnit!,
                kAudioOutputUnitProperty_CurrentDevice,
                kAudioUnitScope_Global, 0,
                &deviceID, size
            )
            if status != noErr {
                print("Warning: could not set input device (error \(status))")
            }
        }
    }

    private func audioDeviceID(for uid: String) -> AudioDeviceID? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyTranslateUIDToDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var cfUID: CFString = uid as CFString
        var deviceID: AudioDeviceID = 0
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        let status = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &address, UInt32(MemoryLayout<CFString>.size), &cfUID,
            &size, &deviceID
        )
        return status == noErr ? deviceID : nil
    }

    func start(outputPath: String) throws {
        let inputNode = engine.inputNode
        let hwFormat = inputNode.outputFormat(forBus: 0)
        let hwRate = UInt32(hwFormat.sampleRate)

        writer = try WAVWriter(
            path: outputPath,
            sampleRate: hwRate,
            channels: UInt16(hwFormat.channelCount)
        )

        inputNode.installTap(onBus: 0, bufferSize: 4096, format: hwFormat) { [weak self] buffer, _ in
            self?.writer?.write(pcmBuffer: buffer)
        }

        try engine.start()
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        writer?.finalize()
    }
}

// MARK: - System Audio Recorder

class SystemAudioRecorder: NSObject, SCStreamOutput {
    private var stream: SCStream?
    private var writer: WAVWriter?
    private let sampleRate: Double

    init(sampleRate: Double) {
        self.sampleRate = sampleRate
    }

    func start(outputPath: String) async throws {
        writer = try WAVWriter(path: outputPath, sampleRate: UInt32(sampleRate))

        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)

        let display = content.displays.first!
        let filter = SCContentFilter(display: display, excludingWindows: [])

        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.sampleRate = Int(sampleRate)
        config.channelCount = 1
        config.excludesCurrentProcessAudio = true

        stream = SCStream(filter: filter, configuration: config, delegate: nil)
        try stream!.addStreamOutput(self, type: .audio, sampleHandlerQueue: .global())
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
            }
        }

        writer?.writeRaw(data: int16Data)
    }

    func stop() async {
        try? await stream?.stopCapture()
        writer?.finalize()
    }
}

// MARK: - Main

let config = parseArgs()

let micRecorder: MicRecorder? = (config.mode == .mic || config.mode == .both)
    ? MicRecorder(sampleRate: config.sampleRate, deviceIndex: config.deviceIndex) : nil

let systemRecorder: SystemAudioRecorder? = (config.mode == .system || config.mode == .both)
    ? SystemAudioRecorder(sampleRate: config.sampleRate) : nil

let stopSemaphore = DispatchSemaphore(value: 0)

let sigintSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
signal(SIGINT, SIG_IGN)
sigintSource.setEventHandler {
    stopSemaphore.signal()
}
sigintSource.resume()

if let mic = micRecorder {
    let micPath = (config.outputDir as NSString).appendingPathComponent("mic.wav")
    do {
        try mic.start(outputPath: micPath)
        print("● Mic recording to \(micPath)")
    } catch {
        print("Error starting mic: \(error)")
        exit(1)
    }
}

if let sys = systemRecorder {
    let sysPath = (config.outputDir as NSString).appendingPathComponent("system.wav")
    let group = DispatchGroup()
    group.enter()
    Task {
        do {
            try await sys.start(outputPath: sysPath)
            print("● System audio recording to \(sysPath)")
        } catch {
            print("Error starting system audio: \(error)")
            exit(1)
        }
        group.leave()
    }
    group.wait()
}

print("● Recording... send SIGINT to stop")

DispatchQueue.global().async {
    stopSemaphore.wait()
    print("\n● Stopping...")
    micRecorder?.stop()
    let done = DispatchSemaphore(value: 0)
    Task {
        await systemRecorder?.stop()
        done.signal()
    }
    done.wait()
    print("● Capture stopped")
    exit(0)
}

dispatchMain()
