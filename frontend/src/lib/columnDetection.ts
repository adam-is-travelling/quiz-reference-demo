export const PLAYER_NAME_HEADER_NAMES = ["name", "player", "player name"]
export const COUNTRY_HEADER_NAMES = ["country"]
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
  candidate: string,
  claimed: Set<number>,
): number | null {
  const normalized = normalizeHeader(header)
  return findExactMatch(normalized, [candidate.toLowerCase()], claimed)
}
