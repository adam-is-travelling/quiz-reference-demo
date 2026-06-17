import { afterEach, describe, expect, setSystemTime, test } from "bun:test"
import { emptyEventMeta, today } from "../src/components/Upload/types"

describe("today", () => {
  afterEach(() => setSystemTime())

  test("returns a string in YYYY-MM-DD format", () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test("formats a fixed date correctly using local time", () => {
    // Month arg is 0-indexed: 2 = March. This verifies +1 padding.
    setSystemTime(new Date(2024, 2, 5))
    expect(today()).toBe("2024-03-05")
  })
})

describe("emptyEventMeta", () => {
  afterEach(() => setSystemTime())

  test("start_date and end_date both equal today (single-day invariant)", () => {
    setSystemTime(new Date(2024, 2, 5))
    const meta = emptyEventMeta()
    expect(meta.start_date).toBe("2024-03-05")
    expect(meta.end_date).toBe("2024-03-05")
  })

  test("returns a fresh date on each call", () => {
    setSystemTime(new Date(2024, 2, 5))
    const a = emptyEventMeta()
    setSystemTime(new Date(2024, 2, 6))
    const b = emptyEventMeta()
    expect(a.start_date).toBe("2024-03-05")
    expect(b.start_date).toBe("2024-03-06")
  })

  test("string fields default to empty string, organizer_name defaults to null", () => {
    const meta = emptyEventMeta()
    expect(meta.name).toBe("")
    expect(meta.organizer_name).toBeNull()
    expect(meta.description).toBe("")
    expect(meta.series_id).toBe("")
    expect(meta.organization_id).toBe("")
    expect(meta.format_id).toBe("")
  })
})
