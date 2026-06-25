import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DESKTOP_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const RELEASE_DIR = join(DESKTOP_ROOT, 'release')
const MANIFEST_PATH = join(RELEASE_DIR, 'latest.json')
const MIN_VERSION = '0.1.0'
const DEFAULT_CHANNEL = 'stable'

async function main() {
  const dmgPath = await singleDmgPath()
  const context = await releaseContext(dmgPath)
  const manifest = releaseManifest(context)
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(JSON.stringify(manifest, null, 2))
}

async function releaseContext(dmgPath) {
  const tag = requiredEnv('RELEASE_TAG')
  const repo = requiredEnv('GITHUB_REPOSITORY')
  const dmgName = basename(dmgPath)
  return {
    assetKey: process.env.GAPPD_UPDATE_ASSET_KEY || assetKeyFromName(dmgName),
    channel: process.env.GAPPD_UPDATE_CHANNEL || DEFAULT_CHANNEL,
    dmgName,
    repo,
    sha256: await sha256File(dmgPath),
    tag,
    version: tag.replace(/^v/i, ''),
  }
}

function releaseManifest(context) {
  const releaseUrl = `https://github.com/${context.repo}/releases/tag/${context.tag}`
  const downloadUrl = `https://github.com/${context.repo}/releases/download/${context.tag}/${encodeURIComponent(context.dmgName)}`
  const asset = { url: downloadUrl, sha256: context.sha256 }
  return {
    schema: 2,
    version: context.version,
    channel: context.channel,
    minVersion: MIN_VERSION,
    releaseUrl,
    downloadUrl,
    sha256: context.sha256,
    channels: { [context.channel]: { minVersion: MIN_VERSION, release: releaseRecord(context, releaseUrl, asset) } },
  }
}

function releaseRecord(context, releaseUrl, asset) {
  return {
    version: context.version,
    name: `Gappd ${context.tag}`,
    releaseUrl,
    assets: { [context.assetKey]: asset },
  }
}

async function singleDmgPath() {
  const files = (await readdir(RELEASE_DIR)).filter((name) => name.toLowerCase().endsWith('.dmg'))
  if (files.length !== 1) throw new Error(`Write release manifest failed for ${RELEASE_DIR}: expected one DMG, found ${files.length}. Remove extras or build one target.`)
  return join(RELEASE_DIR, files[0])
}

function assetKeyFromName(name) {
  if (/universal/i.test(name)) return 'darwin-universal'
  if (/arm64/i.test(name)) return 'darwin-arm64'
  if (/(x64|x86_64)/i.test(name)) return 'darwin-x64'
  return `darwin-${process.arch}`
}

function requiredEnv(name) {
  const value = process.env[name]
  if (value) return value
  throw new Error(`Write release manifest failed: ${name} is missing. Set ${name} before publishing.`)
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')))
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
