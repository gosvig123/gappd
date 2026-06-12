import path from 'node:path'
import { stat } from 'node:fs/promises'
import { app } from 'electron'

// __dirname is dist-electron/main at runtime, so '../..' is the desktop root
// and '../../..' the repo root (expressed as a '..' segment in dev paths).
const DESKTOP_ROOT = path.resolve(__dirname, '../..')

type BinarySpec = {
  /** Environment variable that overrides the resolved path entirely. */
  envVar?: string
  /** Path segments joined onto process.resourcesPath in packaged builds. */
  packaged: string[]
  /** Path segments joined onto the desktop root in dev builds. */
  dev: string[]
}

export function resolveBinary(spec: BinarySpec): string {
  const override = spec.envVar ? process.env[spec.envVar] : undefined
  if (override) return override
  if (app.isPackaged) return path.join(process.resourcesPath, ...spec.packaged)
  return path.join(DESKTOP_ROOT, ...spec.dev)
}

export async function isExecutableFile(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath)
    return info.isFile() && (info.mode & 0o111) !== 0
  } catch {
    return false
  }
}
