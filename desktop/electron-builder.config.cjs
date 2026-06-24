const hooks = require('./scripts/electron-builder-hooks.cjs')

const MACOS_MINIMUM_SYSTEM_VERSION = '14.0'
const MAC_SIGNING_IDENTITY = process.env.APPLE_SIGNING_IDENTITY || process.env.CSC_NAME || '-'
const MAC_BUNDLE_SHORT_VERSION = process.env.GAPPD_BUNDLE_SHORT_VERSION
const MAC_BUILD_VERSION = process.env.GAPPD_BUILD_VERSION

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'dev.gappd.desktop',
  productName: 'Gappd',
  buildVersion: MAC_BUILD_VERSION,
  directories: {
    output: 'release',
  },
  files: ['dist/**', 'dist-electron/**'],
  extraResources: [
    { from: '../build/gappd', to: 'bin/gappd' },
    { from: '../build/GappdCapture.app', to: 'GappdCapture.app' },
    { from: 'resources/ollama', to: 'ollama' },
    { from: 'resources/whisper/whisper-cli', to: 'whisper/whisper-cli' },
  ],
  afterPack: hooks.afterPack,
  afterSign: hooks.afterSign,
  mac: {
    category: 'public.app-category.productivity',
    target: ['dmg'],
    bundleShortVersion: MAC_BUNDLE_SHORT_VERSION,
    minimumSystemVersion: MACOS_MINIMUM_SYSTEM_VERSION,
    identity: MAC_SIGNING_IDENTITY,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    extendInfo: {
      NSAudioCaptureUsageDescription: 'Gappd captures system audio to transcribe your meetings.',
      NSMicrophoneUsageDescription: 'Gappd captures your microphone to transcribe your voice.',
      NSScreenCaptureUsageDescription: 'Gappd uses screen capture to access system audio for meeting transcription.',
    },
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.inherit.plist',
  },
}
