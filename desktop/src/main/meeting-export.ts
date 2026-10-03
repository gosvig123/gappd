import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { dialog } from 'electron'
import { resolveBinary } from './binaries'
import { meetingMediaPath } from './meeting-media'
import { showMeeting } from './meetings'

const run = promisify(execFile)

export async function exportRecording(id: string): Promise<boolean> {
  try { return await exportMeetingFile(id) }
  catch (cause) {
    console.error('Export recording failed:', cause)
    throw new Error('Could not export this Meeting. Check its video, both audio files, and the destination space or permissions; then retry. The Meeting was kept.')
  }
}

async function exportMeetingFile(id: string): Promise<boolean> {
  const meeting = await showMeeting(id)
  const clock = meeting.status.video
  if ((clock.state !== 'ready' && clock.state !== 'ended') || clock.endSec === undefined || !clock.videoStartHostSec || !clock.micStartHostSec || !clock.systemStartHostSec) {
    throw new Error('Export needs a finalized Screen video and measured start times for both voices.')
  }
  // Validate all source paths in main before invoking the helper; renderer sees no path.
  const [video, mic, system] = await Promise.all([meetingMediaPath(id, 'video'), meetingMediaPath(id, 'mic'), meetingMediaPath(id, 'system')])
  const { canceled, filePath } = await dialog.showSaveDialog({ title: 'Export recording', defaultPath: `${meeting.title || 'Meeting'}.mp4`, filters: [{ name: 'MP4 movie', extensions: ['mp4'] }], message: 'This copy is outside Gappd. Deleting the Meeting will not delete the exported recording.' })
  if (canceled || !filePath) return false
  const tempDir = await fs.mkdtemp(path.join(path.dirname(filePath), '.gappd-export-'))
  const output = path.join(tempDir, 'recording.mp4')
  try {
    const helper = resolveBinary({ packaged: ['bin', 'gappd-export'], dev: ['..', 'build', 'gappd-export'] })
    await run(helper, [video, mic, system, output, String(clock.videoStartHostSec), String(clock.micStartHostSec), String(clock.systemStartHostSec)], { timeout: 600_000 })
    if ((await fs.stat(output)).size === 0) throw new Error('Export produced an empty movie')
    await fs.rename(output, filePath)
    return true
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}
