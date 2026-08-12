import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { access } from 'node:fs/promises'
import macReleaseUtils from './mac-release-utils.cjs'

const {
  DEFAULT_MACOS_MIN_VERSION,
  commandOutput,
  compareVersions,
  expectedArchitecturesForBuildProfile,
  readArchitectures,
  readMinimumOsVersions,
  run,
  verifyFluidAudioLicenseFile,
  verifyModelManifest,
} = macReleaseUtils

const MAC_BUILD_NATIVE = 'native'
const MAC_BUILD_ARM64 = 'arm64'
const MAC_BUILD_X64 = 'x64'
const MAC_BUILD_UNIVERSAL = 'universal'
const GO_ARCH_ARM64 = 'arm64'
const GO_ARCH_X64 = 'amd64'
const WORKFLOW_DEV = 'dev'
const WORKFLOW_DIST = 'dist'
const WORKFLOW_BUILD = 'build'

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(desktopRoot, '..')
const buildDir = path.join(repoRoot, 'build')
const gappdBinaryPath = path.join(buildDir, 'gappd')
const diarizerPath = path.join(buildDir, 'gappd-diarizer')
const diarizationModelsPath = path.join(repoRoot, 'gappd-diarizer', 'models', 'speaker-diarization')
const fluidAudioLicensePath = path.join(repoRoot, 'gappd-diarizer', 'legal', 'FluidAudio', 'LICENSE')
const captureAppPath = path.join(buildDir, 'GappdCapture.app')
const captureBinaryPath = path.join(captureAppPath, 'Contents', 'MacOS', 'gappd-capture')
const speechTranscriberAppPath = path.join(buildDir, 'GappdSpeechTranscriber.app')
const speechTranscriberPath = path.join(speechTranscriberAppPath, 'Contents', 'MacOS', 'apple-speech-transcriber')
const workflow = process.argv[2] || WORKFLOW_BUILD
const macBuildProfile = process.env.GAPPD_MAC_BUILD || MAC_BUILD_NATIVE
const macosMinVersion = process.env.GAPPD_MACOS_MIN_VERSION || DEFAULT_MACOS_MIN_VERSION

await buildNativeArtifacts()
await requirePath(gappdBinaryPath, `Native gappd binary missing at ${gappdBinaryPath} after build.`)
if (shouldRunLocalBinaryCheck()) runBinaryCheck()
else console.log(`Skipping local runtime verification for cross-compiled ${macBuildProfile} gappd binary.`)
await verifyModelManifest(diarizationModelsPath)
await verifyFluidAudioLicenseFile(fluidAudioLicensePath)

if (process.platform === 'darwin') {
  await requirePath(diarizerPath, `Native diarization helper missing at ${diarizerPath} after build.`)
  await requirePath(captureAppPath, `Native capture helper missing at ${captureAppPath} after build.`)
  await requirePath(captureBinaryPath, `Native capture helper binary missing at ${captureBinaryPath} after build.`)
  await requirePath(speechTranscriberAppPath, `Native Apple speech transcriber app missing at ${speechTranscriberAppPath} after build.`)
  await requirePath(speechTranscriberPath, `Native Apple speech transcriber missing at ${speechTranscriberPath} after build.`)
  if (shouldRunLocalBinaryCheck()) runDiarizerCheck()
  verifyBinaryCompatibility('gappd binary', gappdBinaryPath)
  verifyBinaryCompatibility('diarization helper', diarizerPath)
  verifyBinaryCompatibility('capture helper binary', captureBinaryPath)
  verifyBinaryCompatibility('Apple speech transcriber', speechTranscriberPath)
}

async function buildNativeArtifacts() {
  if (process.platform !== 'darwin') {
    runMake(['build'])
    return
  }

  await mkdir(buildDir, { recursive: true })
  await buildGoBinary()
  runMake(['build-capture'], {
    GAPPD_MAC_BUILD: macBuildProfile,
    GAPPD_MACOS_MIN_VERSION: macosMinVersion,
  })
  runMake(['build-speech'], {
    GAPPD_MAC_BUILD: macBuildProfile,
    GAPPD_MACOS_MIN_VERSION: macosMinVersion,
  })
  runMake(['build-diarizer'], {
    GAPPD_MAC_BUILD: macBuildProfile,
    GAPPD_MACOS_MIN_VERSION: macosMinVersion,
  })
}

