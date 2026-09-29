import { describe, expect, test } from "bun:test"
import type { EventPublic } from "../src/client"
import { groupEventsBySeries } from "../src/lib/groupEventsBySeries"

function event(name: string, series: string | null): EventPublic {
  return {
    id: `id-${name}`,
    slug: name,
    name,
    start_date: "2026-01-01",
    end_date: "2026-01-01",
    organization_id: "org",
    series_id: series ? `sid-${series}` : null,
    series_name: series ? `Series ${series}` : null,
    series_slug: series,
  }
}

describe("groupEventsBySeries", () => {
  test("groups a series' events where its first (newest) event appears", () => {
    const items = groupEventsBySeries([
      event("tn-2026", "tn"),
      event("solo", null),
      event("tn-2025", "tn"),
    ])
    expect(items.map((i) => i.kind)).toEqual(["series", "event"])
    const group = items[0]
    if (group.kind !== "series") throw new Error("expected a series group")
    expect(group.seriesName).toBe("Series tn")
    expect(group.seriesSlug).toBe("tn")
    expect(group.events.map((e) => e.slug)).toEqual(["tn-2026", "tn-2025"])
  })

  test("events without a series stay as single rows in API order", () => {
    const items = groupEventsBySeries([event("a", null), event("b", null)])
    expect(items).toEqual([
      { kind: "event", event: event("a", null) },
      { kind: "event", event: event("b", null) },
    ])
  })

  test("empty input gives no items", () => {
    expect(groupEventsBySeries([])).toEqual([])
  })
})
