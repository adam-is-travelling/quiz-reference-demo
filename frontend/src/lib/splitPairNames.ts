import { splitTeamNames } from "@/lib/splitTeamNames"

/**
 * Split a result's name cell into its individual quizzers.
 *
 * Separators are `&` (with or without surrounding whitespace) and the
 * standalone word `and`. The whitespace requirement around `and` is what
 * keeps names like "Alexander" and "Sandy" intact — only a free-standing
 * "and" separates two people.
 */
export const PAIR_SEPARATOR_PATTERN = /\s*&\s*|\s+and\s+/gi

export function splitPairNames(cell: string): string[] {
  return cell
    .split(PAIR_SEPARATOR_PATTERN)
    .map((name) => name.trim().replace(/\s+/g, " "))
    .filter((name) => name.length > 0)
}

export const HAS_PAIR_SEPARATOR = /\s*&\s*|\s+and\s+/i

/**
 * Resolve the display names for a single result row, given the current
 * column mapping and participant mode. Step 3's preview renders from this
 * so it can't disagree with the real parsing; later wizard steps are
 * expected to adopt it too as pairs support lands there.
 */
export function namesForRow(
  row: string[],
  mapping: {
    player_name: number
    player_name_2: number | null
    pairsLayout: "combined" | "two-columns"
    lineupLayout?: "combined" | "numbered-columns"
    lineup_combined?: number | null
    lineup_columns?: number[]
  },
  participantMode: "individual" | "pairs" | "teams",
): string[] {
  if (participantMode === "teams") {
    // The team's own name lives in its own column; these are the squad.
    // Either source may be unmapped — a team with no listed squad is a
    // supported upload, filled in later from the results page.
    if (mapping.lineupLayout === "numbered-columns") {
      return (mapping.lineup_columns ?? [])
        .map((i) => (row[i] ?? "").trim().replace(/\s+/g, " "))
        .filter((name) => name.length > 0)
    }
    const col = mapping.lineup_combined
    return col === null || col === undefined
      ? []
      : splitTeamNames(row[col] ?? "")
  }
  const first = row[mapping.player_name] ?? ""
  if (participantMode !== "pairs") {
    const trimmed = first.trim()
    return trimmed ? [trimmed] : []
  }
  if (mapping.pairsLayout === "two-columns") {
    const second =
      mapping.player_name_2 !== null ? (row[mapping.player_name_2] ?? "") : ""
    return [first, second].map((n) => n.trim()).filter((n) => n.length > 0)
  }
  return splitPairNames(first)
}
