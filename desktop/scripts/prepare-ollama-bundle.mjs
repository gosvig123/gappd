import { chmod, copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { downloadFile, fileSha256, runCommand } from './bundle-utils.mjs'
import runtimeManifest from '../src/shared/runtime-manifest.json' with { type: 'json' }

const { release, artifact, sha256 } = runtimeManifest.ollama
const url = `https://github.com/ollama/ollama/releases/download/${release}/${artifact}`
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = path.join(root, '.cache', 'ollama', release)
const archivePath = path.join(cacheDir, artifact)
const cacheBinaryPath = path.join(cacheDir, 'ollama')
const outputDir = path.join(root, 'resources', 'ollama')
const outputPath = path.join(outputDir, 'ollama')

await mkdir(cacheDir, { recursive: true })
await mkdir(outputDir, { recursive: true })

if (!(await hasMatchingArchive())) await downloadFile({ url, outputPath: archivePath, sha256, label: 'Ollama archive' })
await extractBinary()

async function hasMatchingArchive() {
  try {
    return (await fileSha256(archivePath)) === sha256
  } catch {
    return false
  }
}

async function extractBinary() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gappd-ollama-'))
  try {
    runCommand('tar', ['-xzf', archivePath, '-C', tempDir], 'Failed to extract Ollama archive')
    await copyExecutable(path.join(tempDir, 'ollama'), cacheBinaryPath)
    await copyExecutable(cacheBinaryPath, outputPath)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function copyExecutable(source, target) {
  await copyFile(source, target)
  await chmod(target, 0o755)
}
