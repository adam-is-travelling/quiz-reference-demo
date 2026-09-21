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

test.describe("Admin Competitions page", () => {
  let orgId: string
  let orgName: string

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()
    orgName = `E2E Competition Org ${Date.now()}`
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
    await page.goto("/admin/competitions")
    await expect(
      page.getByRole("heading", { name: "Competitions" }),
    ).toBeVisible()
    await expect(
      page.getByText("Manage quiz competitions and tournaments."),
    ).toBeVisible()
  })

  test("Competitions link appears in admin sidebar", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByRole("link", { name: "Competitions" })).toBeVisible()
  })

  test("New Competition button is visible", async ({ page }) => {
    await page.goto("/admin/competitions")
    await expect(
      page.getByRole("button", { name: "New Competition" }),
    ).toBeVisible()
  })

  test("create without organization shows validation error", async ({
    page,
  }) => {
    await page.goto("/admin/competitions")
    await page.getByRole("button", { name: "New Competition" }).click()
    await page.locator('input[name="name"]').fill("Missing Org Competition")
    await page.getByRole("button", { name: "Create" }).click()
    await expect(page.getByText("Organization is required")).toBeVisible()
  })

  test("create, edit, and delete a competition", async ({ page }) => {
    await page.goto("/admin/competitions")

    const competitionName = `Test Competition ${Date.now()}`
    const updatedName = `Updated ${competitionName}`

    // Create
    await page.getByRole("button", { name: "New Competition" }).click()
    await page.locator('input[name="name"]').fill(competitionName)
    await page.locator('select[name="organization_id"]').selectOption(orgId)
    await page.getByRole("button", { name: "Create" }).click()
    await expect(page.getByText("Competition created")).toBeVisible()
    const row = page.getByRole("row").filter({ hasText: competitionName })
    await expect(row).toBeVisible()

    // Edit — targeted by accessible name, not position: the row also carries
    // an "upload a result" action before the pencil.
    await row
      .getByRole("link", { name: `Upload a result in ${competitionName}` })
      .waitFor()
    await row.getByRole("button", { name: `Edit ${competitionName}` }).click()
    await page.locator('input[name="name"]').fill(updatedName)
    await page.getByRole("button", { name: "Save" }).click()
    await expect(page.getByText("Competition updated")).toBeVisible()
    const updatedRow = page.getByRole("row").filter({ hasText: updatedName })
    await expect(updatedRow).toBeVisible()

    // Delete
    await updatedRow
      .getByRole("button", { name: `Delete ${updatedName}` })
      .click()
    await page.getByRole("button", { name: "Delete" }).click()
    await expect(page.getByText("Competition deleted")).toBeVisible()
    await expect(
      page.getByRole("row").filter({ hasText: updatedName }),
    ).not.toBeVisible()
  })

  test("the + action opens Upload Results prefilled for that competition", async ({
    page,
  }) => {
    const competitionName = `Prefill Competition ${Date.now()}`

    await page.goto("/admin/competitions")
    await page.getByRole("button", { name: "New Competition" }).click()
    await page.locator('input[name="name"]').fill(competitionName)
    await page.locator('select[name="organization_id"]').selectOption(orgId)
    await page.getByRole("button", { name: "Create" }).click()
    await expect(page.getByText("Competition created")).toBeVisible()

    const row = page.getByRole("row").filter({ hasText: competitionName })
    await row
      .getByRole("link", { name: `Upload a result in ${competitionName}` })
      .click()

    await expect(page).toHaveURL(/\/upload\?competition=/)
    // Lands on Quiz details, not the mode chooser.
    await expect(page.locator('input[name="name"]')).toHaveValue(
      competitionName,
    )
    await expect(page.getByText(orgName).first()).toBeVisible()
    await expect(page.getByText(competitionName).first()).toBeVisible()

    // Cleanup: the competition created in this test.
    await page.goto("/admin/competitions")
    const cleanupRow = page
      .getByRole("row")
      .filter({ hasText: competitionName })
    await cleanupRow
      .getByRole("button", { name: `Delete ${competitionName}` })
      .click()
    await page.getByRole("button", { name: "Delete" }).click()
    await expect(page.getByText("Competition deleted")).toBeVisible()
  })
})

test.describe("Admin Competitions access control", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("unauthenticated user is redirected away from /admin/competitions", async ({
    page,
  }) => {
    await page.goto("/admin/competitions")
    await expect(page).not.toHaveURL(/\/admin\/competitions/)
  })
})
