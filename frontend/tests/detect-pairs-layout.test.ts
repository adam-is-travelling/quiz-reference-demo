import { describe, expect, test } from "bun:test"
import { detectPairsLayout } from "../src/lib/detectPairsLayout"

describe("detectPairsLayout", () => {
  test("picks combined when most name cells hold a separator", () => {
    const rows = [
      ["Team", "Country", "Score"],
      ["Alice & Bob", "IE", "50"],
      ["Carol and Dave", "IE", "48"],
      ["Solo Sam", "IE", "40"],
    ]
    expect(detectPairsLayout(rows, 0, rows[0], new Set())).toEqual({
      layout: "combined",
      player_name_2: null,
    })
  })

  test("picks two columns when a partner header exists", () => {
    const rows = [
      ["Player 1", "Player 2", "Country", "Score"],
      ["Alice", "Bob", "IE", "50"],
      ["Carol", "Dave", "IE", "48"],
    ]
    expect(detectPairsLayout(rows, 0, rows[0], new Set([0]))).toEqual({
      layout: "two-columns",
      player_name_2: 1,
    })
  })

  test("recognises a partner column", () => {
    const rows = [
      ["Name", "Partner", "Score"],
      ["Alice", "Bob", "50"],
    ]
    expect(detectPairsLayout(rows, 0, rows[0], new Set([0]))).toEqual({
      layout: "two-columns",
      player_name_2: 1,
    })
  })

  test("falls back to combined when nothing matches", () => {
    const rows = [
      ["Name", "Country", "Score"],
      ["Alice", "IE", "50"],
    ]
    expect(detectPairsLayout(rows, 0, rows[0], new Set([0]))).toEqual({
      layout: "combined",
      player_name_2: null,
    })
  })

  test("ignores blank name cells when counting separators", () => {
    const rows = [
      ["Team", "Score"],
      ["Alice & Bob", "50"],
      ["", ""],
    ]
    expect(detectPairsLayout(rows, 0, rows[0], new Set())).toEqual({
      layout: "combined",
      player_name_2: null,
    })
  })
})
