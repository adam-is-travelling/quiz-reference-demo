import type { PlayerSearchResult } from "@/client"
import type { Resolution } from "@/components/Upload/types"
import { resolveCountryCode } from "@/lib/countries"

export interface ParsedRow {
  player_name: string
  country: string
  score: number
}

const SIMILARITY_THRESHOLD = 0.9

export function getAutoResolution(
  parsedRow: ParsedRow,
  candidates: PlayerSearchResult[],
): Resolution {
  if (candidates.length === 0) {
    const seeded = resolveCountryCode(parsedRow.country)
    return {
      player_id: null,
      player_create: {
        display_name: parsedRow.player_name,
        countries: seeded ? [seeded] : [],
      },
      autoResolved: true,
    }
  }
  const highConf = candidates.filter(
    (c) => c.similarity >= SIMILARITY_THRESHOLD,
  )
  if (highConf.length === 1) {
    const candidate = highConf[0]
    const csvCountry = resolveCountryCode(parsedRow.country)
    const playerCountries = candidate.player.countries ?? []
    const countryMismatch =
      csvCountry !== null &&
      playerCountries.length > 0 &&
      !playerCountries.includes(csvCountry)
    if (countryMismatch) {
      // Pre-select the name match so admin can confirm, but flag for review
      return {
        player_id: candidate.player.id,
        player_create: null,
        autoResolved: false,
        reviewClass:
          candidates.length === 1 ? "country-mismatch" : "single-candidate",
      }
    }
    return {
      player_id: candidate.player.id,
      player_create: null,
      autoResolved: true,
    }
  }
  return {
    player_id: null,
    player_create: null,
    autoResolved: false,
    reviewClass: candidates.length === 1 ? "single-candidate" : "ambiguous",
  }
}

export function chunkUniqueNames(names: string[], size: number): string[][] {
  const unique = [...new Set(names)]
  const chunks: string[][] = []
  for (let i = 0; i < unique.length; i += size) {
    chunks.push(unique.slice(i, i + size))
  }
  return chunks
}

export function buildResolutions(
  rows: ParsedRow[],
  candidatesByName: Record<string, PlayerSearchResult[]>,
): Resolution[] {
  return rows.map((row) =>
    getAutoResolution(row, candidatesByName[row.player_name] ?? []),
  )
}
