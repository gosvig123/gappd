# Disposable screen-video feasibility probe

**Throwaway branch.** No production capture code belongs here. The corresponding local Wayfinder ticket is `.scratch/optional-screen-video/issues/02-prove-native-video-capture-fit.md` in the working tree.

Run `./prototype-picker-check.sh window|display|cancel|close-window` on macOS 26 with Swift, `ffprobe`, and a person present to choose a **non-sensitive** source. The script compiles a temporary app under `/tmp/GappdVideoProbe.app`, saves output under `/tmp/gappd-video-probe.*`, and does not grant permissions or select sources automatically.

Observed on macOS 26.6.2 (2026-09-27):

- Window and display selection each finalized a playable 1280×720 H.264 movie of about five seconds; cancelling created none.
- Closing the selected window finalized a movie early, at 4.76 seconds of a planned 15-second recording. The production app must report the early video end while leaving audio running.
- The original prototype crashed at source selection because its main-actor-isolated picker delegate was called from ScreenCaptureKit's XPC queue. The nonisolated delegate in this branch fixes the probe bug.
- Existing `GappdCapture.app` audio capture wrote microphone and system WAVs and emitted live audio chunks while this separate process recorded video. This favors **a separate video helper process**, so a video crash cannot terminate audio capture.
- A disposable packaged Electron 43 app loaded and sought the H.264 `.mov`. That app was not the Gappd Meeting UI.
- `ffmpeg` combined the short movie and two existing WAV inputs into a playable H.264/AAC file. This only proves container composition; its file-time-based offsets do not prove exact Meeting synchronization. Do not add `ffmpeg` as a production dependency on this evidence.

Open acceptance risks: real Gappd packaging/permission attribution; transcript consumption of concurrent chunks; exact shared time origin for replay/export; safe quit and movie-finalization timeout; video failure presentation. Resolve them in the release-safeguards decision and implementation acceptance checks.
