import crypto from "node:crypto"
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

test.describe("Player merge (superuser)", () => {
  test.describe.configure({ mode: "serial" })

  const runId = crypto.randomUUID().slice(0, 8)
  const sourceName = `Merge Source ${runId}`
  const targetName = `Merge Target ${runId}`
  let sourceId: string
  let sourceSlug: string
  let targetId: string
  let targetSlug: string
  let quizIds: string[] = []

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()

    const source = await PlayersService.createPlayerRoute({
      requestBody: { display_name: sourceName },
    })
    sourceId = source.id
    sourceSlug = (
      await PlayersService.updatePlayerRoute({
        playerId: sourceId,
        requestBody: { slug: `merge-source-${runId}` },
      })
    ).slug!

    const target = await PlayersService.createPlayerRoute({
      requestBody: { display_name: targetName },
    })
    targetId = target.id
    targetSlug = (
      await PlayersService.updatePlayerRoute({
        playerId: targetId,
        requestBody: { slug: `merge-target-${runId}` },
      })
    ).slug!

    // Quiz where only the source has a result (will move)
    const movedQuiz = await QuizzesService.createQuiz({
      requestBody: {
        name: `Merge Moved Quiz ${runId}`,
        start_date: "2026-01-01",
        end_date: "2026-01-01",
      },
    })
    await QuizzesService.submitResults({
      id: movedQuiz.id,
      requestBody: {
        results: [{ player_id: sourceId, final_rank: 1, score: 60 }],
      },
    })

    // Quiz where BOTH have results (conflict: source's will be deleted)
    const conflictQuiz = await QuizzesService.createQuiz({
      requestBody: {
        name: `Merge Conflict Quiz ${runId}`,
        start_date: "2026-02-01",
        end_date: "2026-02-01",
      },
    })
    await QuizzesService.submitResults({
      id: conflictQuiz.id,
      requestBody: {
        results: [
          { player_id: sourceId, final_rank: 2, score: 10 },
          { player_id: targetId, final_rank: 1, score: 90 },
        ],
      },
    })
    quizIds = [movedQuiz.id, conflictQuiz.id]
  })

  test.afterAll(async () => {
    for (const id of quizIds) {
      await QuizzesService.deleteQuiz({ id }).catch(() => {})
    }
    await PlayersService.deletePlayerRoute({ playerId: targetId }).catch(
      () => {},
    )
  })

  test("profile shortcut opens merge page with source pre-filled", async ({
    page,
  }) => {
    await page.goto(`/players/${sourceSlug}`)
    await page.getByRole("link", { name: /merge into/i }).click()
    await expect(page).toHaveURL(
      new RegExp(`/admin/players/merge\\?.*${sourceId}`),
    )
    await expect(page.getByText(sourceName)).toBeVisible()
  })

  test("preview shows move count and conflict warning, merge completes", async ({
    page,
  }) => {
    await page.goto(`/admin/players/merge?source=${sourceId}`)
    await expect(page.getByText(sourceName)).toBeVisible()

    // Pick the target in the target picker
    await page
      .getByLabel("Target (will be kept) player search")
      .fill(targetName)
    await page.getByRole("button", { name: new RegExp(targetName) }).click()

    // Preview: 1 result moves, 1 conflict deleted
    await expect(page.getByText(/1 quiz result will move/)).toBeVisible()
    await expect(
      page.getByText(/1 conflicting result will be permanently deleted/),
    ).toBeVisible()
    await expect(page.getByText(`Merge Conflict Quiz ${runId}`)).toBeVisible()

    await page.getByRole("button", { name: "Merge players" }).click()
    await page.getByRole("button", { name: "Merge", exact: true }).click()

    // Redirected to the merged target profile
    await expect(page).toHaveURL(`/players/${targetSlug}`)
    await expect(page.getByRole("heading", { name: targetName })).toBeVisible()
  })

  test("source profile is gone after merge", async ({ page }) => {
    await page.goto(`/players/${sourceSlug}`)
    await expect(
      page.getByRole("heading", { name: sourceName }),
    ).not.toBeVisible()
  })

  test("merge history page lists the merge", async ({ page }) => {
    await page.goto("/admin/players/merges")
    await expect(
      page.getByRole("heading", { name: "Merge History" }),
    ).toBeVisible()
    await expect(
      page.getByRole("cell", { name: new RegExp(sourceName) }),
    ).toBeVisible()
    await expect(page.getByRole("cell", { name: targetName })).toBeVisible()
  })
})
