export const VENUE_MAX_LENGTH = 255

/** The trimmed venue for one CSV row, or null when unmapped or blank. */
export function rowVenue(
  row: string[] | undefined,
  col: number | null | undefined,
): string | null {
  if (row === undefined || col === null || col === undefined) return null
  const v = (row[col] ?? "").trim()
  return v === "" ? null : v
}
