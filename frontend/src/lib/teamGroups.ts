import type { Resolution } from "@/components/Upload/types"

export interface TeamGroup {
  teamName: string
  slotIndices: number[]
}

export interface SquadStatus {
  matched: number
  toCreate: number
  toReview: number
  outstanding: number
}

/**
 * Gather each participant slot under the team whose row it came from.
 *
 * Teams are keyed case- and whitespace-insensitively, matching how Step 4
 * collects its distinct team names, and keep the casing of the row that
 * introduced them. A row whose team cell is blank cannot be a team result and
 * is caught by validation later, but its players still have to be resolvable
 * here — so they land in a trailing unnamed group rather than vanishing.
 */
export function groupSlotsByTeam(
  slots: Array<{ rowIndex: number }>,
  teamNameByRow: string[],
): TeamGroup[] {
  const byKey = new Map<string, TeamGroup>()
  let unnamed: TeamGroup | null = null

  slots.forEach((slot, slotIndex) => {
    const name = (teamNameByRow[slot.rowIndex] ?? "").trim()
    if (name === "") {
      unnamed ??= { teamName: "", slotIndices: [] }
      unnamed.slotIndices.push(slotIndex)
      return
    }
    const key = name.toLowerCase()
    const group = byKey.get(key)
    if (group) group.slotIndices.push(slotIndex)
    else byKey.set(key, { teamName: name, slotIndices: [slotIndex] })
  })

  const groups = [...byKey.values()]
  if (unnamed) groups.push(unnamed)
  return groups
}

/**
 * Count how one squad's players fall across Step 4's buckets.
 *
 * `toReview` is every player the auto-matcher would not settle on its own;
 * `outstanding` is the subset of those still carrying no decision, which is
 * exactly what blocks the Next button. The two differ once an admin confirms
 * a review row — it stays listed, so the list never reflows underfoot, but it
 * no longer counts against the work remaining.
 */
export function squadStatus(resolutions: Resolution[]): SquadStatus {
  const status: SquadStatus = {
    matched: 0,
    toCreate: 0,
    toReview: 0,
    outstanding: 0,
  }
  for (const resolution of resolutions) {
    if (resolution?.autoResolved === true) {
      if (resolution.player_id !== null) status.matched++
      else if (resolution.player_create !== null) status.toCreate++
      continue
    }
    status.toReview++
    const decided =
      (resolution?.player_id ?? null) !== null ||
      (resolution?.player_create ?? null) !== null
    if (!decided) status.outstanding++
  }
  return status
}

/** One line describing a squad, outstanding work first. */
export function squadSummary(status: SquadStatus): string {
  const parts: string[] = []
  if (status.outstanding > 0) parts.push(`${status.outstanding} to review`)
  const confirmed = status.toReview - status.outstanding
  if (confirmed > 0) parts.push(`${confirmed} confirmed`)
  if (status.matched > 0) parts.push(`${status.matched} matched`)
  if (status.toCreate > 0) parts.push(`${status.toCreate} to create`)
  return parts.length > 0 ? parts.join(", ") : "No squad listed"
}
