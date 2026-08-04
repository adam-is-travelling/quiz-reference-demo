import crypto from "node:crypto"
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

test.describe("Players listing page", () => {
  test("is accessible without login", async ({ page }) => {
    await page.goto("/players")
    await expect(page).toHaveURL("/players?page=1")
  })

  test("renders a table or empty state", async ({ page }) => {
    await page.goto("/players")
    await page.waitForLoadState("networkidle")
    const hasTable = await page
      .locator("table")
      .isVisible()
      .catch(() => false)
    expect(hasTable).toBe(true)
  })

  test("shows a search input", async ({ page }) => {
    await page.goto("/players")
    await page.waitForLoadState("networkidle")
    await expect(page.getByPlaceholder("Search players…")).toBeVisible()
  })
})

test.describe("Player profile routing", () => {
  let playerSlug: string

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()

    // Create player with valid fields only (slug/is_published not in PlayerCreate)
    const player = await PlayersService.createPlayerRoute({
      requestBody: { display_name: "Routing Test Player" },
    })

    // Set slug via update endpoint
    const slug = `routing-test-player-${crypto.randomUUID()}`
    const updated = await PlayersService.updatePlayerRoute({
      playerId: player.id,
      requestBody: { slug },
    })
    playerSlug = updated.slug!
  })

  test("navigates to profile page, not the listing", async ({ page }) => {
    await page.goto(`/players/${playerSlug}`)
    await expect(page).toHaveURL(`/players/${playerSlug}`)
    // Profile page shows the player's name — listing page never would
    await expect(
      page.getByRole("heading", { name: "Routing Test Player" }),
    ).toBeVisible()
  })

  test("profile page does not render the players listing content", async ({
    page,
  }) => {
    await page.goto(`/players/${playerSlug}`)
    // If routing had regressed to nesting under the listing, the listing's
    // empty state or card grid would be visible instead of the profile
    await expect(
      page.getByRole("heading", { name: "No players yet" }),
    ).not.toBeVisible()
  })

  test("unknown slug shows not-found state, not the listing", async ({
    page,
  }) => {
    await page.goto("/players/this-slug-does-not-exist-xyz")
    await expect(page).toHaveURL("/players/this-slug-does-not-exist-xyz")
    // Should be an error/not-found state, not the players listing
    await expect(
      page.getByRole("heading", { name: "No players yet" }),
    ).not.toBeVisible()
  })

  test("players listing links navigate to profile pages", async ({ page }) => {
    await page.goto("/players")
    await page.waitForLoadState("networkidle")
    const firstLink = page.locator("a[href^='/players/']").first()
    const count = await firstLink.count()
    if (count === 0) {
      test.skip()
      return
    }
    const href = await firstLink.getAttribute("href")
    await firstLink.click()
    await expect(page).toHaveURL(href!)
    // Should not be the listing page
    await expect(
      page.getByRole("heading", { name: "No players yet" }),
    ).not.toBeVisible()
  })
})

