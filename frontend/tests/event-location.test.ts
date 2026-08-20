import { describe, expect, test } from "bun:test"
import { formatEventLocation } from "../src/components/Events/EventLocation"

describe("formatEventLocation", () => {
  test("renders Online for an online event", () => {
    expect(
      formatEventLocation({
        is_online: true,
        venue: null,
        city: null,
        country: null,
      }),
    ).toBe("Online")
  })

  test("joins venue, city and country name", () => {
    expect(
      formatEventLocation({
        is_online: false,
        venue: "Divani Caravel",
        city: "Athens",
        country: "GR",
      }),
    ).toBe("Divani Caravel, Athens, Greece")
  })

  test("omits a null venue", () => {
    expect(
      formatEventLocation({
        is_online: false,
        venue: null,
        city: "Athens",
        country: "GR",
      }),
    ).toBe("Athens, Greece")
  })

  test("omits a null city", () => {
    expect(
      formatEventLocation({
        is_online: false,
        venue: "Divani Caravel",
        city: null,
        country: "GR",
      }),
    ).toBe("Divani Caravel, Greece")
  })

  test("falls back to an em dash when nothing is known", () => {
    expect(
      formatEventLocation({
        is_online: false,
        venue: null,
        city: null,
        country: null,
      }),
    ).toBe("—")
  })
})
