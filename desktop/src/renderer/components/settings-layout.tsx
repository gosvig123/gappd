import { type ReactNode, useId, useState } from 'react'
import './settings-layout.css'

type SettingsCategory = { label: string; content: ReactNode }

/** Keep panels mounted so switching categories preserves unsaved provider fields. */
export function SettingsLayout({ categories, initialCategory }: { categories: SettingsCategory[]; initialCategory?: string }) {
  const [selected, setSelected] = useState(initialCategory ?? categories[0]?.label)
  const id = useId()
  const active = categories.some(category => category.label === selected) ? selected : categories[0]?.label
  return <div className="settings-layout">
    <nav className="settings-navigation" aria-label="Settings categories">
      {categories.map((category, index) => <button key={category.label} type="button"
        aria-current={category.label === active ? 'page' : undefined} aria-controls={`${id}-${index}`}
        onClick={() => setSelected(category.label)}>{category.label}</button>)}
    </nav>
    <div className="settings-category-area">
      {categories.map((category, index) => <section key={category.label} id={`${id}-${index}`}
        className="settings-category ui-scroll" hidden={category.label !== active} aria-labelledby={`${id}-${index}-heading`}>
        <h2 id={`${id}-${index}-heading`} className="settings-category-title">{category.label}</h2>
        <div className="settings-stack settings-stack-plain">{category.content}</div>
      </section>)}
    </div>
  </div>
}
