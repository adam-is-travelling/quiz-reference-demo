import { expect, test } from "@playwright/test"
import { Labels } from "../src/test-ids"

test.describe("Upload wizard — mode selection", () => {
  test("Wizard shows mode selection as first step", async ({ page }) => {
    await page.goto("/upload")
    await expect(page.getByTestId(Labels.uploadModeNew)).toBeVisible()
    await expect(page.getByTestId(Labels.uploadModeExisting)).toBeVisible()
  })

  test("Selecting New event advances to event details form", async ({ page }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeNew).click()
    await expect(page.getByLabel("Event name *")).toBeVisible()
    await expect(page.getByTestId(Labels.uploadExistingEventSelect)).not.toBeVisible()
  })

  test("Selecting Existing event advances to event picker", async ({ page }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeExisting).click()
    await expect(page.getByTestId(Labels.uploadExistingEventSelect)).toBeVisible()
    await expect(page.getByLabel("Event name *")).not.toBeVisible()
  })

  test("Toggle switches from new to existing mode", async ({ page }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeNew).click()
    await expect(page.getByLabel("Event name *")).toBeVisible()
    await page.getByTestId(Labels.uploadModeToggleExisting).click()
    await expect(page.getByTestId(Labels.uploadExistingEventSelect)).toBeVisible()
    await expect(page.getByLabel("Event name *")).not.toBeVisible()
  })

  test("Toggle switches from existing to new mode", async ({ page }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeExisting).click()
    await page.getByTestId(Labels.uploadModeToggleNew).click()
    await expect(page.getByLabel("Event name *")).toBeVisible()
    await expect(page.getByTestId(Labels.uploadExistingEventSelect)).not.toBeVisible()
  })
})
