import { describe, expect, test } from "bun:test"
import { radioGroupName } from "@/components/Upload/steps/Step4Disambiguation"

// Slot shapes mirror buildParticipantSlots: one entry per participant, so a
// teams upload contributes a whole squad per row.
function slotsFor(squadSizes: number[]): Array<[number, number]> {
  const slots: Array<[number, number]> = []
  squadSizes.forEach((size, rowIndex) => {
    for (let slot = 0; slot < size; slot++) slots.push([rowIndex, slot])
  })
  return slots
}

function names(squadSizes: number[]): string[] {
  return slotsFor(squadSizes).map(([r, s]) => radioGroupName(r, s))
}

describe("radioGroupName", () => {
  test("individual rows get one distinct group each", () => {
    const out = names([1, 1, 1, 1])
    expect(new Set(out).size).toBe(out.length)
  })

  test("pairs get a distinct group per quizzer", () => {
    const out = names([2, 2, 2])
    expect(new Set(out).size).toBe(out.length)
  })

  test("team squads larger than a pair never share a group", () => {
    const out = names([4, 4, 4])
    expect(new Set(out).size).toBe(out.length)
  })

  test("ragged squads never share a group", () => {
    const out = names([6, 3, 5, 2, 8])
    expect(new Set(out).size).toBe(out.length)
  })
})
