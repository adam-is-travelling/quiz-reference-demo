import { describe, expect, test } from "bun:test"
import { today } from "../src/components/Upload/types"

describe("today", () => {
  test("returns a string in YYYY-MM-DD format", () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test("returns today's date in local time", () => {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, "0")
    const d = String(now.getDate()).padStart(2, "0")
    expect(today()).toBe(`${y}-${m}-${d}`)
  })
})
