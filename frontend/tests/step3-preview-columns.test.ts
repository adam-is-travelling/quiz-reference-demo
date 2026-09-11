import { describe, expect, test } from "bun:test"
import { previewColumns } from "@/components/Upload/steps/Step3ColumnMapping"

describe("previewColumns", () => {
  test("individual shows the player and their country", () => {
    expect(previewColumns("individual", "national")).toEqual([
      "pos",
      "player",
      "country",
      "score",
    ])
  })

  test("pairs shows both players", () => {
    expect(previewColumns("pairs", "national")).toEqual([
      "pos",
      "player",
      "player2",
      "country",
      "score",
    ])
  })

  test("national teams drop the player column but keep the country", () => {
    expect(previewColumns("teams", "national")).toEqual([
      "pos",
      "team",
      "lineup",
      "country",
      "score",
    ])
  })

  test("club teams drop the country column as well", () => {
    expect(previewColumns("teams", "club")).toEqual([
      "pos",
      "team",
      "lineup",
      "score",
    ])
  })

  test("the default team type only matters outside teams mode", () => {
    expect(previewColumns("individual", "club")).toEqual(
      previewColumns("individual", "national"),
    )
    expect(previewColumns("pairs", "club")).toEqual(
      previewColumns("pairs", "national"),
    )
  })
})
