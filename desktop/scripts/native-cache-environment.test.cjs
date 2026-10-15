const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const test = require('node:test')

const cacheModule = () => import('./native-cache.mjs')

test('all supported compiler and SDK overrides rotate the environment fingerprint', async () => {
  const { buildEnvironment, fingerprintOf } = await cacheModule()
  const baseline = fingerprintOf(buildEnvironment({}))
  for (const name of Object.keys(buildEnvironment({}))) {
    const first = fingerprintOf(buildEnvironment({ [name]: 'first' }))
    const second = fingerprintOf(buildEnvironment({ [name]: 'second' }))
    assert.notEqual(first, baseline, name)
    assert.notEqual(second, first, name)
  }
})

test('custom compiler commands and toolchain files bypass runtime reuse', async () => {
  const { supportsRuntimeCache } = await cacheModule()
  assert.equal(supportsRuntimeCache({}), true)
  for (const name of ['CC', 'CXX', 'CMAKE_TOOLCHAIN_FILE']) {
    assert.equal(supportsRuntimeCache({ [name]: 'custom --flags' }), false, name)
  }
})

test('actual cache plans distinguish CXXFLAGS overrides', () => {
  assert.notEqual(cachePlan('-DGAPPD_CACHE_PROBE=1'), cachePlan('-DGAPPD_CACHE_PROBE=2'))
})

test('toolchain fingerprints retain build IDs on subsequent output lines', async () => {
  const { commandVersion } = await cacheModule()
  const version = commandVersion(process.execPath, ['-e', 'console.log("Xcode 26\\nBuild version 17A1")'])
  assert.equal(version, 'Xcode 26\nBuild version 17A1')
})

function cachePlan(flags) {
  const script = path.join(__dirname, 'prepare-llamacpp-bundle.mjs')
  const result = spawnSync(process.execPath, [script, '--print-cache-plan'], {
    encoding: 'utf8',
    env: { ...process.env, GAPPD_MAC_BUILD: 'arm64', CXXFLAGS: flags },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /^key=llamacpp-/)
  return result.stdout.split('\n')[0]
}
