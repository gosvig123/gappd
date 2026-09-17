const hooks = require('./scripts/electron-builder-hooks.cjs')

const MACOS_MINIMUM_SYSTEM_VERSION = '26.0'
const MAC_SIGNING_IDENTITY = process.env.APPLE_SIGNING_IDENTITY || process.env.CSC_NAME || '-'
const MAC_BUNDLE_SHORT_VERSION = process.env.GAPPD_BUNDLE_SHORT_VERSION
const MAC_BUILD_VERSION = process.env.GAPPD_BUILD_VERSION

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'dev.gappd.desktop',
  productName: 'Gappd',
  protocols: [{ name: 'Gappd', schemes: ['gappd'] }],
  buildVersion: MAC_BUILD_VERSION,
  directories: {
    output: 'release',
  },
  publish: [{ provider: 'github', owner: 'gosvig123', repo: 'gappd' }],
  files: ['dist/**', 'dist-electron/**'],
  extraResources: [
    { from: '../build/gappd', to: 'bin/gappd' },
    { from: '../build/gappd-diarizer', to: 'bin/gappd-diarizer' },
    { from: '../gappd-diarizer/models', to: 'diarization-models' },
    { from: '../gappd-diarizer/legal', to: 'legal' },
    { from: '../build/GappdSpeechTranscriber.app', to: 'GappdSpeechTranscriber.app' },
    { from: '../build/GappdCapture.app', to: 'GappdCapture.app' },
    { from: 'resources/llamacpp', to: 'llamacpp' },
  ],
  afterPack: hooks.afterPack,
  afterSign: hooks.afterSign,
  mac: {
    icon: 'assets/app-icon.icns',
    category: 'public.app-category.productivity',
    target: ['dmg', 'zip'],
    bundleShortVersion: MAC_BUNDLE_SHORT_VERSION,
    minimumSystemVersion: MACOS_MINIMUM_SYSTEM_VERSION,
    identity: MAC_SIGNING_IDENTITY,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    // notarize-mac-build.cjs owns notarization in the afterSign hook. Disable the built-in
    // @electron/notarize step so each app is notarized and stapled once, and so local builds
    // never submit to Apple just because Apple credentials are present in the environment.
    notarize: false,
    extendInfo: {
      NSAudioCaptureUsageDescription: 'Gappd captures system audio to transcribe your meetings.',
      NSMicrophoneUsageDescription: 'Gappd captures your microphone to transcribe your voice.',
      NSScreenCaptureUsageDescription: 'Gappd uses screen capture to access system audio for meeting transcription.',
      NSSpeechRecognitionUsageDescription: 'Gappd uses on-device Apple Speech to transcribe meeting audio.',
    },
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.inherit.plist',
  },
}
