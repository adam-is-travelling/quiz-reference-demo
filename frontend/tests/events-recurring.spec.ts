import { expect, test } from "@playwright/test"
import {
  EventsService,
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

test.describe("Recurring events", () => {
  // One shared fixture set: without serial mode every parallel worker runs
  // beforeAll again, racing its own copy of the series against the others.
  test.describe.configure({ mode: "serial" })
  const runId = `${Date.now()}${Math.floor(Math.random() * 1000)}`
  const orgName = `Recurring Org ${runId}`
  const eventSeriesName = `Trivia Nationals ${runId}`
  const emptySeriesName = `Empty Recurring ${runId}`
  const quizSeriesName = `TN Individual ${runId}`
  const edition2025 = `Trivia Nationals 2025 ${runId}`
  const edition2026 = `Trivia Nationals 2026 ${runId}`
  const winnerA = `Recurring Winner A ${runId}`
  const winnerB = `Recurring Winner B ${runId}`
  const oneOffName = `TN Pub Quiz ${runId}`

  let orgId = ""
  let eventSeriesSlug = ""
  let emptySeriesSlug = ""
  let quizSeriesSlug = ""
  let edition2026Slug = ""
  let edition2025Slug = ""
  const quizSlugs: Record<string, string> = {}
  const seriesIds: string[] = []
  const eventIds: string[] = []
  const quizIds: string[] = []
  const playerIds: string[] = []

  async function heldQuiz(
    name: string,
    date: string,
    eventId: string,
    seriesId: string | null,
    winnerId: string,
  ) {
    const quiz = await QuizzesService.createQuiz({
      requestBody: {
        name,
        start_date: date,
        end_date: date,
        organization_id: orgId,
        event_id: eventId,
        series_id: seriesId,
      },
    })
    quizIds.push(quiz.id)
    quizSlugs[name] = quiz.slug
    await QuizzesService.submitResults({
      id: quiz.id,
      requestBody: {
        results: [
          { participants: [{ player_id: winnerId }], final_rank: 1, score: 90 },
        ],
      },
    })
    await QuizzesService.approveQuiz({ id: quiz.id })
  }

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()

    orgId = (
      await OrganizationsService.createOrganization({
        requestBody: { name: orgName },
      })
    ).id

    const eventSeries = await SeriesService.createSeries({
      requestBody: {
        name: eventSeriesName,
        organization_id: orgId,
        type: "event",
      },
    })
    const emptySeries = await SeriesService.createSeries({
      requestBody: {
        name: emptySeriesName,
        organization_id: orgId,
        type: "event",
      },
    })
    const quizSeries = await SeriesService.createSeries({
      requestBody: { name: quizSeriesName, organization_id: orgId },
    })
    seriesIds.push(eventSeries.id, emptySeries.id, quizSeries.id)
    eventSeriesSlug = eventSeries.slug
    emptySeriesSlug = emptySeries.slug
    quizSeriesSlug = quizSeries.slug

    const e2025 = await EventsService.createEvent({
      requestBody: {
        name: edition2025,
        start_date: "2025-08-01",
        end_date: "2025-08-03",
        is_online: true,
        organization_id: orgId,
        series_id: eventSeries.id,
      },
    })
    const e2026 = await EventsService.createEvent({
      requestBody: {
        name: edition2026,
        start_date: "2026-08-07",
        end_date: "2026-08-09",
        is_online: true,
        organization_id: orgId,
        series_id: eventSeries.id,
      },
    })
    const emptyEdition = await EventsService.createEvent({
      requestBody: {
        name: `Empty Edition ${runId}`,
        start_date: "2026-05-01",
        end_date: "2026-05-01",
        is_online: true,
        organization_id: orgId,
        series_id: emptySeries.id,
      },
    })
    eventIds.push(e2025.id, e2026.id, emptyEdition.id)
    edition2026Slug = e2026.slug
    edition2025Slug = e2025.slug

    for (const name of [winnerA, winnerB]) {
      const p = await PlayersService.createPlayerRoute({
        requestBody: { display_name: name },
      })
      playerIds.push(p.id)
    }

    await heldQuiz(
      `TN Individual 2025 ${runId}`,
      "2025-08-01",
      e2025.id,
      quizSeries.id,
      playerIds[0],
    )
    await heldQuiz(
      `TN Individual 2026 ${runId}`,
      "2026-08-07",
      e2026.id,
      quizSeries.id,
      playerIds[0],
    )
    await heldQuiz(oneOffName, "2026-08-08", e2026.id, null, playerIds[1])
  })

  test.afterAll(async () => {
    for (const id of quizIds)
      await QuizzesService.deleteQuiz({ id }).catch(() => {})
    for (const id of eventIds)
      await EventsService.deleteEvent({ id }).catch(() => {})
    for (const id of seriesIds)
      await SeriesService.deleteSeries({ id }).catch(() => {})
    for (const id of playerIds)
      await PlayersService.deletePlayerRoute({ playerId: id }).catch(() => {})
    if (orgId)
      await OrganizationsService.deleteOrganization({ id: orgId }).catch(
        () => {},
      )
  })

  test("the series page lists editions, the held-here matrix and medals", async ({
    page,
  }) => {
    await page.goto(`/events/recurring/${eventSeriesSlug}`)
    await expect(
      page.getByRole("heading", { name: eventSeriesName }),
    ).toBeVisible()

    const editions = page.getByTestId("series-editions")
    await expect(
      editions.getByRole("link", { name: edition2025 }),
    ).toBeVisible()
    await expect(
      editions.getByRole("link", { name: edition2026 }),
    ).toBeVisible()

    const seriesRow = page.getByTestId(`series-matrix-row-${quizSeriesSlug}`)
    await expect(
      seriesRow.getByRole("link", { name: quizSeriesName }),
    ).toBeVisible()
    await expect(seriesRow.getByRole("cell")).toHaveCount(3)
    await expect(seriesRow.getByRole("cell").nth(1)).toContainText(winnerA)
    await expect(seriesRow.getByRole("cell").nth(2)).toContainText(winnerA)

    const otherRow = page.getByTestId("series-matrix-row-__other__")
    await expect(otherRow.getByRole("cell").first()).toHaveText("Other quizzes")
    await expect(otherRow.getByRole("cell").nth(1)).toHaveText("—")
    await expect(otherRow.getByRole("cell").nth(2)).toContainText(oneOffName)
    await expect(otherRow.getByRole("cell").nth(2)).toContainText(winnerB)

    const standings = page.getByTestId("podium-standings")
    await expect(
      standings.getByRole("row").filter({ hasText: winnerA }),
    ).toContainText("2")
    await expect(
      standings.getByRole("row").filter({ hasText: winnerB }),
    ).toContainText("1")
  })

  test("an event series with no quizzes still shows its editions", async ({
    page,
  }) => {
    await page.goto(`/events/recurring/${emptySeriesSlug}`)
    await expect(
      page.getByRole("heading", { name: emptySeriesName }),
    ).toBeVisible()
    await expect(
      page.getByText("No quizzes held at these events yet."),
    ).toBeVisible()
    await expect(
      page
        .getByTestId("series-editions")
        .getByRole("link", { name: `Empty Edition ${runId}` }),
    ).toBeVisible()
  })

  test("an edition steps to its neighbours in the series", async ({ page }) => {
    await page.goto(`/events/${edition2026Slug}`)
    const nav = page.getByTestId("series-nav")
    await expect(nav.getByRole("link", { name: eventSeriesName })).toBeVisible()
    await expect(nav.locator('a[rel="next"]')).toHaveCount(0)
    await expect(nav).toContainText(`Part of ${eventSeriesName}`)
    await nav.getByRole("link", { name: "Previous", exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/events/${edition2025Slug}$`))
    const back = page.getByTestId("series-nav")
    await expect(back.locator('a[rel="prev"]')).toHaveCount(0)
    await expect(
      back.getByRole("link", { name: "Next", exact: true }),
    ).toBeVisible()
  })

  test("a quiz steps through its own series", async ({ page }) => {
    const first = `TN Individual 2025 ${runId}`
    const second = `TN Individual 2026 ${runId}`
    await page.goto(`/quizzes/${quizSlugs[second]}`)
    const nav = page.getByTestId("series-nav")
    await expect(
      nav.getByRole("link", { name: quizSeriesName }),
    ).toHaveAttribute("href", new RegExp(`/competitions/${quizSeriesSlug}$`))
    await expect(nav.locator('a[rel="next"]')).toHaveCount(0)
    await nav.getByRole("link", { name: "Previous", exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/quizzes/${quizSlugs[first]}$`))
  })

  test("a one-off quiz has no series nav", async ({ page }) => {
    await page.goto(`/quizzes/${quizSlugs[oneOffName]}`)
    await expect(page.getByRole("heading", { name: oneOffName })).toBeVisible()
    await expect(page.getByTestId("series-nav")).toHaveCount(0)
  })

  test("an edition links back to its series", async ({ page }) => {
    await page.goto(`/events/${edition2026Slug}`)
    await page.getByRole("link", { name: eventSeriesName }).click()
    await expect(page).toHaveURL(
      new RegExp(`/events/recurring/${eventSeriesSlug}$`),
    )
  })

  test("a quiz series page says where each quiz was held", async ({ page }) => {
    await page.goto(`/competitions/${quizSeriesSlug}`)
    await expect(page.getByRole("link", { name: edition2025 })).toBeVisible()
    await expect(page.getByRole("link", { name: edition2026 })).toBeVisible()
  })

  test("/competitions/<event series> redirects to the recurring event page", async ({
    page,
  }) => {
    await page.goto(`/competitions/${eventSeriesSlug}`)
    await expect(page).toHaveURL(
      new RegExp(`/events/recurring/${eventSeriesSlug}$`),
    )
    await expect(
      page.getByRole("heading", { name: eventSeriesName }),
    ).toBeVisible()
  })

  test("/events groups editions under their series", async ({ page }) => {
    await page.goto("/events")
    const header = page.getByRole("row").filter({ hasText: eventSeriesName })
    await expect(
      header.getByRole("link", { name: eventSeriesName }),
    ).toBeVisible()
  })

  test("admin → public navigation does not leak event series", async ({
    page,
  }) => {
    // The admin list holds every type; /competitions must not reuse that cache.
    await page.goto("/admin/competitions")
    await expect(
      page.getByRole("row").filter({ hasText: eventSeriesName }),
    ).toBeVisible()
    await page
      .getByRole("row")
      .filter({ hasText: quizSeriesName })
      .getByRole("link", { name: quizSeriesName, exact: true })
      .click()
    await expect(page).toHaveURL(new RegExp(`/competitions/${quizSeriesSlug}$`))
    await page
      .getByRole("link", { name: "Competitions", exact: true })
      .first()
      .click()
    await expect(page).toHaveURL(/\/competitions$/)
    await expect(page.getByRole("link", { name: quizSeriesName })).toBeVisible()
    await expect(page.getByRole("link", { name: eventSeriesName })).toHaveCount(
      0,
    )
  })
})
