import { useCallback, useEffect, useState } from 'react'
import type { SavedAgendaDraft } from '../../shared/agenda-draft'
import type { SavedPerson } from '../../shared/participant-contract'
import { AGENDA_DRAFTS_ENABLED } from '../lib/features'

/** No saved drafts load while Agenda drafts are hidden, so no chip, row, or search hit shows them. */
export function useSavedDrafts(): [SavedAgendaDraft[], () => void] {
  const [drafts, setDrafts] = useState<SavedAgendaDraft[]>([])
  const reload = useCallback(() => { if (AGENDA_DRAFTS_ENABLED) void window.gappd.agenda.list().then(setDrafts).catch(() => setDrafts([])) }, [])
  useEffect(() => { reload() }, [reload])
  return [drafts, reload]
}

export function useSavedPeople(): [SavedPerson[], (people: SavedPerson[]) => void] {
  const [people, setPeople] = useState<SavedPerson[]>([])
  useEffect(() => {
    let active = true
    void window.gappd.meetings.people().then((next) => { if (active) setPeople(next) }).catch(() => undefined)
    return () => { active = false }
  }, [])
  return [people, setPeople]
}
