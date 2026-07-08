import { describe, expect, test } from "bun:test"
import {
  COUNTRY_HEADER_NAMES,
  detectColumn,
  detectExactColumn,
  PLAYER_NAME_HEADER_NAMES,
  POSITION_HEADER_NAMES,
  SCORE_HEADER_NAMES,
} from "../src/lib/columnDetection"

describe("detectColumn — exact match", () => {
  test("matches player name candidates", () => {
    const header = ["Player Name", "Country", "Score"]
    expect(detectColumn(header, PLAYER_NAME_HEADER_NAMES, new Set())).toBe(0)
  })

  test("matches country candidate", () => {
    const header = ["Name", "Country", "Score"]
    expect(detectColumn(header, COUNTRY_HEADER_NAMES, new Set())).toBe(1)
  })

  test("matches score candidates", () => {
    const header = ["Name", "Country", "Overall"]
    expect(detectColumn(header, SCORE_HEADER_NAMES, new Set())).toBe(2)
  })

  test("matches position candidates including psn", () => {
    const header = ["Psn", "Name", "Country", "Score"]
    expect(detectColumn(header, POSITION_HEADER_NAMES, new Set())).toBe(0)
  })

  test("is case-insensitive and trims whitespace", () => {
    const header = ["  NAME  ", "Country", "Score"]
    expect(detectColumn(header, PLAYER_NAME_HEADER_NAMES, new Set())).toBe(0)
  })
})

describe("detectColumn — substring fallback", () => {
  test("matches when a candidate is a substring of the header", () => {
    const header = ["Player", "Country", "Total Score"]
    expect(detectColumn(header, SCORE_HEADER_NAMES, new Set())).toBe(2)
  })

  test("prefers an exact match over a substring match", () => {
    const header = ["Total Score", "Score"]
    expect(detectColumn(header, SCORE_HEADER_NAMES, new Set())).toBe(1)
  })
})

describe("detectColumn — claimed columns", () => {
  test("skips a column already claimed by another field", () => {
    const header = ["Score", "Country"]
    expect(detectColumn(header, SCORE_HEADER_NAMES, new Set([0]))).toBeNull()
  })
})

describe("detectColumn — no match", () => {
  test("returns null when no header matches", () => {
    const header = ["A", "B", "C"]
    expect(detectColumn(header, PLAYER_NAME_HEADER_NAMES, new Set())).toBeNull()
  })
})

describe("detectExactColumn — round name matching", () => {
  test("matches an exact round name", () => {
    const header = ["Name", "Country", "Score", "Picture Round"]
    expect(detectExactColumn(header, "Picture Round", new Set())).toBe(3)
  })

  test("is case-insensitive and trims whitespace", () => {
    const header = ["  picture round  "]
    expect(detectExactColumn(header, "Picture Round", new Set())).toBe(0)
  })

  test("does not substring-match", () => {
    const header = ["Picture Round Extra"]
    expect(detectExactColumn(header, "Picture Round", new Set())).toBeNull()
  })

  test("skips claimed columns", () => {
    const header = ["Picture Round"]
    expect(detectExactColumn(header, "Picture Round", new Set([0]))).toBeNull()
  })
})

describe("detectExactColumn — array of candidates", () => {
  test("returns the correct index on an exact match against one of the candidates", () => {
    const header = ["Rank", "Name"]
    expect(
      detectExactColumn(header, ["position", "pos", "rank"], new Set()),
    ).toBe(0)
  })

  test("does not substring-match when given an array (position false-positive regression)", () => {
    const header = ["Notes", "Name"]
    expect(
      detectExactColumn(header, POSITION_HEADER_NAMES, new Set()),
    ).toBeNull()
  })
})
