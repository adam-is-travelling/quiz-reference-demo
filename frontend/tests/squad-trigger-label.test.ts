import { describe, expect, test } from "bun:test"
import { squadTriggerLabel } from "../src/components/Quizzes/SquadCell"

describe("squadTriggerLabel", () => {
  test("one player is singular", () => {
    expect(squadTriggerLabel(1)).toBe("1 player")
  })

  test("several players are plural", () => {
    expect(squadTriggerLabel(5)).toBe("5 players")
  })

  test("an empty squad invites the admin to fill it", () => {
    expect(squadTriggerLabel(0)).toBe("Add squad")
  })
})
