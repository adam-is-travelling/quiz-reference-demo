import { expect, test } from "@playwright/test"

// The default project storageState authenticates as the first superuser.
test.describe("Footer database target (admin)", () => {
  test("shows the database line for a logged-in superuser", async ({
    page,
  }) => {
    await page.goto("/")
    await expect(page.getByTestId("footer-db-target")).toBeVisible()
    await expect(page.getByTestId("footer-db-target")).toContainText(
      /Database:\s*(dev|staging)/,
    )
  })
})

test.describe("Footer database target (anonymous)", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("does not show the database line when logged out", async ({ page }) => {
    await page.goto("/series")
    await page.waitForLoadState("networkidle")
    await expect(page.getByRole("heading", { name: "Series" })).toBeVisible()
    await expect(page.getByTestId("footer-db-target")).toHaveCount(0)
  })
})
