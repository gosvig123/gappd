export function readParam(name: string): string | null {
  try { return new URLSearchParams(window.location.search).get(name) } catch { return null }
}

/** Keeps the chosen variant shareable and reload-stable. Falls back to memory when the URL is read-only. */
export function writeParams(patch: Record<string, string>): void {
  try {
    const params = new URLSearchParams(window.location.search)
    for (const [name, value] of Object.entries(patch)) params.set(name, value)
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`)
  } catch {
    /* Sandboxed or file URL: the variant still lives in React state. */
  }
}
