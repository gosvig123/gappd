# gappd — Private meeting intelligence for Mac

gappd records meetings, creates live transcripts, and turns conversations into
clear notes using local models. Audio, transcripts, and summaries stay on your
Mac by default.

[Join the Gappd Discord](https://discord.gg/Xap3vSNM4) for beta access, setup
help, bug reports, and roadmap discussion.

## What gappd does

- Detects supported meetings and prompts you to record.
- Captures microphone and system audio with macOS ScreenCaptureKit.
- Produces live transcripts with Apple SpeechTranscriber.
- Generates local meeting summaries through managed llama.cpp.
- Stores searchable meeting history in SQLite.
- Labels speakers with saved people and calendar suggestions, with short audio previews.
- Recovers interrupted recordings and helps stop recording when a meeting ends.
- Supports multiple transcription languages and optional launch at login.
- Downloads and manages required local models from the desktop app.

## How it works

```text
Meeting detected
      ↓
Record microphone + system audio
      ↓
Transcribe live with Apple SpeechTranscriber
      ↓
Generate notes with local llama.cpp model
      ↓
Save searchable meeting locally
```

No cloud inference account or model service key is required. Network access is
needed to download app updates and local model files.

## Requirements

- macOS 26 or newer
- Microphone, screen recording, and speech recognition permissions
- Internet access during first-time local model setup

## Get gappd

gappd is currently distributed as a beta. Join the
[Gappd Discord](https://discord.gg/Xap3vSNM4) for current download and setup
instructions.

On first launch, gappd checks permissions and prepares its managed local runtime.
Large model downloads can take several minutes.

## Develop locally

Prerequisites: Node.js 22.12.0 or newer, Go 1.25 or newer, CMake, tar, GitHub
network access, and Xcode Command Line Tools with Swift support.

```bash
git clone https://github.com/gappd-dev/gappd.git
cd gappd
npm run desktop:bootstrap
npm run desktop:dev
```

Bootstrap installs desktop dependencies, checks macOS prerequisites, downloads
llama.cpp, and builds the Go, capture, and speech-transcription artifacts.

Useful commands:

```bash
npm run desktop:typecheck   # Check desktop TypeScript
npm run desktop:build       # Build renderer, native artifacts, and Electron main
npm run desktop:dist:dir    # Package an unpacked macOS app
go test ./...               # Check Go packages
```

## Architecture

```text
Electron desktop
  ├── Swift capture and meeting observer
  ├── Apple SpeechTranscriber
  └── Go meeting engine
        ├── SQLite meeting history
        └── llama.cpp summary pipeline
```

More detail:

- [Architecture](docs/architecture.md)
- [macOS releases](docs/desktop-macos-release.md)
- [Speaker labeling](docs/speaker-labeling.md)

## License

MIT
