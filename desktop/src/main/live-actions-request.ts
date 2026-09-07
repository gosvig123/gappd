type Hooks<T> = {
  recording(id: string): boolean
  generate(id: string, signal: AbortSignal): Promise<T>
}

export function createLiveActionsRequests<T>(hooks: Hooks<T>) {
  let revision = 0
  const flights = new Map<string, AbortController>()
  function cancelStale() {
    for (const [id, controller] of flights) if (!hooks.recording(id)) controller.abort()
  }
  function generate(id: string): Promise<T> {
    if (!hooks.recording(id)) return Promise.reject(new Error('Draft action items require a recording meeting.'))
    if (flights.has(id)) return Promise.reject(new Error('Draft action items are already generating.'))
    const controller = new AbortController()
    const done = Promise.resolve().then(() => run(id, controller)).finally(() => { flights.delete(id); revision++ })
    revision++
    flights.set(id, controller)
    return done
  }
  async function run(id: string, controller: AbortController): Promise<T> {
    controller.signal.throwIfAborted()
    const result = await hooks.generate(id, controller.signal)
    controller.signal.throwIfAborted()
    if (!hooks.recording(id)) throw new Error('Recording stopped. Draft action items were not updated.')
    return result
  }
  return { generate, cancelStale, revision: () => revision, generating: (id: string) => flights.has(id) }
}
