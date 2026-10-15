import { useEffect, useRef, useState } from 'react'

export type SpeakerExcerpt = { speakerKey: string; text?: string; startSec?: number }

export function useSpeakerAudio(meetingId: string) {
  const playback = useAudioPlayback(meetingId)
  const [excerpt, setExcerpt] = useState<SpeakerExcerpt | null>(null)
  const play = (speakerKey: string, index: number) => playSpeakerClip(meetingId, speakerKey, index, playback, setExcerpt)
  return { playing: playback.playing, error: playback.error, stop: playback.stop, play, excerpt }
}

function useAudioPlayback(meetingId: string) {
  const media = useRef<{ audio: HTMLAudioElement; url: string } | null>(null), request = useRef(0)
  const [playing, setPlaying] = useState<string | null>(null), [error, setError] = useState<string | null>(null)
  const stop = () => { request.current++; if (media.current) { media.current.audio.onended = null; media.current.audio.pause(); URL.revokeObjectURL(media.current.url) }; media.current = null; setPlaying(null) }
  useEffect(() => () => stop(), [meetingId])
  return { media, request, playing, setPlaying, error, setError, stop }
}

async function playSpeakerClip(id: string, speakerKey: string, index: number, playback: ReturnType<typeof useAudioPlayback>, setExcerpt: (value: SpeakerExcerpt | null) => void) {
  playback.stop(); playback.setError(null); playback.setPlaying(speakerKey); setExcerpt(null)
  const current = playback.request.current
  try {
    const clip = await window.gappd.meetings.speakerClip({ id, speakerKey, index })
    if (playback.request.current !== current) return
    setExcerpt({ speakerKey, text: clip.text, startSec: clip.startSec })
    const url = URL.createObjectURL(new Blob([Uint8Array.from(atob(clip.audioBase64), char => char.charCodeAt(0))], { type: clip.mimeType }))
    const audio = new Audio(url); playback.media.current = { audio, url }; audio.onended = playback.stop
    await audio.play()
  } catch (cause) { if (playback.request.current === current) { playback.stop(); playback.setError(`Could not play speaker clip: ${cause instanceof Error ? cause.message : String(cause)}`) } }
}
