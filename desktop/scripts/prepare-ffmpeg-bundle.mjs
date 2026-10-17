// Builds gappd-ffmpeg: a static, LGPL-only ffmpeg with the SVT-AV1 encoder and the dav1d decoder.
// Storage compaction encodes Screen video as AV1 with it, and export decodes AV1 with dav1d,
// so neither needs the AV1 hardware decoder that M1 and M2 Macs lack.
import { spawnSync } from 'node:child_process'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
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
const BINARY = 'gappd-ffmpeg'
const OUTPUT_LIMIT = 256 << 20
const { release, sources } = runtimeManifest.ffmpeg
const targetProfile = resolveTargetProfile()
const architectures = targetArchitectures()
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(root, '..')
const cacheDir = path.join(root, '.cache', 'ffmpeg', release)
const buildDir = path.join(cacheDir, 'build', targetProfile)
const runtimeStoreDir = path.join(cacheDir, 'runtime')
const outputDir = path.join(root, 'resources', 'ffmpeg')
const fingerprint = fingerprintOf(await fingerprintFields())

await main()

async function main() {
  if (process.argv.includes('--print-cache-plan')) {
    console.log(`key=ffmpeg-${release}-${fingerprint}`)
    console.log(`path=${path.relative(repoRoot, runtimeStoreDir)}`)
    return
  }
  if (process.platform !== 'darwin') throw new Error('gappd-ffmpeg bundling requires macOS because gappd ships macOS binaries.')
  await mkdir(cacheDir, { recursive: true })
  if (!supportsRuntimeCache()) return buildUncachedRuntime()
  const reused = await prepareRuntimeArtifact({
    runtimeDir: path.join(runtimeStoreDir, fingerprint),
    outputDir,
    binaryName: BINARY,
    fingerprint,
    architectures,
    fields: await fingerprintFields(),
    build: buildUncachedRuntime,
    log: (message) => console.log(message),
  })
  if (reused) await rm(buildDir, { recursive: true, force: true })
}

async function buildUncachedRuntime() {
  requireTools()
  await prepareSources()
  await rm(buildDir, { recursive: true, force: true })
  const binaries = []
  for (const arch of architectures) binaries.push(await buildArchitecture(arch))
  await rm(outputDir, { recursive: true, force: true })
  await mkdir(path.join(outputDir, 'licenses'), { recursive: true })
  const output = path.join(outputDir, BINARY)
  if (binaries.length === 1) await cp(binaries[0], output)
  else runCommand('lipo', ['-create', ...binaries, '-output', output], 'Failed to merge gappd-ffmpeg architectures')
  await copyLicenses()
}

async function fingerprintFields() {
  const scripts = [fileURLToPath(import.meta.url), path.join(path.dirname(fileURLToPath(import.meta.url)), 'native-cache.mjs')]
  return {
    schema: 'ffmpeg-runtime-v1',
    release,
    sourcesSha256: sources.map((source) => source.sha256).join(','),
    buildScriptSha256: sha256Text((await Promise.all(scripts.map((file) => readFile(file, 'utf8')))).join('\n')),
    buildProfile: targetProfile,
    architectures: architectures.join(','),
    deploymentTarget: deploymentTarget(),
    environmentSha256: fingerprintOf(buildEnvironment()),
    cmakeVersion: commandVersion('cmake', ['--version']),
    mesonVersion: commandVersion('meson', ['--version']),
    nasmVersion: commandVersion('nasm', ['-v']),
    compilerVersion: commandVersion('cc', ['--version']),
    sdkVersion: commandVersion('xcrun', ['--sdk', 'macosx', '--show-sdk-version']),
  }
}

function resolveTargetProfile() {
  const profile = process.env.GAPPD_MAC_BUILD
  if ([MAC_BUILD_ARM64, MAC_BUILD_X64, MAC_BUILD_UNIVERSAL].includes(profile)) return profile
  return process.arch === 'x64' ? MAC_BUILD_X64 : MAC_BUILD_ARM64
}

