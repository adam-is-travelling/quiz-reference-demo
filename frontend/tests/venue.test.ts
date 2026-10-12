import { describe, expect, test } from "bun:test"
import { rowVenue } from "@/lib/venue"

describe("rowVenue", () => {
  test("trims the mapped cell", () => {
    expect(rowVenue(["Ann", " Leeds "], 1)).toBe("Leeds")
  })
  test("blank or whitespace cell → null", () => {
    expect(rowVenue(["Ann", "   "], 1)).toBeNull()
    expect(rowVenue(["Ann"], 1)).toBeNull()
  })
  test("unmapped column or missing row → null", () => {
    expect(rowVenue(["Ann", "Leeds"], null)).toBeNull()
    expect(rowVenue(["Ann", "Leeds"], undefined)).toBeNull()
    expect(rowVenue(undefined, 1)).toBeNull()
  })
})
