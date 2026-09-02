import { describe, expect, test } from "bun:test"
import { splitPairNames } from "../src/lib/splitPairNames"

describe("splitPairNames", () => {
  test("splits on an ampersand", () => {
    expect(splitPairNames("Alice & Bob")).toEqual(["Alice", "Bob"])
  })

  test("splits on an ampersand without spaces", () => {
    expect(splitPairNames("Alice&Bob")).toEqual(["Alice", "Bob"])
  })

  test("splits on the word and", () => {
    expect(splitPairNames("Alice and Bob")).toEqual(["Alice", "Bob"])
  })

  test("splits on the word And regardless of case", () => {
    expect(splitPairNames("Alice And Bob")).toEqual(["Alice", "Bob"])
  })

  test("leaves a lone name alone", () => {
    expect(splitPairNames("Alice")).toEqual(["Alice"])
  })

  test("does not split a name containing and", () => {
    expect(splitPairNames("Alexander")).toEqual(["Alexander"])
  })

  test("does not split Sandy", () => {
    expect(splitPairNames("Sandy")).toEqual(["Sandy"])
  })

  test("splits a pair whose names contain and", () => {
    expect(splitPairNames("Alexander and Sandy")).toEqual([
      "Alexander",
      "Sandy",
    ])
  })

  test("returns three names when there are three", () => {
    expect(splitPairNames("Alice & Bob & Carol")).toEqual([
      "Alice",
      "Bob",
      "Carol",
    ])
  })

  test("handles mixed separators", () => {
    expect(splitPairNames("Alice & Bob and Carol")).toEqual([
      "Alice",
      "Bob",
      "Carol",
    ])
  })

  test("collapses internal whitespace and trims", () => {
    expect(splitPairNames("  Alice   Smith  &  Bob  ")).toEqual([
      "Alice Smith",
      "Bob",
    ])
  })

  test("drops empty segments from a trailing separator", () => {
    expect(splitPairNames("Alice &")).toEqual(["Alice"])
  })

  test("returns an empty array for an empty cell", () => {
    expect(splitPairNames("   ")).toEqual([])
  })
})
