import { describe, expect, test } from "bun:test"
import type { PlayerSearchResult } from "../src/client"
import {
  buildResolutions,
  chunkUniqueNames,
  getAutoResolution,
} from "../src/lib/matchPlayers"

function candidate(id: string, similarity: number): PlayerSearchResult {
  return {
    similarity,
    player: {
      id,
      display_name: "Jane Doe",
      countries: ["IE"],
      city: null,
      club: null,
      bio: null,
      photo_url: null,
      slug: null,
      is_published: true,
      created_at: null,
    },
  } as PlayerSearchResult
}

describe("chunkUniqueNames", () => {
  test("deduplicates while preserving first-seen order", () => {
    expect(chunkUniqueNames(["b", "a", "b", "c", "a"], 10)).toEqual([
      ["b", "a", "c"],
    ])
  })

  test("splits into chunks of at most the given size", () => {
    expect(chunkUniqueNames(["a", "b", "c", "d", "e"], 2)).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e"],
    ])
  })

  test("returns no chunks for an empty list", () => {
    expect(chunkUniqueNames([], 5)).toEqual([])
  })
})

describe("buildResolutions", () => {
  test("resolves each row from its name's candidates", () => {
    const rows = [
      { player_name: "Jane Doe", country: "IE", score: 10 },
      { player_name: "Unknown Person", country: "GB", score: 5 },
    ]
    const byName = {
      "Jane Doe": [candidate("p1", 0.95)],
    }
    const resolutions = buildResolutions(rows, byName)
    expect(resolutions).toHaveLength(2)
    expect(resolutions[0].player_id).toBe("p1")
    expect(resolutions[0].autoResolved).toBe(true)
    // Missing from the map -> treated as no candidates -> create new
    expect(resolutions[1].player_id).toBeNull()
    expect(resolutions[1].player_create?.display_name).toBe("Unknown Person")
    expect(resolutions[1].autoResolved).toBe(true)
  })

  test("duplicate names share candidates and resolve identically", () => {
    const rows = [
      { player_name: "Jane Doe", country: "IE", score: 10 },
      { player_name: "Jane Doe", country: "IE", score: 8 },
    ]
    const byName = { "Jane Doe": [candidate("p1", 0.95)] }
    const resolutions = buildResolutions(rows, byName)
    expect(resolutions[0].player_id).toBe("p1")
    expect(resolutions[1].player_id).toBe("p1")
  })
})

describe("getAutoResolution review classes", () => {
  const mismatchRow = { player_name: "Jane Doe", country: "DE", score: 10 }

  test("sole high-similarity candidate with country mismatch → country-mismatch, pre-selected", () => {
    const r = getAutoResolution(mismatchRow, [candidate("p1", 0.95)])
    expect(r.player_id).toBe("p1")
    expect(r.autoResolved).toBe(false)
    expect(r.reviewClass).toBe("country-mismatch")
  })

  test("high-similarity mismatch among other candidates → single-candidate, still pre-selected", () => {
    const r = getAutoResolution(mismatchRow, [
      candidate("p1", 0.95),
      candidate("p2", 0.5),
    ])
    expect(r.player_id).toBe("p1")
    expect(r.autoResolved).toBe(false)
    expect(r.reviewClass).toBe("single-candidate")
  })

  test("one low-similarity candidate → single-candidate, nothing selected", () => {
    const r = getAutoResolution(mismatchRow, [candidate("p1", 0.6)])
    expect(r.player_id).toBeNull()
    expect(r.autoResolved).toBe(false)
    expect(r.reviewClass).toBe("single-candidate")
  })

  test("multiple low-similarity candidates → ambiguous", () => {
    const r = getAutoResolution(mismatchRow, [
      candidate("p1", 0.6),
      candidate("p2", 0.5),
    ])
    expect(r.player_id).toBeNull()
    expect(r.reviewClass).toBe("ambiguous")
  })

  test("two high-confidence candidates → ambiguous", () => {
    const r = getAutoResolution(mismatchRow, [
      candidate("p1", 0.95),
      candidate("p2", 0.92),
    ])
    expect(r.player_id).toBeNull()
    expect(r.reviewClass).toBe("ambiguous")
  })

  test("auto-resolved match (country agrees) has no reviewClass", () => {
    const agreeRow = { player_name: "Jane Doe", country: "IE", score: 10 }
    const r = getAutoResolution(agreeRow, [candidate("p1", 0.95)])
    expect(r.autoResolved).toBe(true)
    expect(r.reviewClass).toBeUndefined()
  })

  test("auto-create (no candidates) has no reviewClass", () => {
    const r = getAutoResolution(mismatchRow, [])
    expect(r.autoResolved).toBe(true)
    expect(r.reviewClass).toBeUndefined()
  })
})
