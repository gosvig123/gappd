import { useMemo, useRef } from 'react'

export type RequestGate = {
  next: () => number
  cancel: () => void
  isCurrent: (requestId: number) => boolean
}

export function useRequestGate(): RequestGate {
  const requestRef = useRef(0)
  return useMemo(() => ({
    next: () => advance(requestRef),
    cancel: () => { advance(requestRef) },
    isCurrent: (requestId: number) => requestRef.current === requestId,
  }), [])
}

function advance(ref: { current: number }): number {
  ref.current += 1
  return ref.current
}
