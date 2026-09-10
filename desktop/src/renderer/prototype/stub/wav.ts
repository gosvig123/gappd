/** A short audible tone so speaker-preview buttons behave like the real app. */

const SAMPLE_RATE = 8000
const DURATION_SEC = 0.35
const FREQUENCY = 330

export function toneClip(): { audioBase64: string; mimeType: string } {
  const samples = Math.floor(SAMPLE_RATE * DURATION_SEC)
  const bytes = new Uint8Array(44 + samples * 2)
  const view = new DataView(bytes.buffer)
  writeHeader(view, samples)
  for (let index = 0; index < samples; index += 1) {
    const fade = Math.min(1, index / 400, (samples - index) / 400)
    view.setInt16(44 + index * 2, Math.sin((2 * Math.PI * FREQUENCY * index) / SAMPLE_RATE) * 9000 * fade, true)
  }
  return { audioBase64: toBase64(bytes), mimeType: 'audio/wav' }
}

function writeHeader(view: DataView, samples: number): void {
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, samples * 2, true)
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index))
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
