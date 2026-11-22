import fs from 'node:fs'
import path from 'node:path'
import type { UpdateChannel } from '../shared/contracts'
import type { UsageReport, UsageSharing } from '../shared/usage-report'

export const PREFERENCES_FILE = 'preferences.json'

const LOCK_FILE = `${PREFERENCES_FILE}.lock`
const LOCK_TIMEOUT_MS = 2_000

const LEGACY_FILES = {
  startupInitialized: 'startup-initialized',
  speakerLabelsDisabled: 'speaker-labels-disabled',
  screenVideoEnabled: 'screen-video-enabled',
  agendaAutoDraftEnabled: 'agenda-auto-draft-enabled',
  updateChannel: 'update-channel.json',
  remoteAccess: 'remote-access.json',
  errorReport: 'error-report.json',
  usageReport: 'usage-report.json',
} as const

export type StoredStartupPreferences = {
  initialized?: boolean
  speakerLabelsEnabled?: boolean
  screenVideoEnabled?: boolean
  agendaAutoDraftEnabled?: boolean
}

export type StoredRemoteAccess = {
  enabled: boolean
  lastUsed: Record<string, string>
}

export type StoredErrorReport = {
  sharing: 'on' | 'off'
  failedMeetings?: string[]
}

export type StoredUsageReport = {
  sharing: UsageSharing
  installWeek: string
  day: string
  pendingDay?: string | null
  lastReport: UsageReport | null
  lastSentAt: string | null
}

export type PreferencesDocument = {
  version: 1
  startup?: StoredStartupPreferences
  updateChannel?: UpdateChannel
  remoteAccess?: StoredRemoteAccess
  errorReport?: StoredErrorReport
  usageReport?: StoredUsageReport
}

export type PreferencesReadResult =
  | { status: 'ok'; data: PreferencesDocument }
  | { status: 'missing'; data: PreferencesDocument }
  | { status: 'damaged'; data: PreferencesDocument }

type InternalReadResult =
  | PreferencesReadResult
  | { status: 'unreadable'; data: PreferencesDocument; error: unknown }

type LegacyJsonRead =
  | { status: 'missing' }
  | { status: 'ok'; value: unknown }
  | { status: 'corrupt' }
  | { status: 'unreadable'; error: unknown }

let tempSequence = 0
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4))

/**
 * Single atomic JSON store for non-secret desktop preferences (`preferences.json`).
 * Reads fresh from disk, serializes read-modify-write and migration via a PID-verified cross-process
 * lockfile (never stealing a live writer's lock), commits rollback opt-out markers before updating
 * preferences, requires confirmed directory sync before unlinking migrated legacy files, and fails
 * closed on corruption so Error reports and Open at login never flip back on.
 */
export class PreferencesStore {
  private readonly dir: string

  constructor(dir: string) {
    this.dir = dir
  }

  read(): PreferencesReadResult {
    const loaded = this.loadFromDisk(false)
    return loaded.status === 'unreadable' ? damagedResult() : loaded
  }

  update(mutate: (current: PreferencesDocument) => PreferencesDocument, _options?: { strict?: boolean }): PreferencesDocument {
    return this.withLock(true, () => {
      const loaded = this.loadFromDisk(true)
      if (loaded.status === 'unreadable') throw loaded.error
      if (loaded.status === 'damaged') this.backupCorruptFile()
      const next: PreferencesDocument = { ...mutate(loaded.data), version: 1 }
      // Persist rollback opt-out markers BEFORE publishing preferences.json so an opt-out is never
      // acknowledged without downgrade protection.
      this.writeRollbackOptOuts(next)
      this.writeAtomic(next)
      fsyncDir(this.dir)
      this.clearRollbackOptOuts(next)
      return next
    })
  }

  private filePath(): string {
    return path.join(this.dir, PREFERENCES_FILE)
  }

  private legacyPath(name: string): string {
    return path.join(this.dir, name)
  }

  private backupCorruptFile(): void {
    const target = this.filePath()
    const backup = `${target}.damaged`
    try {
      if (fs.existsSync(target) && !fs.existsSync(backup)) fs.copyFileSync(target, backup)
    } catch { /* Best-effort preservation of corrupt preferences. */ }
  }

