import { describe, expect, test } from "bun:test"
import { normalizePlayerName } from "../src/lib/normalizePlayerName"

describe("normalizePlayerName — ALL CAPS → title case", () => {
  test("full name in all caps", () => {
    expect(normalizePlayerName("JOHN SMITH")).toBe("John Smith")
  })

  test("single word in all caps", () => {
    expect(normalizePlayerName("SMITH")).toBe("Smith")
  })

  test("hyphenated name in all caps", () => {
    expect(normalizePlayerName("SMITH-JONES")).toBe("Smith-Jones")
  })

  test("double hyphenated name in all caps", () => {
    expect(normalizePlayerName("ANNE-MARIE SMITH-JONES")).toBe(
      "Anne-Marie Smith-Jones",
    )
  })

  test("name with initials in all caps", () => {
    expect(normalizePlayerName("G.E. MOORE")).toBe("G.E. Moore")
  })

  test("name with apostrophe in all caps", () => {
    expect(normalizePlayerName("O'BRIEN")).toBe("O'Brien")
  })

  test("name with accented characters in all caps", () => {
    expect(normalizePlayerName("SÉAN ÓBRIEN")).toBe("Séan Óbrien")
  })
})

describe("normalizePlayerName — all lowercase → title case", () => {
  test("full name in all lowercase", () => {
    expect(normalizePlayerName("john smith")).toBe("John Smith")
  })

  test("single word in all lowercase", () => {
    expect(normalizePlayerName("smith")).toBe("Smith")
  })

  test("hyphenated name in all lowercase", () => {
    expect(normalizePlayerName("smith-jones")).toBe("Smith-Jones")
  })

  test("name with initials in all lowercase", () => {
    expect(normalizePlayerName("g.e. moore")).toBe("G.E. Moore")
  })

  test("name with apostrophe in all lowercase", () => {
    expect(normalizePlayerName("o'brien")).toBe("O'Brien")
  })
})

describe("normalizePlayerName — mixed case → unchanged", () => {
  test("MacDonald-style name unchanged", () => {
    expect(normalizePlayerName("MacDonald")).toBe("MacDonald")
  })

  test("camel-style name unchanged", () => {
    expect(normalizePlayerName("RamaSita")).toBe("RamaSita")
  })

  test("title case name unchanged", () => {
    expect(normalizePlayerName("John Smith")).toBe("John Smith")
  })

  test("title case hyphenated name unchanged", () => {
    expect(normalizePlayerName("Smith-Jones")).toBe("Smith-Jones")
  })

  test("title case name with apostrophe unchanged", () => {
    expect(normalizePlayerName("O'Brien")).toBe("O'Brien")
  })

  test("title case name with initials unchanged", () => {
    expect(normalizePlayerName("G.E. Moore")).toBe("G.E. Moore")
  })

  test("Randy van Halen unchanged", () => {
    expect(normalizePlayerName("Randy van Halen")).toBe("Randy van Halen")
  })
})

describe("normalizePlayerName — edge cases", () => {
  test("all caps with digits normalizes letters", () => {
    expect(normalizePlayerName("PLAYER 1")).toBe("Player 1")
  })

  test("all lowercase with digits normalizes letters", () => {
    expect(normalizePlayerName("player 1")).toBe("Player 1")
  })

  test("no alphabetic characters unchanged", () => {
    expect(normalizePlayerName("123")).toBe("123")
  })

  test("single uppercase letter unchanged", () => {
    expect(normalizePlayerName("A")).toBe("A")
  })

  test("mixed case with digits unchanged", () => {
    expect(normalizePlayerName("Player1A")).toBe("Player1A")
  })

  test("whitespace-only unchanged", () => {
    expect(normalizePlayerName("   ")).toBe("   ")
  })
})
