import { describe, expect, test } from "bun:test"
import { defaultTeamDetails } from "../src/components/Upload/steps/TeamsPanel"
import type { TeamDetails } from "../src/components/Upload/types"

const NONE: Record<string, string | null> = {}
const NO_EXISTING: Record<string, TeamDetails> = {}

describe("defaultTeamDetails country inference", () => {
  test("a national team's country is inferred from its name", () => {
    const seeded = defaultTeamDetails(
      ["England A"],
      "national",
      NONE,
      NO_EXISTING,
    )
    expect(seeded["England A"].team_country).toBe("ENG")
  })

  test("a demonym in the name is inferred", () => {
    const seeded = defaultTeamDetails(
      ["Austrian National Team"],
      "national",
      NONE,
      NO_EXISTING,
    )
    expect(seeded["Austrian National Team"].team_country).toBe("AT")
  })

  test("a mapped country column wins over the name", () => {
    const seeded = defaultTeamDetails(
      ["England A"],
      "national",
      { "England A": "SCO" },
      NO_EXISTING,
    )
    expect(seeded["England A"].team_country).toBe("SCO")
  })

  test("a club's country is not inferred from its name", () => {
    const seeded = defaultTeamDetails(
      ["Dublin Quiz Club"],
      "club",
      NONE,
      NO_EXISTING,
    )
    expect(seeded["Dublin Quiz Club"].team_country).toBeNull()
  })

  test("a name with no country stays null", () => {
    const seeded = defaultTeamDetails(
      ["Manchester Quiz League"],
      "national",
      NONE,
      NO_EXISTING,
    )
    expect(seeded["Manchester Quiz League"].team_country).toBeNull()
  })

  test("an existing edited entry is preserved, not re-inferred", () => {
    const edited: Record<string, TeamDetails> = {
      "England A": {
        team_type: "national",
        team_country: null,
        is_international: true,
      },
    }
    const seeded = defaultTeamDetails(["England A"], "national", NONE, edited)
    expect(seeded["England A"]).toBe(edited["England A"])
    expect(seeded["England A"].team_country).toBeNull()
  })

  test("inference does not mark a team international", () => {
    const seeded = defaultTeamDetails(
      ["England A"],
      "national",
      NONE,
      NO_EXISTING,
    )
    expect(seeded["England A"].is_international).toBe(false)
  })
})
