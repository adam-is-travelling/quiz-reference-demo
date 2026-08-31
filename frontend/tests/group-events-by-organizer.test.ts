import { describe, expect, test } from "bun:test"
import type { EventPublic } from "../src/client"
import { groupEventsByOrganizer } from "../src/components/Events/EventSelect"

const ORG_A = "11111111-1111-1111-1111-111111111111"
const ORG_B = "22222222-2222-2222-2222-222222222222"

function event(
  name: string,
  organizationId: string,
  organizationName: string | null,
): EventPublic {
  return {
    id: `event-${name}`,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    start_date: "2026-06-12",
    end_date: "2026-06-14",
    organization_id: organizationId,
    organization_name: organizationName,
  }
}

describe("groupEventsByOrganizer", () => {
  test("groups events under their organizer, keeping API order", () => {
    const groups = groupEventsByOrganizer([
      event("Autumn Open", ORG_A, "Dublin Quiz League"),
      event("All-Ireland Final", ORG_B, "Cork Trivia Society"),
      event("Winter Cup", ORG_A, "Dublin Quiz League"),
    ])

    expect(
      groups.map((g) => [g.organizationName, g.events.map((e) => e.name)]),
    ).toEqual([
      ["Dublin Quiz League", ["Autumn Open", "Winter Cup"]],
      ["Cork Trivia Society", ["All-Ireland Final"]],
    ])
  })

  test("pins the given organizer's group to the front", () => {
    const groups = groupEventsByOrganizer(
      [
        event("All-Ireland Final", ORG_B, "Cork Trivia Society"),
        event("Autumn Open", ORG_A, "Dublin Quiz League"),
      ],
      ORG_A,
    )

    expect(groups.map((g) => g.organizationName)).toEqual([
      "Dublin Quiz League",
      "Cork Trivia Society",
    ])
  })

  test("leaves order alone when the pinned organizer has no events", () => {
    const groups = groupEventsByOrganizer(
      [
        event("All-Ireland Final", ORG_B, "Cork Trivia Society"),
        event("Autumn Open", ORG_A, "Dublin Quiz League"),
      ],
      "33333333-3333-3333-3333-333333333333",
    )

    expect(groups.map((g) => g.organizationName)).toEqual([
      "Cork Trivia Society",
      "Dublin Quiz League",
    ])
  })

  test("falls back to a placeholder label when the organizer name is missing", () => {
    const groups = groupEventsByOrganizer([event("Orphan Open", ORG_A, null)])

    expect(groups.map((g) => g.organizationName)).toEqual(["Unknown organizer"])
  })

  test("returns no groups for an empty event list", () => {
    expect(groupEventsByOrganizer([])).toEqual([])
  })
})
