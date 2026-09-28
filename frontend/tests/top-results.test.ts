import { describe, expect, test } from "bun:test"
import { topResults } from "../src/lib/topResults"

const ranked = (...ranks: number[]) =>
  ranks.map((final_rank) => ({ final_rank }))

describe("topResults", () => {
  test("returns every row when there are no more than the limit", () => {
    const rows = ranked(1, 2, 3)
    expect(topResults(rows, 3)).toEqual(rows)
  })

  test("cuts to the best-ranked rows", () => {
    expect(topResults(ranked(1, 2, 3, 4, 5), 3)).toEqual(ranked(1, 2, 3))
  })

  test("orders by rank regardless of input order", () => {
    expect(topResults(ranked(4, 2, 5, 1, 3), 2)).toEqual(ranked(1, 2))
  })

  test("keeps rows tied with the last one inside the cut", () => {
    expect(topResults(ranked(1, 2, 3, 3, 3, 6), 3)).toEqual(
      ranked(1, 2, 3, 3, 3),
    )
  })

  test("puts unranked rows after ranked ones", () => {
    const rows = [{ final_rank: null }, { final_rank: 2 }, { final_rank: 1 }]
    expect(topResults(rows, 2)).toEqual([{ final_rank: 1 }, { final_rank: 2 }])
  })
})
