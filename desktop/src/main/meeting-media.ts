import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import { requestCommand } from './app-protocol'

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FILES = { video: 'screen.mov', mic: 'mic.wav', system: 'system.wav' } as const
export type MediaKind = keyof typeof FILES

// The Go request owns Meeting lookup and validates its managed movie. Never give its path to the renderer.
export async function meetingMediaPath(id: string, kind: MediaKind): Promise<string> {
  if (!ID.test(id) || !Object.hasOwn(FILES, kind)) throw new Error('Invalid Meeting media request')
  const asset = await requestCommand('meetings.videoAsset', { id })
  const directory = path.dirname(asset.path)
  if (path.basename(asset.path) !== FILES.video) throw new Error('Invalid managed movie')
  const file = path.join(directory, FILES[kind])
  const [realDirectory, realFile, info] = await Promise.all([fs.realpath(directory), fs.realpath(file), fs.lstat(file)])
  if (realDirectory !== directory || realFile !== file || !info.isFile() || info.isSymbolicLink()) throw new Error('Invalid managed media')
  return file
}

export function registerMeetingMedia(): void {
  protocol.handle('gappd-media', async (request) => {
    let fileHandle: Awaited<ReturnType<typeof fs.open>> | undefined
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'meeting' || request.method !== 'GET') return new Response(null, { status: 400 })
      const match = /^\/([0-9a-f-]+)\/(video|mic|system)$/.exec(url.pathname)
      if (!match || url.search || url.hash) return new Response(null, { status: 400 })
      const file = await meetingMediaPath(match[1], match[2] as MediaKind)
      fileHandle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
      const info = await fileHandle.stat()
      if (!info.isFile() || !info.size) throw new Error('Missing media')
      const range = parseRange(request.headers.get('range'), info.size)
      if (!range) { await fileHandle.close(); return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}` } }) }
      const [start, end] = range
      const stream = fileHandle.createReadStream({ start, end, autoClose: true })
      fileHandle = undefined
      return new Response(Readable.toWeb(stream) as ReadableStream, { status: request.headers.has('range') ? 206 : 200, headers: {
        'Content-Type': match[2] === 'video' ? 'video/quicktime' : 'audio/wav',
        'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1),
        ...(request.headers.has('range') ? { 'Content-Range': `bytes ${start}-${end}/${info.size}` } : {}),
      } })
    } catch { await fileHandle?.close(); return new Response(null, { status: 404 }) }
  })
}

export function parseRange(header: string | null, size: number): [number, number] | null {
  if (!header) return [0, size - 1]
  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (!match || (!match[1] && !match[2])) return null
  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
  let end = match[2] && match[1] ? Number(match[2]) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || (!match[1] && Number(match[2]) === 0) || start >= size || start > end || end < 0) return null
  return [start, Math.min(end, size - 1)]
}
