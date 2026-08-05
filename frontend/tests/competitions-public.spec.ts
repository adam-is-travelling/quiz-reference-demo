import { expect, test } from "@playwright/test"
import {
  CompetitionsService,
  OpenAPI,
  OrganizationsService,
  PlayersService,
  QuizzesService,
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

test.describe("Public Competitions listing page", () => {
  let competitionId: string
  let competitionSlug: string
  let competitionName: string
  let orgId: string
  let orgSlug: string
  let orgName: string

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()

    orgName = `E2E Competition Org ${Date.now()}`
    const org = await OrganizationsService.createOrganization({
      requestBody: { name: orgName },
    })
    orgId = org.id
    orgSlug = org.slug

    competitionName = `E2E Test Competition ${Date.now()}`
    const created = await CompetitionsService.createCompetition({
      requestBody: { name: competitionName, organization_id: orgId },
    })
    competitionId = created.id
    competitionSlug = created.slug
  })

  test.afterAll(async () => {
    if (competitionId) {
      await CompetitionsService.deleteCompetition({ id: competitionId })
    }
    if (orgId) {
      await OrganizationsService.deleteOrganization({ id: orgId })
    }
  })

  test.use({ storageState: { cookies: [], origins: [] } })

  test("is accessible without login", async ({ page }) => {
    await page.goto("/competitions")
    await expect(page).toHaveURL("/competitions")
    await expect(
      page.getByRole("heading", { name: "Competitions" }),
    ).toBeVisible()
  })

  test("Competitions link appears in public nav", async ({ page }) => {
    await page.goto("/competitions")
    await expect(
      page.getByRole("link", { name: "Competitions" }).first(),
    ).toBeVisible()
  })

  test("seeded competition appears in the list", async ({ page }) => {
    await page.goto("/competitions")
    await page.waitForLoadState("networkidle")
    await expect(
      page.getByRole("link", { name: competitionName }),
    ).toBeVisible()
  })

  test("clicking a competition row navigates to the detail page", async ({
    page,
  }) => {
    await page.goto("/competitions")
    await page.waitForLoadState("networkidle")
    await page.getByRole("link", { name: competitionName }).click()
    await expect(page).toHaveURL(`/competitions/${competitionSlug}`)
    await expect(
      page.getByRole("heading", { name: competitionName }),
    ).toBeVisible()
  })

  test("detail page shows the Events section", async ({ page }) => {
    await page.goto(`/competitions/${competitionSlug}`)
    await expect(page.getByRole("heading", { name: "Events" })).toBeVisible()
  })

  test("detail page loads by slug and its organization link navigates to the organization page", async ({
    page,
  }) => {
    await page.goto(`/competitions/${competitionSlug}`)
    await expect(page).toHaveURL(`/competitions/${competitionSlug}`)
    await expect(
      page.getByRole("heading", { name: competitionName }),
    ).toBeVisible()

    const orgLink = page.getByRole("link", { name: orgName })
    await expect(orgLink).toBeVisible()
    await orgLink.click()
    await expect(page).toHaveURL(`/organizations/${orgSlug}`)
  })
})

test.describe("Competition detail podium", () => {
  const runId = Date.now()
  const competitionName = `Podium Competition ${runId}`
  const winnerName = `Podium Winner ${runId}`
  const secondName = `Podium Second ${runId}`
  const thirdName = `Podium Third ${runId}`
  let orgId: string
  let competitionId: string
  let competitionSlug: string
  let quizId: string
  const playerIds: string[] = []

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()

    const org = await OrganizationsService.createOrganization({
      requestBody: { name: `Podium Org ${runId}` },
    })
    orgId = org.id
    const competition = await CompetitionsService.createCompetition({
      requestBody: { name: competitionName, organization_id: orgId },
    })
    competitionId = competition.id
    competitionSlug = competition.slug

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
        competition_id: competitionId,
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
    if (competitionId)
      await CompetitionsService.deleteCompetition({ id: competitionId }).catch(
        () => {},
      )
    if (orgId)
      await OrganizationsService.deleteOrganization({ id: orgId }).catch(
        () => {},
      )
  })

  test.use({ storageState: { cookies: [], origins: [] } })

  test("shows podium finishers and standings", async ({ page }) => {
    await page.goto(`/competitions/${competitionSlug}`)
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
