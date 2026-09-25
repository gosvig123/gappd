#!/usr/bin/env node
/**
 * Watches the cleanup backlog and alerts when it is behind.
 *
 * `GET /status` publishes the two aggregate numbers the retention promise depends on, and nothing
 * watched it. This polls it and fails loudly when `cleanup.behind` is true, which covers both a
 * failed sweep and a missed run.
 *
 *   npx --no-install node --experimental-strip-types scripts/cloud-status-watch.ts
 *   ... --install     write a LaunchAgent that runs it hourly
 *   ... --uninstall   remove that LaunchAgent
 *
 * Exit 0 when the backlog is inside the deadline, 1 when it is behind or unreadable, so any
 * scheduler treats a breach as a failure.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const DEFAULT_RESOURCE = 'https://gappd-cloud-api-production.up.railway.app/mcp'
const LABEL = 'dev.gappd.cloud-status-watch'
const SCRIPT = new URL(import.meta.url).pathname

type Backlog = { expired_copies: number; oldest_expired_seconds: number; target_seconds: number; behind: boolean }

function endpoint(): string {
  const resource = process.env.GAPPD_CLOUD_RESOURCE_URL?.trim() || DEFAULT_RESOURCE
  return new URL('/status', resource).toString()
}

async function readBacklog(): Promise<Backlog> {
  const response = await fetch(endpoint(), { signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`status returned ${response.status}`)
  const value = (await response.json()) as { cleanup?: Backlog }
  if (!value.cleanup || typeof value.cleanup.behind !== 'boolean') throw new Error('status carried no backlog')
  return value.cleanup
}

function hours(seconds: number): string {
  return `${(seconds / 3600).toFixed(1)}h`
}

// A macOS notification, so an unattended breach is visible without reading a log.
function notify(title: string, message: string): void {
  if (process.platform !== 'darwin') return
  try {
    execFileSync('osascript', ['-e', `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`])
  } catch {
    // A missing notification is not worth failing the check over.
  }
}

function plistPath(): string {
  return path.join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)
}

function install(): void {
  const log = path.join(homedir(), 'Library', 'Logs', 'gappd-cloud-status-watch.log')
  mkdirSync(path.dirname(log), { recursive: true })
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array>
    <string>${process.execPath}</string>
    <string>--experimental-strip-types</string>
    <string>--disable-warning=MODULE_TYPELESS_PACKAGE_JSON</string>
    <string>${SCRIPT}</string>
  </array>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict></plist>
`
  writeFileSync(plistPath(), plist)
  execFileSync('launchctl', ['unload', plistPath()], { stdio: 'ignore' })
  execFileSync('launchctl', ['load', plistPath()])
  console.log(`installed ${LABEL}, running every hour, logging to ${log}`)
}

function uninstall(): void {
  try {
    execFileSync('launchctl', ['unload', plistPath()], { stdio: 'ignore' })
  } catch {
    // Not loaded is the same as removed.
  }
  rmSync(plistPath(), { force: true })
  console.log(`removed ${LABEL}`)
}

async function main(): Promise<void> {
  const mode = process.argv[2]
  if (mode === '--install') return install()
  if (mode === '--uninstall') return uninstall()
  if (mode) throw new Error('use --install or --uninstall')
  const backlog = await readBacklog()
  const summary = `expired=${backlog.expired_copies} oldest=${hours(backlog.oldest_expired_seconds)} target=${hours(backlog.target_seconds)}`
  if (!backlog.behind) {
    console.log(`ok ${summary}`)
    return
  }
  const message = `cleanup is behind: ${summary}`
  console.error(`BEHIND ${message}`)
  notify('Gappd cloud cleanup is behind', message)
  process.exitCode = 1
}

main().catch((error) => {
  console.error(`cloud status watch failed: ${error instanceof Error ? error.message : String(error)}`)
  notify('Gappd cloud status is unreadable', String(error instanceof Error ? error.message : error))
  process.exitCode = 1
})
