import type { TeamDetails } from "@/components/Upload/types"
import { inferCountryFromTeamName } from "@/lib/countries"

/**
 * Seed one TeamDetails per distinct team name, preserving any the admin has
 * already edited.
 *
 * A national side's country falls back to whatever its name says — "England
 * A", "Austrian National Team" — but only as a last resort: a mapped country
 * column wins, and an entry the admin has already touched is returned
 * untouched. Clubs are never inferred, because a country word in a club's
 * name is usually incidental.
 */
export function defaultTeamDetails(
  teamNames: string[],
  defaultTeamType: "national" | "club",
  seededCountries: Record<string, string | null>,
  existing: Record<string, TeamDetails>,
): Record<string, TeamDetails> {
  const next: Record<string, TeamDetails> = {}
  for (const name of teamNames) {
    const inferred =
      defaultTeamType === "national" ? inferCountryFromTeamName(name) : null
    next[name] = existing[name] ?? {
      team_type: defaultTeamType,
      team_country: seededCountries[name] ?? inferred,
      is_international: false,
    }
  }
  return next
}
