export const EMPTY_TITLE = 'Untitled meeting'

export function dateLabel(value: string): string {
  return new Date(value).toLocaleString()
}
