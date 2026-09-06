import { describe, expect, test } from "bun:test"
import type { ColumnMapping } from "@/components/Upload/types"
import type { RowResolution } from "@/lib/matchPlayers"
import { validateUploadRows } from "@/lib/validateUploadRows"

const mapping: ColumnMapping = {
  player_name: 0,
  country: null,
  score: 2,
  position: null,
  rounds: [],
  player_name_2: null,
  pairsLayout: "combined",
  team_name: 0,
  lineupLayout: "combined",
  lineup_combined: 1,
  lineup_columns: [],
}

function resolutions(count: number): RowResolution[] {
  return Array.from({ length: count }, () => ({ participants: [] }))
}

describe("validateUploadRows in teams mode", () => {
  test("accepts a team with a squad", () => {
    const rows = [
      ["Team", "Players", "Score"],
      ["England A", "Alice, Bob", "100"],
    ]
    expect(validateUploadRows(rows, mapping, resolutions(1), "teams")).toEqual([])
  })

  test("accepts a team with no squad", () => {
    const rows = [
      ["Team", "Players", "Score"],
      ["England A", "", "100"],
    ]
    expect(validateUploadRows(rows, mapping, resolutions(1), "teams")).toEqual([])
  })

  test("rejects a blank team name", () => {
    const rows = [
      ["Team", "Players", "Score"],
      ["  ", "Alice", "100"],
    ]
    const errors = validateUploadRows(rows, mapping, resolutions(1), "teams")
    expect(errors).toEqual([{ row: 1, message: "Team name is missing" }])
  })

  test("rejects the same team appearing twice", () => {
    const rows = [
      ["Team", "Players", "Score"],
      ["England A", "Alice", "100"],
      ["england a", "Bob", "90"],
    ]
    const errors = validateUploadRows(rows, mapping, resolutions(2), "teams")
    expect(errors).toEqual([
      { row: 2, message: 'Team "england a" already appears in row 1' },
    ])
  })

  test("rejects the same player in two teams", () => {
    const rows = [
      ["Team", "Players", "Score"],
      ["England A", "Alice", "100"],
      ["Scotland", "alice", "90"],
    ]
    const errors = validateUploadRows(rows, mapping, resolutions(2), "teams")
    expect(errors).toEqual([
      { row: 2, message: '"alice" already appears in row 1' },
    ])
  })

  test("rejects the same player twice within one team", () => {
    const rows = [
      ["Team", "Players", "Score"],
      ["England A", "Alice, Alice", "100"],
    ]
    const errors = validateUploadRows(rows, mapping, resolutions(1), "teams")
    expect(errors).toEqual([
      { row: 1, message: "The same quizzer appears twice in this row" },
    ])
  })

  test("still reports a missing score", () => {
    const rows = [
      ["Team", "Players", "Score"],
      ["England A", "Alice", ""],
    ]
    const errors = validateUploadRows(rows, mapping, resolutions(1), "teams")
    expect(errors).toEqual([{ row: 1, message: "Score is missing" }])
  })

  test("reads numbered lineup columns", () => {
    const numbered: ColumnMapping = {
      ...mapping,
      lineupLayout: "numbered-columns",
      lineup_combined: null,
      lineup_columns: [1, 3],
      score: 2,
    }
    const rows = [
      ["Team", "Player 1", "Score", "Player 2"],
      ["England A", "Alice", "100", "Alice"],
    ]
    const errors = validateUploadRows(rows, numbered, resolutions(1), "teams")
    expect(errors).toEqual([
      { row: 1, message: "The same quizzer appears twice in this row" },
    ])
  })
})
