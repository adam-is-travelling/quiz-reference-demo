import { describe, expect, test } from "bun:test"
import type { EventPublic, QuizPodium } from "../src/client"
import {
  buildSeriesMatrix,
  competitionListQueryKey,
  OTHER_QUIZZES_KEY,
} from "../src/lib/seriesMatrix"

function edition(slug: string, startDate: string): EventPublic {
  return {
    id: `id-${slug}`,
    slug,
    name: slug,
    start_date: startDate,
    end_date: startDate,
    organization_id: "org",
  }
}

function quiz(
  id: string,
  eventSlug: string | null,
  seriesSlug: string | null,
): QuizPodium {
  return {
    quiz_id: id,
    quiz_name: id,
    quiz_slug: id,
    start_date: "2026-01-01",
    end_date: "2026-01-01",
    finishers: [],
    event_name: eventSlug,
    event_slug: eventSlug,
    series_name: seriesSlug ? `Series ${seriesSlug}` : null,
    series_slug: seriesSlug,
  }
}

describe("buildSeriesMatrix", () => {
  test("orders columns by edition date and reads the year", () => {
    const m = buildSeriesMatrix(
      [edition("tn-2026", "2026-08-07"), edition("tn-2025", "2025-08-01")],
      [],
    )
    expect(m.columns.map((c) => [c.eventSlug, c.year])).toEqual([
      ["tn-2025", 2025],
      ["tn-2026", 2026],
    ])
  })

  test("one row per quiz series in first-appearance order, then Other quizzes", () => {
    const m = buildSeriesMatrix(
      [edition("tn-2025", "2025-08-01"), edition("tn-2026", "2026-08-07")],
      [
        quiz("ind-25", "tn-2025", "ind"),
        quiz("pub-25", "tn-2025", null),
        quiz("pairs-26", "tn-2026", "pairs"),
        quiz("ind-26", "tn-2026", "ind"),
      ],
    )
    expect(m.rows.map((r) => r.key)).toEqual([
      "ind",
      "pairs",
      OTHER_QUIZZES_KEY,
    ])
    expect(m.rows[0].label).toBe("Series ind")
    expect(m.rows[0].seriesSlug).toBe("ind")
    expect(m.rows[0].cells.map((c) => c.map((q) => q.quiz_id))).toEqual([
      ["ind-25"],
      ["ind-26"],
    ])
    expect(m.rows[1].cells.map((c) => c.length)).toEqual([0, 1])
    expect(m.rows[2].label).toBe("Other quizzes")
    expect(m.rows[2].seriesSlug).toBeNull()
  })

  test("keeps several quizzes of one series held at one edition in one cell", () => {
    const m = buildSeriesMatrix(
      [edition("tn-2026", "2026-08-07")],
      [quiz("heat", "tn-2026", "ind"), quiz("final", "tn-2026", "ind")],
    )
    expect(m.rows[0].cells[0].map((q) => q.quiz_id)).toEqual(["heat", "final"])
  })

  test("skips a quiz whose event is not among the editions", () => {
    const m = buildSeriesMatrix(
      [edition("tn-2026", "2026-08-07")],
      [quiz("elsewhere", "other-event", "ind")],
    )
    expect(m.rows).toEqual([])
  })

  test("editions without quizzes give columns and no rows", () => {
    const m = buildSeriesMatrix([edition("tn-2026", "2026-08-07")], [])
    expect(m.columns).toHaveLength(1)
    expect(m.rows).toEqual([])
  })
})

describe("competitionListQueryKey", () => {
  test("never collides with a competition detail key", () => {
    // Detail pages use ["competitions", slug]; a slug of "quiz" must not
    // read the list cache.
    expect(competitionListQueryKey("quiz")).toEqual([
      "competitions",
      "list",
      "quiz",
    ])
    expect(competitionListQueryKey()).toEqual(["competitions", "list", "all"])
  })
})
