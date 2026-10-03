import path from 'node:path'
import { stat } from 'node:fs/promises'
import { app } from 'electron'

// __dirname is dist-electron/main at runtime, so '../..' is the desktop root
// and '../../..' the repo root (expressed as a '..' segment in dev paths).
const DESKTOP_ROOT = path.resolve(__dirname, '../..')
const DEV_PREPARE_COMMAND = 'npm run dev:prepare'

type BinarySpec = {
  /** Development-only environment variable that overrides the resolved path. Packaged builds ignore it. */
  envVar?: string
  /** Path segments joined onto process.resourcesPath in packaged builds. */
  packaged: string[]
  /** Path segments joined onto the desktop root in dev builds. */
  dev: string[]
}

export function resolveBinary(spec: BinarySpec): string {
  if (app.isPackaged) return path.join(process.resourcesPath, ...spec.packaged)
  return (spec.envVar && devOverride(spec.envVar)) || path.join(DESKTOP_ROOT, ...spec.dev)
}

/** Packaged builds use only their own bundled assets, so overrides apply in development only. */
export function devOverride(envVar: string): string | undefined {
  return app.isPackaged ? undefined : process.env[envVar] || undefined
}

/** Recovery copy for a missing or invalid runtime asset. Packaged copy names no local path. */
export function missingRuntimeAssetMessage(component: string, assetPath?: string): string {
  if (app.isPackaged) return `${component} is missing or invalid in this copy of Gappd. Reinstall Gappd.`
  return `${component} is missing or invalid${assetPath ? ` at ${assetPath}` : ''}. Run \`${DEV_PREPARE_COMMAND}\` in desktop/.`
}

export async function isExecutableFile(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath)
    return info.isFile() && (info.mode & 0o111) !== 0
  } catch {
    return false
  }
}
