import { access, chmod, cp, mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { downloadFile, fileSha256, runCommand } from './bundle-utils.mjs'
import runtimeManifest from '../src/shared/runtime-manifest.json' with { type: 'json' }

const DEFAULT_MACOS_MIN_VERSION = '26.0'
const MAC_BUILD_ARM64 = 'arm64'
const MAC_BUILD_X64 = 'x64'
const MAC_BUILD_UNIVERSAL = 'universal'
const MAC_ARCH_ARM64 = 'arm64'
const MAC_ARCH_X64 = 'x86_64'
const LLAMA_SERVER = 'llama-server'
const BUILD_TYPE = 'Release'
const { release, source } = runtimeManifest.llamacpp
const targetProfile = resolveTargetProfile()
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = path.join(root, '.cache', 'llamacpp', release)
const sourceArchivePath = path.join(cacheDir, source.name)
const sourceDir = path.join(cacheDir, `llama.cpp-${release}`)
const buildDir = path.join(cacheDir, 'build', targetProfile)
const outputDir = path.join(root, 'resources', 'llamacpp')

await requireDarwin()
await mkdir(cacheDir, { recursive: true })
await prepareSource()
await buildRuntime()
await copyRuntime()

async function requireDarwin() {
  if (process.platform === 'darwin') return
  throw new Error('llama.cpp bundling requires macOS because gappd ships macOS llama-server binaries.')
}

function resolveTargetProfile() {
  const profile = process.env.GAPPD_MAC_BUILD
  if ([MAC_BUILD_ARM64, MAC_BUILD_X64, MAC_BUILD_UNIVERSAL].includes(profile)) return profile
  return process.arch === 'x64' ? MAC_BUILD_X64 : MAC_BUILD_ARM64
}

async function prepareSource() {
  if (!(await hasMatchingSourceArchive())) await downloadFile({ url: source.url, outputPath: sourceArchivePath, sha256: source.sha256, label: 'llama.cpp source' })
  await rm(sourceDir, { recursive: true, force: true })
  runCommand('tar', ['-xzf', sourceArchivePath, '-C', cacheDir], 'Failed to extract llama.cpp source')
}

async function hasMatchingSourceArchive() {
  try {
    return (await fileSha256(sourceArchivePath)) === source.sha256
  } catch {
    return false
  }
}

async function buildRuntime() {
  await rm(buildDir, { recursive: true, force: true })
  await mkdir(buildDir, { recursive: true })
  runCommand('cmake', cmakeConfigureArgs(), 'Failed to configure llama.cpp')
  runCommand('cmake', ['--build', buildDir, '--config', BUILD_TYPE, '--target', LLAMA_SERVER, '-j', String(os.availableParallelism?.() || os.cpus().length)], 'Failed to build llama-server')
}

function cmakeConfigureArgs() {
  return [
    '-S', sourceDir,
    '-B', buildDir,
    `-DCMAKE_BUILD_TYPE=${BUILD_TYPE}`,
    `-DCMAKE_OSX_ARCHITECTURES=${cmakeArchitectures()}`,
    `-DCMAKE_OSX_DEPLOYMENT_TARGET=${process.env.GAPPD_MACOS_MIN_VERSION || DEFAULT_MACOS_MIN_VERSION}`,
    '-DBUILD_SHARED_LIBS=OFF',
    '-DGGML_METAL=ON',
    '-DLLAMA_OPENSSL=OFF',
  ]
}

function cmakeArchitectures() {
  if (targetProfile === MAC_BUILD_UNIVERSAL) return `${MAC_ARCH_ARM64};${MAC_ARCH_X64}`
  if (targetProfile === MAC_BUILD_X64) return MAC_ARCH_X64
  return MAC_ARCH_ARM64
}

async function copyRuntime() {
  const serverPath = await builtServerPath()
  await rm(outputDir, { recursive: true, force: true })
  await mkdir(outputDir, { recursive: true })
  await cp(serverPath, path.join(outputDir, LLAMA_SERVER))
  await copyLicense()
  await chmod(path.join(outputDir, LLAMA_SERVER), 0o755)
}

async function builtServerPath() {
  const candidates = [path.join(buildDir, 'bin', LLAMA_SERVER), path.join(buildDir, 'bin', BUILD_TYPE, LLAMA_SERVER)]
  for (const candidate of candidates) if (await exists(candidate)) return candidate
  throw new Error(`Built llama-server not found under ${buildDir}.`)
}

async function copyLicense() {
  const sourcePath = path.join(sourceDir, 'LICENSE')
  if (!(await exists(sourcePath))) return
  await cp(sourcePath, path.join(outputDir, 'LICENSE'))
}

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}
