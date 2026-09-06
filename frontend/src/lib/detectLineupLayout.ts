import { detectColumn, LINEUP_HEADER_NAMES } from "@/lib/columnDetection"
import { HAS_TEAM_SEPARATOR } from "@/lib/splitTeamNames"

export interface LineupLayoutDetection {
  layout: "combined" | "numbered-columns"
  lineup_combined: number | null
  lineup_columns: number[]
}

const SEPARATOR_SHARE_THRESHOLD = 0.5
const NUMBERED_LINEUP_HEADER = /^(player|member|name)\s*\d+$/

/**
 * Every unclaimed header of the form "Player 1", "Member2", "name 3",
 * in header order — which is the order the squad is recorded in.
 */
export function detectNumberedColumns(
  header: string[],
  claimed: Set<number>,
): number[] {
  return header
    .map((h, i) => [h.trim().toLowerCase(), i] as const)
    .filter(([h, i]) => !claimed.has(i) && NUMBERED_LINEUP_HEADER.test(h))
    .map(([, i]) => i)
}

/**
 * Guess whether a teams CSV holds its squads in one cell or across
 * numbered columns.
 *
 * A majority of separator-bearing cells in the candidate lineup column is
 * the strongest signal, so it wins outright. Failing that, two or more
 * numbered headers mean a column-per-member layout. Otherwise assume
 * combined: an empty squad is a legitimate upload, and the Lineup preview
 * column makes a wrong guess visible before submit.
 */
export function detectLineupLayout(
  rows: string[][],
  header: string[],
  claimed: Set<number>,
): LineupLayoutDetection {
  const combined = detectColumn(header, LINEUP_HEADER_NAMES, claimed)

  if (combined !== null) {
    const cells = rows
      .slice(1)
      .map((row) => row[combined] ?? "")
      .filter((cell) => cell.trim().length > 0)
    const withSeparator = cells.filter((cell) =>
      HAS_TEAM_SEPARATOR.test(cell),
    ).length
    if (
      cells.length > 0 &&
      withSeparator / cells.length >= SEPARATOR_SHARE_THRESHOLD
    ) {
      return {
        layout: "combined",
        lineup_combined: combined,
        lineup_columns: [],
      }
    }
  }

  const numbered = detectNumberedColumns(header, claimed)
  if (numbered.length >= 2) {
    return {
      layout: "numbered-columns",
      lineup_combined: null,
      lineup_columns: numbered,
    }
  }

  // `combined` can still be a numbered-style header ("Player 1") that
  // LINEUP_HEADER_NAMES' "player" substring caught but that didn't have a
  // second numbered sibling to justify numbered-columns above. A lone slot
  // like that was never a genuine free-text lineup column, so it doesn't
  // count as a combined match either — report unmapped instead.
  const combinedIsNumberedHeader =
    combined !== null &&
    NUMBERED_LINEUP_HEADER.test(header[combined].trim().toLowerCase())

  return {
    layout: "combined",
    lineup_combined: combinedIsNumberedHeader ? null : combined,
    lineup_columns: [],
  }
}
