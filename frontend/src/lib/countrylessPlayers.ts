import type { Resolution } from "@/components/Upload/types"
import type { RowResolution } from "@/lib/matchPlayers"

/**
 * Whether this resolution will create a player with no country — the case the
 * upload wizard flags, because country is optional and a missing one is easy
 * to overlook. Matched players keep whatever countries they already have.
 */
export function isCountrylessNewPlayer(r: Resolution): boolean {
  return (
    r.player_create !== null && (r.player_create.countries ?? []).length === 0
  )
}

export function countCountrylessNewPlayers(rows: RowResolution[]): number {
  return rows.flatMap((row) => row.participants).filter(isCountrylessNewPlayer)
    .length
}

export function countrylessMessage(n: number): string {
  const noun = n === 1 ? "player" : "players"
  return `${n} new ${noun} will be created without a country. You can set one below, or later from their profile.`
}
