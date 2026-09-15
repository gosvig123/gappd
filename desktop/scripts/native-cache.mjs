import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const MANIFEST_NAME = 'cache-manifest.json'
const MANIFEST_SCHEMA = 1
const EXECUTABLE_MODE = 0o755
const defaultDeps = { hashFile: sha256File, readArchitectures: lipoArchitectures }

export function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function fingerprintOf(fields) {
  return sha256Text(JSON.stringify(fields, Object.keys(fields).sort()))
}

export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')))
  })
}

export function commandVersion(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: 'pipe' })
  if (result.error || result.status !== 0) return ''
  const lines = `${result.stdout || ''}\n${result.stderr || ''}`.split('\n').map((line) => line.trim()).filter(Boolean)
  return lines.join('\n')
}

export function buildEnvironment(env = process.env) {
  const names = ['CC', 'CXX', 'CFLAGS', 'CXXFLAGS', 'CPPFLAGS', 'LDFLAGS', 'SDKROOT',
    'DEVELOPER_DIR', 'MACOSX_DEPLOYMENT_TARGET', 'CMAKE_TOOLCHAIN_FILE', 'CMAKE_PREFIX_PATH',
    'CMAKE_GENERATOR', 'CMAKE_GENERATOR_PLATFORM', 'CMAKE_GENERATOR_TOOLSET',
    'CPATH', 'CPLUS_INCLUDE_PATH', 'C_INCLUDE_PATH', 'LIBRARY_PATH']
  return Object.fromEntries(names.map((name) => [name, env[name] || '']))
}

// Custom compiler commands/toolchain files can change in place or contain arguments.
// Build them fresh instead of guessing how to identify their effective compiler.
export function supportsRuntimeCache(env = process.env) {
  return !env.CC && !env.CXX && !env.CMAKE_TOOLCHAIN_FILE
}

export function lipoArchitectures(binaryPath) {
  const result = spawnSync('lipo', ['-archs', binaryPath], { encoding: 'utf8', stdio: 'pipe' })
  if (result.error || result.status !== 0) return []
  return result.stdout.trim().split(/\s+/).filter(Boolean)
}

export function isCacheManifest(value) {
  if (!value || value.schema !== MANIFEST_SCHEMA) return false
  return ['fingerprint', 'binary', 'sha256'].every((key) => typeof value[key] === 'string' && value[key].length > 0)
}

export function sameArchitectures(actual, expected) {
  return [...actual].sort().join(' ') === [...expected].sort().join(' ')
}

export async function readCacheManifest(runtimeDir) {
  try {
    const manifest = JSON.parse(await readFile(path.join(runtimeDir, MANIFEST_NAME), 'utf8'))
    return isCacheManifest(manifest) ? manifest : null
  } catch {
    return null
  }
}

export async function writeCacheManifest(runtimeDir, manifest) {
  const record = { schema: MANIFEST_SCHEMA, ...manifest }
  await writeFile(path.join(runtimeDir, MANIFEST_NAME), `${JSON.stringify(record, null, 2)}\n`)
  return record
}

export async function cachedRuntimeStatus({ runtimeDir, binaryName, fingerprint, architectures, deps = defaultDeps }) {
  const manifest = await readCacheManifest(runtimeDir)
  if (!manifest) return invalid('cache manifest missing, unreadable, or from an older cache schema')
  if (manifest.fingerprint !== fingerprint) return invalid('cached fingerprint does not match the current build inputs')
  if (manifest.binary !== binaryName) return invalid(`cached runtime file ${manifest.binary} does not match ${binaryName}`)
  const binaryPath = path.join(runtimeDir, binaryName)
  const actualSha256 = await deps.hashFile(binaryPath).catch(() => null)
  if (!actualSha256) return invalid('cached runtime binary is missing or unreadable')
  if (actualSha256 !== manifest.sha256) return invalid('cached runtime checksum mismatch')
  const actualArchitectures = deps.readArchitectures(binaryPath)
  if (!sameArchitectures(actualArchitectures, architectures)) return invalid(`cached runtime architectures ${describe(actualArchitectures)} do not match ${describe(architectures)}`)
  return { valid: true, manifest }
}

export async function prepareRuntimeArtifact(options) {
  const { runtimeDir, outputDir, binaryName, fingerprint, architectures, fields, build } = options
  const deps = options.deps || defaultDeps
  const log = options.log || (() => {})
  const status = await cachedRuntimeStatus({ runtimeDir, binaryName, fingerprint, architectures, deps })
  if (status.valid) log(`Native runtime cache hit for ${fingerprint}.`)
  else {
    log(`Native runtime cache miss for ${fingerprint}: ${status.reason}. Rebuilding.`)
    await rm(runtimeDir, { recursive: true, force: true })
    await build()
    await storeRuntime({ runtimeDir, outputDir, binaryName, fingerprint, architectures, fields, deps })
  }
  await copyRuntimeFiles(runtimeDir, outputDir)
  await chmod(path.join(outputDir, binaryName), EXECUTABLE_MODE)
  return status.valid
}

async function storeRuntime({ runtimeDir, outputDir, binaryName, fingerprint, architectures, fields, deps }) {
  await rm(runtimeDir, { recursive: true, force: true })
  await mkdir(runtimeDir, { recursive: true })
  for (const name of await readdir(outputDir)) await cp(path.join(outputDir, name), path.join(runtimeDir, name), { recursive: true })
  const binaryPath = path.join(runtimeDir, binaryName)
  await writeCacheManifest(runtimeDir, {
    fingerprint,
    architectures: deps.readArchitectures(binaryPath),
    binary: binaryName,
    fields,
    sha256: await deps.hashFile(binaryPath),
  })
  const status = await cachedRuntimeStatus({ runtimeDir, binaryName, fingerprint, architectures, deps })
  if (!status.valid) throw new Error(`Freshly built native runtime failed cache validation: ${status.reason}`)
}

async function copyRuntimeFiles(fromDir, toDir) {
  await rm(toDir, { recursive: true, force: true })
  await mkdir(toDir, { recursive: true })
  for (const name of await readdir(fromDir)) {
    if (name === MANIFEST_NAME) continue
    await cp(path.join(fromDir, name), path.join(toDir, name), { recursive: true })
  }
}

function invalid(reason) {
  return { valid: false, reason }
}

function describe(architectures) {
  return architectures.length > 0 ? architectures.join(', ') : 'unknown'
}
