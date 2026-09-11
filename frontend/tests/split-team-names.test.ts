import { describe, expect, test } from "bun:test"
import { HAS_TEAM_SEPARATOR, splitTeamNames } from "@/lib/splitTeamNames"

describe("splitTeamNames", () => {
  test("splits on commas", () => {
    expect(splitTeamNames("Alice Smith, Bob Jones, Carol Ng")).toEqual([
      "Alice Smith",
      "Bob Jones",
      "Carol Ng",
    ])
  })

  test("splits on ampersands", () => {
    expect(splitTeamNames("Alice&Bob")).toEqual(["Alice", "Bob"])
  })

  test("splits on a standalone and", () => {
    expect(splitTeamNames("Alice and Bob")).toEqual(["Alice", "Bob"])
  })

  test("mixes separators", () => {
    expect(splitTeamNames("Alice, Bob and Carol & Dave")).toEqual([
      "Alice",
      "Bob",
      "Carol",
      "Dave",
    ])
  })

  test("keeps Alexander intact", () => {
    expect(splitTeamNames("Alexander Reid")).toEqual(["Alexander Reid"])
  })

  test("keeps Sandy intact", () => {
    expect(splitTeamNames("Sandy Duncan")).toEqual(["Sandy Duncan"])
  })

  test("collapses internal whitespace and trims", () => {
    expect(splitTeamNames("  Alice   Smith ,  Bob  ")).toEqual([
      "Alice Smith",
      "Bob",
    ])
  })

  test("drops empty segments", () => {
    expect(splitTeamNames("Alice,,Bob,")).toEqual(["Alice", "Bob"])
  })

  test("returns nothing for an empty cell", () => {
    expect(splitTeamNames("   ")).toEqual([])
  })
})

describe("HAS_TEAM_SEPARATOR", () => {
  test("detects a comma", () => {
    expect(HAS_TEAM_SEPARATOR.test("Alice, Bob")).toBe(true)
  })

  test("does not fire on Alexander", () => {
    expect(HAS_TEAM_SEPARATOR.test("Alexander Reid")).toBe(false)
  })

  test("is stateless across calls", () => {
    expect(HAS_TEAM_SEPARATOR.test("Alice, Bob")).toBe(true)
    expect(HAS_TEAM_SEPARATOR.test("Alice, Bob")).toBe(true)
  })
})
