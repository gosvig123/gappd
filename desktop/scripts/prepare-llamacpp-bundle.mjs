import { chmod, mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { downloadFile, fileSha256, runCommand } from './bundle-utils.mjs'
import runtimeManifest from '../src/shared/runtime-manifest.json' with { type: 'json' }

const { release, artifacts } = runtimeManifest.llamacpp
const artifact = artifacts[targetArch()]
const url = `https://github.com/ggml-org/llama.cpp/releases/download/${release}/${artifact.name}`
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = path.join(root, '.cache', 'llamacpp', release, targetArch())
const archivePath = path.join(cacheDir, artifact.name)
const outputDir = path.join(root, 'resources', 'llamacpp')

await mkdir(cacheDir, { recursive: true })
await mkdir(outputDir, { recursive: true })

if (!(await hasMatchingArchive())) await downloadFile({ url, outputPath: archivePath, sha256: artifact.sha256, label: 'llama.cpp archive' })
await extractRuntime()

function targetArch() {
  if (process.env.GAPPD_MAC_BUILD === 'universal') throw new Error('llama.cpp universal runtime bundling is not implemented; build arm64 or x64.')
  if (process.env.GAPPD_MAC_BUILD === 'x64') return 'x64'
  if (process.env.GAPPD_MAC_BUILD === 'arm64') return 'arm64'
  return process.arch === 'x64' ? 'x64' : 'arm64'
}

async function hasMatchingArchive() {
  try {
    return (await fileSha256(archivePath)) === artifact.sha256
  } catch {
    return false
  }
}

async function extractRuntime() {
  await rm(outputDir, { recursive: true, force: true })
  await mkdir(outputDir, { recursive: true })
  runCommand('tar', ['-xzf', archivePath, '--strip-components', '1', '-C', outputDir], 'Failed to extract llama.cpp archive')
  await removeUnusedExecutables(outputDir)
  await chmod(path.join(outputDir, 'llama-server'), 0o755)
}

async function removeUnusedExecutables(targetDir) {
  const entries = await readdir(targetDir)
  await Promise.all(entries.filter(shouldRemove).map((name) => rm(path.join(targetDir, name), { force: true })))
}

function shouldRemove(name) {
  if (name === 'llama-server') return false
  if (name.startsWith('lib') || name === 'LICENSE') return false
  return true
}