  private loadFromDisk(holdingLock: boolean): InternalReadResult {
    let text: string
    try {
      text = fs.readFileSync(this.filePath(), 'utf8')
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
        return holdingLock ? this.migrateLegacyLocked() : this.withLock(false, () => this.migrateLegacyLocked())
      }
      return { status: 'unreadable', data: damagedResult().data, error: cause }
    }
    const parsed = parsePreferences(text)
    if (!parsed) return damagedResult()
    return { status: 'ok', data: this.applyLegacyOptOuts(parsed) }
  }

  /**
   * If a user manually downgraded, opted out of Error reports or Usage reports in the old build,
   * and upgraded again, honor those legacy opt-outs instead of resuming reporting without consent.
   */
  private applyLegacyOptOuts(doc: PreferencesDocument): PreferencesDocument {
    let next = doc
    if (next.errorReport?.sharing !== 'off') {
      const legacyErr = readLegacyJson(this.legacyPath(LEGACY_FILES.errorReport))
      if (legacyErr.status !== 'missing') {
        const explicitlyOn = legacyErr.status === 'ok' && isRecord(legacyErr.value) && legacyErr.value.version === 1 && legacyErr.value.sharing === 'on'
        if (!explicitlyOn) next = { ...next, errorReport: { ...(next.errorReport ?? {}), sharing: 'off' } }
      }
    }
    if (next.usageReport?.sharing === 'on') {
      const legacyUsage = readLegacyJson(this.legacyPath(LEGACY_FILES.usageReport))
      if (legacyUsage.status === 'ok' && isRecord(legacyUsage.value) && legacyUsage.value.version === 1 && legacyUsage.value.sharing === 'off') {
        next = { ...next, usageReport: { ...next.usageReport, sharing: 'off' } }
      }
    }
    return next
  }

  private migrateLegacyLocked(): InternalReadResult {
    try {
      const existing = fs.readFileSync(this.filePath(), 'utf8')
      const parsed = parsePreferences(existing)
      return parsed ? { status: 'ok', data: this.applyLegacyOptOuts(parsed) } : damagedResult()
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') {
        return { status: 'unreadable', data: damagedResult().data, error: cause }
      }
    }

    const removable: string[] = []
    const doc: PreferencesDocument = { version: 1 }
    const startup: StoredStartupPreferences = {}
    let hasStartup = false
    let anyLegacyFound = false

    const takeMarker = (name: string, removeAfter: boolean): boolean => {
      const target = this.legacyPath(name)
      if (!fs.existsSync(target)) return false
      anyLegacyFound = true
      if (removeAfter) removable.push(target)
      return true
    }

    // Keep opt-out / initialized sentinels on disk so a manual rollback never re-enables Open at login or speaker labels.
    if (takeMarker(LEGACY_FILES.startupInitialized, false)) { startup.initialized = true; hasStartup = true }
    if (takeMarker(LEGACY_FILES.speakerLabelsDisabled, false)) { startup.speakerLabelsEnabled = false; hasStartup = true }
    if (takeMarker(LEGACY_FILES.screenVideoEnabled, true)) { startup.screenVideoEnabled = true; hasStartup = true }
    if (takeMarker(LEGACY_FILES.agendaAutoDraftEnabled, true)) { startup.agendaAutoDraftEnabled = true; hasStartup = true }
    if (hasStartup) doc.startup = startup

    const updateChannelFile = this.legacyPath(LEGACY_FILES.updateChannel)
    const updateChannelRead = readLegacyJson(updateChannelFile)
    if (updateChannelRead.status === 'unreadable') return { status: 'unreadable', data: damagedResult().data, error: updateChannelRead.error }
    if (updateChannelRead.status !== 'missing') {
      anyLegacyFound = true
      removable.push(updateChannelFile)
      if (updateChannelRead.status === 'ok' && isRecord(updateChannelRead.value) && (updateChannelRead.value.channel === 'stable' || updateChannelRead.value.channel === 'beta')) {
        doc.updateChannel = updateChannelRead.value.channel
      }
    }

    const remoteAccessFile = this.legacyPath(LEGACY_FILES.remoteAccess)
    const remoteAccessRead = readLegacyJson(remoteAccessFile)
    if (remoteAccessRead.status === 'unreadable') return { status: 'unreadable', data: damagedResult().data, error: remoteAccessRead.error }
    if (remoteAccessRead.status !== 'missing') {
      anyLegacyFound = true
      removable.push(remoteAccessFile)
      if (remoteAccessRead.status === 'ok' && isRecord(remoteAccessRead.value)) {
        const lastUsed: Record<string, string> = {}
        if (isRecord(remoteAccessRead.value.lastUsed)) {
          for (const [key, value] of Object.entries(remoteAccessRead.value.lastUsed)) {
            if (typeof value === 'string' && Number.isFinite(Date.parse(value))) lastUsed[key] = value
          }
        }
        doc.remoteAccess = { enabled: remoteAccessRead.value.enabled === true, lastUsed }
      }
    }

    const errorReportFile = this.legacyPath(LEGACY_FILES.errorReport)
    const errorReportRead = readLegacyJson(errorReportFile)
    if (errorReportRead.status === 'unreadable') return { status: 'unreadable', data: damagedResult().data, error: errorReportRead.error }
    if (errorReportRead.status !== 'missing') {
      anyLegacyFound = true
      if (errorReportRead.status === 'ok' && isRecord(errorReportRead.value) && errorReportRead.value.version === 1 && (errorReportRead.value.sharing === 'on' || errorReportRead.value.sharing === 'off')) {
        const failedMeetings = Array.isArray(errorReportRead.value.failedMeetings) ? errorReportRead.value.failedMeetings.filter((x): x is string => typeof x === 'string') : undefined
        doc.errorReport = failedMeetings ? { sharing: errorReportRead.value.sharing, failedMeetings } : { sharing: errorReportRead.value.sharing }
      } else {
        doc.errorReport = { sharing: 'off' }
      }
      if (doc.errorReport.sharing !== 'off') removable.push(errorReportFile)
    }

    const usageReportFile = this.legacyPath(LEGACY_FILES.usageReport)
    const usageReportRead = readLegacyJson(usageReportFile)
    if (usageReportRead.status === 'unreadable') return { status: 'unreadable', data: damagedResult().data, error: usageReportRead.error }
    if (usageReportRead.status !== 'missing') {
      anyLegacyFound = true
      if (usageReportRead.status === 'ok' && isRecord(usageReportRead.value) && usageReportRead.value.version === 1) {
        doc.usageReport = {
          sharing: usageReportRead.value.sharing === 'on' || usageReportRead.value.sharing === 'off' ? usageReportRead.value.sharing : 'unset',
          installWeek: typeof usageReportRead.value.installWeek === 'string' ? usageReportRead.value.installWeek : '',
          day: typeof usageReportRead.value.day === 'string' ? usageReportRead.value.day : '',
          pendingDay: typeof usageReportRead.value.pendingDay === 'string' ? usageReportRead.value.pendingDay : null,
          lastReport: isRecord(usageReportRead.value.lastReport) ? usageReportRead.value.lastReport as unknown as UsageReport : null,
          lastSentAt: typeof usageReportRead.value.lastSentAt === 'string' ? usageReportRead.value.lastSentAt : null,
        }
      }
      if (doc.usageReport?.sharing !== 'off') removable.push(usageReportFile)
    }

    if (!anyLegacyFound) return { status: 'missing', data: doc }
    try {
      this.writeAtomic(doc)
      // Only remove legacy sources when the containing directory entry is durably synced.
      if (fsyncDir(this.dir)) {
        for (const file of removable) {
          try { fs.rmSync(file, { force: true }) } catch { /* Best-effort cleanup after durable save. */ }
        }
      }
    } catch {
      // If disk write fails during migration, serve migrated values without deleting legacy files.
    }
    return { status: 'ok', data: doc }
  }

  /**
   * Durably writes rollback-safe opt-out markers BEFORE committing preferences.json.
   * Failures propagate so an opt-out is never reported as saved without downgrade protection.
   */
  private writeRollbackOptOuts(doc: PreferencesDocument): void {
    fs.mkdirSync(this.dir, { recursive: true })
    let wroteAny = false
    if (doc.errorReport?.sharing === 'off') {
      writeAtomicFile(this.legacyPath(LEGACY_FILES.errorReport), JSON.stringify({ version: 1, sharing: 'off' }))
      wroteAny = true
    }
    if (doc.startup?.initialized) {
      const marker = this.legacyPath(LEGACY_FILES.startupInitialized)
      if (!fs.existsSync(marker)) {
        writeAtomicFile(marker, '')
        wroteAny = true
      }
    }
    if (doc.startup?.speakerLabelsEnabled === false) {
      const marker = this.legacyPath(LEGACY_FILES.speakerLabelsDisabled)
      if (!fs.existsSync(marker)) {
        writeAtomicFile(marker, '')
        wroteAny = true
      }
    }
    if (wroteAny) fsyncDir(this.dir)
  }

  /** Removes obsolete legacy opt-out markers after preferences.json has durably recorded an explicit opt-in. */
  private clearRollbackOptOuts(doc: PreferencesDocument): void {
    try {
      if (doc.errorReport?.sharing === 'on') fs.rmSync(this.legacyPath(LEGACY_FILES.errorReport), { force: true })
      if (doc.usageReport?.sharing === 'on') fs.rmSync(this.legacyPath(LEGACY_FILES.usageReport), { force: true })
      if (doc.startup?.speakerLabelsEnabled === true) fs.rmSync(this.legacyPath(LEGACY_FILES.speakerLabelsDisabled), { force: true })
    } catch { /* Best-effort cleanup of cleared opt-out marker. */ }
  }

  private writeAtomic(document: PreferencesDocument): void {
    fs.mkdirSync(this.dir, { recursive: true })
    writeAtomicFile(this.filePath(), JSON.stringify(document))
  }

  private withLock<T>(forWrite: boolean, action: () => T): T {
    if (forWrite) {
      fs.mkdirSync(this.dir, { recursive: true })
    } else if (!fs.existsSync(this.dir)) {
      return action()
    }
    const lockPath = path.join(this.dir, LOCK_FILE)
    const deadline = Date.now() + LOCK_TIMEOUT_MS
    let fd: number | null = null
    while (fd === null) {
      try {
        fd = fs.openSync(lockPath, 'wx', 0o600)
        fs.writeFileSync(fd, `${process.pid}\n`, 'utf8')
      } catch (cause) {
        if (fd !== null) { try { fs.closeSync(fd) } catch {}; fd = null }
        const code = (cause as NodeJS.ErrnoException).code
        if (code !== 'EEXIST') {
          if (forWrite) throw cause
          return action()
        }
        if (tryReclaimDeadLock(lockPath)) continue
        if (Date.now() >= deadline) throw new Error('Timed out waiting for preferences lock.')
        Atomics.wait(sleepBuffer, 0, 0, 10)
      }
    }
    const ownedIno = fs.fstatSync(fd).ino
    try {
      return action()
    } finally {
      try {
        if (fs.statSync(lockPath).ino === ownedIno) fs.rmSync(lockPath, { force: true })
      } catch {}
      try { fs.closeSync(fd) } catch {}
    }
  }
}

