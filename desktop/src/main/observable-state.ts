export type ObservableState<T> = {
  get(): T
  set(next: T): void
  subscribe(listener: (value: T) => void): () => void
}

export function createObservableState<T>(initial: T): ObservableState<T> {
  let value = initial
  const listeners = new Set<(value: T) => void>()
  return {
    get: () => value,
    set(next: T) {
      value = next
      for (const listener of listeners) listener(value)
    },
    subscribe(listener: (value: T) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
