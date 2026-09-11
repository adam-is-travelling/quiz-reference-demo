import type { TeamDetails } from "@/components/Upload/types"
import { CountrySelect } from "@/components/ui/CountrySelect"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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

/**
 * Type and country for each distinct team in this file.
 *
 * Teams have no cross-quiz identity, so there is nothing to match against
 * and no team search — every team here is created fresh with this quiz's
 * result. A national side with no country IS an international team; the
 * checkbox is how that intent is stated, since "not chosen yet" and
 * "deliberately none" are indistinguishable in the country value alone.
 */
export function TeamsPanel({
  teamNames,
  value,
  onChange,
}: {
  teamNames: string[]
  value: Record<string, TeamDetails>
  onChange: (next: Record<string, TeamDetails>) => void
}) {
  if (teamNames.length === 0) return null

  const update = (name: string, patch: Partial<TeamDetails>) =>
    onChange({ ...value, [name]: { ...value[name], ...patch } })

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Teams in this file</h3>
      <div className="space-y-3">
        {teamNames.map((name, index) => {
          const details = value[name]
          if (!details) return null
          const internationalId = `team-international-${index}`
          return (
            <div
              key={name}
              data-testid={`team-details-${name}`}
              className="flex flex-wrap items-end gap-3 rounded-md border p-3"
            >
              <span className="font-medium">{name}</span>

              <div className="space-y-1">
                <Label className="text-xs">Type</Label>
                <Select
                  value={details.team_type}
                  onValueChange={(v) =>
                    update(name, { team_type: v as "national" | "club" })
                  }
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="national">National</SelectItem>
                    <SelectItem value="club">Club</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* A club's country is optional and almost never meaningful at
                  upload time, so the control would only offer an "Unknown" to
                  puzzle over. A club that does carry one — kept when a team is
                  switched over from National — stays editable from the quiz
                  results page. */}
              {details.team_type === "national" && (
                <div className="space-y-1">
                  <Label className="text-xs">Country</Label>
                  <CountrySelect
                    value={details.team_country}
                    disabled={details.is_international}
                    onChange={(code) => update(name, { team_country: code })}
                    className="h-9 w-48 rounded-md border border-input bg-background px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
              )}

              {details.team_type === "national" && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={internationalId}
                    checked={details.is_international}
                    onCheckedChange={(checked) =>
                      update(name, {
                        is_international: checked === true,
                        team_country:
                          checked === true ? null : details.team_country,
                      })
                    }
                  />
                  <Label
                    htmlFor={internationalId}
                    className="text-xs font-normal"
                  >
                    International (no single country)
                  </Label>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
