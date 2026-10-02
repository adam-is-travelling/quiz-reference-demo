interface SeriesItem {
  id: string
  name: string
  start_date: string
}

/**
 * The editions either side of `currentId` in a series, in date order (ties
 * broken by name so same-day quizzes keep a stable order). An item not in
 * the list — e.g. an unapproved quiz, which public lists leave out — has
 * no neighbours.
 */
export function findNeighbours<T extends SeriesItem>(
  items: T[],
  currentId: string,
): { previous: T | null; next: T | null } {
  const ordered = [...items].sort(
    (a, b) =>
      a.start_date.localeCompare(b.start_date) || a.name.localeCompare(b.name),
  )
  const index = ordered.findIndex((item) => item.id === currentId)
  if (index === -1) return { previous: null, next: null }
  return {
    previous: ordered[index - 1] ?? null,
    next: ordered[index + 1] ?? null,
  }
}
