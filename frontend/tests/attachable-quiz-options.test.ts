import { describe, expect, test } from "bun:test"
import type { QuizPublic } from "../src/client"
import { buildAttachableQuizOptions } from "../src/components/Events/AttachQuizDialog"

const THIS_EVENT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
const OTHER_EVENT = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"

function quiz(overrides: Partial<QuizPublic> & { name: string }): QuizPublic {
  return {
    id: `quiz-${overrides.name}`,
    slug: overrides.name.toLowerCase().replace(/\s+/g, "-"),
    start_date: "2026-03-01",
    end_date: "2026-03-01",
    status: "approved",
    submitted_by_id: "user-1",
    ...overrides,
  } as QuizPublic
}

describe("buildAttachableQuizOptions", () => {
  test("offers an unattached quiz, labelled with its date", () => {
    const options = buildAttachableQuizOptions(
      [quiz({ name: "Spring Open", start_date: "2026-03-01" })],
      THIS_EVENT,
    )

    expect(options).toEqual([
      { id: "quiz-Spring Open", label: "Spring Open (2026-03-01)" },
    ])
  })

  test("excludes quizzes already attached to this event", () => {
    const options = buildAttachableQuizOptions(
      [
        quiz({ name: "Already Here", event_id: THIS_EVENT }),
        quiz({ name: "Spring Open" }),
      ],
      THIS_EVENT,
    )

    expect(options.map((o) => o.label)).toEqual(["Spring Open (2026-03-01)"])
  })

  test("flags a quiz attached to a different event so re-pointing is explicit", () => {
    const options = buildAttachableQuizOptions(
      [
        quiz({
          name: "Borrowed",
          event_id: OTHER_EVENT,
          event_name: "Autumn Open",
        }),
      ],
      THIS_EVENT,
    )

    expect(options).toEqual([
      {
        id: "quiz-Borrowed",
        label: "Borrowed (2026-03-01) — currently: Autumn Open",
      },
    ])
  })

  test("falls back to a generic note when the other event has no name", () => {
    const options = buildAttachableQuizOptions(
      [quiz({ name: "Borrowed", event_id: OTHER_EVENT })],
      THIS_EVENT,
    )

    expect(options[0].label).toBe(
      "Borrowed (2026-03-01) — currently: another event",
    )
  })

  test("returns nothing when every quiz is already on this event", () => {
    const options = buildAttachableQuizOptions(
      [quiz({ name: "Already Here", event_id: THIS_EVENT })],
      THIS_EVENT,
    )

    expect(options).toEqual([])
  })
})
