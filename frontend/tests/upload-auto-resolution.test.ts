import { describe, expect, test } from "bun:test"
import type { PlayerSearchResult } from "../src/client"
import { getAutoResolution } from "../src/lib/matchPlayers"

function candidate(
  over: Partial<PlayerSearchResult["player"]>,
  similarity: number,
): PlayerSearchResult {
  return {
    similarity,
    player: {
      id: "p1",
      display_name: "Jane Doe",
      countries: ["IE"],
      city: null,
      club: null,
      bio: null,
      photo_url: null,
      slug: null,
      is_published: true,
      created_at: null,
      ...over,
    },
  } as PlayerSearchResult
}

describe("getAutoResolution", () => {
  test("no candidates -> create new with seeded countries", () => {
    const r = getAutoResolution(
      { player_name: "Jane Doe", country: "IE", score: 1 },
      [],
    )
    expect(r.player_create?.countries).toEqual(["IE"])
    expect(r.autoResolved).toBe(true)
  })

  test("single high-confidence match with same country auto-resolves", () => {
    const r = getAutoResolution(
      { player_name: "Jane Doe", country: "IE", score: 1 },
      [candidate({ countries: ["IE"] }, 0.95)],
    )
    expect(r.player_id).toBe("p1")
    expect(r.autoResolved).toBe(true)
  })

  test("country mismatch flags for review", () => {
    const r = getAutoResolution(
      { player_name: "Jane Doe", country: "GB", score: 1 },
      [candidate({ countries: ["IE"] }, 0.95)],
    )
    expect(r.player_id).toBe("p1")
    expect(r.autoResolved).toBe(false)
  })

  test("empty candidate countries do not count as mismatch", () => {
    const r = getAutoResolution(
      { player_name: "Jane Doe", country: "GB", score: 1 },
      [candidate({ countries: [] }, 0.95)],
    )
    expect(r.autoResolved).toBe(true)
  })
})
