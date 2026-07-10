import { describe, expect, test } from "bun:test"
import type { ColumnMapping, Resolution } from "../src/components/Upload/types"
import { validateUploadRows } from "../src/lib/validateUploadRows"

const baseMapping: ColumnMapping = {
  player_name: 0,
  country: 1,
  score: 2,
  position: null,
  rounds: [],
}

function resolution(): Resolution {
  return { player_id: "some-id", player_create: null }
}

describe("validateUploadRows", () => {
  test("returns no errors for clean rows", () => {
    const parsedRows = [
      ["Name", "Country", "Score"],
      ["Alice", "Ireland", "50"],
    ]
    const errors = validateUploadRows(parsedRows, baseMapping, [resolution()])
    expect(errors).toEqual([])
  })

  test("flags a missing player name", () => {
    const parsedRows = [
      ["Name", "Country", "Score"],
      ["", "Ireland", "50"],
    ]
    const errors = validateUploadRows(parsedRows, baseMapping, [resolution()])
    expect(errors).toEqual([{ row: 1, message: "Player name is missing" }])
  })

  test("flags a missing score", () => {
    const parsedRows = [
      ["Name", "Country", "Score"],
      ["Alice", "Ireland", ""],
    ]
    const errors = validateUploadRows(parsedRows, baseMapping, [resolution()])
    expect(errors).toEqual([{ row: 1, message: "Score is missing" }])
  })

  test("flags a non-numeric score", () => {
    const parsedRows = [
      ["Name", "Country", "Score"],
      ["Alice", "Ireland", "DNF"],
    ]
    const errors = validateUploadRows(parsedRows, baseMapping, [resolution()])
    expect(errors).toEqual([{ row: 1, message: 'Score "DNF" is not a number' }])
  })

  test("allows a blank round score but flags a non-numeric one", () => {
    const mapping: ColumnMapping = { ...baseMapping, rounds: [3, 4] }
    const parsedRows = [
      ["Name", "Country", "Score", "R1", "R2"],
      ["Alice", "Ireland", "50", "", "bad"],
    ]
    const errors = validateUploadRows(parsedRows, mapping, [resolution()])
    expect(errors).toEqual([
      { row: 1, message: 'Round 2 score "bad" is not a number' },
    ])
  })

  test("uses the player_create display_name when present", () => {
    const parsedRows = [
      ["Name", "Country", "Score"],
      ["", "Ireland", "50"],
    ]
    const resolutions: Resolution[] = [
      {
        player_id: null,
        player_create: { display_name: "New Player", countries: ["IE"] },
      },
    ]
    const errors = validateUploadRows(parsedRows, baseMapping, resolutions)
    expect(errors).toEqual([])
  })
})
