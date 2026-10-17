import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { dialog } from 'electron'
import { resolveBinary } from './binaries'
import { meetingMediaPath } from './meeting-media'
import { showMeeting } from './meetings'
import { resolveFfmpegBinary } from './native-runtime'

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
    const starts = { video: clock.videoStartHostSec, mic: clock.micStartHostSec, system: clock.systemStartHostSec }
    if (video.endsWith('.mp4')) await run(resolveFfmpegBinary(), av1ExportArgs(video, mic, system, output, starts), { timeout: 600_000 })
    else {
      const helper = resolveBinary({ packaged: ['bin', 'gappd-export'], dev: ['..', 'build', 'gappd-export'] })
      await run(helper, [video, mic, system, output, String(starts.video), String(starts.mic), String(starts.system)], { timeout: 600_000 })
    }
    if ((await fs.stat(output)).size === 0) throw new Error('Export produced an empty movie')
    await fs.rename(output, filePath)
    return true
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}

// AV1 Screen video exports through gappd-ffmpeg. dav1d decodes it in software, so Macs without an AV1
// hardware decoder (M1, M2) export it the same way. The output matches the AVFoundation helper's:
// each track starts at its measured host time, both voices mix at full volume, and the movie is H.264 High with mono AAC.
export function av1ExportArgs(video: string, mic: string, system: string, output: string, starts: { video: number, mic: number, system: number }): string[] {
  const origin = Math.min(starts.video, starts.mic, starts.system)
  const delayMs = (start: number) => ((start - origin) * 1000).toFixed(4)
  return [
    '-nostdin', '-hide_banner', '-v', 'error', '-xerror',
    '-itsoffset', (starts.video - origin).toFixed(6), '-c:v', 'libdav1d', '-i', video, '-i', mic, '-i', system,
    '-filter_complex', `[1:a]adelay=delays=${delayMs(starts.mic)}:all=1[m];[2:a]adelay=delays=${delayMs(starts.system)}:all=1[s];[m][s]amix=inputs=2:duration=longest:normalize=0[a]`,
    '-map', '0:v:0', '-map', '[a]', '-fps_mode:v', 'passthrough', '-enc_time_base:v', 'demux',
    '-c:v', 'h264_videotoolbox', '-profile:v', 'high', '-b:v', '4M', '-c:a', 'aac', '-b:a', '32k', '-ac', '1', '-ar', '16000',
    '-movflags', '+faststart', '-f', 'mp4', '-y', output,
  ]
}
