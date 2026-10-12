import { describe, expect, test } from "bun:test"
import { previewColumns } from "@/components/Upload/steps/Step3ColumnMapping"

const COUNTRY_ONLY = { country: true, venue: false }

describe("previewColumns", () => {
  test("individual shows the player and their country", () => {
    expect(previewColumns("individual", "national", COUNTRY_ONLY)).toEqual([
      "pos",
      "player",
      "country",
      "score",
    ])
  })

  test("pairs shows both players", () => {
    expect(previewColumns("pairs", "national", COUNTRY_ONLY)).toEqual([
      "pos",
      "player",
      "player2",
      "country",
      "score",
    ])
  })

  test("national teams drop the player column but keep the country", () => {
    expect(previewColumns("teams", "national", COUNTRY_ONLY)).toEqual([
      "pos",
      "team",
      "lineup",
      "country",
      "score",
    ])
  })

  test("club teams drop the country column as well", () => {
    expect(previewColumns("teams", "club", COUNTRY_ONLY)).toEqual([
      "pos",
      "team",
      "lineup",
      "score",
    ])
  })

  test("the default team type only matters outside teams mode", () => {
    expect(previewColumns("individual", "club", COUNTRY_ONLY)).toEqual(
      previewColumns("individual", "national", COUNTRY_ONLY),
    )
    expect(previewColumns("pairs", "club", COUNTRY_ONLY)).toEqual(
      previewColumns("pairs", "national", COUNTRY_ONLY),
    )
  })

  test("an unmapped country column is not previewed", () => {
    expect(
      previewColumns("individual", "national", {
        country: false,
        venue: false,
      }),
    ).toEqual(["pos", "player", "score"])
  })

  test("a mapped venue is previewed before the score", () => {
    expect(
      previewColumns("individual", "national", { country: true, venue: true }),
    ).toEqual(["pos", "player", "country", "venue", "score"])
    expect(
      previewColumns("teams", "club", { country: true, venue: true }),
    ).toEqual(["pos", "team", "lineup", "venue", "score"])
  })
})
