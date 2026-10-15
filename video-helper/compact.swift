import AVFoundation
import CoreMedia

enum CompactError: Error { case noVideo, unreadable, unwritable, durationChanged }

/// Encodes a finished Screen video again as HEVC at a fixed quality.
/// ScreenCaptureKit picks one bitrate for any codec, so a quality target, not the codec, makes the movie smaller.
/// The movie timeline stays identical, so replay and export keep their measured start times.
enum Compactor {
    static let quality = 0.65

    /// Returns false when the source is already HEVC and needs no work.
    nonisolated static func compact(source: URL, destination: URL) async throws -> Bool {
        let asset = AVURLAsset(url: source)
        guard let track = try await asset.loadTracks(withMediaType: .video).first else { throw CompactError.noVideo }
        let (formats, size, transform, timescale) = try await track.load(.formatDescriptions, .naturalSize, .preferredTransform, .naturalTimeScale)
        guard let format = formats.first else { throw CompactError.noVideo }
        if CMFormatDescriptionGetMediaSubType(format) == kCMVideoCodecType_HEVC { return false }
        let duration = try await asset.load(.duration)

        let reader = try AVAssetReader(asset: asset)
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange])
        output.alwaysCopiesSampleData = false
        reader.add(output)
        let writer = try AVAssetWriter(outputURL: destination, fileType: .mov)
        var settings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.hevc,
            AVVideoWidthKey: Int(size.width),
            AVVideoHeightKey: Int(size.height),
            AVVideoCompressionPropertiesKey: [AVVideoQualityKey: quality],
        ]
        if let colors = colorProperties(format) { settings[AVVideoColorPropertiesKey] = colors }
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
        input.transform = transform
        input.mediaTimeScale = timescale
        input.expectsMediaDataInRealTime = false
        writer.add(input)

        guard reader.startReading() else { throw reader.error ?? CompactError.unreadable }
        guard writer.startWriting() else { throw writer.error ?? CompactError.unwritable }
        writer.startSession(atSourceTime: .zero)
        while let sample = output.copyNextSampleBuffer() {
            while !input.isReadyForMoreMediaData { try await Task.sleep(for: .milliseconds(5)) }
            guard input.append(sample) else { throw writer.error ?? CompactError.unwritable }
        }
        guard reader.status == .completed else { throw reader.error ?? CompactError.unreadable }
        input.markAsFinished()
        writer.endSession(atSourceTime: duration)
        await writer.finishWriting()
        guard writer.status == .completed else { throw writer.error ?? CompactError.unwritable }

        let written = try await AVURLAsset(url: destination).load(.duration)
        guard abs(CMTimeGetSeconds(written) - CMTimeGetSeconds(duration)) < 0.1 else { throw CompactError.durationChanged }
        return true
    }

    /// Copies the source colour tags so the new movie does not shift colours.
    private static func colorProperties(_ format: CMFormatDescription) -> [String: String]? {
        let keys = [
            (kCMFormatDescriptionExtension_ColorPrimaries, AVVideoColorPrimariesKey),
            (kCMFormatDescriptionExtension_TransferFunction, AVVideoTransferFunctionKey),
            (kCMFormatDescriptionExtension_YCbCrMatrix, AVVideoYCbCrMatrixKey),
        ]
        var colors: [String: String] = [:]
        for (extensionKey, settingKey) in keys {
            guard let value = CMFormatDescriptionGetExtension(format, extensionKey: extensionKey) as? String else { return nil }
            colors[settingKey] = value
        }
        return colors
    }
}
