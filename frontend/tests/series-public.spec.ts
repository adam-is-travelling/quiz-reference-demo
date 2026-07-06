import { expect, test } from "@playwright/test"
import { OpenAPI, OrganizationsService, SeriesService } from "../src/client"
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

test.describe("Public Series listing page", () => {
  let seriesId: string
  let seriesName: string
  let orgId: string

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()

    const org = await OrganizationsService.createOrganization({
      requestBody: { name: `E2E Series Org ${Date.now()}` },
    })
    orgId = org.id

    seriesName = `E2E Test Series ${Date.now()}`
    const created = await SeriesService.createSeries({
      requestBody: { name: seriesName, organization_id: orgId },
    })
    seriesId = created.id
  })

  test.afterAll(async () => {
    if (seriesId) {
      await SeriesService.deleteSeries({ id: seriesId })
    }
    if (orgId) {
      await OrganizationsService.deleteOrganization({ id: orgId })
    }
  })

  test.use({ storageState: { cookies: [], origins: [] } })

  test("is accessible without login", async ({ page }) => {
    await page.goto("/series")
    await expect(page).toHaveURL("/series")
    await expect(page.getByRole("heading", { name: "Series" })).toBeVisible()
  })

  test("Series link appears in public nav", async ({ page }) => {
    await page.goto("/series")
    await expect(
      page.getByRole("link", { name: "Series" }).first(),
    ).toBeVisible()
  })

  test("seeded series appears in the list", async ({ page }) => {
    await page.goto("/series")
    await page.waitForLoadState("networkidle")
    await expect(page.getByRole("link", { name: seriesName })).toBeVisible()
  })

  test("clicking a series row navigates to the detail page", async ({
    page,
  }) => {
    await page.goto("/series")
    await page.waitForLoadState("networkidle")
    await page.getByRole("link", { name: seriesName }).click()
    await expect(page).toHaveURL(`/series/${seriesId}`)
    await expect(page.getByRole("heading", { name: seriesName })).toBeVisible()
  })

  test("detail page shows the Events section", async ({ page }) => {
    await page.goto(`/series/${seriesId}`)
    await expect(page.getByRole("heading", { name: "Events" })).toBeVisible()
  })
})
