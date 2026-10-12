import { describe, expect, test } from "bun:test"
import { roundHeaderLabel } from "@/lib/roundLabels"

const format = {
  rounds: ["Entertainment", "Lifestyle", "Science"],
  round_abbreviations: ["Ent", null],
}

describe("roundHeaderLabel", () => {
  test("uses the short name when the round has one", () => {
    expect(roundHeaderLabel(format, 0)).toBe("Ent")
  })

  test("falls back to the full name when the short name is null", () => {
    expect(roundHeaderLabel(format, 1)).toBe("Lifestyle")
  })

  test("falls back to the full name past the end of the short names", () => {
    expect(roundHeaderLabel(format, 2)).toBe("Science")
  })

  test("falls back when the format has no short names at all", () => {
    expect(roundHeaderLabel({ rounds: ["History"] }, 0)).toBe("History")
  })
})
