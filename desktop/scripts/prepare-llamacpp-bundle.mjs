import { access, cp, mkdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { downloadFile, runCommand } from './bundle-utils.mjs'
import { buildEnvironment, commandVersion, fingerprintOf, prepareRuntimeArtifact, sha256File, sha256Text, supportsRuntimeCache } from './native-cache.mjs'
import runtimeManifest from '../src/shared/runtime-manifest.json' with { type: 'json' }

const DEFAULT_MACOS_MIN_VERSION = '26.0'
const MAC_BUILD_ARM64 = 'arm64'
const MAC_BUILD_X64 = 'x64'
const MAC_BUILD_UNIVERSAL = 'universal'
const MAC_ARCH_ARM64 = 'arm64'
const MAC_ARCH_X64 = 'x86_64'
const LLAMA_SERVER = 'llama-server'
const LLAMA_LICENSE = 'LICENSE'
const BUILD_TYPE = 'Release'
const { release, source } = runtimeManifest.llamacpp
const targetProfile = resolveTargetProfile()
const expectedArchitectures = cmakeArchitectures().split(';')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(root, '..')
const cacheDir = path.join(root, '.cache', 'llamacpp', release)
const sourceArchivePath = path.join(cacheDir, source.name)
const sourceDir = path.join(cacheDir, `llama.cpp-${release}`)
const buildDir = path.join(cacheDir, 'build', targetProfile)
const runtimeStoreDir = path.join(cacheDir, 'runtime')
const outputDir = path.join(root, 'resources', 'llamacpp')
const buildScriptSha256 = await buildScriptDigest()
const cacheFields = fingerprintFields()
const fingerprint = fingerprintOf(cacheFields)

await main()

async function main() {
  if (process.argv.includes('--print-cache-plan')) {
    console.log(`key=llamacpp-${release}-${fingerprint}`)
    console.log(`path=${path.relative(repoRoot, runtimeStoreDir)}`)
    return
  }
  await requireDarwin()
  await mkdir(cacheDir, { recursive: true })
  if (!supportsRuntimeCache()) return buildUncachedRuntime()
  const reused = await prepareRuntimeArtifact({
    runtimeDir: path.join(runtimeStoreDir, fingerprint),
    outputDir,
    binaryName: LLAMA_SERVER,
    fingerprint,
    architectures: expectedArchitectures,
    fields: cacheFields,
    build: buildUncachedRuntime,
    log: (message) => console.log(message),
  })
  if (reused) await discardReusableStaging()
}

// A cache hit leaves both trees unused, and every rebuild recreates them from the cached source archive.
async function discardReusableStaging() {
  console.log('Removing unused llama.cpp source and build trees.')
  await rm(sourceDir, { recursive: true, force: true })
  await rm(buildDir, { recursive: true, force: true })
}

async function buildUncachedRuntime() {
  await prepareSource()
  await buildRuntime()
  await copyBuiltRuntime()
}

async function requireDarwin() {
  if (process.platform === 'darwin') return
  throw new Error('llama.cpp bundling requires macOS because gappd ships macOS llama-server binaries.')
}

function fingerprintFields() {
  return {
    schema: 'llamacpp-runtime-v1',
    release,
    sourceSha256: source.sha256,
    buildScriptSha256,
    buildProfile: targetProfile,
    architectures: cmakeArchitectures(),
    deploymentTarget: macosDeploymentTarget(),
    buildType: BUILD_TYPE,
    buildOptionsSha256: sha256Text(JSON.stringify(cmakeOptions())),
    environmentSha256: fingerprintOf(buildEnvironment()),
    cmakeVersion: commandVersion('cmake', ['--version']),
    compilerVersion: commandVersion('cc', ['--version']),
    cxxVersion: commandVersion('c++', ['--version']),
    sdkVersion: commandVersion('xcrun', ['--sdk', 'macosx', '--show-sdk-version']),
    xcodeVersion: commandVersion('xcodebuild', ['-version']),
  }
}

async function buildScriptDigest() {
  const scriptPaths = [fileURLToPath(import.meta.url), path.join(root, 'scripts', 'native-cache.mjs')]
  const sources = await Promise.all(scriptPaths.map((scriptPath) => readFile(scriptPath, 'utf8')))
  return sha256Text(sources.join('\n'))
}

function resolveTargetProfile() {
  const profile = process.env.GAPPD_MAC_BUILD
  if ([MAC_BUILD_ARM64, MAC_BUILD_X64, MAC_BUILD_UNIVERSAL].includes(profile)) return profile
  return process.arch === 'x64' ? MAC_BUILD_X64 : MAC_BUILD_ARM64
}

function macosDeploymentTarget() {
  return process.env.GAPPD_MACOS_MIN_VERSION || DEFAULT_MACOS_MIN_VERSION
}

function cmakeOptions() {
  return cmakeConfigureArgs().filter((option) => option.startsWith('-D'))
}

async function prepareSource() {
  if (!(await hasMatchingSourceArchive())) await downloadFile({ url: source.url, outputPath: sourceArchivePath, sha256: source.sha256, label: 'llama.cpp source' })
  await rm(sourceDir, { recursive: true, force: true })
  runCommand('tar', ['-xzf', sourceArchivePath, '-C', cacheDir], 'Failed to extract llama.cpp source')
}

async function hasMatchingSourceArchive() {
  try {
    return (await sha256File(sourceArchivePath)) === source.sha256
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
    `-DCMAKE_OSX_DEPLOYMENT_TARGET=${macosDeploymentTarget()}`,
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

async function copyBuiltRuntime() {
  const serverPath = await builtServerPath()
  await rm(outputDir, { recursive: true, force: true })
  await mkdir(outputDir, { recursive: true })
  await cp(serverPath, path.join(outputDir, LLAMA_SERVER))
  const licensePath = path.join(sourceDir, LLAMA_LICENSE)
  if (await exists(licensePath)) await cp(licensePath, path.join(outputDir, LLAMA_LICENSE))
}

async function builtServerPath() {
  const candidates = [path.join(buildDir, 'bin', LLAMA_SERVER), path.join(buildDir, 'bin', BUILD_TYPE, LLAMA_SERVER)]
  for (const candidate of candidates) if (await exists(candidate)) return candidate
  throw new Error(`Built llama-server not found under ${buildDir}.`)
}

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}
