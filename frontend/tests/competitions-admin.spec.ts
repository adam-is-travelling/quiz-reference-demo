import { expect, test } from "@playwright/test"
import {
  OpenAPI,
  OrganizationsService,
  QuizzesService,
  SeriesService,
} from "../src/client"
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
      page.getByRole("heading", { name: "Competitions", exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText("Manage quiz competitions and tournaments."),
    ).toBeVisible()
  })

  test("Competitions appears in the Manage menu", async ({ page }) => {
    await page.goto("/")
    await page.getByTestId("nav-manage").click()
    await expect(
      page.getByRole("menuitem", { name: "Competitions" }),
    ).toHaveAttribute("href", "/admin/competitions")
  })

  test("each kind of competition has its own table and New button", async ({
    page,
  }) => {
    await page.goto("/admin/competitions")
    await expect(
      page.getByRole("heading", { name: "Quiz competitions" }),
    ).toBeVisible()
    await expect(
      page.getByRole("heading", { name: "Recurring events" }),
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "New Quiz Competition" }),
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "New Recurring Event" }),
    ).toBeVisible()
  })

  test("a competition can be created without an organization", async ({
    page,
  }) => {
    const name = `No Org Competition ${Date.now()}`
    await page.goto("/admin/competitions")
    await page.getByRole("button", { name: "New Quiz Competition" }).click()
    await page.locator('input[name="name"]').fill(name)
    await page.getByRole("button", { name: "Create" }).click()
    await expect(page.getByText("Competition created")).toBeVisible()
    const row = page
      .getByTestId(Labels.adminQuizCompetitionsTable)
      .getByRole("row")
      .filter({ hasText: name })
    await expect(row).toBeVisible()
    await row.getByRole("button", { name: `Delete ${name}` }).click()
    await page.getByRole("button", { name: "Delete" }).click()
    await expect(page.getByText("Competition deleted")).toBeVisible()
  })

  test("create, edit, and delete a competition", async ({ page }) => {
    await page.goto("/admin/competitions")

    const competitionName = `Test Competition ${Date.now()}`
    const updatedName = `Updated ${competitionName}`

    // Create
    await page.getByRole("button", { name: "New Quiz Competition" }).click()
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
    await page.getByRole("button", { name: "New Quiz Competition" }).click()
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

  test("create a recurring event; editing keeps its type", async ({ page }) => {
    const name = `Recurring Admin ${Date.now()}`
    await page.goto("/admin/competitions")
    await page.getByRole("button", { name: "New Recurring Event" }).click()
    // The section preset the type.
    await expect(page.getByTestId(Labels.seriesTypeEvent)).toHaveClass(
      /bg-primary/,
    )
    await page.locator('input[name="name"]').fill(name)
    await page.locator('select[name="organization_id"]').selectOption(orgId)
    await page.getByRole("button", { name: "Create" }).click()
    await expect(page.getByText("Competition created")).toBeVisible()

    const recurring = page.getByTestId(Labels.adminRecurringEventsTable)
    const row = recurring.getByRole("row").filter({ hasText: name })
    await expect(row.getByRole("link", { name, exact: true })).toHaveAttribute(
      "href",
      /\/events\/recurring\//,
    )
    await expect(
      row.getByRole("link", { name: `Upload a result in ${name}` }),
    ).toHaveCount(0)
    await expect(
      page
        .getByTestId(Labels.adminQuizCompetitionsTable)
        .getByRole("row")
        .filter({ hasText: name }),
    ).toHaveCount(0)

    // Edit without touching Type: it must stay a recurring event.
    await row.getByRole("button", { name: `Edit ${name}` }).click()
    await expect(page.getByTestId(Labels.seriesTypeEvent)).toHaveClass(
      /bg-primary/,
    )
    await page.locator('input[name="name"]').fill(`${name} renamed`)
    await page.getByRole("button", { name: "Save" }).click()
    await expect(page.getByText("Competition updated")).toBeVisible()
    const renamed = recurring
      .getByRole("row")
      .filter({ hasText: `${name} renamed` })
    await expect(renamed).toBeVisible()

    await renamed
      .getByRole("button", { name: `Delete ${name} renamed` })
      .click()
    await page.getByRole("button", { name: "Delete" }).click()
    await expect(page.getByText("Competition deleted")).toBeVisible()
  })

  test("changing the type of a competition with quizzes shows an error", async ({
    page,
  }) => {
    const name = `Linked Type ${Date.now()}`
    const series = await SeriesService.createSeries({
      requestBody: { name, organization_id: orgId },
    })
    const quiz = await QuizzesService.createQuiz({
      requestBody: {
        name: `${name} quiz`,
        start_date: "2026-01-01",
        end_date: "2026-01-01",
        series_id: series.id,
      },
    })
    try {
      await page.goto("/admin/competitions")
      const row = page.getByRole("row").filter({ hasText: name })
      await row.getByRole("button", { name: `Edit ${name}` }).click()
      await page.getByTestId(Labels.seriesTypeEvent).click()
      await page.getByRole("button", { name: "Save" }).click()
      await expect(
        page.getByText(
          "This competition already has quizzes or events, so its type can't change",
        ),
      ).toBeVisible()
    } finally {
      await QuizzesService.deleteQuiz({ id: quiz.id }).catch(() => {})
      await SeriesService.deleteSeries({ id: series.id }).catch(() => {})
    }
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
