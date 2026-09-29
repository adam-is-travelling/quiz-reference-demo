import type { EventPublic } from "@/client"

export type EventListItem =
  | {
      kind: "series"
      seriesId: string
      seriesName: string
      seriesSlug: string
      events: EventPublic[]
    }
  | { kind: "event"; event: EventPublic }

/**
 * Groups a recurring event's editions under one entry, placed where its
 * first event appears. The API lists events newest first, so a series sits
 * at its latest edition. Events without a series stay as single entries.
 */
export function groupEventsBySeries(events: EventPublic[]): EventListItem[] {
  const items: EventListItem[] = []
  const groups = new Map<string, Extract<EventListItem, { kind: "series" }>>()
  for (const event of events) {
    if (!event.series_id || !event.series_slug) {
      items.push({ kind: "event", event })
      continue
    }
    let group = groups.get(event.series_id)
    if (!group) {
      group = {
        kind: "series",
        seriesId: event.series_id,
        seriesName: event.series_name ?? event.series_slug,
        seriesSlug: event.series_slug,
        events: [],
      }
      groups.set(event.series_id, group)
      items.push(group)
    }
    group.events.push(event)
  }
  return items
}
