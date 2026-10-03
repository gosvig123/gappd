// Development runtime-asset contract. `npm run dev:prepare` writes build/runtime-assets.json after it
// builds and verifies the native assets; `npm run dev:start` runs this file to fail fast before launch.
// Packaged apps never read this file: they resolve only their own bundled resources.
import { constants } from 'node:fs'
import { access, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEV_RUNTIME_ASSETS_SCHEMA = 1
const MANIFEST_PATH = ['build', 'runtime-assets.json']
const RECOVERY = 'Run `npm run dev:prepare` in desktop/.'

// Repo-relative paths that the dev desktop resolves at run time (src/main/native-runtime.ts, llamacpp.ts).
export function devRuntimeAssets(platform = process.platform) {
  const assets = [{ name: 'Gappd backend', path: 'build/gappd', executable: true }]
  if (platform !== 'darwin') return assets
  return assets.concat([
    { name: 'Capture helper', path: 'build/GappdCapture.app/Contents/MacOS/gappd-capture', executable: true },
    { name: 'Apple speech transcriber', path: 'build/GappdSpeechTranscriber.app/Contents/MacOS/apple-speech-transcriber', executable: true },
    { name: 'Video helper', path: 'build/GappdVideo.app/Contents/MacOS/gappd-video', executable: true },
    { name: 'Recording export helper', path: 'build/gappd-export', executable: true },
    { name: 'Diarization helper', path: 'build/gappd-diarizer', executable: true },
    { name: 'Diarization models', path: 'gappd-diarizer/models/speaker-diarization/SHA256SUMS', executable: false },
    { name: 'Bundled llama.cpp runtime', path: 'desktop/resources/llamacpp/llama-server', executable: true },
  ])
}

export async function writeDevRuntimeAssets(repoRoot, build, platform = process.platform) {
  const assets = devRuntimeAssets(platform)
  const missing = await missingAssets(repoRoot, assets)
  if (missing) throw new Error(missing)
  const manifest = { schema: DEV_RUNTIME_ASSETS_SCHEMA, macBuildProfile: build.macBuildProfile, macosMinVersion: build.macosMinVersion, assets }
  await writeFile(path.join(repoRoot, ...MANIFEST_PATH), `${JSON.stringify(manifest, null, 2)}\n`)
}

/** Returns null when development assets are ready, or an actionable error message. */
export async function checkDevRuntimeAssets(repoRoot, platform = process.platform) {
  const manifestPath = path.join(...MANIFEST_PATH)
  let manifest
  try {
    manifest = JSON.parse(await readFile(path.join(repoRoot, manifestPath), 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return `Desktop dev runtime assets are not prepared (${manifestPath} is missing). ${RECOVERY}`
    return `Desktop dev runtime assets are stale (${manifestPath} is unreadable). ${RECOVERY}`
  }
  if (manifest?.schema !== DEV_RUNTIME_ASSETS_SCHEMA) return `Desktop dev runtime assets are stale (${manifestPath} has an old schema). ${RECOVERY}`
  const recorded = new Set((manifest.assets || []).map((asset) => asset.path))
  const required = devRuntimeAssets(platform)
  const unrecorded = required.filter((asset) => !recorded.has(asset.path))
  if (unrecorded.length) return `Desktop dev runtime assets are stale (not prepared: ${unrecorded.map((asset) => asset.name).join(', ')}). ${RECOVERY}`
  return missingAssets(repoRoot, required)
}

async function missingAssets(repoRoot, assets) {
  const missing = []
  for (const asset of assets) {
    try {
      await access(path.join(repoRoot, asset.path), asset.executable ? constants.X_OK : constants.R_OK)
    } catch {
      missing.push(`${asset.name} (${asset.path})`)
    }
  }
  return missing.length ? `Desktop dev runtime assets are missing: ${missing.join(', ')}. ${RECOVERY}` : null
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  const problem = await checkDevRuntimeAssets(repoRoot)
  if (problem) {
    console.error(problem)
    process.exit(1)
  }
}
