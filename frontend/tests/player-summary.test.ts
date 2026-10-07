import { describe, expect, test } from "bun:test"
import { playerSummary } from "../src/lib/playerSummary"

describe("playerSummary", () => {
  test("spans the first and last year", () => {
    expect(playerSummary(12, 2015, 2024)).toBe(
      "Competed in 12 quizzes between 2015 and 2024",
    )
  })

  test("names a single year when every quiz was in it", () => {
    expect(playerSummary(3, 2024, 2024)).toBe("Competed in 3 quizzes in 2024")
  })

  test("uses the singular for one quiz", () => {
    expect(playerSummary(1, 2024, 2024)).toBe("Competed in 1 quiz in 2024")
  })

  test("says so when the player has no results", () => {
    expect(playerSummary(0, null, null)).toBe("No quizzes yet")
  })
})
