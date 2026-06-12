import { useEffect } from 'react'

type Guard = (fn: () => void) => void

/**
 * useEffect with a disposal guard: callbacks wrapped in `guard(fn)` are
 * silently dropped once the effect has been cleaned up, so async results and
 * subscription events can't update state after unmount or dependency change.
 * The setup function may return an extra cleanup (e.g. an unsubscribe).
 */
export function useGuardedEffect(setup: (guard: Guard) => (() => void) | void, deps: unknown[]): void {
  useEffect(() => {
    let disposed = false
    const guard: Guard = (fn) => {
      if (!disposed) fn()
    }
    const cleanup = setup(guard)
    return () => {
      disposed = true
      cleanup?.()
    }
  }, deps)
}
