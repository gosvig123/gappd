import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { isExecutableFile } from './binaries'
import { resolveDiarizationModels, resolveDiarizerBinary } from './native-runtime'
const run = promisify(execFile)
const ENGINE = 'fluidaudio-offline-vbx'
const ENGINE_REVISION = '300165b240c45375add402265f62410b6df33cf1'
export const missingDiarizationAssetsMessage = (): string => 'Speaker labeling assets are missing or invalid.'
export async function diarizationAssetsAvailable(): Promise<boolean> {
  const binary = resolveDiarizerBinary()
  if (!await isExecutableFile(binary)) return false
  const root = path.join(resolveDiarizationModels(), 'speaker-diarization')
  try {
    const version = JSON.parse((await run(binary, ['--version'], { encoding: 'utf8', timeout: 5_000 })).stdout)
    if (version.schemaVersion !== 1 || version.engine !== ENGINE || version.engineRevision !== ENGINE_REVISION) return false
    const lines = (await readFile(path.join(root, 'SHA256SUMS'), 'utf8')).trim().split('\n')
    if (!lines.length) return false
    for (const line of lines) {
      const match = /^([0-9a-f]{64})  (.+)$/.exec(line)
      if (!match) return false
      const file = path.resolve(root, match[2])
      if (!file.startsWith(`${path.resolve(root)}${path.sep}`)) return false
      if (createHash('sha256').update(await readFile(file)).digest('hex') !== match[1]) return false
    }
    return true
  } catch { return false }
}
