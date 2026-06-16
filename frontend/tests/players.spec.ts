import crypto from "node:crypto"
import { expect, test } from "@playwright/test"
import { OpenAPI, PlayersService } from "../src/client"
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
    await expect(page).toHaveURL("/players")
  })

  test("renders player cards or empty state", async ({ page }) => {
    await page.goto("/players")
    // Wait for the suspense boundary to resolve
    await page.waitForLoadState("networkidle")
    const hasCards = await page.locator("a[href^='/players/']").count()
    const hasEmpty = await page
      .getByRole("heading", { name: "No players yet" })
      .isVisible()
      .catch(() => false)
    expect(hasCards > 0 || hasEmpty).toBe(true)
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
})
