import { useCallback, useEffect, useState } from 'react'

export type ThemeName = 'dark' | 'light'

export const THEME_OPTIONS: ReadonlyArray<{ value: ThemeName; label: string }> = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
]

/** Presentation preference only, so it stays on this Mac and never reaches the Meeting database. */
const STORAGE_KEY = 'gappd.theme'

export function useTheme(): [ThemeName, (theme: ThemeName) => void] {
  const [theme, setTheme] = useState<ThemeName>(readStoredTheme)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    storeTheme(theme)
  }, [theme])
  const choose = useCallback((next: ThemeName) => setTheme(next), [])
  return [theme, choose]
}

function readStoredTheme(): ThemeName {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function storeTheme(theme: ThemeName): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    /* A blocked storage still leaves the theme applied for this session. */
  }
}
