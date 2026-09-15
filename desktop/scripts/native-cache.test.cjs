const assert = require('node:assert/strict')
const test = require('node:test')
const { spawnSync } = require('node:child_process')
const { mkdir, mkdtemp, readFile, rm, stat, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const runtimeManifest = require('../src/shared/runtime-manifest.json')

const SCRIPTS_DIR = __dirname
const BUNDLE_SCRIPT = path.join(SCRIPTS_DIR, 'prepare-llamacpp-bundle.mjs')
const CACHE_MODULE_URL = pathToFileURL(path.join(SCRIPTS_DIR, 'native-cache.mjs')).href
const FINGERPRINT = 'f'.repeat(64)
const ARCHITECTURES = ['arm64', 'x86_64']

function cacheModule() {
  return import(CACHE_MODULE_URL)
}

const deps = {
  hashFile: async (filePath) => (await cacheModule()).sha256Text(await readFile(filePath, 'utf8')),
  readArchitectures: () => ['x86_64', 'arm64'],
}

async function withTempDir(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gappd-native-cache-'))
  try {
    return await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function writeRuntimeDir(runtimeDir, overrides = {}) {
  const { sha256Text, writeCacheManifest } = await cacheModule()
  const contents = overrides.contents || 'llama-server-binary'
  await mkdir(runtimeDir, { recursive: true })
  await writeFile(path.join(runtimeDir, 'llama-server'), contents)
  await writeCacheManifest(runtimeDir, {
    binary: 'llama-server',
    fields: { deploymentTarget: '26.0' },
    fingerprint: overrides.fingerprint || FINGERPRINT,
    sha256: sha256Text(contents),
  })
  return { runtimeDir, binaryName: 'llama-server', fingerprint: FINGERPRINT, architectures: ARCHITECTURES }
}

test('fingerprint is stable for equal inputs and changes with every cache input', async () => {
  const { fingerprintOf } = await cacheModule()
  const fields = { architectures: 'arm64;x86_64', compilerVersion: 'Apple clang 17', sourceSha256: 'source-a' }
  assert.equal(fingerprintOf(fields), fingerprintOf({ sourceSha256: 'source-a', compilerVersion: 'Apple clang 17', architectures: 'arm64;x86_64' }))
  for (const [key, value] of Object.entries({ architectures: 'arm64', compilerVersion: 'Apple clang 18', sourceSha256: 'source-b' })) {
    assert.notEqual(fingerprintOf(fields), fingerprintOf({ ...fields, [key]: value }), `${key} must change the fingerprint`)
  }
})

test('reports a cache hit only for a matching manifest, checksum, and architecture set', async () => {
  const { cachedRuntimeStatus } = await cacheModule()
  await withTempDir(async (dir) => {
    const options = await writeRuntimeDir(path.join(dir, 'runtime', FINGERPRINT))
    const status = await cachedRuntimeStatus({ ...options, deps })
    assert.equal(status.valid, true)
    assert.equal(status.manifest.schema, 1)
  })
})

test('rejects stale, corrupt, and unvalidatable caches with a rebuild reason', async () => {
  const { cachedRuntimeStatus } = await cacheModule()
  await withTempDir(async (dir) => {
    const missing = await cachedRuntimeStatus({ runtimeDir: path.join(dir, 'absent'), binaryName: 'llama-server', fingerprint: FINGERPRINT, architectures: ARCHITECTURES, deps })
    assert.equal(missing.valid, false)
    assert.match(missing.reason, /manifest/)

    const options = await writeRuntimeDir(path.join(dir, 'runtime', FINGERPRINT))
    const stale = await cachedRuntimeStatus({ ...options, fingerprint: 'a'.repeat(64), deps })
    assert.equal(stale.valid, false)
    assert.match(stale.reason, /fingerprint/)

    const renamed = await cachedRuntimeStatus({ ...options, binaryName: 'other-server', deps })
    assert.match(renamed.reason, /does not match/)

  })
})

test('rejects corrupt binaries, architectures, and manifest schemas', async () => {
  const { cachedRuntimeStatus, sha256Text } = await cacheModule()
  await withTempDir(async (dir) => {
    const options = await writeRuntimeDir(path.join(dir, 'runtime', FINGERPRINT))
    await writeFile(path.join(options.runtimeDir, 'llama-server'), 'tampered')
    const corrupt = await cachedRuntimeStatus({ ...options, deps })
    assert.equal(corrupt.valid, false)
    assert.match(corrupt.reason, /checksum/)

    await rm(path.join(options.runtimeDir, 'llama-server'))
    assert.match((await cachedRuntimeStatus({ ...options, deps })).reason, /unreadable/)

    await writeFile(path.join(options.runtimeDir, 'llama-server'), 'llama-server-binary')
    const wrongArchitectures = await cachedRuntimeStatus({ ...options, architectures: ['arm64'], deps })
    assert.equal(wrongArchitectures.valid, false)
    assert.match(wrongArchitectures.reason, /architectures/)

    await writeFile(path.join(options.runtimeDir, 'cache-manifest.json'), JSON.stringify({ schema: 0, binary: 'llama-server', fingerprint: FINGERPRINT, sha256: sha256Text('llama-server-binary') }))
    assert.match((await cachedRuntimeStatus({ ...options, deps })).reason, /manifest/)
  })
})

test('prepareRuntimeArtifact rebuilds on a miss, restores on a hit, and rebuilds corrupt caches', async () => {
  await withTempDir(checkRuntimeLifecycle)
})

async function checkRuntimeLifecycle(dir) {
    const { prepareRuntimeArtifact } = await cacheModule()
    const runtimeDir = path.join(dir, 'runtime', FINGERPRINT)
    const outputDir = path.join(dir, 'output')
    const options = { runtimeDir, outputDir, binaryName: 'llama-server', fingerprint: FINGERPRINT, architectures: ARCHITECTURES, fields: {}, deps }
    let builds = 0
    const build = async () => {
      builds += 1
      await mkdir(outputDir, { recursive: true })
      await writeFile(path.join(outputDir, 'llama-server'), 'llama-server-binary')
      await writeFile(path.join(outputDir, 'LICENSE'), 'llama.cpp license')
    }

    assert.equal(await prepareRuntimeArtifact({ ...options, build }), false)
    assert.equal(builds, 1)
    assert.equal(await readFile(path.join(runtimeDir, 'cache-manifest.json'), 'utf8').then(Boolean), true)
    await checkRestoredRuntime(options, build, () => builds)
}

async function checkRestoredRuntime(options, build, builds) {
    const { prepareRuntimeArtifact } = await cacheModule()
    const { runtimeDir, outputDir } = options
    await rm(outputDir, { recursive: true, force: true })
    assert.equal(await prepareRuntimeArtifact({ ...options, build }), true)
    assert.equal(builds(), 1)
    assert.equal(await readFile(path.join(outputDir, 'llama-server'), 'utf8'), 'llama-server-binary')
    assert.equal(await readFile(path.join(outputDir, 'LICENSE'), 'utf8'), 'llama.cpp license')
    assert.equal((await stat(path.join(outputDir, 'llama-server'))).mode & 0o777, 0o755)
    assert.equal(await readFile(path.join(outputDir, 'cache-manifest.json'), 'utf8').catch(() => null), null)

    await writeFile(path.join(runtimeDir, 'llama-server'), 'tampered')
    assert.equal(await prepareRuntimeArtifact({ ...options, build }), false)
    assert.equal(builds(), 2)
    assert.equal(await readFile(path.join(runtimeDir, 'llama-server'), 'utf8'), 'llama-server-binary')
}

test('reports an empty toolchain version when a command is unavailable', async () => {
  const { commandVersion } = await cacheModule()
  assert.equal(commandVersion('gappd-missing-command', ['--version']), '')
  assert.match(commandVersion(process.execPath, ['--version']), /^v\d+\./)
})

test('prepare-llamacpp-bundle prints the cache plan consumed by the release workflow', () => {
  const release = runtimeManifest.llamacpp.release
  const plan = cachePlan({ GAPPD_MAC_BUILD: 'universal' })
  assert.equal(plan.status, 0, plan.stderr)
  assert.deepEqual(Object.keys(plan.outputs).sort(), ['key', 'path'])
  assert.match(plan.outputs.key, new RegExp(`^llamacpp-${release}-[0-9a-f]{64}$`))
  assert.equal(plan.outputs.path, `desktop/.cache/llamacpp/${release}/runtime`)
  assert.equal(cachePlan({ GAPPD_MAC_BUILD: 'universal' }).outputs.key, plan.outputs.key)
  assert.notEqual(cachePlan({ GAPPD_MAC_BUILD: 'arm64' }).outputs.key, plan.outputs.key)
  assert.notEqual(cachePlan({ GAPPD_MAC_BUILD: 'universal', GAPPD_MACOS_MIN_VERSION: '15.0' }).outputs.key, plan.outputs.key)
})

function cachePlan(env) {
  const result = spawnSync(process.execPath, [BUNDLE_SCRIPT, '--print-cache-plan'], {
    cwd: path.dirname(SCRIPTS_DIR),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  const outputs = Object.fromEntries(result.stdout.trim().split('\n').filter(Boolean).map((line) => line.split('=')))
  return { ...result, outputs }
}
