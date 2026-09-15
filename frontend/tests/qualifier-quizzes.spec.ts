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

test.describe("Qualifier quizzes", () => {
  // Each worker runs this file's beforeAll, and `Date.now()` alone collides
  // when they start in the same millisecond — the org slug is unique.
  const runId = `${Date.now()}${Math.floor(Math.random() * 1e6)}`
  // No fixture name may contain "Qualification": the tests below assert on
  // the suffix by its exact text, and a name containing it would also match.
  const playerName = `Heat Winner ${runId}`
  const championshipName = `Main Event ${runId}`
  const qualifierName = `Opening Heat ${runId}`
  let orgId: string
  let competitionId: string
  let competitionSlug: string
  let playerId: string
  let playerSlug: string
  let championshipId: string
  let qualifierId: string
  let qualifierSlug: string

  async function createWin(
    name: string,
    isQualifier: boolean,
  ): Promise<{ id: string; slug: string }> {
    const quiz = await QuizzesService.createQuiz({
      requestBody: {
        name,
        start_date: "2026-04-01",
        end_date: "2026-04-01",
        competition_id: competitionId,
        is_qualifier: isQualifier,
      },
    })
    await QuizzesService.submitResults({
      id: quiz.id,
      requestBody: {
        results: [
          { participants: [{ player_id: playerId }], final_rank: 1, score: 90 },
        ],
      },
    })
    await QuizzesService.approveQuiz({ id: quiz.id })
    return { id: quiz.id, slug: quiz.slug }
  }

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()

    const org = await OrganizationsService.createOrganization({
      requestBody: { name: `Heat Org ${runId}` },
    })
    orgId = org.id
    const competition = await CompetitionsService.createCompetition({
      requestBody: {
        name: `Heat Competition ${runId}`,
        organization_id: orgId,
      },
    })
    competitionId = competition.id
    competitionSlug = competition.slug

    const player = await PlayersService.createPlayerRoute({
      requestBody: { display_name: playerName },
    })
    playerId = player.id
    playerSlug = player.slug!

    championshipId = (await createWin(championshipName, false)).id
    const qualifier = await createWin(qualifierName, true)
    qualifierId = qualifier.id
    qualifierSlug = qualifier.slug
  })

  test.afterAll(async () => {
    for (const id of [championshipId, qualifierId]) {
      if (id) await QuizzesService.deleteQuiz({ id }).catch(() => {})
    }
    if (playerId)
      await PlayersService.deletePlayerRoute({ playerId }).catch(() => {})
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

  test("the quiz page badges a qualifier and leaves other quizzes unbadged", async ({
    page,
  }) => {
    await page.goto(`/quizzes/${qualifierSlug}`)
    await expect(
      page.getByRole("heading", { name: qualifierName }),
    ).toBeVisible()
    await expect(
      page.getByText("(Qualification)", { exact: true }),
    ).toBeVisible()

    const championship = await QuizzesService.readQuiz({ id: championshipId })
    await page.goto(`/quizzes/${championship.slug}`)
    await expect(
      page.getByRole("heading", { name: championshipName }),
    ).toBeVisible()
    await expect(
      page.getByText("(Qualification)", { exact: true }),
    ).toHaveCount(0)
  })

  test("the competition podium badges the qualifier but awards it no medal", async ({
    page,
  }) => {
    await page.goto(`/competitions/${competitionSlug}`)
    await page.waitForLoadState("networkidle")

    const qualifierRow = page.getByRole("row", {
      name: new RegExp(qualifierName),
    })
    await expect(
      qualifierRow.getByText("(Qualification)", { exact: true }),
    ).toBeVisible()
    // It still shows who won it.
    await expect(qualifierRow.getByText(playerName)).toBeVisible()

    // One gold from the championship, none from the qualifier.
    const standingsRow = page
      .getByTestId("podium-standings")
      .getByRole("row", { name: new RegExp(playerName) })
    await expect(standingsRow.getByRole("cell").nth(1)).toHaveText("1")
  })

  test("a qualifier win is a quiz played but not a win on the player profile", async ({
    page,
  }) => {
    await page.goto(`/players/${playerSlug}`)
    await expect(page.getByRole("heading", { name: playerName })).toBeVisible()

    await expect(page.getByTestId("stat-quizzes")).toContainText("2")
    await expect(page.getByTestId("stat-wins")).toContainText("1")
    await expect(page.getByTestId("stat-podiums")).toContainText("1")

    const historyRow = page.getByRole("row", {
      name: new RegExp(qualifierName),
    })
    await expect(
      historyRow.getByText("(Qualification)", { exact: true }),
    ).toBeVisible()
  })
})

test.describe("Marking an existing quiz as a qualifier", () => {
  const runId = `${Date.now()}${Math.floor(Math.random() * 1e6)}`
  const quizName = `Late Heat ${runId}`
  let quizId: string
  let quizSlug: string

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()
    const quiz = await QuizzesService.createQuiz({
      requestBody: {
        name: quizName,
        start_date: "2026-05-01",
        end_date: "2026-05-01",
      },
    })
    quizId = quiz.id
    quizSlug = quiz.slug
  })

  test.afterAll(async () => {
    if (quizId) await QuizzesService.deleteQuiz({ id: quizId }).catch(() => {})
  })

  test("the metadata dialog toggles the flag and the badge follows", async ({
    page,
  }) => {
    await page.goto(`/quizzes/${quizSlug}`)
    await expect(page.getByRole("heading", { name: quizName })).toBeVisible()
    await expect(
      page.getByText("(Qualification)", { exact: true }),
    ).toHaveCount(0)

    await page.getByRole("button", { name: "Edit Metadata" }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("checkbox", { name: "Qualification quiz" }).check()
    await dialog.getByRole("button", { name: "Save" }).click()

    await expect(page.getByText("Quiz updated")).toBeVisible()
    await expect(
      page.getByText("(Qualification)", { exact: true }),
    ).toBeVisible()
  })
})
