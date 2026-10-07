import { describe, expect, test } from "bun:test"
import { sortMedalResults } from "../src/lib/sortMedalResults"

const result = (id: string, final_rank: number, start_date: string) => ({
  result_id: id,
  final_rank,
  start_date,
})

describe("sortMedalResults", () => {
  test("orders golds, then silvers, then bronzes, newest first within each", () => {
    const sorted = sortMedalResults([
      result("bronze-2024", 3, "2024-05-01"),
      result("gold-2022", 1, "2022-01-01"),
      result("silver-2025", 2, "2025-01-01"),
      result("gold-2025", 1, "2025-03-01"),
      result("silver-2021", 2, "2021-01-01"),
    ])
    expect(sorted.map((r) => r.result_id)).toEqual([
      "gold-2025",
      "gold-2022",
      "silver-2025",
      "silver-2021",
      "bronze-2024",
    ])
  })

  test("does not reorder the array it was given", () => {
    const input = [result("b", 2, "2024-01-01"), result("a", 1, "2024-01-01")]
    sortMedalResults(input)
    expect(input.map((r) => r.result_id)).toEqual(["b", "a"])
  })
})
