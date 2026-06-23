import { chmod, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { downloadFile, fileSha256, runCommand } from './bundle-utils.mjs'
import runtimeManifest from '../src/shared/runtime-manifest.json' with { type: 'json' }

const { release, artifact, sha256 } = runtimeManifest.ollama
const url = `https://github.com/ollama/ollama/releases/download/${release}/${artifact}`
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = path.join(root, '.cache', 'ollama', release)
const archivePath = path.join(cacheDir, artifact)
const outputDir = path.join(root, 'resources', 'ollama')
const executableNames = ['ollama', 'llama-server', 'llama-quantize']

await mkdir(cacheDir, { recursive: true })
await mkdir(outputDir, { recursive: true })

if (!(await hasMatchingArchive())) await downloadFile({ url, outputPath: archivePath, sha256, label: 'Ollama archive' })
await extractRuntime()

async function hasMatchingArchive() {
  try {
    return (await fileSha256(archivePath)) === sha256
  } catch {
    return false
  }
}

async function extractRuntime() {
  await extractArchive(cacheDir, false)
  await extractArchive(outputDir, true)
}

async function extractArchive(targetDir, clean) {
  if (clean) await rm(targetDir, { recursive: true, force: true })
  await mkdir(targetDir, { recursive: true })
  runCommand('tar', ['-xzf', archivePath, '-C', targetDir], 'Failed to extract Ollama archive')
  await markExecutables(targetDir)
}

async function markExecutables(targetDir) {
  for (const name of executableNames) await chmod(path.join(targetDir, name), 0o755)
}