function targetArchitectures() {
  if (targetProfile === MAC_BUILD_UNIVERSAL) return [MAC_ARCH_ARM64, MAC_ARCH_X64]
  return [targetProfile === MAC_BUILD_X64 ? MAC_ARCH_X64 : MAC_ARCH_ARM64]
}

function deploymentTarget() {
  return process.env.GAPPD_MACOS_MIN_VERSION || DEFAULT_MACOS_MIN_VERSION
}

function requireTools() {
  const missing = ['cmake', 'meson', 'ninja', 'nasm', 'pkg-config'].filter((tool) => spawnSync('which', [tool]).status !== 0)
  if (missing.length) throw new Error(`gappd-ffmpeg build needs ${missing.join(', ')}. Install with: brew install ${missing.join(' ')}`)
}

async function prepareSources() {
  for (const source of sources) {
    const archive = path.join(cacheDir, source.name)
    if ((await sha256File(archive).catch(() => '')) !== source.sha256) await downloadFile({ url: source.url, outputPath: archive, sha256: source.sha256, label: `${source.dir} source` })
    await rm(path.join(cacheDir, source.dir), { recursive: true, force: true })
    runCommand('tar', ['-xf', archive, '-C', cacheDir], `Failed to extract ${source.name}`)
  }
}

function sourceDir(id) {
  return path.join(cacheDir, sources.find((source) => source.id === id).dir)
}

async function buildArchitecture(arch) {
  const work = path.join(buildDir, arch)
  const prefix = path.join(work, 'prefix')
  const flags = `-arch ${arch} -mmacosx-version-min=${deploymentTarget()}`
  const env = { ...process.env, MACOSX_DEPLOYMENT_TARGET: deploymentTarget(), PKG_CONFIG_PATH: path.join(prefix, 'lib', 'pkgconfig'), PKG_CONFIG_LIBDIR: path.join(prefix, 'lib', 'pkgconfig') }
  await mkdir(work, { recursive: true })

  const svt = path.join(work, 'svt-av1')
  run('cmake', ['-S', sourceDir('svt-av1'), '-B', svt, '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_SHARED_LIBS=OFF', '-DBUILD_APPS=OFF', '-DBUILD_TESTING=OFF',
    `-DCMAKE_OSX_ARCHITECTURES=${arch}`, `-DCMAKE_SYSTEM_PROCESSOR=${arch}`, `-DCMAKE_OSX_DEPLOYMENT_TARGET=${deploymentTarget()}`, `-DCMAKE_INSTALL_PREFIX=${prefix}`], { env }, 'Failed to configure SVT-AV1')
  run('cmake', ['--build', svt], { env }, 'Failed to build SVT-AV1')
  run('cmake', ['--install', svt], { env }, 'Failed to install SVT-AV1')

  const dav1d = path.join(work, 'dav1d')
  const crossFile = path.join(work, 'meson-cross.ini')
  await writeFile(crossFile, mesonCrossFile(arch))
  run('meson', ['setup', dav1d, sourceDir('dav1d'), '--cross-file', crossFile, `--prefix=${prefix}`, '--libdir=lib', '--default-library=static', '--buildtype=release',
    '-Denable_tools=false', '-Denable_tests=false', '-Denable_examples=false'], { env }, 'Failed to configure dav1d')
  run('ninja', ['-C', dav1d, 'install'], { env }, 'Failed to build dav1d')

  const ffmpeg = path.join(work, 'ffmpeg')
  await mkdir(ffmpeg, { recursive: true })
  run(path.join(sourceDir('ffmpeg'), 'configure'), [`--prefix=${prefix}`, '--enable-cross-compile', `--arch=${arch}`, '--target-os=darwin', `--cc=clang -arch ${arch}`,
    `--extra-cflags=${flags}`, `--extra-ldflags=${flags}`, ...ffmpegConfigureArgs()], { cwd: ffmpeg, env }, 'Failed to configure ffmpeg')
  run('make', [`-j${os.availableParallelism?.() || os.cpus().length}`, 'ffmpeg'], { cwd: ffmpeg, env }, 'Failed to build ffmpeg')
  return path.join(ffmpeg, 'ffmpeg')
}

