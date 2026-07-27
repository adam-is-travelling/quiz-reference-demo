import { expect, test } from "@playwright/test"
import {
  OpenAPI,
  OrganizationsService,
  PlayersService,
  QuizzesService,
  SeriesService,
} from "../src/client"
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

test.describe("Series detail podium", () => {
  const runId = Date.now()
  const seriesName = `Podium Series ${runId}`
  const winnerName = `Podium Winner ${runId}`
  const secondName = `Podium Second ${runId}`
  const thirdName = `Podium Third ${runId}`
  let orgId: string
  let seriesId: string
  let quizId: string
  const playerIds: string[] = []

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()

    const org = await OrganizationsService.createOrganization({
      requestBody: { name: `Podium Org ${runId}` },
    })
    orgId = org.id
    const series = await SeriesService.createSeries({
      requestBody: { name: seriesName, organization_id: orgId },
    })
    seriesId = series.id

    for (const name of [winnerName, secondName, thirdName]) {
      const p = await PlayersService.createPlayerRoute({
        requestBody: { display_name: name },
      })
      playerIds.push(p.id)
    }

    const quiz = await QuizzesService.createQuiz({
      requestBody: {
        name: `Podium Event ${runId}`,
        start_date: "2026-03-01",
        end_date: "2026-03-01",
        series_id: seriesId,
      },
    })
    quizId = quiz.id
    await QuizzesService.submitResults({
      id: quizId,
      requestBody: {
        results: [
          { player_id: playerIds[0], final_rank: 1, score: 90 },
          { player_id: playerIds[1], final_rank: 2, score: 80 },
          { player_id: playerIds[2], final_rank: 3, score: 70 },
        ],
      },
    })
    await QuizzesService.approveQuiz({ id: quizId })
  })

  test.afterAll(async () => {
    if (quizId) await QuizzesService.deleteQuiz({ id: quizId }).catch(() => {})
    for (const id of playerIds) {
      await PlayersService.deletePlayerRoute({ playerId: id }).catch(() => {})
    }
    if (seriesId)
      await SeriesService.deleteSeries({ id: seriesId }).catch(() => {})
    if (orgId)
      await OrganizationsService.deleteOrganization({ id: orgId }).catch(
        () => {},
      )
  })

  test.use({ storageState: { cookies: [], origins: [] } })

  test("shows podium finishers and standings", async ({ page }) => {
    await page.goto(`/series/${seriesId}`)
    await page.waitForLoadState("networkidle")

    await expect(page.getByRole("heading", { name: "Events" })).toBeVisible()
    await expect(
      page.getByRole("heading", { name: "Podium standings" }),
    ).toBeVisible()

    // Finishers appear in the events table
    await expect(page.getByText(winnerName).first()).toBeVisible()
    await expect(page.getByText(thirdName).first()).toBeVisible()
  })
})
