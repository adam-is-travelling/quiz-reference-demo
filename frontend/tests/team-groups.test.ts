import { describe, expect, test } from "bun:test"
import type { Resolution } from "@/components/Upload/types"
import { groupSlotsByTeam, squadStatus, squadSummary } from "@/lib/teamGroups"

function slots(rowIndices: number[]): Array<{ rowIndex: number }> {
  return rowIndices.map((rowIndex) => ({ rowIndex }))
}

// Resolution shorthands for each bucket Step 4 distinguishes.
const matched = (id: string): Resolution => ({
  player_id: id,
  player_create: null,
  autoResolved: true,
})
const toCreate = (name: string): Resolution => ({
  player_id: null,
  player_create: { display_name: name },
  autoResolved: true,
})
const undecided = (): Resolution => ({
  player_id: null,
  player_create: null,
  autoResolved: false,
})
const confirmed = (id: string): Resolution => ({
  player_id: id,
  player_create: null,
  autoResolved: false,
})

describe("groupSlotsByTeam", () => {
  test("keeps each team's slots together in first-seen order", () => {
    const out = groupSlotsByTeam(slots([0, 0, 1, 1]), ["Celtic", "Bohemians"])
    expect(out).toEqual([
      { teamName: "Celtic", slotIndices: [0, 1] },
      { teamName: "Bohemians", slotIndices: [2, 3] },
    ])
  })

  test("merges rows whose team name differs only by case", () => {
    const out = groupSlotsByTeam(slots([0, 1]), ["Celtic", "CELTIC"])
    expect(out).toEqual([{ teamName: "Celtic", slotIndices: [0, 1] }])
  })

  test("ignores surrounding whitespace when grouping", () => {
    const out = groupSlotsByTeam(slots([0, 1]), ["Celtic", "  Celtic  "])
    expect(out).toEqual([{ teamName: "Celtic", slotIndices: [0, 1] }])
  })

  test("keeps players from an unnamed team visible in a trailing group", () => {
    const out = groupSlotsByTeam(slots([0, 1]), ["", "Bohemians"])
    expect(out).toEqual([
      { teamName: "Bohemians", slotIndices: [1] },
      { teamName: "", slotIndices: [0] },
    ])
  })

  test("a team with no squad contributes no group", () => {
    expect(groupSlotsByTeam(slots([1]), ["Celtic", "Bohemians"])).toEqual([
      { teamName: "Bohemians", slotIndices: [0] },
    ])
  })

  test("no slots means no groups", () => {
    expect(groupSlotsByTeam([], ["Celtic"])).toEqual([])
  })
})

describe("squadStatus", () => {
  test("counts each bucket separately", () => {
    const out = squadStatus([
      matched("a"),
      matched("b"),
      toCreate("Carol"),
      undecided(),
    ])
    expect(out).toEqual({
      matched: 2,
      toCreate: 1,
      toReview: 1,
      outstanding: 1,
    })
  })

  test("a review row that has been decided is no longer outstanding", () => {
    const out = squadStatus([confirmed("a"), undecided()])
    expect(out).toEqual({
      matched: 0,
      toCreate: 0,
      toReview: 2,
      outstanding: 1,
    })
  })

  test("a missing resolution counts as outstanding review", () => {
    const out = squadStatus([undefined as unknown as Resolution])
    expect(out).toEqual({
      matched: 0,
      toCreate: 0,
      toReview: 1,
      outstanding: 1,
    })
  })

  test("an empty squad is all zeroes", () => {
    expect(squadStatus([])).toEqual({
      matched: 0,
      toCreate: 0,
      toReview: 0,
      outstanding: 0,
    })
  })
})

describe("squadSummary", () => {
  test("leads with the outstanding work when there is any", () => {
    expect(
      squadSummary({ matched: 4, toCreate: 1, toReview: 2, outstanding: 2 }),
    ).toBe("2 to review, 4 matched, 1 to create")
  })

  test("drops empty buckets", () => {
    expect(
      squadSummary({ matched: 6, toCreate: 0, toReview: 0, outstanding: 0 }),
    ).toBe("6 matched")
  })

  test("reports a settled review row as confirmed rather than outstanding", () => {
    expect(
      squadSummary({ matched: 0, toCreate: 0, toReview: 2, outstanding: 0 }),
    ).toBe("2 confirmed")
  })

  test("describes an empty squad", () => {
    expect(
      squadSummary({ matched: 0, toCreate: 0, toReview: 0, outstanding: 0 }),
    ).toBe("No squad listed")
  })
})
