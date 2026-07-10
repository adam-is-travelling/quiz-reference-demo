import { describe, expect, test } from "bun:test"
import { parseCsv } from "../src/lib/csv"

describe("parseCsv", () => {
  test("splits a simple comma-delimited row", () => {
    const rows = parseCsv("Name,Country,Score\nAlice,Ireland,50")
    expect(rows).toEqual([
      ["Name", "Country", "Score"],
      ["Alice", "Ireland", "50"],
    ])
  })

  test("keeps a quoted field containing a comma as one cell", () => {
    const rows = parseCsv('Name,Score\n"Smith, Jr., John",42')
    expect(rows).toEqual([
      ["Name", "Score"],
      ["Smith, Jr., John", "42"],
    ])
  })

  test("unescapes doubled quotes inside a quoted field", () => {
    const rows = parseCsv('Name,Score\n"Say ""Hi"" John",10')
    expect(rows).toEqual([
      ["Name", "Score"],
      ['Say "Hi" John', "10"],
    ])
  })

  test("detects and parses tab-delimited input", () => {
    const rows = parseCsv("Name\tCountry\tScore\nAlice\tIreland\t50")
    expect(rows).toEqual([
      ["Name", "Country", "Score"],
      ["Alice", "Ireland", "50"],
    ])
  })

  test("drops blank lines", () => {
    const rows = parseCsv("Name,Score\nAlice,50\n\nBob,40\n")
    expect(rows).toEqual([
      ["Name", "Score"],
      ["Alice", "50"],
      ["Bob", "40"],
    ])
  })

  test("trims whitespace around unquoted cells", () => {
    const rows = parseCsv("Name, Score \n Alice , 50 ")
    expect(rows).toEqual([
      ["Name", "Score"],
      ["Alice", "50"],
    ])
  })
})
