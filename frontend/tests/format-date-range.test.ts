import { describe, expect, test } from "bun:test"
import { formatDateRange } from "../src/lib/dates"

describe("formatDateRange", () => {
  test("returns a single date when start and end match", () => {
    expect(formatDateRange("2026-06-12", "2026-06-12")).toBe("2026-06-12")
  })

  test("returns an en-dash range when they differ", () => {
    expect(formatDateRange("2026-06-12", "2026-06-14")).toBe(
      "2026-06-12 – 2026-06-14",
    )
  })
})
