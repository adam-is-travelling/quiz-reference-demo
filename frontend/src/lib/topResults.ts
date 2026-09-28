type Ranked = { final_rank?: number | null }

// An unranked row sorts after every ranked one.
const rankOf = (row: Ranked) => row.final_rank ?? Number.POSITIVE_INFINITY

/**
 * The best-ranked `limit` rows, in rank order. Rows tied with the last one
 * inside the cut are kept too, so a shared rank is never split across the
 * "top" list and the rest.
 */
export function topResults<T extends Ranked>(rows: T[], limit: number): T[] {
  const sorted = [...rows].sort((a, b) => rankOf(a) - rankOf(b))
  if (sorted.length <= limit) return sorted
  const cutoff = rankOf(sorted[limit - 1])
  return sorted.filter((row) => rankOf(row) <= cutoff)
}
