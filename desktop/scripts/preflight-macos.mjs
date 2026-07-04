import { spawnSync } from 'node:child_process'

const MIN_NODE_VERSION = '22.12.0'
const MIN_GO_VERSION = '1.25'
const MIN_MACOS_VERSION = '26.0'
const COMMANDS = [
  ['npm', 'Install Node.js 22.12.0 or newer, which includes npm.'],
  ['go', 'Install Go 1.25 or newer.'],
  ['cmake', 'Install CMake.'],
  ['tar', 'Install tar.'],
  ['xcode-select', 'Install Xcode Command Line Tools with `xcode-select --install`.'],
  ['swiftc', 'Install Xcode Command Line Tools with Swift support.'],
  ['codesign', 'Install Xcode Command Line Tools codesign support.'],
  ['lipo', 'Install Xcode Command Line Tools lipo support.'],
  ['xcrun', 'Install Xcode Command Line Tools xcrun support.'],
]

const failures = []

if (process.platform !== 'darwin') failures.push('Desktop macOS bootstrap requires macOS.')
else if (!hasMacOSVersion(MIN_MACOS_VERSION)) failures.push('macOS 26+ required because Apple SpeechTranscriber requires macOS 26. Upgrade macOS, then rerun preflight.')

if (!hasNodeVersion(MIN_NODE_VERSION)) failures.push(`Node.js ${MIN_NODE_VERSION}+ required. Found ${process.version}.`)

for (const [command, hint] of COMMANDS) {
  if (!hasCommand(command)) failures.push(`Missing ${command}. ${hint}`)
}

if (!hasXcodePath()) failures.push('Xcode Command Line Tools path missing. Run `xcode-select --install`.')
if (!hasGoVersion(MIN_GO_VERSION)) failures.push('Go 1.25+ required. Install Go 1.25 or newer.')

if (failures.length > 0) {
  console.error('Desktop macOS preflight failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  console.error('Fix prerequisites, then rerun `npm run desktop:bootstrap` from repo root.')
  process.exit(1)
}

console.log('Desktop macOS preflight passed.')

function hasNodeVersion(minVersion) {
  return compareVersions(process.versions.node, minVersion) >= 0
}

function hasCommand(command) {
  const result = spawnSync('sh', ['-lc', `command -v ${quote(command)}`], { stdio: 'ignore' })
  return !result.error && result.status === 0
}

function hasXcodePath() {
  const result = spawnSync('xcode-select', ['-p'], { stdio: 'ignore' })
  return !result.error && result.status === 0
}

function hasMacOSVersion(minVersion) {
  const result = spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8', stdio: 'pipe' })
  if (result.error || result.status !== 0) return false
  return compareVersions(result.stdout.trim(), minVersion) >= 0
}

function hasGoVersion(minVersion) {
  const result = spawnSync('go', ['version'], { encoding: 'utf8', stdio: 'pipe' })
  if (result.error || result.status !== 0) return false
  const match = result.stdout.match(/go(\d+)\.(\d+)(?:\.(\d+))?/)
  return Boolean(match && compareVersions(match.slice(1).join('.'), minVersion) >= 0)
}

function compareVersions(actual, minimum) {
  const left = versionParts(actual)
  const right = versionParts(minimum)
  for (let index = 0; index < right.length; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1
  }
  return 0
}

function versionParts(version) {
  return version.replace(/^v/, '').split('.').map((part) => Number(part) || 0)
}

function quote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`
}