test.describe("Player profile page (superuser)", () => {
  // chromium project already has superuser auth from setup step — no login needed
  // Use the player created in the routing tests (has a slug, no quiz results)

  // playwright.config.cts sets fullyParallel: true, so tests in this file are
  // NOT guaranteed to run serially on one worker by default. The tests below
  // share and mutate `testPlayerSlug` (the slug-rename test reassigns it for
  // later tests), so force serial execution within this describe block.
  test.describe.configure({ mode: "serial" })

  let testPlayerSlug: string

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()

    const player = await PlayersService.createPlayerRoute({
      requestBody: { display_name: "Superuser Test Player" },
    })
    const slug = `superuser-test-player-${crypto.randomUUID()}`
    const updated = await PlayersService.updatePlayerRoute({
      playerId: player.id,
      requestBody: { slug },
    })
    testPlayerSlug = updated.slug!
  })

  test("superuser sees delete button on player profile with no results", async ({
    page,
  }) => {
    // Superusers can navigate to unpublished players by slug
    await page.goto(`/players/${testPlayerSlug}`)
    await expect(page.getByRole("button", { name: /delete/i })).toBeVisible()
  })

  test("superuser can edit name and set a primary country", async ({
    page,
  }) => {
    await page.goto(`/players/${testPlayerSlug}`)
    await page.getByRole("button", { name: /edit/i }).click()

    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("Display Name").fill("Edited Superuser Player")
    await dialog.locator("select").selectOption({ label: "Ireland" })
    await dialog.locator("select").selectOption({ label: "Germany" })
    await dialog.getByRole("button", { name: "Make Germany primary" }).click()
    await dialog.getByRole("button", { name: "Save" }).click()

    // Dialog closes and the profile reflects the new name and countries
    await expect(dialog).not.toBeVisible()
    await expect(
      page.getByRole("heading", { name: "Edited Superuser Player" }),
    ).toBeVisible()

    // PlayerProfile renders each country as a Badge (data-slot="badge"),
    // with the primary (first) country first in DOM order. This player has
    // no quiz history yet ("No results yet." is shown instead of the
    // history table), so these are the only two badges on the page — an
    // exact-text match on each also avoids getByText("Ireland") matching
    // substrings like "Northern Ireland".
    const countryBadges = page.locator('[data-slot="badge"]')
    await expect(countryBadges).toHaveCount(2)
    await expect(countryBadges.nth(0)).toHaveText("Germany")
    await expect(countryBadges.nth(1)).toHaveText("Ireland")
  })

  test("editing the slug navigates to the new profile URL", async ({
    page,
  }) => {
    const newSlug = `${testPlayerSlug}-renamed`
    await page.goto(`/players/${testPlayerSlug}`)
    await page.getByRole("button", { name: /edit/i }).click()

    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("URL Slug").fill(newSlug)
    await dialog.getByRole("button", { name: "Save" }).click()

    await expect(page).toHaveURL(`/players/${newSlug}`)
    testPlayerSlug = newSlug
  })

  test("slug cannot be cleared", async ({ page }) => {
    await page.goto(`/players/${testPlayerSlug}`)
    await page.getByRole("button", { name: /edit/i }).click()

    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("URL Slug").fill("")
    await dialog.getByRole("button", { name: "Save" }).click()

    // Validation error keeps the dialog open; URL unchanged
    await expect(dialog.getByText("Slug is required")).toBeVisible()
    await expect(page).toHaveURL(`/players/${testPlayerSlug}`)
  })

  test("anonymous user does not see the edit button", async ({ browser }) => {
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    })
    const page = await context.newPage()

    // Any published player profile will do; skip if none exist
    await page.goto("/players")
    await page.waitForLoadState("networkidle")
    const firstLink = page.locator("a[href^='/players/']").first()
    if ((await firstLink.count()) === 0) {
      await context.close()
      test.skip()
      return
    }
    await firstLink.click()
    await page.waitForLoadState("networkidle")
    await expect(page.getByRole("button", { name: /edit/i })).not.toBeVisible()

    await context.close()
  })
})

test.describe("Players search", () => {
  const uniqueName = `SearchTest-${crypto.randomUUID().slice(0, 8)}`

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()

    const player = await PlayersService.createPlayerRoute({
      requestBody: { display_name: uniqueName },
    })
    await PlayersService.updatePlayerRoute({
      playerId: player.id,
      requestBody: { is_published: true },
    })
  })

  test("search input filters the player table", async ({ page }) => {
    await page.goto("/players")
    await page.waitForLoadState("networkidle")
    await page.getByPlaceholder("Search players…").fill(uniqueName)
    // Wait for debounce + network
    await page.waitForTimeout(500)
    await page.waitForLoadState("networkidle")
    await expect(page.getByRole("cell", { name: uniqueName })).toBeVisible()
  })

  test("clearing search returns to browse mode", async ({ page }) => {
    await page.goto("/players")
    await page.waitForLoadState("networkidle")
    const input = page.getByPlaceholder("Search players…")
    await input.fill(uniqueName)
    await page.waitForTimeout(500)
    await input.fill("")
    await page.waitForTimeout(500)
    await page.waitForLoadState("networkidle")
    // Pagination row is present only in browse mode (or table at minimum)
    await expect(page.locator("table")).toBeVisible()
  })

  test("search does not show unpublished players", async ({ browser }) => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()
    const unpublishedName = `Unpublished-${crypto.randomUUID().slice(0, 8)}`
    const unpublished = await PlayersService.createPlayerRoute({
      requestBody: { display_name: unpublishedName },
    })
    // deliberately do NOT publish

    // logged-out context: superusers are allowed to see unpublished
    // players in search, so use an anonymous session here
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    })
    const page = await context.newPage()

    await page.goto("/players")
    await page.waitForLoadState("networkidle")
    await page.getByPlaceholder("Search players…").fill(unpublishedName)
    await page.waitForTimeout(500)
    await page.waitForLoadState("networkidle")
    await expect(
      page.getByRole("cell", { name: unpublishedName }),
    ).not.toBeVisible()

    await context.close()

    // cleanup
    await PlayersService.deletePlayerRoute({ playerId: unpublished.id })
  })
})

