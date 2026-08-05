#!/usr/bin/env node

const { spawnSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const path = require('node:path')
const { defaultAppPath } = require('./mac-release-utils.cjs')
const { designatedRequirement, needsScreenReset } = require('./install-mac-support.cjs')

const APP_ID = 'dev.gappd.desktop'
const APP_PROCESS = '^/Applications/Gappd.app/Contents/MacOS/Gappd( |$)'
const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
const SCREEN_CAPTURE = 'ScreenCapture'
const TARGET = '/Applications/Gappd.app'

async function main() {
  if (process.platform !== 'darwin') throw new Error('macOS install is only supported on macOS')
  const source = process.argv[2] ? path.resolve(process.argv[2]) : await defaultAppPath()
  install(source)
  console.log(`Installed ${source} to ${TARGET}`)
}

function install(source) {
  const previous = existsSync(TARGET) ? requirement(TARGET, true) : null
  const incoming = requirement(source, false)
  quitGappd()
  if (previous) run(LSREGISTER, ['-u', TARGET])
  if (needsScreenReset(previous, incoming)) run('tccutil', ['reset', SCREEN_CAPTURE, APP_ID])
  run('rm', ['-rf', TARGET])
  run('ditto', [source, TARGET])
  run(LSREGISTER, ['-f', TARGET])
  run('open', [TARGET])
}

function requirement(appPath, optional) {
  const result = execute('codesign', ['-dr', '-', appPath])
  if (!result.error && result.status === 0) return designatedRequirement(`${result.stderr}\n${result.stdout}`)
  if (optional) return 'unreadable-existing-signature'
  throw commandError('codesign', ['-dr', '-', appPath], result)
}

function quitGappd() {
  runQuiet('osascript', ['-e', `tell application id "${APP_ID}" to quit`])
  if (waitForExit()) return
  runQuiet('pkill', ['-TERM', '-f', APP_PROCESS])
  if (!waitForExit()) throw new Error(`Gappd did not quit before replacing ${TARGET}`)
}

function waitForExit() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (execute('pgrep', ['-f', APP_PROCESS]).status !== 0) return true
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
  }
  return false
}

function run(command, args) {
  const result = execute(command, args)
  if (!result.error && result.status === 0) return
  throw commandError(command, args, result)
}

function runQuiet(command, args) {
  execute(command, args)
}

function execute(command, args) {
  return spawnSync(command, args, { stdio: 'pipe', encoding: 'utf8' })
}

function commandError(command, args, result) {
  const output = result.error?.message || result.stderr.trim() || result.stdout.trim() || `Command exited with status ${result.status}`
  return new Error(`${command} ${args.join(' ')} failed.\n${output}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
