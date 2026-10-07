interface MedalResult {
  final_rank?: number | null
  start_date: string
}

/** Golds, then silvers, then bronzes; newest first within each medal. */
export function sortMedalResults<T extends MedalResult>(results: T[]): T[] {
  return [...results].sort(
    (a, b) =>
      (a.final_rank ?? Number.POSITIVE_INFINITY) -
        (b.final_rank ?? Number.POSITIVE_INFINITY) ||
      b.start_date.localeCompare(a.start_date),
  )
}
