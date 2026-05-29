import { expect, test } from "@playwright/test"
import { Labels } from "../src/test-ids"

test.describe("Upload wizard — mode selection", () => {
  test("Wizard shows mode selection as first step", async ({ page }) => {
    await page.goto("/upload")
    await expect(page.getByTestId(Labels.uploadModeNew)).toBeVisible()
    await expect(page.getByTestId(Labels.uploadModeExisting)).toBeVisible()
  })

  test("Selecting New event advances to event details form", async ({
    page,
  }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeNew).click()
    await expect(page.getByLabel("Event name *")).toBeVisible()
    await expect(
      page.getByTestId(Labels.uploadExistingEventSelect),
    ).not.toBeVisible()
  })

  test("Selecting Existing event advances to event picker", async ({
    page,
  }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeExisting).click()
    await expect(
      page.getByTestId(Labels.uploadExistingEventSelect),
    ).toBeVisible()
    await expect(page.getByLabel("Event name *")).not.toBeVisible()
  })

  test("Toggle switches from new to existing mode", async ({ page }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeNew).click()
    await expect(page.getByLabel("Event name *")).toBeVisible()
    await page.getByTestId(Labels.uploadModeToggleExisting).click()
    await expect(
      page.getByTestId(Labels.uploadExistingEventSelect),
    ).toBeVisible()
    await expect(page.getByLabel("Event name *")).not.toBeVisible()
  })

  test("Toggle switches from existing to new mode", async ({ page }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeExisting).click()
    await page.getByTestId(Labels.uploadModeToggleNew).click()
    await expect(page.getByLabel("Event name *")).toBeVisible()
    await expect(
      page.getByTestId(Labels.uploadExistingEventSelect),
    ).not.toBeVisible()
  })
})

test.describe("Upload wizard — date fields", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeNew).click()
  })

  test("date field defaults to today in YYYY-MM-DD format", async ({ page }) => {
    const now = new Date()
    const expected = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-")
    await expect(page.getByLabel("Date *")).toHaveValue(expected)
  })

  test("end date field is hidden by default", async ({ page }) => {
    await expect(page.getByLabel("End date *")).not.toBeVisible()
  })

  test("multi-day checkbox is unchecked by default", async ({ page }) => {
    await expect(page.getByLabel("Multi-day event")).not.toBeChecked()
  })

  test("checking multi-day reveals end date and relabels start date", async ({
    page,
  }) => {
    await page.getByLabel("Multi-day event").check()
    await expect(page.getByLabel("Start date *")).toBeVisible()
    await expect(page.getByLabel("End date *")).toBeVisible()
    await expect(page.getByLabel("Date *", { exact: true })).not.toBeVisible()
  })

  test("end date pre-fills with today when multi-day is first checked", async ({
    page,
  }) => {
    const startValue = await page.getByLabel("Date *").inputValue()
    await page.getByLabel("Multi-day event").check()
    await expect(page.getByLabel("End date *")).toHaveValue(startValue)
  })

  test("unchecking multi-day hides end date and restores Date label", async ({
    page,
  }) => {
    await page.getByLabel("Multi-day event").check()
    await page.getByLabel("Multi-day event").uncheck()
    await expect(page.getByLabel("Date *")).toBeVisible()
    await expect(page.getByLabel("End date *")).not.toBeVisible()
  })

  test("date field is narrower than the full form width", async ({ page }) => {
    const dateBBox = await page.getByLabel("Date *").boundingBox()
    const nameBBox = await page.getByLabel("Event name *").boundingBox()
    expect(dateBBox!.width).toBeLessThan(nameBBox!.width)
  })

  test("start and end date inputs are on the same line in multi-day mode", async ({
    page,
  }) => {
    await page.getByLabel("Multi-day event").check()
    const startBBox = await page.getByLabel("Start date *").boundingBox()
    const endBBox = await page.getByLabel("End date *").boundingBox()
    expect(Math.abs(startBBox!.y - endBBox!.y)).toBeLessThan(2)
  })

  test("calendar picker indicator has invert filter rule for dark mode", async ({
    page,
  }) => {
    const hasRule = await page.evaluate(() => {
      function search(rules: CSSRuleList): boolean {
        for (const rule of rules) {
          if (
            rule instanceof CSSStyleRule &&
            rule.selectorText?.includes("calendar-picker-indicator") &&
            rule.style.filter === "invert(1)"
          ) {
            return true
          }
          if ("cssRules" in rule && search((rule as CSSGroupingRule).cssRules)) {
            return true
          }
        }
        return false
      }
      for (const sheet of document.styleSheets) {
        try {
          if (search(sheet.cssRules)) return true
        } catch {
          // cross-origin sheets are inaccessible
        }
      }
      return false
    })
    expect(hasRule).toBe(true)
  })
})

test.describe("Upload wizard — submit mode", () => {
  test("Submit mode toggle is not present on new event path at Step 1", async ({
    page,
  }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeNew).click()
    await expect(page.getByTestId(Labels.submitModeToggle)).not.toBeVisible()
  })

  test("Navigating back from Step 1 returns to mode selection", async ({
    page,
  }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeNew).click()
    await page.getByRole("button", { name: "← Back" }).click()
    await expect(page.getByTestId(Labels.uploadModeNew)).toBeVisible()
    await expect(page.getByTestId(Labels.uploadModeExisting)).toBeVisible()
  })

  test("Navigating back from existing Step 1 returns to mode selection", async ({
    page,
  }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeExisting).click()
    await page.getByRole("button", { name: "← Back" }).click()
    await expect(page.getByTestId(Labels.uploadModeNew)).toBeVisible()
    await expect(page.getByTestId(Labels.uploadModeExisting)).toBeVisible()
  })
})
