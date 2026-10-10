const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { readFileSync, readdirSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const desktopRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(desktopRoot, '..')
const RENDERER_ONLY_PACKAGES = [
  '@fontsource/hanken-grotesk',
  '@fontsource/jetbrains-mono',
  '@fontsource/newsreader',
  'lucide-react',
  'react',
  'react-dom',
]

test('mac config leaves notarization and nested signing to the hooks', () => {
  const config = require(path.join(desktopRoot, 'electron-builder.config.cjs'))
  const hooks = readFileSync(path.join(desktopRoot, 'scripts', 'electron-builder-hooks.cjs'), 'utf8')

  assert.equal(config.mac.notarize, false, 'the built-in @electron/notarize step must stay disabled')
  assert.equal(config.mac.hardenedRuntime, true)
  assert.equal(config.mac.identity, process.env.APPLE_SIGNING_IDENTITY || process.env.CSC_NAME || '-')
  assert.equal(typeof config.afterPack, 'function')
  assert.equal(typeof config.afterSign, 'function')

  assert.match(hooks, /sign-mac-nested-code\.cjs/, 'nested code must be signed in afterPack')
  assert.match(hooks, /notarize-mac-build\.cjs/, 'afterSign must own notarization and stapling')
  assert.match(hooks, /verify-mac-release\.cjs/, 'afterSign must verify the finished bundle')
  assert.ok(
    hooks.indexOf('notarize-mac-build.cjs') < hooks.indexOf('verify-mac-release.cjs'),
    'verification must run after notarization',
  )
})

test('notarization stays off unless a signed release enables it', () => {
  const { shouldNotarize } = require('./mac-release-utils.cjs')
  const previous = process.env.GAPPD_ENABLE_NOTARIZATION
  try {
    delete process.env.GAPPD_ENABLE_NOTARIZATION
    assert.equal(shouldNotarize(), false, 'local ad-hoc builds must not notarize')
    process.env.GAPPD_ENABLE_NOTARIZATION = '1'
    assert.equal(shouldNotarize(), true, 'signed releases must notarize')
  } finally {
    if (previous === undefined) delete process.env.GAPPD_ENABLE_NOTARIZATION
    else process.env.GAPPD_ENABLE_NOTARIZATION = previous
  }
})

test('renderer-only packages are build dependencies, not runtime dependencies', () => {
  const manifest = JSON.parse(readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'))
  for (const name of RENDERER_ONLY_PACKAGES) {
    assert.equal(typeof manifest.devDependencies[name], 'string', `${name} must be a devDependency`)
    assert.equal(manifest.dependencies[name], undefined, `${name} must not be a runtime dependency`)
  }
  assert.equal(
    typeof manifest.dependencies['electron-updater'],
    'string',
    'main-process runtime dependencies stay in dependencies',
  )
})

test('main process sources never import renderer-only packages', () => {
  const offenders = []
  for (const file of sourceFiles(['src/main', 'src/preload', 'src/shared'])) {
    const source = readFileSync(file, 'utf8')
    for (const name of RENDERER_ONLY_PACKAGES) {
      if (importsPackage(source, name)) offenders.push(`${path.relative(repoRoot, file)} imports ${name}`)
    }
  }
  assert.deepEqual(offenders, [])
})

test('release workflow publishes installers and keeps the Actions artifact small', () => {
  const workflow = readFileSync(path.join(repoRoot, '.github/workflows/desktop-macos-release.yml'), 'utf8')
  const publishScript = readFileSync(path.join(repoRoot, '.github/scripts/publish-desktop-release.sh'), 'utf8')
  const uploadStep = workflow.slice(workflow.indexOf('actions/upload-artifact'))

  assert.match(workflow, /run: \.github\/scripts\/publish-desktop-release\.sh/)
  assert.match(publishScript, /desktop\/release\/\*\.dmg/)
  assert.match(publishScript, /desktop\/release\/\*\.zip/)
  assert.match(workflow, /GAPPD_ENABLE_NOTARIZATION="\$GAPPD_SIGNED_RELEASE"/)
  assert.match(workflow, /GAPPD_REQUIRE_GATEKEEPER="\$GAPPD_SIGNED_RELEASE"/)

  assert.match(uploadStep, /retention-days: \d+/)
  assert.match(uploadStep, /desktop\/release\/\*-mac\.yml/)
  assert.doesNotMatch(uploadStep, /\*\.dmg|\*\.zip|release\/mac\*\//, 'installers must not be duplicated as artifacts')
})

test('diarizer cache prefix rotates with every scratch-path input', () => {
  const base = diarizerCachePlan()
  const rotations = {
    'swift toolchain': { '--swift': 'Apple Swift version 6.1.0 (swiftlang-6.1.0.1.1)' },
    'Xcode version': { '--xcode': 'Xcode 16.5' },
    'macOS SDK version': { '--sdk': '26.5' },
    'deployment target': { '--target': '27.0' },
    'Swift configuration': { '--configuration': 'debug' },
    'resolved dependencies': { '--resolved-sha': 'd'.repeat(64) },
    'build script': { '--build-script-sha': 'e'.repeat(64) },
  }

  for (const [label, overrides] of Object.entries(rotations)) {
    const rotated = diarizerCachePlan(overrides)
    assert.notEqual(rotated['restore-key'], base['restore-key'], `a changed ${label} must rotate the restore prefix`)
    assert.notEqual(rotated['cache-key'], base['cache-key'], `a changed ${label} must rotate the cache key`)
  }
})

test('diarizer cache prefix stays stable for a source-only change', () => {
  const base = diarizerCachePlan()
  const changed = diarizerCachePlan({ '--sources-sha': 'f'.repeat(64) })

  assert.equal(changed['restore-key'], base['restore-key'], 'source changes must still restore the previous prefix')
  assert.notEqual(changed['cache-key'], base['cache-key'], 'source changes must write a new cache key')
  assert.ok(base['cache-key'].length < 512, 'GitHub cache keys must stay under 512 characters')
})

test('diarizer cache plan runs without Darwin tooling', () => {
  const plan = diarizerCachePlan()
  assert.match(plan['cache-key'], /^Darwin-ARM64-diarizer-/)
  assert.ok(plan['restore-key'].endsWith('-'), 'the restore prefix must end with a separator')
})

test('release workflow derives the diarizer cache key from the scratch-path inputs', () => {
  const workflow = readFileSync(path.join(repoRoot, '.github/workflows/desktop-macos-release.yml'), 'utf8')
  const planStep = workflowStep(workflow, 'Plan diarizer build cache')
  const planner = readFileSync(path.join(repoRoot, '.github/scripts/prepare-diarizer-cache.sh'), 'utf8')
  const restoreStep = workflowStep(workflow, 'Restore diarizer build cache')
  const buildScript = readFileSync(path.join(repoRoot, 'gappd-diarizer/build.sh'), 'utf8')

  for (const flag of ['--swift', '--xcode', '--sdk', '--target', '--configuration', '--resolved-sha', '--build-script-sha', '--sources-sha']) {
    assert.ok(planner.includes(flag), `the planner must pass ${flag}`)
  }
  assert.match(planStep, /run: bash \.github\/scripts\/prepare-diarizer-cache\.sh/)
  assert.ok(planStep.includes("hashFiles('gappd-diarizer/Package.swift', 'gappd-diarizer/Sources/**')"))
  assert.match(restoreStep, /restore-keys: \$\{\{ steps\.diarizer-cache\.outputs\.restore-key \}\}/)

  for (const scratchPath of ['.build/arm64', '.build/x86_64']) {
    assert.ok(buildScript.includes(scratchPath), `build.sh must own ${scratchPath}`)
    assert.ok(restoreStep.includes(`gappd-diarizer/${scratchPath}`), `the cache must restore ${scratchPath}`)
  }
})

test('diarizer cache key stays bounded and collision-safe for long tool strings', () => {
  const longBase = `Apple Swift version ${'9'.repeat(380)}`
  const first = diarizerCachePlan({ '--swift': `${longBase}-clang-1` })
  const second = diarizerCachePlan({ '--swift': `${longBase}-clang-2` })

  assert.ok(first['cache-key'].length < 512, 'GitHub cache keys must stay under 512 characters')
  assert.notEqual(first['cache-key'], second['cache-key'], 'a suffix-only toolchain change must still rotate the key')
})

function diarizerCachePlan(overrides = {}) {
  const inputs = {
    '--os': 'Darwin',
    '--arch': 'ARM64',
    '--swift': 'Apple Swift version 6.0.3 (swiftlang-6.0.3.1.10 clang-1700.0.13.5)',
    '--xcode': 'Xcode 16.4',
    '--sdk': '26.4',
    '--target': '26.0',
    '--configuration': 'release',
    '--resolved-sha': 'a'.repeat(64),
    '--build-script-sha': 'b'.repeat(64),
    '--sources-sha': 'c'.repeat(64),
    ...overrides,
  }
  const args = [path.join(repoRoot, '.github/scripts/plan-diarizer-cache.sh'), ...Object.entries(inputs).flatMap(([flag, value]) => [flag, value])]

  const result = spawnSync('/bin/bash', args, { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } })
  assert.equal(result.status, 0, result.stderr)
  return Object.fromEntries(result.stdout.trim().split('\n').map((line) => line.split('=')))
}

function workflowStep(workflow, name) {
  const start = workflow.indexOf(`- name: ${name}`)
  assert.ok(start >= 0, `workflow step not found: ${name}`)
  const nextStep = workflow.indexOf('- name:', start + 1)
  return nextStep < 0 ? workflow.slice(start) : workflow.slice(start, nextStep)
}

function importsPackage(source, name) {
  const escaped = name.replace(/[/@.]/g, (character) => `\\${character}`)
  return new RegExp(`(?:import|from|require)\\s*\\(?\\s*['"]${escaped}['"/]`).test(source)
}

function sourceFiles(directories) {
  const files = []
  for (const directory of directories) collectSourceFiles(path.join(desktopRoot, directory), files)
  return files
}

function collectSourceFiles(directory, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) collectSourceFiles(entryPath, files)
    else if (/\.(ts|tsx|cjs|mjs|js)$/.test(entry.name)) files.push(entryPath)
  }
}
