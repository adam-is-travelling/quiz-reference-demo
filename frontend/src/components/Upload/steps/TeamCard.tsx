import type { ReactNode } from "react"
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

/**
 * One team in this file: its identity, and the squad to be resolved under it.
 *
 * The identity controls stay visible whatever the squad is doing — a national
 * side's country is the admin's to set whether or not its players need any
 * attention, so only the squad itself collapses. `expanded` is owned by the
 * caller because this card is rendered inside a virtualizer: scrolling a card
 * out of view unmounts it, and local state would forget itself on the way
 * back.
 *
 * A quiz whose teams are all clubs has nothing to pick — team type comes from
 * Step 1, and a club carries neither country nor international flag — so
 * `showTypeSelect` is false there and the card holds no controls at all.
 */
export function TeamCard({
  teamName,
  details,
  onChange,
  showTypeSelect,
  summary,
  squadCount,
  expanded,
  onToggle,
  children,
}: {
  teamName: string
  details: TeamDetails
  onChange: (patch: Partial<TeamDetails>) => void
  showTypeSelect: boolean
  summary: string
  squadCount: number
  expanded: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const internationalId = `team-international-${teamName}`
  const isNational = details.team_type === "national"

  return (
    <div data-testid={`team-details-${teamName}`} className="rounded-md border">
      <div className="flex flex-wrap items-end gap-3 p-3">
        <span className="font-medium">{teamName || "Unnamed team"}</span>

        {showTypeSelect && (
          <div className="space-y-1">
            <Label className="text-xs">Type</Label>
            <Select
              value={details.team_type}
              onValueChange={(v) =>
                onChange({ team_type: v as "national" | "club" })
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
        )}

        {/* A club's country is optional and almost never meaningful at
            upload time, so the control would only offer an "Unknown" to
            puzzle over. A club that does carry one — kept when a team is
            switched over from National — stays editable from the quiz
            results page. */}
        {isNational && (
          <div className="space-y-1">
            <Label className="text-xs">Country</Label>
            <CountrySelect
              value={details.team_country}
              disabled={details.is_international}
              onChange={(code) => onChange({ team_country: code })}
              className="h-9 w-48 rounded-md border border-input bg-background px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
        )}

        {isNational && (
          <div className="flex items-center gap-2">
            <Checkbox
              id={internationalId}
              checked={details.is_international}
              onCheckedChange={(checked) =>
                onChange({
                  is_international: checked === true,
                  team_country: checked === true ? null : details.team_country,
                })
              }
            />
            <Label htmlFor={internationalId} className="text-xs font-normal">
              International (no single country)
            </Label>
          </div>
        )}
      </div>

      <button
        type="button"
        data-testid={`team-squad-toggle-${teamName}`}
        onClick={onToggle}
        className="flex w-full items-center gap-2 border-t px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted"
      >
        <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
        <span>{summary}</span>
      </button>

      {expanded && (
        <div className="flex flex-col gap-3 border-t p-3">
          {squadCount === 0 ? (
            <p className="text-xs text-muted-foreground">
              No squad listed. You can add players from the quiz results page
              after this upload.
            </p>
          ) : (
            children
          )}
        </div>
      )}
    </div>
  )
}
