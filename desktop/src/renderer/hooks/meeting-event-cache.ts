import type { CalendarEventSummary } from '../../shared/calendar-contract'
import type { LinkCalendarInput, ParticipantContext } from '../../shared/participant-contract'

type EventLoader = (id: string) => Promise<CalendarEventSummary | undefined>

/** A confirmed local link change invalidates any older asynchronous lookup. */
export class MeetingEventCache {
  private generation = 0
  private events = new Map<string, CalendarEventSummary>()
  private mutations = new Map<string, Promise<ParticipantContext>>()

  update(id: string, event?: CalendarEventSummary): Map<string, CalendarEventSummary> {
    this.cancel()
    this.events = new Map(this.events)
    if (event) this.events.set(id, event)
    else this.events.delete(id)
    return this.events
  }

  async refresh(ids: string[], load: EventLoader): Promise<Map<string, CalendarEventSummary> | null> {
    const request = ++this.generation
    const pairs = await Promise.all(ids.map(async id => [id, await load(id)] as const))
    if (request !== this.generation) return null
    this.events = new Map(pairs.filter((pair): pair is [string, CalendarEventSummary] => Boolean(pair[1])))
    return this.events
  }

  /** Mutation completion belongs to the shared owner, not a mounted speaker pane. */
  link(input: LinkCalendarInput, write: (input: LinkCalendarInput) => Promise<ParticipantContext>, publish: (events: Map<string, CalendarEventSummary>) => void): Promise<ParticipantContext> {
    const previous = this.mutations.get(input.id) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(() => write(input)).then(context => {
      publish(this.update(input.id, context.event))
      return context
    })
    this.mutations.set(input.id, current)
    const clear = () => { if (this.mutations.get(input.id) === current) this.mutations.delete(input.id) }
    void current.then(clear, clear)
    return current
  }

  cancel(): void { this.generation += 1 }
}
