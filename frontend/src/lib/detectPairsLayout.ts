import { detectColumn, PARTNER_HEADER_NAMES } from "@/lib/columnDetection"
import { HAS_PAIR_SEPARATOR } from "@/lib/splitPairNames"

export interface PairsLayoutDetection {
  layout: "combined" | "two-columns"
  player_name_2: number | null
}

const SEPARATOR_SHARE_THRESHOLD = 0.5

/**
 * Guess whether a pairs CSV holds both names in one column or two.
 *
 * A majority of separator-bearing name cells is the strongest signal, so it
 * wins outright. Failing that, an unclaimed partner-ish header means two
 * columns. Otherwise assume combined: a lone name per row is a legitimate
 * solo result, and the Player 1 / Player 2 preview makes a wrong guess
 * visible before submit.
 */
export function detectPairsLayout(
  rows: string[][],
  nameColumn: number,
  header: string[],
  claimed: Set<number>,
): PairsLayoutDetection {
  const cells = rows
    .slice(1)
    .map((row) => row[nameColumn] ?? "")
    .filter((cell) => cell.trim().length > 0)

  const withSeparator = cells.filter((cell) =>
    HAS_PAIR_SEPARATOR.test(cell),
  ).length

  if (
    cells.length > 0 &&
    withSeparator / cells.length >= SEPARATOR_SHARE_THRESHOLD
  ) {
    return { layout: "combined", player_name_2: null }
  }

  const partner = detectColumn(header, PARTNER_HEADER_NAMES, claimed)
  if (partner !== null) {
    return { layout: "two-columns", player_name_2: partner }
  }

  return { layout: "combined", player_name_2: null }
}
