import { useCallback, useEffect, useRef, useState } from 'react'
import { AgendaDraftSession, type AgendaSessionState, type AgendaPort, type AgendaScheduler } from './agenda-draft-session'
export type { AgendaSaveState } from './agenda-draft-session'

const browserScheduler: AgendaScheduler = {
  schedule: (work, delayMs) => window.setTimeout(work, delayMs),
  cancel: (handle) => window.clearTimeout(handle as number),
}

const port: AgendaPort = {
  load: (draftKey) => window.gappd.agenda.load(draftKey),
  save: (input) => window.gappd.agenda.save(input),
  remove: (draftKey) => window.gappd.agenda.remove(draftKey),
  generate: (input) => window.gappd.googleCalendar.generateAgenda(input),
  now: () => new Date().toISOString(),
}

export type AgendaDraftController = AgendaSessionState & {
  setTopics(topics: string[]): void
  generate(slackChannelIds?: string[]): Promise<void>
  retrySave(): Promise<void>
  reload(): Promise<void>
  remove(): Promise<void>
}

/**
 * Binds one draft session to React state. A new draft key always starts a new
 * session, so a late response from a previous event cannot touch this one.
 */
export function useAgendaDraft(draftKey: string, sourceId: string): AgendaDraftController {
  const [state, setState] = useState<AgendaSessionState>(() => ({ ...INITIAL_STATE, draftKey, sourceId }))
  const sessionRef = useRef<AgendaDraftSession | null>(null)
  useEffect(() => {
    const session = new AgendaDraftSession(port, { onState: setState, scheduler: browserScheduler }, { draftKey, sourceId })
    sessionRef.current = session
    void session.start()
    return () => { session.stop(); sessionRef.current = null }
  }, [draftKey, sourceId])
  return {
    ...state,
    setTopics: useCallback((topics) => sessionRef.current?.setTopics(topics), []),
    generate: useCallback((slackChannelIds?: string[]) => sessionRef.current?.generate(slackChannelIds) ?? Promise.resolve(), []),
    retrySave: useCallback(() => sessionRef.current?.retrySave() ?? Promise.resolve(), []),
    reload: useCallback(() => sessionRef.current?.reload() ?? Promise.resolve(), []),
    remove: useCallback(() => sessionRef.current?.remove() ?? Promise.resolve(), []),
  }
}

const INITIAL_STATE: AgendaSessionState = {
  draftKey: '', sourceId: '', draft: null, loading: true, generating: false, saveState: 'clean', error: '', canGenerate: false, topics: [],
}
