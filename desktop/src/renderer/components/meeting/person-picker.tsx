import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { cx } from '../ui'
import { matchPersonOptions, type PersonOption } from './speaker-options'

type Item = { value: string; label: string; detail?: string; tag?: string; action?: boolean }
type Props = { ariaLabel: string; options: PersonOption[]; value: string; clearLabel?: string; newValue: string; disabled?: boolean; onChoose: (value: string, query: string) => void }

// A searchable person menu: type to filter by name or email, arrows to move, Enter to choose, Escape to close.
export function PersonPicker(props: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const shown = props.value === props.newValue ? 'Someone else…' : props.options.find(option => option.value === props.value)?.name ?? ''
  const items = pickerItems(props, query)
  const show = (next: string) => { if (props.disabled) return; setQuery(next); setActive(0); setOpen(true) }
  const close = () => { setOpen(false); setQuery('') }
  const choose = (item: Item) => { if (props.disabled) return; const typed = query.trim(); close(); if (item.value !== props.value || item.value === props.newValue) props.onChoose(item.value, typed) }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (props.disabled || event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) return show(query)
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((active + step + items.length) % items.length)
    } else if (event.key === 'Enter' && open && items[active]) {
      event.preventDefault()
      choose(items[active])
    } else if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  }
  const optionId = (index: number) => `${listId}-${index}`
  return (
    <div className={cx('person-picker', open && 'open')}>
      <input
        ref={inputRef}
        role="combobox"
        aria-label={props.ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-disabled={props.disabled || undefined}
        aria-activedescendant={open && items[active] ? optionId(active) : undefined}
        placeholder={shown ? `${shown} · type to search` : 'Choose a person…'}
        value={open ? query : shown}
        readOnly={props.disabled}
        autoComplete="off"
        spellCheck={false}
        onClick={() => { if (!open) show('') }}
        onBlur={close}
        onChange={event => show(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {open ? <ul id={listId} className="ui-card person-picker-menu" role="listbox" aria-label={props.ariaLabel} onMouseDown={event => event.preventDefault()}>
        {items.map((item, index) => <li
          key={item.value}
          id={optionId(index)}
          role="option"
          aria-selected={index === active}
          className={cx('list-row person-picker-option', index === active && 'active', item.action && 'action', item.value === props.value && 'current')}
          onMouseDown={event => event.preventDefault()}
          onMouseEnter={() => setActive(index)}
          onClick={() => choose(item)}
        ><span>{item.label}</span>{item.detail ? <small>{item.detail}</small> : null}{item.tag ? <em>{item.tag}</em> : null}</li>)}
      </ul> : null}
    </div>
  )
}

function pickerItems(props: Props, query: string): Item[] {
  const typed = query.trim()
  const people: Item[] = matchPersonOptions(props.options, typed).map(person => ({ value: person.value, label: person.name, detail: person.email && person.email !== person.name ? person.email : undefined, tag: person.invited ? 'Invited' : undefined }))
  const clear: Item[] = props.clearLabel && !typed ? [{ value: '', label: props.clearLabel, action: true }] : []
  return [...people, ...clear, { value: props.newValue, label: typed ? `Add “${typed}” as a new person` : 'Someone else…', action: true }]
}
