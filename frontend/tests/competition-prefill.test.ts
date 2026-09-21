import { describe, expect, test } from "bun:test"
import type { CompetitionPublic } from "../src/client"
import {
  competitionPrefillState,
  INITIAL_STATE,
} from "../src/components/Upload/types"

const competition: CompetitionPublic = {
  id: "comp-1",
  name: "World Championship",
  slug: "world-championship",
  organization_id: "org-1",
  organization_name: "Quiz Org",
  organization_slug: "quiz-org",
  description: null,
}

describe("competitionPrefillState", () => {
  test("opens the wizard on Quiz details in new-quiz mode", () => {
    const state = competitionPrefillState(competition)
    expect(state.step).toBe(1)
    expect(state.quizMode).toBe("new")
  })

  test("prefills name, competition, organization and organizer", () => {
    const { quizMeta } = competitionPrefillState(competition)
    expect(quizMeta.name).toBe("World Championship")
    expect(quizMeta.competition_id).toBe("comp-1")
    expect(quizMeta.organization_id).toBe("org-1")
    expect(quizMeta.organizer_name).toBe("Quiz Org")
  })

  test("leaves every other field at its wizard default", () => {
    const { quizMeta } = competitionPrefillState(competition)
    expect(quizMeta.event_id).toBe("")
    expect(quizMeta.format_id).toBe("")
    expect(quizMeta.description).toBe("")
    expect(quizMeta.participant_mode).toBe("individual")
    expect(quizMeta.is_qualifier).toBe(false)
    expect(quizMeta.start_date).toBe(quizMeta.end_date)
  })

  test("a competition with no organization name leaves organizer_name null", () => {
    const { quizMeta } = competitionPrefillState({
      ...competition,
      organization_name: null,
    })
    expect(quizMeta.organizer_name).toBeNull()
    expect(quizMeta.organization_id).toBe("org-1")
  })

  test("does not mutate INITIAL_STATE", () => {
    competitionPrefillState(competition)
    expect(INITIAL_STATE.step).toBe(0)
    expect(INITIAL_STATE.quizMeta.name).toBe("")
    expect(INITIAL_STATE.quizMeta.competition_id).toBe("")
  })
})
