import { describe, expect, test } from "bun:test"
import { findNeighbours } from "../src/lib/seriesNeighbours"

function item(id: string, start_date: string, name = id) {
  return { id, name, start_date }
}

describe("findNeighbours", () => {
  const items = [
    item("c", "2027-08-01"),
    item("a", "2025-08-01"),
    item("b", "2026-08-01"),
  ]

  test("a middle item has both neighbours, by date", () => {
    const { previous, next } = findNeighbours(items, "b")
    expect(previous?.id).toBe("a")
    expect(next?.id).toBe("c")
  })

  test("the first item has no previous", () => {
    const { previous, next } = findNeighbours(items, "a")
    expect(previous).toBeNull()
    expect(next?.id).toBe("b")
  })

  test("the last item has no next", () => {
    const { previous, next } = findNeighbours(items, "c")
    expect(previous?.id).toBe("b")
    expect(next).toBeNull()
  })

  test("an item missing from the list gets no neighbours", () => {
    expect(findNeighbours(items, "zzz")).toEqual({ previous: null, next: null })
  })

  test("a single-item series has no neighbours", () => {
    expect(findNeighbours([item("a", "2025-01-01")], "a")).toEqual({
      previous: null,
      next: null,
    })
  })

  test("same-day items order by name so neighbours are stable", () => {
    const sameDay = [
      item("2", "2026-08-07", "Final"),
      item("1", "2026-08-07", "Heat"),
      item("3", "2026-08-07", "Semi"),
    ]
    const { previous, next } = findNeighbours(sameDay, "1")
    expect(previous?.name).toBe("Final")
    expect(next?.name).toBe("Semi")
  })
})
