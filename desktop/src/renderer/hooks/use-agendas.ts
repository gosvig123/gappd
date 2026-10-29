import { useEffect, useState } from 'react'
import type { Agenda } from '../../shared/agenda'

/** Saved Agendas by Calendar event key; automatic drafts and saves arrive as change events. */
export function useAgendas(): Record<string, Agenda> | null {
  const [agendas, setAgendas] = useState<Record<string, Agenda> | null>(null)
  useEffect(() => {
    let active = true
    let changed = false
    const off = window.gappd.agenda.onChanged((next) => { changed = true; setAgendas(next) })
    window.gappd.agenda.list()
      .then((next) => { if (active && !changed) setAgendas(next) })
      .catch((error) => console.error('Load agendas failed; reopen the app to try again', error))
    return () => { active = false; off() }
  }, [])
  return agendas
}
