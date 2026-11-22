import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { UpdateChannel } from '../shared/contracts'
import type { UsageReport, UsageSharing } from '../shared/usage-report'

// Use getBuiltinModule because tsup strips the `node:` prefix from static imports, and `node:sqlite`
// only resolves with its `node:` scheme in Node and Electron.
const sqlite = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite') | undefined

export const PREFERENCES_FILE = 'preferences.json'

const LOCK_FILE = 'preferences.lock.sqlite'
const LEGACY_LOCK_FILE = `${PREFERENCES_FILE}.lock`
const LEGACY_LOCK_TAG = 'sqlite'
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
  | (PreferencesReadResult & { rawDoc?: PreferencesDocument | null })
  | { status: 'unreadable'; data: PreferencesDocument; error: unknown }

type LegacyJsonRead =
  | { status: 'missing' }
  | { status: 'ok'; value: unknown }
  | { status: 'corrupt' }
  | { status: 'unreadable'; error: unknown }

type LegacyScanResult =
  | { status: 'missing'; data: PreferencesDocument; removable: string[] }
  | { status: 'ok'; data: PreferencesDocument; removable: string[] }
  | { status: 'unreadable'; data: PreferencesDocument; error: unknown }

let tempSequence = 0
const lockedDirs = new Set<string>()
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4))

/**
 * Single atomic JSON store for non-secret desktop preferences (`preferences.json`).
 * Reads fresh from disk, serializes read-modify-write and migration via an OS kernel exclusive lock
 * (`BEGIN EXCLUSIVE` on a stable 0-byte SQLite file never opened outside SQLite) plus a legacy
 * `preferences.json.lock` bridge for overlapping older builds, commits and directory-syncs rollback
 * opt-out markers before publishing `preferences.json`, requires confirmed directory sync before
 * removing migrated or cleared legacy files, and fails closed on corruption.
 */
export class PreferencesStore {
  private readonly dir: string

  constructor(dir: string) {
    this.dir = dir
  }

  read(): PreferencesReadResult {
    const loaded = this.loadFromDisk(false)
    if (loaded.status === 'unreadable') return this.damagedResult()
    return { status: loaded.status, data: loaded.data }
  }

  /**
   * Runs `action` on the current preferences under the cross-process lock and writes nothing. A
   * send that must not start after an opt-out from any process starts inside `action`.
   */
  readLocked<T>(action: (current: PreferencesReadResult) => T): T {
    return this.withWriteLock(() => {
      const loaded = this.loadFromDisk(true)
      if (loaded.status === 'unreadable') return action(this.damagedResult())
      return action({ status: loaded.status, data: loaded.data })
    })
  }

  update(mutate: (current: PreferencesDocument) => PreferencesDocument, _options?: { strict?: boolean }): PreferencesDocument {
    return this.withWriteLock(() => {
      const loaded = this.loadFromDisk(true)
      if (loaded.status === 'unreadable') throw loaded.error
      if (loaded.status === 'damaged') this.backupCorruptFile()
      const rawDoc = loaded.rawDoc ?? null
      const next: PreferencesDocument = { ...mutate(loaded.data), version: 1 }
      const committingOptOut = hasUncommittedOptOut(next, rawDoc)
      // Persist and sync rollback opt-out markers BEFORE publishing preferences.json so an opt-out
      // is never acknowledged without downgrade protection, including retries from a fresh store.
      this.writeRollbackOptOuts(next, committingOptOut)
      this.writeAtomic(next)
      const synced = fsyncDir(this.dir)
      if (committingOptOut && !synced) {
        throw new Error('Save preferences: could not confirm directory sync after saving opt-out.')
      }
      const pendingClear = this.pendingOptOutMarkerClears(next)
      if (pendingClear.length > 0) {
        if (!synced) {
          throw new Error('Save preferences: could not confirm directory sync before clearing previous opt-out markers.')
        }
        let clearError: unknown = null
        for (const file of pendingClear) {
          try {
            fs.rmSync(file, { force: true })
          } catch (cause) {
            clearError ??= cause
          }
        }
        if (clearError) throw clearError
      }
      return next
    })
  }

  private filePath(): string {
    return path.join(this.dir, PREFERENCES_FILE)
  }

  private legacyPath(name: string): string {
    return path.join(this.dir, name)
  }

