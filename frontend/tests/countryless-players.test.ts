import { describe, expect, test } from "bun:test"
import type { Resolution } from "@/components/Upload/types"
import {
  countCountrylessNewPlayers,
  countrylessMessage,
  isCountrylessNewPlayer,
} from "@/lib/countrylessPlayers"
import { getAutoResolution } from "@/lib/matchPlayers"

const create = (countries?: string[]): Resolution => ({
  player_id: null,
  player_create: { display_name: "Jane", countries },
})
const existing: Resolution = { player_id: "p1", player_create: null }
const unresolved: Resolution = { player_id: null, player_create: null }

describe("isCountrylessNewPlayer", () => {
  test("a new player with no countries is countryless", () => {
    expect(isCountrylessNewPlayer(create([]))).toBe(true)
    expect(isCountrylessNewPlayer(create(undefined))).toBe(true)
  })
  test("a new player with a country is not", () => {
    expect(isCountrylessNewPlayer(create(["IE"]))).toBe(false)
  })
  test("matched or unresolved rows are never countryless", () => {
    expect(isCountrylessNewPlayer(existing)).toBe(false)
    expect(isCountrylessNewPlayer(unresolved)).toBe(false)
  })
})

describe("countCountrylessNewPlayers", () => {
  test("counts across every participant of every row", () => {
    expect(
      countCountrylessNewPlayers([
        { participants: [create([]), create(["IE"])] },
        { participants: [existing] },
        { participants: [create(undefined)] },
      ]),
    ).toBe(2)
  })
})

describe("countrylessMessage", () => {
  test("singular and plural", () => {
    expect(countrylessMessage(1)).toBe(
      "1 new player will be created without a country. You can set one below, or later from their profile.",
    )
    expect(countrylessMessage(3)).toBe(
      "3 new players will be created without a country. You can set one below, or later from their profile.",
    )
  })
})

describe("auto-created players from the CSV", () => {
  test("an unrecognised country value yields a countryless new player", () => {
    const r = getAutoResolution(
      { player_name: "Jane", country: "Narnia", score: 1 },
      [],
    )
    expect(isCountrylessNewPlayer(r)).toBe(true)
  })
  test("a blank country (column unmapped) yields a countryless new player", () => {
    const r = getAutoResolution(
      { player_name: "Jane", country: "", score: 1 },
      [],
    )
    expect(isCountrylessNewPlayer(r)).toBe(true)
  })
})
