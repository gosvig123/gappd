const assert = require('node:assert/strict')
const test = require('node:test')
const { chmod, mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const MODULE_URL = pathToFileURL(path.join(__dirname, 'dev-runtime-assets.mjs')).href
const BUILD = { macBuildProfile: 'native', macosMinVersion: '26.0' }
const RECOVERY = 'Run `npm run dev:prepare` in desktop/.'

async function withPreparedRepo(run) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'gappd-dev-assets-'))
  try {
    const assets = await import(MODULE_URL)
    for (const asset of assets.devRuntimeAssets('darwin')) {
      const file = path.join(repo, asset.path)
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, asset.name)
      if (asset.executable) await chmod(file, 0o755)
    }
    await assets.writeDevRuntimeAssets(repo, BUILD, 'darwin')
    return await run(repo, assets)
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
}

test('prepared development assets pass the start check', async () => {
  await withPreparedRepo(async (repo, assets) => {
    assert.equal(await assets.checkDevRuntimeAssets(repo, 'darwin'), null)
    const manifest = JSON.parse(await readFile(path.join(repo, 'build', 'runtime-assets.json'), 'utf8'))
    assert.equal(manifest.schema, assets.DEV_RUNTIME_ASSETS_SCHEMA)
    assert.equal(manifest.macBuildProfile, 'native')
  })
})

test('a worktree that never ran dev:prepare is reported as not prepared', async () => {
  await withPreparedRepo(async (repo, assets) => {
    await rm(path.join(repo, 'build', 'runtime-assets.json'))
    assert.equal(await assets.checkDevRuntimeAssets(repo, 'darwin'), `Desktop dev runtime assets are not prepared (build/runtime-assets.json is missing). ${RECOVERY}`)
  })
})

test('a manifest without a newly required asset is stale', async () => {
  await withPreparedRepo(async (repo, assets) => {
    const manifestPath = path.join(repo, 'build', 'runtime-assets.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.assets = manifest.assets.filter((asset) => asset.name !== 'Diarization helper')
    await writeFile(manifestPath, JSON.stringify(manifest))
    assert.equal(await assets.checkDevRuntimeAssets(repo, 'darwin'), `Desktop dev runtime assets are stale (not prepared: Diarization helper). ${RECOVERY}`)
    await writeFile(manifestPath, JSON.stringify({ ...manifest, schema: 0 }))
    assert.match(await assets.checkDevRuntimeAssets(repo, 'darwin'), /old schema/)
  })
})

test('a deleted or non-executable asset is reported by name and path', async () => {
  await withPreparedRepo(async (repo, assets) => {
    await rm(path.join(repo, 'build', 'gappd-export'))
    await chmod(path.join(repo, 'build', 'gappd'), 0o644)
    assert.equal(await assets.checkDevRuntimeAssets(repo, 'darwin'), `Desktop dev runtime assets are missing: Gappd backend (build/gappd), Recording export helper (build/gappd-export). ${RECOVERY}`)
  })
})

test('dev:prepare refuses to record assets that are absent', async () => {
  await withPreparedRepo(async (repo, assets) => {
    await rm(path.join(repo, 'desktop', 'resources', 'llamacpp', 'llama-server'))
    await assert.rejects(assets.writeDevRuntimeAssets(repo, BUILD, 'darwin'), /Bundled llama\.cpp runtime \(desktop\/resources\/llamacpp\/llama-server\)/)
  })
})