  private damagedResult(): PreferencesReadResult {
    return {
      status: 'damaged',
      data: this.applyLegacyOptOuts({ version: 1, errorReport: { sharing: 'off' }, startup: { initialized: true } }),
    }
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
        if (holdingLock) return this.migrateLegacyLocked()
        return this.readMissingPreferences()
      }
      return { status: 'unreadable', data: this.damagedResult().data, error: cause }
    }
    const parsed = parsePreferences(text)
    if (!parsed) return this.damagedResult()
    return { status: 'ok', data: this.applyLegacyOptOuts(parsed), rawDoc: parsed }
  }

  /**
   * When preferences.json does not exist during a read():
   * - If the directory does not exist, return missing without creating it.
   * - If this process already holds the lock for this directory, return a pure read-only snapshot.
   * - If we can acquire the kernel lock, migrate legacy files safely under lock.
   * - If the directory is read-only / inaccessible for locking, return a pure read-only snapshot
   *   without writing or deleting anything.
   * - If lock acquisition times out or fails unexpectedly, fail closed.
   */
  private readMissingPreferences(): InternalReadResult {
    if (!fs.existsSync(this.dir)) return { status: 'missing', data: { version: 1 } }
    if (lockedDirs.has(normalizeDirKey(this.dir))) return this.readLegacySnapshot()
    try {
      return this.withExistingDirLock(() => this.migrateLegacyLocked())
    } catch (cause) {
      if (isReadOnlyOrMissingLockError(cause)) return this.readLegacySnapshot()
      return { status: 'unreadable', data: this.damagedResult().data, error: cause }
    }
  }

  private readLegacySnapshot(): InternalReadResult {
    const scanned = this.scanLegacyFiles()
    if (scanned.status === 'unreadable') return { status: 'unreadable', data: scanned.data, error: scanned.error }
    return { status: scanned.status, data: scanned.data }
  }

  /**
   * Reconciles legacy opt-out / initialized markers written by an older build after a manual
   * downgrade so re-upgrading never revives Error reports, Usage reports, Open at login, or
   * speaker labels without explicit new consent.
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
      if (legacyUsage.status !== 'missing') {
        const record = legacyUsage.status === 'ok' && isRecord(legacyUsage.value) && legacyUsage.value.version === 1 ? legacyUsage.value : null
        if (record?.sharing === 'on') {
          // Explicit legacy opt-in matches current consent.
        } else if (record?.sharing === 'unset') {
          // Old build launched without a legacy file and recorded 'unset': stop sending but keep prompt eligible.
          next = { ...next, usageReport: { ...next.usageReport, sharing: 'unset' } }
        } else {
          // Explicit 'off', invalid, corrupt, or unreadable: fail closed to 'off'.
          next = { ...next, usageReport: { ...next.usageReport, sharing: 'off' } }
        }
      }
    } else if (next.usageReport?.sharing !== 'off') {
      const legacyUsage = readLegacyJson(this.legacyPath(LEGACY_FILES.usageReport))
      if (legacyUsage.status === 'ok' && isRecord(legacyUsage.value) && legacyUsage.value.version === 1 && legacyUsage.value.sharing === 'off') {
        next = {
          ...next,
          usageReport: {
            sharing: 'off',
            installWeek: typeof legacyUsage.value.installWeek === 'string' ? legacyUsage.value.installWeek : (next.usageReport?.installWeek ?? ''),
            day: typeof legacyUsage.value.day === 'string' ? legacyUsage.value.day : (next.usageReport?.day ?? ''),
            pendingDay: typeof legacyUsage.value.pendingDay === 'string' ? legacyUsage.value.pendingDay : (next.usageReport?.pendingDay ?? null),
            lastReport: next.usageReport?.lastReport ?? null,
            lastSentAt: typeof legacyUsage.value.lastSentAt === 'string' ? legacyUsage.value.lastSentAt : (next.usageReport?.lastSentAt ?? null),
          },
        }
      }
    }
    if (!next.startup?.initialized && hasLegacySentinel(this.legacyPath(LEGACY_FILES.startupInitialized))) {
      next = { ...next, startup: { ...next.startup, initialized: true } }
    }
    if (next.startup?.speakerLabelsEnabled !== false && hasLegacySentinel(this.legacyPath(LEGACY_FILES.speakerLabelsDisabled))) {
      next = { ...next, startup: { ...next.startup, speakerLabelsEnabled: false } }
    }
    return next
  }

  private migrateLegacyLocked(): InternalReadResult {
    try {
      const existing = fs.readFileSync(this.filePath(), 'utf8')
      const parsed = parsePreferences(existing)
      return parsed ? { status: 'ok', data: this.applyLegacyOptOuts(parsed), rawDoc: parsed } : this.damagedResult()
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') {
        return { status: 'unreadable', data: this.damagedResult().data, error: cause }
      }
    }

    const scanned = this.scanLegacyFiles()
    if (scanned.status !== 'ok') return scanned

    try {
      this.writeAtomic(scanned.data)
      // Only remove legacy sources when the containing directory entry is durably synced.
      if (fsyncDir(this.dir)) {
        for (const file of scanned.removable) {
          try { fs.rmSync(file, { force: true }) } catch { /* Best-effort cleanup after durable save. */ }
        }
        return { status: 'ok', data: scanned.data, rawDoc: scanned.data }
      }
    } catch {
      // If disk write fails during migration, serve migrated values without deleting legacy files.
    }
    return { status: 'ok', data: scanned.data, rawDoc: null }
  }

  /** Pure read-only scan of legacy preference files; writes and deletes nothing. */
  private scanLegacyFiles(): LegacyScanResult {
    const removable: string[] = []
    const doc: PreferencesDocument = { version: 1 }
    const startup: StoredStartupPreferences = {}
    let hasStartup = false
    let anyLegacyFound = false

    const markerSpecs: Array<{ name: string; removeAfter: boolean; apply: () => void }> = [
      // Keep opt-out / initialized sentinels on disk so a manual rollback never re-enables Open at login or speaker labels.
      { name: LEGACY_FILES.startupInitialized, removeAfter: false, apply: () => { startup.initialized = true } },
      { name: LEGACY_FILES.speakerLabelsDisabled, removeAfter: false, apply: () => { startup.speakerLabelsEnabled = false } },
      { name: LEGACY_FILES.screenVideoEnabled, removeAfter: true, apply: () => { startup.screenVideoEnabled = true } },
      { name: LEGACY_FILES.agendaAutoDraftEnabled, removeAfter: true, apply: () => { startup.agendaAutoDraftEnabled = true } },
    ]
    for (const spec of markerSpecs) {
      const target = this.legacyPath(spec.name)
      const markerState = statLegacyMarker(target)
      if (markerState.status === 'unreadable') {
        return { status: 'unreadable', data: this.damagedResult().data, error: markerState.error }
      }
      if (markerState.status === 'present') {
        anyLegacyFound = true
        hasStartup = true
        spec.apply()
        if (spec.removeAfter) removable.push(target)
      }
    }
    if (hasStartup) doc.startup = startup

    const updateChannelFile = this.legacyPath(LEGACY_FILES.updateChannel)
    const updateChannelRead = readLegacyJson(updateChannelFile)
    if (updateChannelRead.status === 'unreadable') return { status: 'unreadable', data: this.damagedResult().data, error: updateChannelRead.error }
    if (updateChannelRead.status !== 'missing') {
      anyLegacyFound = true
      removable.push(updateChannelFile)
      if (updateChannelRead.status === 'ok' && isRecord(updateChannelRead.value) && (updateChannelRead.value.channel === 'stable' || updateChannelRead.value.channel === 'beta')) {
        doc.updateChannel = updateChannelRead.value.channel
      }
    }

    const remoteAccessFile = this.legacyPath(LEGACY_FILES.remoteAccess)
    const remoteAccessRead = readLegacyJson(remoteAccessFile)
    if (remoteAccessRead.status === 'unreadable') return { status: 'unreadable', data: this.damagedResult().data, error: remoteAccessRead.error }
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
    if (errorReportRead.status === 'unreadable') return { status: 'unreadable', data: this.damagedResult().data, error: errorReportRead.error }
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
    if (usageReportRead.status === 'unreadable') return { status: 'unreadable', data: this.damagedResult().data, error: usageReportRead.error }
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

    if (!anyLegacyFound) return { status: 'missing', data: doc, removable }
    return { status: 'ok', data: doc, removable }
  }

  /**
   * Durably writes and directory-syncs rollback-safe opt-out markers BEFORE committing
   * preferences.json. Syncs whenever a marker was written or an opt-out is not yet committed in
   * on-disk preferences.json, so fresh-store retries still require confirmed durability while
   * unrelated saves stay independent of already-committed markers.
   */
  private writeRollbackOptOuts(doc: PreferencesDocument, committingOptOut: boolean): void {
    fs.mkdirSync(this.dir, { recursive: true })
    let wroteAny = false

    if (doc.errorReport?.sharing === 'off') {
      const errorFile = this.legacyPath(LEGACY_FILES.errorReport)
      const existing = readLegacyJson(errorFile)
      const alreadyOff = existing.status === 'ok' && isRecord(existing.value) && existing.value.version === 1 && existing.value.sharing === 'off'
      if (!alreadyOff) {
        writeAtomicFile(errorFile, JSON.stringify({ version: 1, sharing: 'off' }))
        wroteAny = true
      }
    }

    const usageFile = this.legacyPath(LEGACY_FILES.usageReport)
    if (doc.usageReport?.sharing === 'off') {
      const existing = readLegacyJson(usageFile)
      const alreadyOff = existing.status === 'ok' && isRecord(existing.value) && existing.value.version === 1 && existing.value.sharing === 'off'
      if (!alreadyOff) {
        writeAtomicFile(usageFile, JSON.stringify({
          version: 1,
          sharing: 'off',
          installWeek: doc.usageReport.installWeek,
          day: doc.usageReport.day,
          pendingDay: doc.usageReport.pendingDay ?? null,
          lastReport: null,
          lastSentAt: doc.usageReport.lastSentAt,
        }))
        wroteAny = true
      }
    } else if (doc.usageReport?.sharing !== 'on' && hasLegacySentinel(usageFile)) {
      // Ensure a stale legacy usage-report.json with sharing:'on' never survives when consolidated
      // preferences do not consent to sharing.
      const existingUsage = readLegacyJson(usageFile)
      const alreadyNonSending = existingUsage.status === 'ok'
        && isRecord(existingUsage.value)
        && existingUsage.value.version === 1
        && (existingUsage.value.sharing === 'off' || existingUsage.value.sharing === 'unset')
      if (!alreadyNonSending) {
        writeAtomicFile(usageFile, JSON.stringify({
          version: 1,
          sharing: 'unset',
          installWeek: doc.usageReport?.installWeek ?? '',
          day: doc.usageReport?.day ?? '',
          pendingDay: doc.usageReport?.pendingDay ?? null,
          lastReport: null,
          lastSentAt: doc.usageReport?.lastSentAt ?? null,
        }))
        wroteAny = true
      }
    }

    if (doc.startup?.initialized) {
      const marker = this.legacyPath(LEGACY_FILES.startupInitialized)
      if (statLegacyMarker(marker).status !== 'present') {
        writeAtomicFile(marker, '')
        wroteAny = true
      }
    }

    if (doc.startup?.speakerLabelsEnabled === false) {
      const marker = this.legacyPath(LEGACY_FILES.speakerLabelsDisabled)
      if (statLegacyMarker(marker).status !== 'present') {
        writeAtomicFile(marker, '')
        wroteAny = true
      }
    }

    if ((wroteAny || committingOptOut) && !fsyncDir(this.dir)) {
      throw new Error('Save preferences: could not sync rollback opt-out markers to disk.')
    }
  }

  /** Legacy opt-out files that must be removed after preferences.json durably records an opt-in. */
  private pendingOptOutMarkerClears(doc: PreferencesDocument): string[] {
    const files: string[] = []
    const errorFile = this.legacyPath(LEGACY_FILES.errorReport)
    if (doc.errorReport?.sharing === 'on' && hasLegacySentinel(errorFile)) files.push(errorFile)
    const usageFile = this.legacyPath(LEGACY_FILES.usageReport)
    if (doc.usageReport?.sharing === 'on' && hasLegacySentinel(usageFile)) files.push(usageFile)
    const speakerFile = this.legacyPath(LEGACY_FILES.speakerLabelsDisabled)
    if (doc.startup?.speakerLabelsEnabled === true && hasLegacySentinel(speakerFile)) files.push(speakerFile)
    return files
  }

  private writeAtomic(document: PreferencesDocument): void {
    fs.mkdirSync(this.dir, { recursive: true })
    writeAtomicFile(this.filePath(), JSON.stringify(document))
  }

  private withWriteLock<T>(action: () => T): T {
    fs.mkdirSync(this.dir, { recursive: true })
    return this.withExistingDirLock(action)
  }

  /**
   * Acquires an OS kernel exclusive lock on a stable 0-byte SQLite file (`preferences.lock.sqlite`),
   * never opening or closing that inode outside SQLite (so same-process POSIX record locks can
   * never be dropped). While holding the SQLite lock, also acquires the legacy `preferences.json.lock`
   * bridge so overlapping older builds serialize against this build cleanly.
   */
  private withExistingDirLock<T>(action: () => T): T {
    if (!sqlite?.DatabaseSync) throw new Error('Lock preferences: node:sqlite is unavailable in this runtime.')
    const lockKey = normalizeDirKey(this.dir)
    if (lockedDirs.has(lockKey)) throw new Error('Nested preferences update is not allowed.')

    const lockPath = path.join(this.dir, LOCK_FILE)
    const deadline = Date.now() + LOCK_TIMEOUT_MS
    const db = new sqlite.DatabaseSync(lockPath, { timeout: LOCK_TIMEOUT_MS })
    let transactionOpen = false
    let addedLockKey = false
    let legacyOwnedIno: number | null = null
    const legacyLockPath = path.join(this.dir, LEGACY_LOCK_FILE)
    try {
      db.exec('BEGIN EXCLUSIVE')
      transactionOpen = true
      lockedDirs.add(lockKey)
      addedLockKey = true
      try { fs.chmodSync(lockPath, 0o600) } catch {}
      legacyOwnedIno = acquireLegacyBridgeLock(legacyLockPath, deadline)
      return action()
    } finally {
      if (legacyOwnedIno !== null) {
        try {
          if (fs.statSync(legacyLockPath).ino === legacyOwnedIno) fs.rmSync(legacyLockPath, { force: true })
        } catch {}
      }
      if (transactionOpen) {
        try { db.exec('ROLLBACK') } catch {}
      }
      try { db.close() } catch {}
      if (addedLockKey) lockedDirs.delete(lockKey)
    }
  }
}

