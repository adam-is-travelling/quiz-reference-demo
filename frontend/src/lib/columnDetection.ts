export const PLAYER_NAME_HEADER_NAMES = ["name", "player", "player name"]
export const COUNTRY_HEADER_NAMES = ["country"]
export const PARTNER_HEADER_NAMES = [
  "player 2",
  "player2",
  "partner",
  "name 2",
  "name2",
  "player b",
]
export const SCORE_HEADER_NAMES = ["total", "score", "overall"]
export const POSITION_HEADER_NAMES = [
  "position",
  "pos",
  "rank",
  "place",
  "#",
  "no",
  "no.",
  "psn",
]

function normalizeHeader(header: string[]): string[] {
  return header.map((h) => h.trim().toLowerCase())
}

function findExactMatch(
  normalized: string[],
  candidates: string[],
  claimed: Set<number>,
): number | null {
  const idx = normalized.findIndex(
    (h, i) => !claimed.has(i) && candidates.includes(h),
  )
  return idx === -1 ? null : idx
}

function findSubstringMatch(
  normalized: string[],
  candidates: string[],
  claimed: Set<number>,
): number | null {
  const idx = normalized.findIndex(
    (h, i) => !claimed.has(i) && candidates.some((c) => h.includes(c)),
  )
  return idx === -1 ? null : idx
}

export function detectColumn(
  header: string[],
  candidates: string[],
  claimed: Set<number>,
): number | null {
  const normalized = normalizeHeader(header)
  const lowerCandidates = candidates.map((c) => c.toLowerCase())
  return (
    findExactMatch(normalized, lowerCandidates, claimed) ??
    findSubstringMatch(normalized, lowerCandidates, claimed)
  )
}

export function detectExactColumn(
  header: string[],
  candidates: string | string[],
  claimed: Set<number>,
): number | null {
  const normalized = normalizeHeader(header)
  const list = Array.isArray(candidates) ? candidates : [candidates]
  return findExactMatch(
    normalized,
    list.map((c) => c.toLowerCase()),
    claimed,
  )
}

/**
 * Resolve the country column index, given the mapping's current value, a
 * fresh detection attempt, and the active participant mode.
 *
 * A value the user (or a prior detection pass) already moved away from the
 * compiled-in default is left untouched, in both modes. Otherwise a
 * successful detection wins. Failing that, the fallback is mode-dependent:
 * individual quizzes keep country required, so they fall back to the
 * concrete default column, never null; pairs quizzes may leave it
 * unmapped, so they fall back to null ("Not mapped").
 */
export function resolveCountryColumn(
  existing: number | null,
  detected: number | null,
  participantMode: "individual" | "pairs",
  defaultIndex: number,
): number | null {
  if (existing !== defaultIndex) {
    return existing
  }
  if (detected !== null) {
    return detected
  }
  return participantMode === "pairs" ? null : defaultIndex
}
