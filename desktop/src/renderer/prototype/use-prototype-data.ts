import { useCallback, useEffect, useState } from 'react'
import type { SavedAgendaDraft } from '../../shared/agenda-draft'
import type { SavedPerson } from '../../shared/participant-contract'

export function useSavedDrafts(): [SavedAgendaDraft[], () => void] {
  const [drafts, setDrafts] = useState<SavedAgendaDraft[]>([])
  const reload = useCallback(() => { void window.gappd.agenda.list().then(setDrafts).catch(() => setDrafts([])) }, [])
  useEffect(() => { reload() }, [reload])
  return [drafts, reload]
}

export function useSavedPeople(): SavedPerson[] {
  const [people, setPeople] = useState<SavedPerson[]>([])
  useEffect(() => { let active = true; void window.gappd.meetings.people().then((next) => { if (active) setPeople(next) }).catch(() => undefined); return () => { active = false } }, [])
  return people
}