/**
 * Serializes against overlapping older builds that lock `preferences.json.lock`.
 * Always called while the process already holds the SQLite `BEGIN EXCLUSIVE` kernel lock:
 * - Any `preferences.json.lock` tagged `sqlite` came from a crashed new build (provably dead even if
 *   its PID was reused, because we hold the SQLite lock) and is reclaimed immediately.
 * - Any untagged `preferences.json.lock` came from an older build: wait while its PID is live and
 *   post-boot; reclaim if dead (`ESRCH`), pre-boot, or empty/malformed past the lock timeout.
 * - Publishes `${process.pid} sqlite\n` atomically via hard-link (`linkSync`), so older builds see
 *   a live PID via `parseInt` and never see an empty or partial lockfile.
 */
function acquireLegacyBridgeLock(legacyLockPath: string, deadline: number): number {
  const tempLock = `${legacyLockPath}.${process.pid}.${++tempSequence}.tmp`
  let ownedIno: number
  let fd: number | null = null
  try {
    fd = fs.openSync(tempLock, 'w', 0o600)
    fs.writeFileSync(fd, `${process.pid} ${LEGACY_LOCK_TAG}\n`, 'utf8')
    ownedIno = fs.fstatSync(fd).ino
    fs.closeSync(fd)
    fd = null
  } catch (cause) {
    if (fd !== null) try { fs.closeSync(fd) } catch {}
    try { fs.rmSync(tempLock, { force: true }) } catch {}
    throw cause
  }

  try {
    while (true) {
      try {
        fs.linkSync(tempLock, legacyLockPath)
        return ownedIno
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause
      }
      if (tryReclaimLegacyBridgeLock(legacyLockPath)) continue
      if (Date.now() >= deadline) throw new Error('Timed out waiting for legacy preferences lock.')
      Atomics.wait(sleepBuffer, 0, 0, 10)
    }
  } finally {
    try { fs.rmSync(tempLock, { force: true }) } catch {}
  }
}

