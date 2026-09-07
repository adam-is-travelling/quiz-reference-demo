import { describe, expect, test } from "bun:test"
import { computeInitialMapping } from "@/components/Upload/steps/Step3ColumnMapping"
import type { ParticipantMode, WizardState } from "@/components/Upload/types"
import { INITIAL_STATE } from "@/components/Upload/types"

function stateFor(csv: string[][], participantMode: ParticipantMode) {
  return {
    ...INITIAL_STATE,
    participantMode,
    parsedRows: csv,
  } satisfies WizardState
}

function mappingFor(csv: string[][], participantMode: ParticipantMode) {
  return computeInitialMapping(stateFor(csv, participantMode), 0)
}

describe("computeInitialMapping — teams mode does not claim the squad column", () => {
  test("Team,Players,Score keeps the squad column for the lineup", () => {
    const mapping = mappingFor(
      [
        ["Team", "Players", "Score"],
        ["England A", "Alice, Bob", "100"],
        ["Scotland", "Carol & Dave", "90"],
      ],
      "teams",
    )
    expect(mapping.team_name).toBe(0)
    expect(mapping.lineupLayout).toBe("combined")
    expect(mapping.lineup_combined).toBe(1)
    expect(mapping.lineup_columns).toEqual([])
    expect(mapping.score).toBe(2)
  })

  test("Team,Player 1,Player 2,Score maps both numbered squad columns", () => {
    const mapping = mappingFor(
      [
        ["Team", "Player 1", "Player 2", "Score"],
        ["Wales", "Erin", "Frank", "80"],
        ["Ireland", "Gwen", "Hugh", "70"],
      ],
      "teams",
    )
    expect(mapping.team_name).toBe(0)
    expect(mapping.lineupLayout).toBe("numbered-columns")
    expect(mapping.lineup_combined).toBeNull()
    expect(mapping.lineup_columns).toEqual([1, 2])
    expect(mapping.score).toBe(3)
  })

  test("a squad column with no separators still maps as combined", () => {
    const mapping = mappingFor(
      [
        ["Team", "Players", "Score"],
        ["England A", "Alice", "100"],
      ],
      "teams",
    )
    expect(mapping.lineupLayout).toBe("combined")
    expect(mapping.lineup_combined).toBe(1)
  })

  test("player_name is left at its compiled-in default, unread, in teams mode", () => {
    const mapping = mappingFor(
      [
        ["Team", "Players", "Score"],
        ["England A", "Alice, Bob", "100"],
      ],
      "teams",
    )
    expect(mapping.player_name).toBe(INITIAL_STATE.columnMapping.player_name)
  })

  test("a file with no squad column leaves the lineup unmapped", () => {
    const mapping = mappingFor(
      [
        ["Team", "Score"],
        ["Rest of the World", "70"],
      ],
      "teams",
    )
    expect(mapping.team_name).toBe(0)
    expect(mapping.lineup_combined).toBeNull()
    expect(mapping.lineup_columns).toEqual([])
    expect(mapping.score).toBe(1)
  })

  test("score is still detected in teams mode, ahead of a later score-ish column", () => {
    const mapping = mappingFor(
      [
        ["Team", "Total", "Players"],
        ["England A", "100", "Alice, Bob"],
      ],
      "teams",
    )
    expect(mapping.score).toBe(1)
    expect(mapping.lineup_combined).toBe(2)
  })

  test("a user-chosen squad column is never overwritten by detection", () => {
    const mapping = computeInitialMapping(
      {
        ...stateFor(
          [
            ["Team", "Players", "Reserves", "Score"],
            ["England A", "Alice, Bob", "Carol, Dave", "100"],
          ],
          "teams",
        ),
        columnMapping: {
          ...INITIAL_STATE.columnMapping,
          team_name: 0,
          lineup_combined: 2,
        },
      },
      0,
    )
    expect(mapping.lineup_combined).toBe(2)
  })
})

describe("computeInitialMapping — pairs and individual are unaffected", () => {
  test("pairs still detect the name column and a partner column", () => {
    const mapping = mappingFor(
      [
        ["Player", "Partner", "Country", "Score"],
        ["Alice", "Bob", "Ireland", "100"],
      ],
      "pairs",
    )
    expect(mapping.player_name).toBe(0)
    expect(mapping.pairsLayout).toBe("two-columns")
    expect(mapping.player_name_2).toBe(1)
    expect(mapping.country).toBe(2)
    expect(mapping.score).toBe(3)
  })

  test("pairs still detect a combined name column", () => {
    const mapping = mappingFor(
      [
        ["Players", "Country", "Score"],
        ["Alice & Bob", "Ireland", "100"],
        ["Carol and Dave", "Wales", "90"],
      ],
      "pairs",
    )
    expect(mapping.player_name).toBe(0)
    expect(mapping.pairsLayout).toBe("combined")
    expect(mapping.player_name_2).toBeNull()
  })

  test("individual still detects name, country, score and position", () => {
    const mapping = mappingFor(
      [
        ["Rank", "Player Name", "Country", "Total"],
        ["1", "Alice", "Ireland", "50"],
      ],
      "individual",
    )
    expect(mapping.position).toBe(0)
    expect(mapping.player_name).toBe(1)
    expect(mapping.country).toBe(2)
    expect(mapping.score).toBe(3)
  })

  test("individual falls back to the default columns when nothing matches", () => {
    const mapping = mappingFor(
      [
        ["A", "B", "C", "D"],
        ["Alice", "Ireland", "50", "1"],
      ],
      "individual",
    )
    expect(mapping.player_name).toBe(0)
    expect(mapping.country).toBe(1)
    expect(mapping.score).toBe(2)
  })
})
