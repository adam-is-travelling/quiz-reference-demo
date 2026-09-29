import type { EventPublic, QuizPodium } from "@/client"

export const OTHER_QUIZZES_KEY = "__other__"

export interface MatrixColumn {
  eventId: string
  eventSlug: string
  eventName: string
  year: number
}

export interface MatrixRow {
  key: string
  label: string
  /** null for the "Other quizzes" row of one-off quizzes. */
  seriesSlug: string | null
  /** One entry per column; each holds the quizzes of this row held there. */
  cells: QuizPodium[][]
}

export interface SeriesMatrix {
  columns: MatrixColumn[]
  rows: MatrixRow[]
}

/**
 * The "held here" table on an event series page: a column per edition
 * (earliest first), a row per quiz series seen at any edition (in the order
 * they first appear in `quizzes`, which the API sends earliest first), and a
 * final "Other quizzes" row for one-off quizzes. A quiz whose event is not
 * one of `editions` is skipped rather than guessed at.
 */
export function buildSeriesMatrix(
  editions: EventPublic[],
  quizzes: QuizPodium[],
): SeriesMatrix {
  const columns: MatrixColumn[] = [...editions]
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .map((e) => ({
      eventId: e.id,
      eventSlug: e.slug,
      eventName: e.name,
      year: Number(e.start_date.slice(0, 4)),
    }))
  const columnIndex = new Map(columns.map((c, i) => [c.eventSlug, i]))
  const newRow = (
    key: string,
    label: string,
    seriesSlug: string | null,
  ): MatrixRow => ({ key, label, seriesSlug, cells: columns.map(() => []) })

  const seriesRows = new Map<string, MatrixRow>()
  let otherRow: MatrixRow | null = null

  for (const quiz of quizzes) {
    const column = quiz.event_slug
      ? columnIndex.get(quiz.event_slug)
      : undefined
    if (column === undefined) continue
    let row: MatrixRow
    if (quiz.series_slug) {
      row =
        seriesRows.get(quiz.series_slug) ??
        newRow(
          quiz.series_slug,
          quiz.series_name ?? quiz.series_slug,
          quiz.series_slug,
        )
      seriesRows.set(quiz.series_slug, row)
    } else {
      otherRow ??= newRow(OTHER_QUIZZES_KEY, "Other quizzes", null)
      row = otherRow
    }
    row.cells[column].push(quiz)
  }

  const rows = [...seriesRows.values()]
  if (otherRow) rows.push(otherRow)
  return { columns, rows }
}

/**
 * Query key for a competition (series) list. Kept apart from the detail keys
 * (["competitions", slug]) and split by type, so the admin list of every type
 * and the public quiz-only list never share a cache entry.
 */
export function competitionListQueryKey(type?: "quiz" | "event") {
  return ["competitions", "list", type ?? "all"] as const
}
