import { afterEach, describe, expect, setSystemTime, test } from "bun:test"
import { today } from "../src/components/Upload/types"

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