test.describe("Player history grouped by competition", () => {
  let slug: string
  let competitionName: string
  let orgId: string
  let playerId: string
  const quizIds: string[] = []

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()

    // 1. Create a player and give it a unique slug (published implicitly via
    // approving a quiz result below — approveQuiz publishes the player).
    const player = await PlayersService.createPlayerRoute({
      requestBody: { display_name: "Competition History Test Player" },
    })
    playerId = player.id
    slug = `competition-history-test-player-${crypto.randomUUID()}`
    await PlayersService.updatePlayerRoute({
      playerId: player.id,
      requestBody: { slug },
    })

    // 2. Create an organization + competition (capture competitionName for assertions)
    const orgName = `E2E Competition History Org ${Date.now()}`
    const org = await OrganizationsService.createOrganization({
      requestBody: { name: orgName },
    })
    orgId = org.id

    competitionName = `E2E Competition History ${Date.now()}`
    const competition = await CompetitionsService.createCompetition({
      requestBody: { name: competitionName, organization_id: org.id },
    })

    // 3. Create 6 approved quizzes in that competition, each with a result for
    // the player, using distinct start_dates for deterministic ordering.
    const startDates = [
      "2024-01-01",
      "2024-02-01",
      "2024-03-01",
      "2024-04-01",
      "2024-05-01",
      "2024-06-01",
    ]
    for (let i = 0; i < startDates.length; i++) {
      const startDate = startDates[i]
      const quiz = await QuizzesService.createQuiz({
        requestBody: {
          name: `Competition History Quiz ${i + 1}`,
          start_date: startDate,
          end_date: startDate,
          competition_id: competition.id,
        },
      })
      quizIds.push(quiz.id)
      await QuizzesService.submitResults({
        id: quiz.id,
        requestBody: {
          results: [{ player_id: player.id, final_rank: 1, score: 100 }],
        },
      })
      // Approving publishes the player and makes results public — submit
      // results before approving.
      await QuizzesService.approveQuiz({ id: quiz.id })
    }
  })

  test.afterAll(async () => {
    // Best-effort cleanup — don't fail the run if something's already gone.
    // Players with quiz results can't be deleted directly (delete-guard),
    // so delete the quizzes first — QuizResult has ondelete=CASCADE on
    // quiz_id, so this also removes their results.
    for (const quizId of quizIds) {
      try {
        await QuizzesService.deleteQuiz({ id: quizId })
      } catch {
        // ignore
      }
    }
    try {
      if (playerId) {
        await PlayersService.deletePlayerRoute({ playerId })
      }
    } catch {
      // ignore
    }
    try {
      if (orgId) {
        await OrganizationsService.deleteOrganization({ id: orgId })
      }
    } catch {
      // ignore
    }
  })

  test("profile shows the competition section heading", async ({ page }) => {
    await page.goto(`/players/${slug}`)
    await page.waitForLoadState("networkidle")
    await expect(
      page.getByRole("heading", { name: competitionName }),
    ).toBeVisible()
  })

  test("see-all link appears past 5 results and navigates to the full list", async ({
    page,
  }) => {
    await page.goto(`/players/${slug}`)
    await page.waitForLoadState("networkidle")
    const seeAll = page.getByRole("link", { name: /See all 6 results/i })
    await expect(seeAll).toBeVisible()
    await seeAll.click()
    await expect(page).toHaveURL(new RegExp(`/players/${slug}/competitions/`))
    // Full list shows all 6 rows (>5, so more than the profile's cap of 5)
    await expect(page.locator("table tbody tr")).toHaveCount(6)
  })
})
