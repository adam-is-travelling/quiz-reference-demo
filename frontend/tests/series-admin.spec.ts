import { expect, test } from "@playwright/test"
import { OpenAPI, OrganizationsService } from "../src/client"
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

test.describe("Admin Series page", () => {
  let orgId: string
  let orgName: string

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()
    orgName = `E2E Series Org ${Date.now()}`
    const org = await OrganizationsService.createOrganization({
      requestBody: { name: orgName },
    })
    orgId = org.id
  })

  test.afterAll(async () => {
    if (orgId) {
      await OrganizationsService.deleteOrganization({ id: orgId })
    }
  })

  test("is accessible and shows correct heading", async ({ page }) => {
    await page.goto("/admin/series")
    await expect(page.getByRole("heading", { name: "Series" })).toBeVisible()
    await expect(
      page.getByText("Manage quiz series and tournaments."),
    ).toBeVisible()
  })

  test("Series link appears in admin sidebar", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByRole("link", { name: "Series" })).toBeVisible()
  })

  test("New Series button is visible", async ({ page }) => {
    await page.goto("/admin/series")
    await expect(page.getByRole("button", { name: "New Series" })).toBeVisible()
  })

  test("create without organization shows validation error", async ({
    page,
  }) => {
    await page.goto("/admin/series")
    await page.getByRole("button", { name: "New Series" }).click()
    await page.locator('input[name="name"]').fill("Missing Org Series")
    await page.getByRole("button", { name: "Create" }).click()
    await expect(page.getByText("Organization is required")).toBeVisible()
  })

  test("create, edit, and delete a series", async ({ page }) => {
    await page.goto("/admin/series")

    const seriesName = `Test Series ${Date.now()}`
    const updatedName = `Updated ${seriesName}`

    // Create
    await page.getByRole("button", { name: "New Series" }).click()
    await page.locator('input[name="name"]').fill(seriesName)
    await page.locator('select[name="organization_id"]').selectOption(orgId)
    await page.getByRole("button", { name: "Create" }).click()
    await expect(page.getByText("Series created")).toBeVisible()
    const row = page.getByRole("row").filter({ hasText: seriesName })
    await expect(row).toBeVisible()

    // Edit
    await row.getByRole("button").first().click()
    await page.locator('input[name="name"]').fill(updatedName)
    await page.getByRole("button", { name: "Save" }).click()
    await expect(page.getByText("Series updated")).toBeVisible()
    const updatedRow = page.getByRole("row").filter({ hasText: updatedName })
    await expect(updatedRow).toBeVisible()

    // Delete
    await updatedRow.getByRole("button").last().click()
    await page.getByRole("button", { name: "Delete" }).click()
    await expect(page.getByText("Series deleted")).toBeVisible()
    await expect(
      page.getByRole("row").filter({ hasText: updatedName }),
    ).not.toBeVisible()
  })
})

test.describe("Admin Series access control", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("unauthenticated user is redirected away from /admin/series", async ({
    page,
  }) => {
    await page.goto("/admin/series")
    await expect(page).not.toHaveURL(/\/admin\/series/)
  })
})
