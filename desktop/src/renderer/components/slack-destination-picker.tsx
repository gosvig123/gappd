import { useEffect, useState } from 'react'
import type { SlackDestinationOption } from '../../shared/slack-contract'
import { Button } from './ui'

const KIND_LABELS = { channel: 'Channel', 'private-channel': 'Private channel', dm: 'DM', 'group-dm': 'Group DM' }

/** Browses memberships only; pasted links remain available for thread replies. */
export function SlackDestinationPicker({ value, onChange, disabled }: { value: string; onChange(value: string): void; disabled: boolean }) {
  const [destinations, setDestinations] = useState<SlackDestinationOption[]>([])
  const [cursor, setCursor] = useState('')
  const [nextCursor, setNextCursor] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    window.gappd.slack.destinations(cursor).then(page => {
      if (!active) return
      setDestinations(previous => [...new Map([...previous, ...page.destinations].map(item => [item.channelId, item])).values()])
      setNextCursor(page.nextCursor)
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not load Slack destinations. Try again.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [cursor, attempt])

  const visible = destinations.filter(item => `${item.label} ${item.channelId}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const selected = destinations.find(item => item.channelId === value)
  return (
    <div className="slack-destination-picker">
      <label className="field" htmlFor="slack-destination-filter">
        <span>Find a channel or conversation</span>
        <input id="slack-destination-filter" type="search" value={query} disabled={disabled} placeholder="Filter loaded destinations" onChange={event => setQuery(event.target.value)} />
      </label>
      <label className="field" htmlFor="slack-destination-list">
        <span>Choose a destination</span>
        <select id="slack-destination-list" value={selected ? value : ''} disabled={disabled || !destinations.length} onChange={event => { if (event.target.value) onChange(event.target.value) }}>
          <option value="">Choose a channel or conversation…</option>
          {selected && !visible.includes(selected) ? <option value={selected.channelId}>{KIND_LABELS[selected.kind]}: {selected.label}</option> : null}
          {visible.map(item => <option key={item.channelId} value={item.channelId}>{KIND_LABELS[item.kind]}: {item.label}</option>)}
        </select>
      </label>
      <div className="slack-composer-meta" role="status">{loading ? 'Loading Slack destinations…' : `${visible.length} matching destinations loaded.`} Joined channels and existing DMs only.</div>
      {error ? <div className="status-note danger" role="alert">{error}</div> : null}
      <div className="actions-row">
        {error ? <Button disabled={disabled || loading} onClick={() => setAttempt(value => value + 1)}>Retry destinations</Button> : nextCursor ? <Button disabled={disabled || loading} onClick={() => setCursor(nextCursor)}>Load more destinations</Button> : null}
      </div>
    </div>
  )
}
