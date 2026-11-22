import fs from 'node:fs'
import path from 'node:path'
import type { UpdateChannel } from '../shared/contracts'
import type { UsageReport, UsageSharing } from '../shared/usage-report'

export const PREFERENCES_FILE = 'preferences.json'

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

/**
 * Single atomic JSON store for non-secret desktop preferences (`preferences.json`).
 * Reads fresh from disk on every read/update so separate writers cannot clobber each other,
 * migrates the 8 legacy per-feature files on first read without deleting unreadable files,
 * and fails closed on corruption so Error reports and Open at login never flip back on.
 */
export class PreferencesStore {
  private readonly dir: string

  constructor(dir: string) {
    this.dir = dir
  }

  read(): PreferencesReadResult {
    const loaded = this.loadFromDisk()
    return loaded.status === 'unreadable' ? damagedResult() : loaded
  }

  update(mutate: (current: PreferencesDocument) => PreferencesDocument, _options?: { strict?: boolean }): PreferencesDocument {
    const loaded = this.loadFromDisk()
    if (loaded.status === 'unreadable') throw loaded.error
    if (loaded.status === 'damaged') this.backupCorruptFile()
    const next: PreferencesDocument = { ...mutate(loaded.data), version: 1 }
    this.writeAtomic(next)
    return next
  }

  private filePath(): string {
    return path.join(this.dir, PREFERENCES_FILE)
  }

  private backupCorruptFile(): void {
    const target = this.filePath()
    const backup = `${target}.damaged`
    try {
      // Only back up a corrupt JSON file, never fail the write if backup cannot be made.
      if (fs.existsSync(target) && !fs.existsSync(backup)) fs.copyFileSync(target, backup)
    } catch { /* Best-effort preservation of corrupt preferences. */ }
  }

  private loadFromDisk(): InternalReadResult {
    let text: string
    try {
      text = fs.readFileSync(this.filePath(), 'utf8')
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return this.migrateLegacy()
      return { status: 'unreadable', data: damagedResult().data, error: cause }
    }
    const parsed = parsePreferences(text)
    if (!parsed) return damagedResult()
    return { status: 'ok', data: parsed }
  }

  private migrateLegacy(): InternalReadResult {
    const removable: string[] = []
    const doc: PreferencesDocument = { version: 1 }
    const startup: StoredStartupPreferences = {}
    let hasStartup = false
    let anyLegacyFound = false

    const legacyPath = (name: string) => path.join(this.dir, name)
    const takeMarker = (name: string): boolean => {
      const target = legacyPath(name)
      if (!fs.existsSync(target)) return false
      anyLegacyFound = true
      removable.push(target)
      return true
    }

    if (takeMarker(LEGACY_FILES.startupInitialized)) { startup.initialized = true; hasStartup = true }
    if (takeMarker(LEGACY_FILES.speakerLabelsDisabled)) { startup.speakerLabelsEnabled = false; hasStartup = true }
    if (takeMarker(LEGACY_FILES.screenVideoEnabled)) { startup.screenVideoEnabled = true; hasStartup = true }
    if (takeMarker(LEGACY_FILES.agendaAutoDraftEnabled)) { startup.agendaAutoDraftEnabled = true; hasStartup = true }
    if (hasStartup) doc.startup = startup

    const updateChannelFile = legacyPath(LEGACY_FILES.updateChannel)
    const updateChannelRead = readLegacyJson(updateChannelFile)
    if (updateChannelRead.status === 'unreadable') return { status: 'unreadable', data: damagedResult().data, error: updateChannelRead.error }
    if (updateChannelRead.status !== 'missing') {
      anyLegacyFound = true
      removable.push(updateChannelFile)
      if (updateChannelRead.status === 'ok' && isRecord(updateChannelRead.value) && (updateChannelRead.value.channel === 'stable' || updateChannelRead.value.channel === 'beta')) {
        doc.updateChannel = updateChannelRead.value.channel
      }
    }

    const remoteAccessFile = legacyPath(LEGACY_FILES.remoteAccess)
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

    const errorReportFile = legacyPath(LEGACY_FILES.errorReport)
    const errorReportRead = readLegacyJson(errorReportFile)
    if (errorReportRead.status === 'unreadable') return { status: 'unreadable', data: damagedResult().data, error: errorReportRead.error }
    if (errorReportRead.status !== 'missing') {
      anyLegacyFound = true
      if (errorReportRead.status === 'ok' && isRecord(errorReportRead.value) && errorReportRead.value.version === 1 && (errorReportRead.value.sharing === 'on' || errorReportRead.value.sharing === 'off')) {
        const failedMeetings = Array.isArray(errorReportRead.value.failedMeetings) ? errorReportRead.value.failedMeetings.filter((x): x is string => typeof x === 'string') : undefined
        doc.errorReport = failedMeetings ? { sharing: errorReportRead.value.sharing, failedMeetings } : { sharing: errorReportRead.value.sharing }
      } else {
        // A corrupt legacy error-report.json may have held an opt-out, so fail closed to off.
        doc.errorReport = { sharing: 'off' }
      }
      // Keep an opted-out legacy error-report.json so a manual downgrade still sees sharing: off.
      if (doc.errorReport.sharing !== 'off') removable.push(errorReportFile)
    }

    const usageReportFile = legacyPath(LEGACY_FILES.usageReport)
    const usageReportRead = readLegacyJson(usageReportFile)
    if (usageReportRead.status === 'unreadable') return { status: 'unreadable', data: damagedResult().data, error: usageReportRead.error }
    if (usageReportRead.status !== 'missing') {
      anyLegacyFound = true
      removable.push(usageReportFile)
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
    }

    if (!anyLegacyFound) return { status: 'missing', data: doc }
    try {
      this.writeAtomic(doc)
      for (const file of removable) {
        try { fs.rmSync(file, { force: true }) } catch { /* Best-effort cleanup after atomic save. */ }
      }
    } catch {
      // If disk write fails during migration, still serve migrated in-memory values without deleting legacy files.
    }
    return { status: 'ok', data: doc }
  }

  private writeAtomic(document: PreferencesDocument): void {
    fs.mkdirSync(this.dir, { recursive: true })
    const target = this.filePath()
    const temporary = `${target}.${process.pid}.${++tempSequence}.tmp`
    const fd = fs.openSync(temporary, 'w', 0o600)
    try {
      fs.writeFileSync(fd, JSON.stringify(document), 'utf8')
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    fs.renameSync(temporary, target)
  }
}

function damagedResult(): PreferencesReadResult {
  // Fail closed: keep Error reports off and prevent initializeStartupSettings from re-enabling Open at login.
  return { status: 'damaged', data: { version: 1, errorReport: { sharing: 'off' }, startup: { initialized: true } } }
}

function parsePreferences(raw: string): PreferencesDocument | null {
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value) || value.version !== 1) return null
    const doc = { ...value } as PreferencesDocument
    // Normalize any present-but-malformed errorReport to off so privacy opt-outs never flip back on.
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
