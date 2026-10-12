import { expect, test } from "@playwright/test"
import {
  FormatsService,
  OpenAPI,
  PlayersService,
  QuizzesService,
} from "../src/client"
import { firstSuperuser, firstSuperuserPassword } from "./config.ts"

async function authenticate(): Promise<string> {
  const res = await fetch(
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
  return (await res.json()).access_token
}

test.describe("Format round short names", () => {
  const runId = Date.now()
  const formatName = `Abbrev Format ${runId}`
  const created: { quizId?: string; playerId?: string; formatId?: string } = {}

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()
  })

  test.afterAll(async () => {
    if (created.quizId)
      await QuizzesService.deleteQuiz({ id: created.quizId }).catch(() => {})
    if (created.playerId)
      await PlayersService.deletePlayerRoute({
        playerId: created.playerId,
      }).catch(() => {})
    const { data } = await FormatsService.readFormats({ limit: 1000 })
    for (const f of data.filter((f) => f.name === formatName)) {
      await FormatsService.deleteFormat({ id: f.id }).catch(() => {})
    }
  })

  test("a short name set in the format editor heads the results column", async ({
    page,
  }) => {
    await page.goto("/admin/formats")
    await page.getByRole("button", { name: "New Format" }).click()
    await page.getByLabel("Name").fill(formatName)
    await page.getByPlaceholder("Round 1").fill("Entertainment")
    const short1 = page.getByLabel("Abbreviation for round 1")
    await short1.fill("Entertain")
    // The input stops at four characters.
    await expect(short1).toHaveValue("Ente")
    await short1.fill("Ent")
    await page.getByRole("button", { name: "Add Round" }).click()
    await page.getByPlaceholder("Round 2").fill("Lifestyle")
    await page.getByRole("button", { name: "Create" }).click()
    await expect(page.getByText("Format created")).toBeVisible()

    const { data } = await FormatsService.readFormats({ limit: 1000 })
    const format = data.find((f) => f.name === formatName)!
    created.formatId = format.id
    expect(format.round_abbreviations).toEqual(["Ent", null])

    const player = await PlayersService.createPlayerRoute({
      requestBody: { display_name: `Abbrev Player ${runId}` },
    })
    created.playerId = player.id
    const quiz = await QuizzesService.createQuiz({
      requestBody: {
        name: `Abbrev Quiz ${runId}`,
        start_date: "2026-03-01",
        end_date: "2026-03-01",
        format_id: format.id,
      },
    })
    created.quizId = quiz.id
    await QuizzesService.submitResults({
      id: quiz.id,
      requestBody: {
        results: [
          {
            participants: [{ player_id: player.id }],
            final_rank: 1,
            score: 22,
            round_scores: [10, 12],
          },
        ],
      },
    })
    await QuizzesService.approveQuiz({ id: quiz.id })

    await page.goto(`/quizzes/${quiz.slug}`)
    const entHeader = page.getByRole("columnheader", { name: /^Ent\b/ })
    await expect(entHeader).toBeVisible()
    await expect(
      page.getByRole("columnheader", { name: /Lifestyle/ }),
    ).toBeVisible()
    await entHeader.getByText("Ent", { exact: true }).hover()
    await expect(page.getByRole("tooltip")).toContainText("Entertainment")
  })
})
