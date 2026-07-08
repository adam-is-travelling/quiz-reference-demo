import { expect, test } from "@playwright/test"
import { FormatsService, OpenAPI } from "../src/client"
import { Labels } from "../src/test-ids"
import { firstSuperuser, firstSuperuserPassword } from "./config.ts"

async function authenticate(): Promise<string> {
  const loginRes = await fetch(
    `${process.env.VITE_API_URL}/api/v1/login/access-token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        username: firstSuperuser,
        password: firstSuperuserPassword,
      }),
    },
  )
  const { access_token } = await loginRes.json()
  return access_token
}

test.describe("Upload wizard — mode selection", () => {
  test("Wizard shows mode selection as first step", async ({ page }) => {
    await page.goto("/upload")
    await expect(page.getByTestId(Labels.uploadModeNew)).toBeVisible()
    await expect(page.getByTestId(Labels.uploadModeExisting)).toBeVisible()
  })

  test("Selecting New quiz advances to quiz details form", async ({ page }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeNew).click()
    await expect(page.getByLabel("Quiz name *")).toBeVisible()
    await expect(
      page.getByTestId(Labels.uploadExistingQuizSelect),
    ).not.toBeVisible()
  })

  test("Selecting Existing quiz advances to quiz picker", async ({ page }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeExisting).click()
    await expect(
      page.getByTestId(Labels.uploadExistingQuizSelect),
    ).toBeVisible()
    await expect(page.getByLabel("Quiz name *")).not.toBeVisible()
  })

  test("Toggle switches from new to existing mode", async ({ page }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeNew).click()
    await expect(page.getByLabel("Quiz name *")).toBeVisible()
    await page.getByTestId(Labels.uploadModeToggleExisting).click()
    await expect(
      page.getByTestId(Labels.uploadExistingQuizSelect),
    ).toBeVisible()
    await expect(page.getByLabel("Quiz name *")).not.toBeVisible()
  })

  test("Toggle switches from existing to new mode", async ({ page }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeExisting).click()
    await page.getByTestId(Labels.uploadModeToggleNew).click()
    await expect(page.getByLabel("Quiz name *")).toBeVisible()
    await expect(
      page.getByTestId(Labels.uploadExistingQuizSelect),
    ).not.toBeVisible()
  })
})

test.describe("Upload wizard — date fields", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeNew).click()
  })

  test("date field defaults to today in YYYY-MM-DD format", async ({
    page,
  }) => {
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
    await expect(page.getByLabel("Multi-day quiz")).not.toBeChecked()
  })

  test("checking multi-day reveals end date and relabels start date", async ({
    page,
  }) => {
    await page.getByLabel("Multi-day quiz").check()
    await expect(page.getByLabel("Start date *")).toBeVisible()
    await expect(page.getByLabel("End date *")).toBeVisible()
    await expect(page.getByLabel("Date *", { exact: true })).not.toBeVisible()
  })

  test("end date pre-fills with today when multi-day is first checked", async ({
    page,
  }) => {
    const startValue = await page.getByLabel("Date *").inputValue()
    await page.getByLabel("Multi-day quiz").check()
    await expect(page.getByLabel("End date *")).toHaveValue(startValue)
  })

  test("unchecking multi-day hides end date and restores Date label", async ({
    page,
  }) => {
    await page.getByLabel("Multi-day quiz").check()
    await page.getByLabel("Multi-day quiz").uncheck()
    await expect(page.getByLabel("Date *")).toBeVisible()
    await expect(page.getByLabel("End date *")).not.toBeVisible()
  })

  test("date field is narrower than the full form width", async ({ page }) => {
    const dateBBox = await page.getByLabel("Date *").boundingBox()
    const nameBBox = await page.getByLabel("Quiz name *").boundingBox()
    expect(dateBBox!.width).toBeLessThan(nameBBox!.width)
  })

  test("start and end date inputs are on the same line in multi-day mode", async ({
    page,
  }) => {
    await page.getByLabel("Multi-day quiz").check()
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
          if (
            "cssRules" in rule &&
            search((rule as CSSGroupingRule).cssRules)
          ) {
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
  test("Submit mode toggle is not present on new quiz path at Step 1", async ({
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

test.describe("Upload wizard — column mapping", () => {
  async function navigateToStep3(page: import("@playwright/test").Page) {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeNew).click()
    await page.getByLabel("Quiz name *").fill("Test Quiz")
    await page.getByRole("button", { name: "Next →" }).click()
    await page
      .getByLabel("Or paste data directly")
      .fill("Position,Name,Country,Score\n1,Alice,Ireland,50\n2,Bob,England,40")
    await page.getByRole("button", { name: "Next →" }).click()
  }

  test("Position column selector label is visible in Step 3", async ({
    page,
  }) => {
    await navigateToStep3(page)
    await expect(page.getByText("Position column (optional)")).toBeVisible()
  })

  test("Next button is enabled in Step 3 when Position is not mapped", async ({
    page,
  }) => {
    await navigateToStep3(page)
    await expect(page.getByTestId(Labels.columnMappingPosition)).toBeVisible()
    await expect(page.getByRole("button", { name: "Next →" })).toBeEnabled()
  })

  test("Auto-detects player name, country, score, and position columns from matching headers", async ({
    page,
  }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeNew).click()
    await page.getByLabel("Quiz name *").fill("Test Quiz")
    await page.getByRole("button", { name: "Next →" }).click()
    await page
      .getByLabel("Or paste data directly")
      .fill(
        "Rank,Player Name,Country,Total\n1,Alice,Ireland,50\n2,Bob,England,40",
      )
    await page.getByRole("button", { name: "Next →" }).click()

    await expect(
      page.getByTestId(Labels.columnMappingPlayerName),
    ).toContainText("Player Name")
    await expect(page.getByTestId(Labels.columnMappingCountry)).toContainText(
      "Country",
    )
    await expect(page.getByTestId(Labels.columnMappingScore)).toContainText(
      "Total",
    )
    await expect(page.getByTestId(Labels.columnMappingPosition)).toContainText(
      "Rank",
    )
  })

  test("Falls back to default columns when no header matches", async ({
    page,
  }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeNew).click()
    await page.getByLabel("Quiz name *").fill("Test Quiz")
    await page.getByRole("button", { name: "Next →" }).click()
    await page
      .getByLabel("Or paste data directly")
      .fill("A,B,C,D\nAlice,Ireland,50,1\nBob,England,40,2")
    await page.getByRole("button", { name: "Next →" }).click()

    await expect(
      page.getByTestId(Labels.columnMappingPlayerName),
    ).toContainText("A")
    await expect(page.getByTestId(Labels.columnMappingCountry)).toContainText(
      "B",
    )
    await expect(page.getByTestId(Labels.columnMappingScore)).toContainText("C")
  })
})

test.describe("Upload wizard — round column auto-fill", () => {
  let formatId: string | undefined
  let formatName: string | undefined

  const roundColId = (i: number) => `round-column-${i}`

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()

    formatName = `Auto-fill Test Format ${Date.now()}`
    const format = await FormatsService.createFormat({
      requestBody: { name: formatName, rounds: ["R1", "R2", "R3"] },
    })
    formatId = format.id
  })

  test.afterAll(async () => {
    if (formatId) {
      await FormatsService.deleteFormat({ id: formatId })
    }
  })

  test("selecting round 0 auto-fills subsequent rounds consecutively", async ({
    page,
  }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeNew).click()

    await page.getByLabel("Quiz name *").fill("Auto-fill Test Quiz")

    // Select the test format
    await page.getByTestId(Labels.formatSelect).click()
    await page.getByRole("option", { name: formatName }).click()

    await page.getByRole("button", { name: "Next →" }).click()

    // Step 2: paste a 6-column CSV
    await page
      .getByLabel("Or paste data directly")
      .fill(
        "Name,Country,Score,R1,R2,R3\nAlice,Ireland,50,10,20,20\nBob,England,40,15,10,15",
      )
    await page.getByRole("button", { name: "Next →" }).click()

    // Step 3: select R1 (column index 3) for round 0
    await page.getByTestId(roundColId(0)).click()
    await page.getByRole("option", { name: "R1" }).click()

    // Rounds 1 and 2 should auto-fill to R2 and R3
    await expect(page.getByTestId(roundColId(1))).toContainText("R2")
    await expect(page.getByTestId(roundColId(2))).toContainText("R3")
  })
})

test.describe("Upload wizard — round column name auto-detect", () => {
  let formatId: string | undefined
  let formatName: string | undefined

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()

    formatName = `Round Name Detect Format ${Date.now()}`
    const format = await FormatsService.createFormat({
      requestBody: { name: formatName, rounds: ["Picture Round", "R2", "R3"] },
    })
    formatId = format.id
  })

  test.afterAll(async () => {
    if (formatId) {
      await FormatsService.deleteFormat({ id: formatId })
    }
  })

  test("auto-selects a round column whose header exactly matches the round name", async ({
    page,
  }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeNew).click()
    await page.getByLabel("Quiz name *").fill("Round Detect Quiz")

    await page.getByTestId(Labels.formatSelect).click()
    await page.getByRole("option", { name: formatName }).click()

    await page.getByRole("button", { name: "Next →" }).click()

    await page
      .getByLabel("Or paste data directly")
      .fill(
        "Name,Country,Score,Picture Round\nAlice,Ireland,50,10\nBob,England,40,15",
      )
    await page.getByRole("button", { name: "Next →" }).click()

    await expect(page.getByTestId("round-column-0")).toContainText(
      "Picture Round",
    )
    await expect(page.getByTestId("round-column-1")).toContainText(
      "Not mapped",
    )
  })
})
