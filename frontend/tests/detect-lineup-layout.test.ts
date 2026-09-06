import { describe, expect, test } from "bun:test"
import {
  detectLineupLayout,
  detectNumberedColumns,
} from "@/lib/detectLineupLayout"

describe("detectNumberedColumns", () => {
  test("finds numbered player headers in header order", () => {
    const header = ["Team", "Player 2", "Player 1", "Score"]
    expect(detectNumberedColumns(header, new Set())).toEqual([1, 2])
  })

  test("accepts member and name variants, with or without a space", () => {
    const header = ["Team", "Member1", "name 2", "Player3"]
    expect(detectNumberedColumns(header, new Set())).toEqual([1, 2, 3])
  })

  test("skips claimed columns", () => {
    const header = ["Player 1", "Player 2"]
    expect(detectNumberedColumns(header, new Set([0]))).toEqual([1])
  })

  test("ignores an unnumbered player header", () => {
    expect(detectNumberedColumns(["Player", "Team"], new Set())).toEqual([])
  })
})

describe("detectLineupLayout", () => {
  test("a majority of separator-bearing cells wins outright", () => {
    const rows = [
      ["Team", "Players", "Score"],
      ["England A", "Alice, Bob", "100"],
      ["Scotland", "Carol & Dave", "90"],
      ["Wales", "Erin", "80"],
    ]
    expect(detectLineupLayout(rows, rows[0], new Set([0]))).toEqual({
      layout: "combined",
      lineup_combined: 1,
      lineup_columns: [],
    })
  })

  test("falls back to numbered columns when no separators are present", () => {
    const rows = [
      ["Team", "Player 1", "Player 2", "Score"],
      ["England A", "Alice", "Bob", "100"],
      ["Scotland", "Carol", "Dave", "90"],
    ]
    expect(detectLineupLayout(rows, rows[0], new Set([0]))).toEqual({
      layout: "numbered-columns",
      lineup_combined: null,
      lineup_columns: [1, 2],
    })
  })

  test("a single numbered column is not enough to choose that layout", () => {
    const rows = [
      ["Team", "Player 1", "Score"],
      ["England A", "Alice", "100"],
    ]
    expect(detectLineupLayout(rows, rows[0], new Set([0]))).toEqual({
      layout: "combined",
      lineup_combined: null,
      lineup_columns: [],
    })
  })

  test("defaults to combined with the detected name column", () => {
    const rows = [
      ["Team", "Players", "Score"],
      ["England A", "Alice", "100"],
      ["Scotland", "Bob", "90"],
    ]
    expect(detectLineupLayout(rows, rows[0], new Set([0]))).toEqual({
      layout: "combined",
      lineup_combined: 1,
      lineup_columns: [],
    })
  })

  test("returns an unmapped combined column when there is no lineup column", () => {
    const rows = [
      ["Team", "Score"],
      ["England A", "100"],
    ]
    expect(detectLineupLayout(rows, rows[0], new Set([0]))).toEqual({
      layout: "combined",
      lineup_combined: null,
      lineup_columns: [],
    })
  })
})
