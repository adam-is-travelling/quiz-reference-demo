import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
  COUNTRIES,
  COUNTRY_DEMONYMS,
  countryName,
  countrySlug,
  countrySummary,
  inferCountryFromTeamName,
  resolveCountryCode,
  slugifyCountryName,
  teamLabel,
} from "../src/lib/countries"

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

describe("teamLabel", () => {
  test("a country is named", () => {
    expect(teamLabel({ team_type: "national", team_country: "GB" })).toBe(
      "United Kingdom",
    )
  })

  test("national with no country is an international side", () => {
    expect(teamLabel({ team_type: "national", team_country: null })).toBe(
      "International",
    )
  })

  test("a club with no country has nothing to say", () => {
    expect(teamLabel({ team_type: "club", team_country: null })).toBe("—")
  })

  test("a missing team_type has nothing to say", () => {
    expect(teamLabel({ team_country: null })).toBe("—")
  })
})

describe("inferCountryFromTeamName", () => {
  test("a country name with a letter suffix resolves", () => {
    expect(inferCountryFromTeamName("England A")).toBe("ENG")
  })

  test("a country name with a word suffix resolves", () => {
    expect(inferCountryFromTeamName("Netherlands One")).toBe("NL")
  })

  test("a demonym resolves", () => {
    expect(inferCountryFromTeamName("Austrian National Team")).toBe("AT")
  })

  test("a demonym sharing no letters with its country name resolves", () => {
    expect(inferCountryFromTeamName("Dutch Masters")).toBe("NL")
  })

  test("the longest match wins over a country name nested inside it", () => {
    expect(inferCountryFromTeamName("Northern Ireland A")).toBe("NIR")
  })

  test("South Sudan is not read as Sudan", () => {
    expect(inferCountryFromTeamName("South Sudan B")).toBe("SS")
  })

  test("two different countries infer nothing", () => {
    expect(inferCountryFromTeamName("England v Scotland Select")).toBeNull()
  })

  test("matching is case-insensitive", () => {
    expect(inferCountryFromTeamName("ENGLAND A")).toBe("ENG")
  })

  test("a country name must match as a whole word", () => {
    expect(inferCountryFromTeamName("Englander Social Club")).toBeNull()
  })

  test("punctuation does not prevent a match", () => {
    expect(inferCountryFromTeamName("Ireland (A)")).toBe("IE")
  })

  test("a name with no country infers nothing", () => {
    expect(inferCountryFromTeamName("Manchester Quiz League")).toBeNull()
  })

  test("empty input infers nothing", () => {
    expect(inferCountryFromTeamName("")).toBeNull()
  })

  test("null input infers nothing", () => {
    expect(inferCountryFromTeamName(null)).toBeNull()
  })
})

describe("COUNTRY_DEMONYMS", () => {
  test("every demonym maps to a real country code", () => {
    const codes = new Set(COUNTRIES.map((c) => c.code))
    const unknown = Object.entries(COUNTRY_DEMONYMS).filter(
      ([, code]) => !codes.has(code),
    )
    expect(unknown).toEqual([])
  })

  test("every demonym key is lowercase", () => {
    const mixed = Object.keys(COUNTRY_DEMONYMS).filter(
      (key) => key !== key.toLowerCase(),
    )
    expect(mixed).toEqual([])
  })
})

describe("countrySlug", () => {
  test("matches the backend slugs byte for byte", () => {
    // Pinned identically in backend/tests/api/routes/test_countries.py.
    expect(countrySlug("CA")).toBe("canada")
    expect(countrySlug("AE")).toBe("united-arab-emirates")
    expect(countrySlug("AX")).toBe("åland-islands")
    expect(countrySlug("CI")).toBe("côte-divoire")
    expect(countrySlug("VI")).toBe("us-virgin-islands")
    expect(countrySlug("CD")).toBe("congo-democratic-republic")
  })

  test("is null for a missing or unknown code", () => {
    expect(countrySlug(null)).toBeNull()
    expect(countrySlug(undefined)).toBeNull()
    expect(countrySlug("")).toBeNull()
    expect(countrySlug("XX")).toBeNull()
  })

  test("every country has a distinct slug", () => {
    const slugs = COUNTRIES.map((c) => slugifyCountryName(c.name))
    expect(new Set(slugs).size).toBe(COUNTRIES.length)
  })
})

describe("frontend country list", () => {
  test("matches backend/app/countries.py code for code and name for name", () => {
    const source = readFileSync(
      new URL("../../backend/app/countries.py", import.meta.url),
      "utf8",
    )
    const backend = [...source.matchAll(/"([A-Z]{2,3})": "([^"]+)"/g)]
      .map(([, code, name]) => `${code} ${name}`)
      .sort()
    const frontend = COUNTRIES.map((c) => `${c.code} ${c.name}`).sort()
    expect(frontend).toEqual(backend)
  })
})

describe("countrySummary", () => {
  test("reads as a sentence with plural counts", () => {
    expect(countrySummary("India", 12, 30)).toBe(
      "12 quizzers have represented India across 30 quizzes",
    )
  })

  test("uses the singular for one quizzer and one quiz", () => {
    expect(countrySummary("India", 1, 1)).toBe(
      "1 quizzer has represented India across 1 quiz",
    )
  })

  test("mixes singular and plural independently", () => {
    expect(countrySummary("India", 3, 1)).toBe(
      "3 quizzers have represented India across 1 quiz",
    )
    expect(countrySummary("India", 1, 4)).toBe(
      "1 quizzer has represented India across 4 quizzes",
    )
  })
})