// One cross file for both architectures, so a native and a cross build use the same flags.
function mesonCrossFile(arch) {
  const target = deploymentTarget()
  return `[binaries]
c = ['clang', '-arch', '${arch}']
ar = 'ar'
strip = 'strip'
nasm = 'nasm'

[built-in options]
c_args = ['-mmacosx-version-min=${target}']
c_link_args = ['-mmacosx-version-min=${target}']

[host_machine]
system = 'darwin'
cpu_family = '${arch === MAC_ARCH_X64 ? 'x86_64' : 'aarch64'}'
cpu = '${arch === MAC_ARCH_X64 ? 'x86_64' : 'aarch64'}'
endian = 'little'
`
}

// Only what compaction and export use. No --enable-gpl or --enable-nonfree: the binary stays LGPL.
function ffmpegConfigureArgs() {
  return [
    '--pkg-config-flags=--static', '--enable-static', '--disable-shared', '--disable-autodetect', '--disable-everything',
    '--disable-doc', '--disable-network', '--disable-ffplay', '--disable-ffprobe', '--disable-avdevice',
    '--enable-videotoolbox', '--enable-zlib', '--enable-libsvtav1', '--enable-libdav1d',
    '--enable-protocol=file,pipe',
    '--enable-demuxer=mov,wav,flac',
    '--enable-muxer=mp4,mov,null',
    '--enable-decoder=hevc,h264,libdav1d,pcm_s16le,flac,aac',
    '--enable-encoder=libsvtav1,h264_videotoolbox,hevc_videotoolbox,aac,wrapped_avframe',
    '--enable-hwaccel=hevc_videotoolbox,h264_videotoolbox',
    '--enable-parser=hevc,h264,av1,flac,aac',
    '--enable-bsf=av1_frame_split,av1_frame_merge,av1_metadata,extract_extradata,hevc_mp4toannexb,h264_mp4toannexb,aac_adtstoasc',
    '--enable-filter=adelay,amix,aresample,aformat,anull,null,format,scale,setpts',
  ]
}

async function copyLicenses() {
  const licenses = path.join(outputDir, 'licenses')
  await cp(path.join(sourceDir('ffmpeg'), 'COPYING.LGPLv2.1'), path.join(licenses, 'ffmpeg-COPYING.LGPLv2.1'))
  await cp(path.join(sourceDir('svt-av1'), 'LICENSE.md'), path.join(licenses, 'SVT-AV1-LICENSE.md'))
  await cp(path.join(sourceDir('svt-av1'), 'PATENTS.md'), path.join(licenses, 'SVT-AV1-PATENTS.md'))
  await cp(path.join(sourceDir('dav1d'), 'COPYING'), path.join(licenses, 'dav1d-COPYING'))
  const lines = sources.map((source) => `${source.dir}: ${source.url} (sha256 ${source.sha256})`)
  await writeFile(path.join(licenses, 'SOURCES.txt'), `gappd-ffmpeg is FFmpeg built from unmodified sources under the LGPL v2.1 or later.\n\n${lines.join('\n')}\n\nffmpeg configure options:\n${ffmpegConfigureArgs().join('\n')}\n`)
}

function run(command, args, options, message) {
  const result = spawnSync(command, args, { stdio: 'pipe', maxBuffer: OUTPUT_LIMIT, ...options })
  if (!result.error && result.status === 0) return
  const output = result.error ? result.error.message : `${result.stderr}`.trim().split('\n').slice(-40).join('\n') || `${result.stdout}`.trim().split('\n').slice(-40).join('\n')
  throw new Error(`${message} (${command}).\n${output}`)
}