/**
 * Only reclaims a lockfile whose recorded PID is provably dead (ESRCH).
 * Never steals a lock held by a live (even suspended or slow) process, and atomically moves the
 * dead lockfile aside by inode-checked rename so two contenders cannot unlink a winner's fresh lock.
 */
function tryReclaimDeadLock(lockPath: string): boolean {
  let pidText: string
  let stat: fs.Stats
  try {
    stat = fs.statSync(lockPath)
    pidText = fs.readFileSync(lockPath, 'utf8').trim()
  } catch {
    return false
  }
  const pid = Number.parseInt(pidText, 10)
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return false // Owner process is still alive; never steal.
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') return false
  }
  // Verify the lockfile wasn't already replaced by a live contender before unlinking.
  const graveyard = `${lockPath}.dead.${process.pid}.${++tempSequence}`
  try {
    if (fs.statSync(lockPath).ino !== stat.ino) return false
    fs.renameSync(lockPath, graveyard)
    fs.rmSync(graveyard, { force: true })
    return true
  } catch {
    return false
  }
}

function writeAtomicFile(target: string, contents: string): void {
  const temporary = `${target}.${process.pid}.${++tempSequence}.tmp`
  const fd = fs.openSync(temporary, 'w', 0o600)
  try {
    fs.writeFileSync(fd, contents, 'utf8')
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(temporary, target)
}

function fsyncDir(dir: string): boolean {
  let fd: number | null = null
  try {
    fd = fs.openSync(dir, 'r')
    fs.fsyncSync(fd)
    return true
  } catch {
    return false
  } finally {
    if (fd !== null) try { fs.closeSync(fd) } catch {}
  }
}

function damagedResult(): PreferencesReadResult {
  return { status: 'damaged', data: { version: 1, errorReport: { sharing: 'off' }, startup: { initialized: true } } }
}

function parsePreferences(raw: string): PreferencesDocument | null {
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value) || value.version !== 1) return null
    const doc = { ...value } as PreferencesDocument
    if ('errorReport' in value && value.errorReport !== undefined) {
      if (!isRecord(value.errorReport) || (value.errorReport.sharing !== 'on' && value.errorReport.sharing !== 'off')) {
        doc.errorReport = { sharing: 'off' }
      }
    }
    return doc
  } catch {
    return null
  }
}

function readLegacyJson(file: string): LegacyJsonRead {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' }
    return { status: 'unreadable', error: cause }
  }
  try {
    return { status: 'ok', value: JSON.parse(text) }
  } catch {
    return { status: 'corrupt' }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
