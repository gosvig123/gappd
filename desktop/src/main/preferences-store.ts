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

/**
 * Single atomic JSON store for non-secret desktop preferences (`preferences.json`).
 * Migrates the 8 legacy per-feature files on first read and distinguishes missing vs damaged files
 * so privacy-sensitive defaults (Error reports) fail closed on corruption.
 */
export class PreferencesStore {
  private readonly dir: string
  private cached: PreferencesReadResult | null = null

  constructor(dir: string) {
    this.dir = dir
  }

  read(): PreferencesReadResult {
    if (this.cached) return this.cached
    const loaded = this.loadFromDisk()
    this.cached = loaded
    return loaded
  }

  update(mutate: (current: PreferencesDocument) => PreferencesDocument, options?: { strict?: boolean }): PreferencesDocument {
    if (options?.strict) this.assertReadableForWrite()
    const current = this.read().data
    const next: PreferencesDocument = { ...mutate(current), version: 1 }
    this.writeAtomic(next)
    this.cached = { status: 'ok', data: next }
    return next
  }

  private filePath(): string {
    return path.join(this.dir, PREFERENCES_FILE)
  }

  private assertReadableForWrite(): void {
    try {
      JSON.parse(fs.readFileSync(this.filePath(), 'utf8'))
    } catch (cause) {
      if (cause instanceof SyntaxError || (cause as NodeJS.ErrnoException).code === 'ENOENT') return
      throw cause
    }
  }

  private loadFromDisk(): PreferencesReadResult {
    let text: string
    try {
      text = fs.readFileSync(this.filePath(), 'utf8')
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return this.migrateLegacy()
      return { status: 'damaged', data: { version: 1, errorReport: { sharing: 'off' } } }
    }
    const parsed = parsePreferences(text)
    if (!parsed) return { status: 'damaged', data: { version: 1, errorReport: { sharing: 'off' } } }
    return { status: 'ok', data: parsed }
  }

  private migrateLegacy(): PreferencesReadResult {
    const found: string[] = []
    const doc: PreferencesDocument = { version: 1 }
    const startup: StoredStartupPreferences = {}
    let hasStartup = false

    const legacyPath = (name: string) => path.join(this.dir, name)
    const takeMarker = (name: string): boolean => {
      const target = legacyPath(name)
      if (!fs.existsSync(target)) return false
      found.push(target)
      return true
    }

    if (takeMarker(LEGACY_FILES.startupInitialized)) { startup.initialized = true; hasStartup = true }
    if (takeMarker(LEGACY_FILES.speakerLabelsDisabled)) { startup.speakerLabelsEnabled = false; hasStartup = true }
    if (takeMarker(LEGACY_FILES.screenVideoEnabled)) { startup.screenVideoEnabled = true; hasStartup = true }
    if (takeMarker(LEGACY_FILES.agendaAutoDraftEnabled)) { startup.agendaAutoDraftEnabled = true; hasStartup = true }
    if (hasStartup) doc.startup = startup

    const updateChannelFile = legacyPath(LEGACY_FILES.updateChannel)
    if (fs.existsSync(updateChannelFile)) {
      found.push(updateChannelFile)
      const parsed = readJsonFile(updateChannelFile)
      if (isRecord(parsed) && (parsed.channel === 'stable' || parsed.channel === 'beta')) {
        doc.updateChannel = parsed.channel
      }
    }

    const remoteAccessFile = legacyPath(LEGACY_FILES.remoteAccess)
    if (fs.existsSync(remoteAccessFile)) {
      found.push(remoteAccessFile)
      const parsed = readJsonFile(remoteAccessFile)
      if (isRecord(parsed)) {
        const lastUsed: Record<string, string> = {}
        if (isRecord(parsed.lastUsed)) {
          for (const [key, value] of Object.entries(parsed.lastUsed)) {
            if (typeof value === 'string' && Number.isFinite(Date.parse(value))) lastUsed[key] = value
          }
        }
        doc.remoteAccess = { enabled: parsed.enabled === true, lastUsed }
      }
    }

    const errorReportFile = legacyPath(LEGACY_FILES.errorReport)
    if (fs.existsSync(errorReportFile)) {
      found.push(errorReportFile)
      const parsed = readJsonFile(errorReportFile)
      if (isRecord(parsed) && parsed.version === 1 && (parsed.sharing === 'on' || parsed.sharing === 'off')) {
        const failedMeetings = Array.isArray(parsed.failedMeetings) ? parsed.failedMeetings.filter((x): x is string => typeof x === 'string') : undefined
        doc.errorReport = failedMeetings ? { sharing: parsed.sharing, failedMeetings } : { sharing: parsed.sharing }
      } else {
        // A damaged legacy error-report.json may have held an opt-out, so fail closed to off.
        doc.errorReport = { sharing: 'off' }
      }
    }

    const usageReportFile = legacyPath(LEGACY_FILES.usageReport)
    if (fs.existsSync(usageReportFile)) {
      found.push(usageReportFile)
      const parsed = readJsonFile(usageReportFile)
      if (isRecord(parsed) && parsed.version === 1) {
        doc.usageReport = {
          sharing: parsed.sharing === 'on' || parsed.sharing === 'off' ? parsed.sharing : 'unset',
          installWeek: typeof parsed.installWeek === 'string' ? parsed.installWeek : '',
          day: typeof parsed.day === 'string' ? parsed.day : '',
          pendingDay: typeof parsed.pendingDay === 'string' ? parsed.pendingDay : null,
          lastReport: isRecord(parsed.lastReport) ? parsed.lastReport as unknown as UsageReport : null,
          lastSentAt: typeof parsed.lastSentAt === 'string' ? parsed.lastSentAt : null,
        }
      }
    }

    if (found.length === 0) return { status: 'missing', data: doc }
    try {
      this.writeAtomic(doc)
      for (const file of found) {
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
    const temporary = `${target}.tmp`
    fs.writeFileSync(temporary, JSON.stringify(document), { mode: 0o600 })
    fs.renameSync(temporary, target)
  }
}

function parsePreferences(raw: string): PreferencesDocument | null {
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value) || value.version !== 1) return null
    return value as PreferencesDocument
  } catch {
    return null
  }
}

function readJsonFile(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) }
  catch { return null }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
