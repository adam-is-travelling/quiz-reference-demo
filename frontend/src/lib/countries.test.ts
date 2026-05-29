import { describe, expect, test } from "bun:test"
import { countryName, resolveCountryCode } from "./countries"

describe("resolveCountryCode", () => {
  test("GB resolves to GB", () => {
    expect(resolveCountryCode("GB")).toBe("GB")
  })

  test("UK alias resolves to GB", () => {
    expect(resolveCountryCode("UK")).toBe("GB")
  })

  test("countryName(GB) is United Kingdom", () => {
    expect(countryName("GB")).toBe("United Kingdom")
  })

  test("UK round-trips to United Kingdom", () => {
    expect(countryName(resolveCountryCode("UK"))).toBe("United Kingdom")
  })

  test("full name United Kingdom resolves to GB", () => {
    expect(resolveCountryCode("United Kingdom")).toBe("GB")
  })

  test("Britain alias resolves to GB", () => {
    expect(resolveCountryCode("Britain")).toBe("GB")
  })

  test("Great Britain alias resolves to GB", () => {
    expect(resolveCountryCode("Great Britain")).toBe("GB")
  })

  test("USA alias resolves to US", () => {
    expect(resolveCountryCode("USA")).toBe("US")
  })

  test("Ireland resolves to IE", () => {
    expect(resolveCountryCode("Ireland")).toBe("IE")
  })

  test("ie (lowercase code) resolves to IE", () => {
    expect(resolveCountryCode("ie")).toBe("IE")
  })

  test("England resolves to ENG", () => {
    expect(resolveCountryCode("England")).toBe("ENG")
  })

  test("unknown string returns null", () => {
    expect(resolveCountryCode("Narnia")).toBeNull()
  })

  test("null input returns null", () => {
    expect(resolveCountryCode(null)).toBeNull()
  })

  test("empty string returns null", () => {
    expect(resolveCountryCode("")).toBeNull()
  })
})
