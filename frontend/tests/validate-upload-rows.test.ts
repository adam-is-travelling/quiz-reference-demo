import { describe, expect, test } from "bun:test"
import type { ColumnMapping } from "../src/components/Upload/types"
import type { RowResolution } from "../src/lib/matchPlayers"
import { validateUploadRows } from "../src/lib/validateUploadRows"

const baseMapping: ColumnMapping = {
  player_name: 0,
  player_name_2: null,
  pairsLayout: "combined",
  country: 1,
  score: 2,
  position: null,
  rounds: [],
}

function resolution(): RowResolution {
  return { participants: [{ player_id: "some-id", player_create: null }] }
}

describe("validateUploadRows", () => {
  test("returns no errors for clean rows", () => {
    const parsedRows = [
      ["Name", "Country", "Score"],
      ["Alice", "Ireland", "50"],
    ]
    const errors = validateUploadRows(
      parsedRows,
      baseMapping,
      [resolution()],
      "individual",
    )
    expect(errors).toEqual([])
  })

  test("flags a missing player name", () => {
    const parsedRows = [
      ["Name", "Country", "Score"],
      ["", "Ireland", "50"],
    ]
    const errors = validateUploadRows(
      parsedRows,
      baseMapping,
      [resolution()],
      "individual",
    )
    expect(errors).toEqual([{ row: 1, message: "Player name is missing" }])
  })

  test("flags a missing score", () => {
    const parsedRows = [
      ["Name", "Country", "Score"],
      ["Alice", "Ireland", ""],
    ]
    const errors = validateUploadRows(
      parsedRows,
      baseMapping,
      [resolution()],
      "individual",
    )
    expect(errors).toEqual([{ row: 1, message: "Score is missing" }])
  })

  test("flags a non-numeric score", () => {
    const parsedRows = [
      ["Name", "Country", "Score"],
      ["Alice", "Ireland", "DNF"],
    ]
    const errors = validateUploadRows(
      parsedRows,
      baseMapping,
      [resolution()],
      "individual",
    )
    expect(errors).toEqual([{ row: 1, message: 'Score "DNF" is not a number' }])
  })

  test("allows a blank round score but flags a non-numeric one", () => {
    const mapping: ColumnMapping = { ...baseMapping, rounds: [3, 4] }
    const parsedRows = [
      ["Name", "Country", "Score", "R1", "R2"],
      ["Alice", "Ireland", "50", "", "bad"],
    ]
    const errors = validateUploadRows(
      parsedRows,
      mapping,
      [resolution()],
      "individual",
    )
    expect(errors).toEqual([
      { row: 1, message: 'Round 2 score "bad" is not a number' },
    ])
  })

  test("uses the player_create display_name when present", () => {
    const parsedRows = [
      ["Name", "Country", "Score"],
      ["", "Ireland", "50"],
    ]
    const resolutions: RowResolution[] = [
      {
        participants: [
          {
            player_id: null,
            player_create: { display_name: "New Player", countries: ["IE"] },
          },
        ],
      },
    ]
    const errors = validateUploadRows(
      parsedRows,
      baseMapping,
      resolutions,
      "individual",
    )
    expect(errors).toEqual([])
  })
})

const pairsMapping: ColumnMapping = {
  player_name: 0,
  player_name_2: null,
  pairsLayout: "combined",
  country: 1,
  score: 2,
  position: null,
  rounds: [],
}

function pairResolution(): RowResolution {
  return {
    participants: [
      { player_id: "a1", player_create: null },
      { player_id: "b1", player_create: null },
    ],
  }
}

describe("validateUploadRows — pairs", () => {
  test("accepts a well-formed pair", () => {
    const parsedRows = [
      ["Team", "Country", "Score"],
      ["Alice & Bob", "Ireland", "50"],
    ]
    expect(
      validateUploadRows(parsedRows, pairsMapping, [pairResolution()], "pairs"),
    ).toEqual([])
  })

  test("accepts a solo entry without complaint", () => {
    const parsedRows = [
      ["Team", "Country", "Score"],
      ["Alice", "Ireland", "50"],
    ]
    const resolutions: RowResolution[] = [
      { participants: [{ player_id: "a1", player_create: null }] },
    ]
    expect(
      validateUploadRows(parsedRows, pairsMapping, resolutions, "pairs"),
    ).toEqual([])
  })

  test("rejects three names", () => {
    const parsedRows = [
      ["Team", "Country", "Score"],
      ["Alice & Bob & Carol", "Ireland", "50"],
    ]
    const errors = validateUploadRows(
      parsedRows,
      pairsMapping,
      [pairResolution()],
      "pairs",
    )
    expect(errors).toEqual([
      {
        row: 1,
        message:
          'Expected at most two quizzers, found 3 ("Alice & Bob & Carol")',
      },
    ])
  })

  test("rejects the same person twice", () => {
    const parsedRows = [
      ["Team", "Country", "Score"],
      ["Alice & Alice", "Ireland", "50"],
    ]
    const errors = validateUploadRows(
      parsedRows,
      pairsMapping,
      [pairResolution()],
      "pairs",
    )
    expect(errors).toEqual([
      { row: 1, message: "The same quizzer appears twice in this row" },
    ])
  })

  test("still flags a missing name", () => {
    const parsedRows = [
      ["Team", "Country", "Score"],
      ["", "Ireland", "50"],
    ]
    const errors = validateUploadRows(
      parsedRows,
      pairsMapping,
      [{ participants: [] }],
      "pairs",
    )
    expect(errors).toEqual([{ row: 1, message: "Player name is missing" }])
  })
})
