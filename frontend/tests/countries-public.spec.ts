import { expect, test } from "@playwright/test"
import { OpenAPI, PlayersService, QuizzesService } from "../src/client"
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

test.describe("Public country page", () => {
  // Each worker runs beforeAll; Date.now() alone collides across workers.
  const runId = `${Date.now()}${Math.floor(Math.random() * 1e6)}`
  const playerName = `Tuvalu Quizzer ${runId}`
  const teamName = `Tuvalu E2E ${runId}`
  const quizIds: string[] = []
  let playerId: string
  let playerSlug: string

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()

    const player = await PlayersService.createPlayerRoute({
      requestBody: { display_name: playerName, countries: ["TV"] },
    })
    playerId = player.id
    playerSlug = player.slug!

    const individual = await QuizzesService.createQuiz({
      requestBody: {
        name: `Tuvalu Open ${runId}`,
        start_date: "2026-03-01",
        end_date: "2026-03-01",
      },
    })
    quizIds.push(individual.id)
    await QuizzesService.submitResults({
      id: individual.id,
      requestBody: {
        results: [
          {
            participants: [{ player_id: playerId, country: "TV" }],
            final_rank: 1,
            score: 90,
          },
        ],
      },
    })
    await QuizzesService.approveQuiz({ id: individual.id })

    const teams = await QuizzesService.createQuiz({
      requestBody: {
        name: `Tuvalu Nations Cup ${runId}`,
        start_date: "2026-04-01",
        end_date: "2026-04-01",
        participant_mode: "teams",
      },
    })
    quizIds.push(teams.id)
    await QuizzesService.submitResults({
      id: teams.id,
      requestBody: {
        results: [
          {
            participants: [{ player_id: playerId }],
            final_rank: 2,
            score: 80,
            team_name: teamName,
            team_type: "national",
            team_country: "TV",
          },
        ],
      },
    })
    await QuizzesService.approveQuiz({ id: teams.id })
  })

  test.afterAll(async () => {
    for (const id of quizIds) {
      await QuizzesService.deleteQuiz({ id }).catch(() => {})
    }
    if (playerId)
      await PlayersService.deletePlayerRoute({ playerId }).catch(() => {})
  })

  test.use({ storageState: { cookies: [], origins: [] } })

  test("shows stats, medal table, national team and players", async ({
    page,
  }) => {
    await page.goto("/countries/tuvalu")
    await expect(page.getByRole("heading", { name: "Tuvalu" })).toBeVisible()
    for (const id of ["quizzers", "competed", "quizzes", "medals"]) {
      await expect(page.getByTestId(`country-stat-${id}`)).toBeVisible()
    }
    await expect(
      page.getByTestId("country-medal-table").getByText(playerName),
    ).toBeVisible()
    const teams = page.getByTestId("country-national-teams")
    await expect(teams.getByText(teamName)).toBeVisible()
    await expect(teams.getByText(playerName)).toBeVisible()
    await expect(
      page.getByTestId("country-players").getByText(playerName),
    ).toBeVisible()
  })

  test("a player's country chip links to the country page", async ({
    page,
  }) => {
    await page.goto(`/players/${playerSlug}`)
    await page.getByRole("link", { name: "Tuvalu" }).first().click()
    await expect(page).toHaveURL("/countries/tuvalu")
    await expect(page.getByRole("heading", { name: "Tuvalu" })).toBeVisible()
  })

  test("an unknown country shows not found", async ({ page }) => {
    await page.goto("/countries/atlantis")
    await expect(page.getByText("Country not found.")).toBeVisible()
  })
})
