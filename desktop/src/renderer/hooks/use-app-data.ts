import { useEffect, useState } from 'react'
import type { SavedPerson } from '../../shared/participant-contract'

export function useSavedPeople(): [SavedPerson[], (people: SavedPerson[]) => void] {
  const [people, setPeople] = useState<SavedPerson[]>([])
  useEffect(() => {
    let active = true
    void window.gappd.meetings.people().then((next) => { if (active) setPeople(next) }).catch(() => undefined)
    return () => { active = false }
  }, [])
  return [people, setPeople]
}