function tryReclaimLegacyBridgeLock(legacyLockPath: string): boolean {
  let stat: fs.Stats
  let text: string
  try {
    stat = fs.statSync(legacyLockPath)
    text = fs.readFileSync(legacyLockPath, 'utf8').trim()
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === 'ENOENT'
  }

  let dead = false
  if (text.endsWith(` ${LEGACY_LOCK_TAG}`)) {
    // We already hold the SQLite kernel lock, so any previous new-build bridge lock is orphaned.
    dead = true
  } else {
    const bootTimeMs = Date.now() - os.uptime() * 1000
    if (stat.mtimeMs < bootTimeMs) {
      dead = true
    } else if (/^\d+$/.test(text)) {
      const pid = Number.parseInt(text, 10)
      if (pid <= 0 || pid === process.pid) {
        dead = true
      } else {
        try {
          process.kill(pid, 0)
          dead = false
        } catch (cause) {
          dead = (cause as NodeJS.ErrnoException).code === 'ESRCH'
        }
      }
    } else if (Date.now() - stat.mtimeMs > LOCK_TIMEOUT_MS) {
      dead = true
    }
  }

  if (!dead) return false
  const graveyard = `${legacyLockPath}.dead.${process.pid}.${++tempSequence}`
  try {
    if (fs.statSync(legacyLockPath).ino !== stat.ino) return false
    fs.renameSync(legacyLockPath, graveyard)
    fs.rmSync(graveyard, { force: true })
    return true
  } catch {
    return false
  }
}

