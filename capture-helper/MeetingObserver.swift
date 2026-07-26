import Foundation
import CoreAudio
import CoreGraphics

private struct MeetingActivity: Encodable {
    let provider: String
    let title: String
    let key: String
    let source = "native"
}

private struct MeetingSnapshot: Encodable {
    let meetings: [MeetingActivity]
}

private struct MeetingApp {
    let bundlePrefixes: [String]
    let provider: String
    let title: String
    let windowOwner: String?
}

private struct AudioActivity {
    let bundleID: String
    let input: Bool
    let output: Bool
}

private let observerInterval = 2.0
private let supportedApps = [
    MeetingApp(bundlePrefixes: ["com.google.Chrome"], provider: "Browser", title: "Google Chrome call", windowOwner: "Google Chrome"),
    MeetingApp(bundlePrefixes: ["com.apple.Safari", "com.apple.WebKit.WebContent"], provider: "Browser", title: "Safari call", windowOwner: "Safari"),
    MeetingApp(bundlePrefixes: ["org.mozilla.firefox"], provider: "Browser", title: "Firefox call", windowOwner: "Firefox"),
    MeetingApp(bundlePrefixes: ["com.microsoft.edgemac"], provider: "Browser", title: "Microsoft Edge call", windowOwner: "Microsoft Edge"),
    MeetingApp(bundlePrefixes: ["com.brave.Browser"], provider: "Browser", title: "Brave call", windowOwner: "Brave Browser"),
    MeetingApp(bundlePrefixes: ["company.thebrowser.Browser"], provider: "Browser", title: "Arc call", windowOwner: "Arc"),
    MeetingApp(bundlePrefixes: ["com.operasoftware.Opera"], provider: "Browser", title: "Opera call", windowOwner: "Opera"),
    MeetingApp(bundlePrefixes: ["com.vivaldi.Vivaldi"], provider: "Browser", title: "Vivaldi call", windowOwner: "Vivaldi"),
    MeetingApp(bundlePrefixes: ["us.zoom.xos"], provider: "Zoom", title: "Zoom call", windowOwner: nil),
    MeetingApp(bundlePrefixes: ["com.microsoft.teams"], provider: "Microsoft Teams", title: "Microsoft Teams call", windowOwner: nil),
    MeetingApp(bundlePrefixes: ["Cisco-Systems.Spark", "com.cisco.webex"], provider: "Webex", title: "Webex call", windowOwner: nil),
    MeetingApp(bundlePrefixes: ["com.tinyspeck.slackmacgap"], provider: "Slack Huddle", title: "Slack Huddle", windowOwner: nil),
    MeetingApp(bundlePrefixes: ["com.apple.FaceTime"], provider: "FaceTime", title: "FaceTime call", windowOwner: nil),
]

func runMeetingObserver() -> Never {
    let encoder = JSONEncoder()
    while true {
        emit(MeetingSnapshot(meetings: activeMeetingActivities()), encoder: encoder)
        Thread.sleep(forTimeInterval: observerInterval)
    }
}

private func emit(_ snapshot: MeetingSnapshot, encoder: JSONEncoder) {
    guard let data = try? encoder.encode(snapshot), let line = String(data: data, encoding: .utf8) else { return }
    print(line)
    fflush(stdout)
}

private func activeMeetingActivities() -> [MeetingActivity] {
    let audio = audioActivities()
    let windows = visibleWindows()
    let microphoneApps = audio.filter(\.input).compactMap { supportedApp($0.bundleID) }
    let mutedBrowserApps = browserAppsWithOutput(audio).filter { hasVisibleMeetingWindow($0, windows: windows) }
    var seen = Set<String>()
    return (microphoneApps + mutedBrowserApps).map(meetingActivity).filter { seen.insert($0.key).inserted }
}

private func browserAppsWithOutput(_ audio: [AudioActivity]) -> [MeetingApp] {
    return audio.filter(\.output).compactMap { activity in
        guard let app = supportedApp(activity.bundleID), app.windowOwner != nil else { return nil }
        return app
    }
}

private func hasVisibleMeetingWindow(_ app: MeetingApp, windows: [(owner: String, title: String)]) -> Bool {
    guard let owner = app.windowOwner else { return false }
    return windows.contains { window in window.owner == owner && meetingWindowTitle(window.title) }
}

private func visibleWindows() -> [(owner: String, title: String)] {
    let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else { return [] }
    return windows.compactMap { window in
        guard let owner = window[kCGWindowOwnerName as String] as? String,
              let title = window[kCGWindowName as String] as? String else { return nil }
        return (owner, title)
    }
}

private func meetingWindowTitle(_ title: String) -> Bool {
    let value = title.lowercased()
    return value.contains("google meet") || value.contains("microsoft teams") ||
        value.contains("zoom meeting") || value.contains("webex") || value.contains("slack huddle")
}

private func meetingActivity(_ app: MeetingApp) -> MeetingActivity {
    return MeetingActivity(provider: app.provider, title: app.title, key: "native:\(app.title)")
}

private func supportedApp(_ bundleID: String) -> MeetingApp? {
    return supportedApps.first { app in app.bundlePrefixes.contains { bundleID.hasPrefix($0) } }
}

private func audioActivities() -> [AudioActivity] {
    return audioProcessObjects().compactMap { object in
        guard let bundleID = audioBundleID(object) else { return nil }
        return AudioActivity(
            bundleID: bundleID,
            input: audioProperty(object, kAudioProcessPropertyIsRunningInput) == 1,
            output: audioProperty(object, kAudioProcessPropertyIsRunningOutput) == 1
        )
    }
}

private func audioBundleID(_ object: AudioObjectID) -> String? {
    var address = propertyAddress(kAudioProcessPropertyBundleID)
    var value: CFString?
    var size = UInt32(MemoryLayout<CFString?>.size)
    let status = withUnsafeMutablePointer(to: &value) {
        AudioObjectGetPropertyData(object, &address, 0, nil, &size, $0)
    }
    return status == noErr ? value as String? : nil
}

private func audioProcessObjects() -> [AudioObjectID] {
    var address = propertyAddress(kAudioHardwarePropertyProcessObjectList)
    var size: UInt32 = 0
    let system = AudioObjectID(kAudioObjectSystemObject)
    guard AudioObjectGetPropertyDataSize(system, &address, 0, nil, &size) == noErr else { return [] }
    var objects = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(system, &address, 0, nil, &size, &objects) == noErr else { return [] }
    return objects
}

private func audioProperty(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> UInt32? {
    var address = propertyAddress(selector)
    var value: UInt32 = 0
    var size = UInt32(MemoryLayout<UInt32>.size)
    return AudioObjectGetPropertyData(object, &address, 0, nil, &size, &value) == noErr ? value : nil
}

private func propertyAddress(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
    return AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
}
