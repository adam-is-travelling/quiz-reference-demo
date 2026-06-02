import { expect, test } from "@playwright/test"
import { Labels } from "../src/test-ids"

test.describe("Homepage (authenticated)", () => {
  test("renders recent events section", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId(Labels.homeRecentEvents)).toBeVisible()
  })

  test("renders recent quizzers section", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId(Labels.homeRecentQuizzers)).toBeVisible()
  })

  test("shows greeting for logged-in user", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId(Labels.homeGreeting)).toBeVisible()
  })

  test("does not show admin login link when authenticated", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId(Labels.homeAdminLoginLink)).not.toBeVisible()
  })

  test("shows sidebar for logged-in user", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId("user-menu")).toBeVisible()
  })
})

test.describe("Homepage (guest)", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("is accessible without login", async ({ page }) => {
    await page.goto("/")
    await expect(page).toHaveURL("/")
  })

  test("renders recent events section", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId(Labels.homeRecentEvents)).toBeVisible()
  })

  test("renders recent quizzers section", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId(Labels.homeRecentQuizzers)).toBeVisible()
  })

  test("shows admin login link", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId(Labels.homeAdminLoginLink)).toBeVisible()
  })

  test("does not show greeting when not logged in", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId(Labels.homeGreeting)).not.toBeVisible()
  })

  test("shows Events nav link", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId("public-nav").getByRole("link", { name: "Events" })).toBeVisible()
  })

  test("shows Organizations nav link", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId("public-nav").getByRole("link", { name: "Organizations" })).toBeVisible()
  })

  test("shows Quizzers nav link", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId("public-nav").getByRole("link", { name: "Quizzers" })).toBeVisible()
  })
})