function hasUncommittedOptOut(next: PreferencesDocument, rawDoc: PreferencesDocument | null): boolean {
  if (next.errorReport?.sharing === 'off' && rawDoc?.errorReport?.sharing !== 'off') return true
  if (next.usageReport?.sharing === 'off' && rawDoc?.usageReport?.sharing !== 'off') return true
  if (next.startup?.initialized === true && rawDoc?.startup?.initialized !== true) return true
  if (next.startup?.speakerLabelsEnabled === false && rawDoc?.startup?.speakerLabelsEnabled !== false) return true
  return false
}

function normalizeDirKey(dir: string): string {
  try {
    const stat = fs.statSync(dir)
    return `${stat.dev}:${stat.ino}`
  } catch {
    return path.resolve(dir)
  }
}

function writeAtomicFile(target: string, contents: string): void {
  const temporary = `${target}.${process.pid}.${++tempSequence}.tmp`
  let fd: number | null = null
  try {
    fd = fs.openSync(temporary, 'w', 0o600)
    fs.writeFileSync(fd, contents, 'utf8')
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = null
    fs.renameSync(temporary, target)
  } catch (cause) {
    if (fd !== null) try { fs.closeSync(fd) } catch {}
    try { fs.rmSync(temporary, { force: true }) } catch {}
    throw cause
  }
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
    if ('usageReport' in value && value.usageReport !== undefined) {
      if (!isRecord(value.usageReport) || (value.usageReport.sharing !== 'on' && value.usageReport.sharing !== 'off' && value.usageReport.sharing !== 'unset')) {
        doc.usageReport = { sharing: 'off', installWeek: '', day: '', lastReport: null, lastSentAt: null }
      }
    }
    if ('startup' in value && value.startup !== undefined && !isRecord(value.startup)) {
      doc.startup = { initialized: true }
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

function statLegacyMarker(file: string): { status: 'present' } | { status: 'missing' } | { status: 'unreadable'; error: unknown } {
  try {
    fs.statSync(file)
    return { status: 'present' }
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' }
    return { status: 'unreadable', error: cause }
  }
}

function hasLegacySentinel(file: string): boolean {
  return statLegacyMarker(file).status !== 'missing'
}

function isReadOnlyOrMissingLockError(cause: unknown): boolean {
  if (!cause || typeof cause !== 'object') return false
  const errcode = (cause as { errcode?: unknown }).errcode
  if (errcode === 8 || errcode === 14) return true // SQLITE_READONLY, SQLITE_CANTOPEN
  const code = (cause as NodeJS.ErrnoException).code
  return code === 'EACCES' || code === 'EROFS' || code === 'EPERM' || code === 'ENOENT'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
