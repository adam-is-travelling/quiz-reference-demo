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
 * column mapping and participant mode. Steps 3, 4 and 5 all render from
 * this so the preview and the real parsing can never disagree.
 */
export function namesForRow(
  row: string[],
  mapping: {
    player_name: number
    player_name_2: number | null
    pairsLayout: "combined" | "two-columns"
  },
  participantMode: "individual" | "pairs",
): string[] {
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
