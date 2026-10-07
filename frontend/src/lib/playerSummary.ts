/** The one-line career summary at the top of a player's page. */
export function playerSummary(
  total: number,
  firstYear: number | null | undefined,
  lastYear: number | null | undefined,
): string {
  if (total === 0 || firstYear == null || lastYear == null) {
    return "No quizzes yet"
  }
  const count = `${total} ${total === 1 ? "quiz" : "quizzes"}`
  const span =
    firstYear === lastYear
      ? `in ${firstYear}`
      : `between ${firstYear} and ${lastYear}`
  return `Competed in ${count} ${span}`
}