async function buildGoBinary() {
  if (macBuildProfile !== MAC_BUILD_UNIVERSAL) {
    runMake(['build'], {
      GOOS: 'darwin',
      GOARCH: goArchForProfile(macBuildProfile),
      MACOSX_DEPLOYMENT_TARGET: macosMinVersion,
      OUTPUT: gappdBinaryPath,
    })
    return
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gappd-native-'))
  const arm64Path = path.join(tempDir, 'gappd-arm64')
  const x64Path = path.join(tempDir, 'gappd-x64')

  try {
    runMake(['build'], {
      GOOS: 'darwin',
      GOARCH: GO_ARCH_ARM64,
      MACOSX_DEPLOYMENT_TARGET: macosMinVersion,
      OUTPUT: arm64Path,
    })
    runMake(['build'], {
      GOOS: 'darwin',
      GOARCH: GO_ARCH_X64,
      MACOSX_DEPLOYMENT_TARGET: macosMinVersion,
      OUTPUT: x64Path,
    })
    run('lipo', ['-create', arm64Path, x64Path, '-output', gappdBinaryPath])
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

function runMake(targets, extraEnv = {}) {
  const result = spawnSync('make', targets, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  })
  if (!result.error && result.status === 0) return
  const detail = result.error?.message || `Command exited with status ${result.status}`
  throw new Error(`${label(workflow)} native build failed via \`make ${targets.join(' ')}\`.\n${detail}`)
}

function runBinaryCheck() {
  const result = spawnSync(gappdBinaryPath, ['app', 'config', 'show', '--json'], { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' })
  if (!result.error && result.status === 0) return
  throw new Error(
    `${label(workflow)} native verification failed for \`${path.relative(repoRoot, gappdBinaryPath)} app config show --json\`. ` +
      `Desktop would otherwise launch with a stale or broken binary.\n${commandOutput(result)}`.trim(),
  )
}

function runDiarizerCheck() {
  const result = spawnSync(diarizerPath, ['--version'], { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' })
  if (!result.error && result.status === 0) return
  throw new Error(`${label(workflow)} native verification failed for diarization helper --version.\n${commandOutput(result)}`.trim())
}

function shouldRunLocalBinaryCheck() {
  if (process.platform !== 'darwin') return true
  const [hostArchitecture] = expectedArchitecturesForBuildProfile(MAC_BUILD_NATIVE)
  const expectedArchitectures = expectedArchitecturesForBuildProfile(macBuildProfile)
  return expectedArchitectures.includes(hostArchitecture)
}

function verifyBinaryCompatibility(binaryLabel, binaryPath) {
  const expectedArchitectures = expectedArchitecturesForBuildProfile(macBuildProfile)
  const actualArchitectures = readArchitectures(binaryPath)
  const missingArchitectures = expectedArchitectures.filter((arch) => !actualArchitectures.includes(arch))
  if (missingArchitectures.length > 0) {
    throw new Error(
      `${label(workflow)} compatibility verification failed for ${binaryLabel}. ` +
        `Expected architectures ${expectedArchitectures.join(', ')}, found ${actualArchitectures.join(', ')} at ${binaryPath}.`,
    )
  }

  const minimumOsVersions = readMinimumOsVersions(binaryPath)
  const mismatchedMinimumOs = minimumOsVersions.filter((version) => compareVersions(version, macosMinVersion) > 0)
  if (mismatchedMinimumOs.length > 0) {
    throw new Error(
      `${label(workflow)} compatibility verification failed for ${binaryLabel}. ` +
        `Expected minOS <= ${macosMinVersion}, found ${mismatchedMinimumOs.join(', ')} at ${binaryPath}.`,
    )
  }
}

function goArchForProfile(buildProfile) {
  switch (buildProfile) {
    case MAC_BUILD_ARM64:
      return GO_ARCH_ARM64
    case MAC_BUILD_X64:
      return GO_ARCH_X64
    case MAC_BUILD_NATIVE:
      return os.arch() === 'x64' ? GO_ARCH_X64 : GO_ARCH_ARM64
    default:
      throw new Error(`Unsupported single-arch GAPPD_MAC_BUILD value: ${buildProfile}`)
  }
}

function label(step) {
  return step === WORKFLOW_DEV ? 'Desktop dev' : step === WORKFLOW_DIST ? 'Desktop packaging' : 'Desktop build'
}

async function requirePath(filePath, message) {
  try {
    await access(filePath)
  } catch {
    throw new Error(message)
  }
}
