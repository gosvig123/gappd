#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rename } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const APP_SUPPORT = path.join(os.homedir(), 'Library', 'Application Support', 'gappd-desktop')
const BACKUP_DIR = path.join(os.homedir(), `.gappd-dev-reset-${timestamp()}`)
const TCC_SERVICES = ['Microphone', 'ScreenCapture']
const TCC_CLIENTS = ['dev.gappd.desktop', 'dev.gappd.capture', 'com.github.Electron']

const TARGETS = [
  [path.join(os.homedir(), '.gappd', 'config.toml'), 'config.toml'],
  [path.join(APP_SUPPORT, 'llamacpp-models'), 'llamacpp-models'],
  [path.join(APP_SUPPORT, 'whisper-models'), 'whisper-models'],
]

await mkdir(BACKUP_DIR, { recursive: true })
quitGappd()
const moved = await moveTargets()
resetPermissions()
printSummary(moved)

function quitGappd() {
  runQuiet('osascript', ['-e', 'tell application id "dev.gappd.desktop" to quit'])
  runQuiet('osascript', ['-e', 'tell application "Gappd" to quit'])
  runQuiet('pkill', ['-f', '/Applications/Gappd.app/Contents/MacOS/Gappd'])
  runQuiet('pkill', ['-f', '/Applications/Gappd.app/Contents/Resources/llamacpp/llama-server'])
}

async function moveTargets() {
  const moved = []
  for (const [source, name] of TARGETS) {
    if (!existsSync(source)) continue
    const target = path.join(BACKUP_DIR, name)
    await rename(source, target)
    moved.push(`${source} -> ${target}`)
  }
  return moved
}

function resetPermissions() {
  for (const service of TCC_SERVICES) {
    for (const client of TCC_CLIENTS) runQuiet('tccutil', ['reset', service, client])
  }
}

function printSummary(moved) {
  console.log(`Backup: ${BACKUP_DIR}`)
  console.log('Moved:')
  console.log(moved.length ? moved.map((item) => `  ${item}`).join('\n') : '  none')
  console.log(`Reset permissions: ${TCC_SERVICES.join(', ')} for ${TCC_CLIENTS.join(', ')}`)
}

function runQuiet(bin, args) {
  try {
    execFileSync(bin, args, { stdio: 'ignore' })
  } catch {}
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '').replace('T', '-')
}
