// Fixed demo clock: Monday 14 September 2026, 09:50. No real account data.
export type Entry = { id: string; title: string; day: string; time: string; kind: 'planned' | 'recorded' | 'draft'; people: string; note: string; linked?: boolean }
export const days = ['2026-09-11', '2026-09-14', '2026-09-15', '2026-09-16']
export const demoEntries: Entry[] = [
  { id: 'planning', title: 'Product planning', day: days[1], time: '10:00', kind: 'planned', people: 'Alex, Sam, you', note: 'Confirm the release scope. Review the two open accessibility issues.' },
  { id: 'design', title: 'Design review', day: days[1], time: '14:00', kind: 'planned', people: 'Morgan, you', note: 'Compare settings navigation. Decide which controls need to stay visible.' },
  { id: 'standup', title: 'Engineering check-in', day: days[1], time: '09:00', kind: 'recorded', people: 'Alex, Sam, you', note: 'The team agreed to finish keyboard navigation before the next release.', linked: true },
  { id: 'research', title: 'Customer research', day: days[2], time: '11:00', kind: 'planned', people: 'Taylor, you', note: 'Ask how the team prepares for recurring Meetings.' },
  { id: 'sync', title: 'Release review', day: days[0], time: '15:30', kind: 'recorded', people: 'Sam, you', note: 'The release is ready for internal testing. Sam will review the setup flow.', linked: true },
  { id: 'adhoc', title: 'Quick conversation with Alex', day: days[0], time: '11:20', kind: 'recorded', people: 'Alex, you', note: 'Agreed to keep Calendar optional. Local recording must work without an account.' },
  { id: 'saved', title: 'Partner discussion', day: days[0], time: '10:00', kind: 'draft', people: 'Jamie, you', note: 'Discuss the pilot timeline. Confirm who owns onboarding.' },
]

export function dateLabel(day: string) {
  return new Date(`${day}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export const variantNames = { A: 'Timeline', B: 'Split view', C: 'Day browser' }
export type Variant = keyof typeof variantNames
