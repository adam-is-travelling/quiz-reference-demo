import { expect, test } from "@playwright/test"
import {
  EventsService,
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

test.describe("Events end-to-end", () => {
  const runId = Date.now()
  const eventName = `Trivia Nationals ${runId}`
  const onlineEventName = `Trivia Online Nationals ${runId}`
  const winnerName = `Event Winner ${runId}`
  const secondName = `Event Second ${runId}`
  const thirdName = `Event Third ${runId}`
  const quizName = `Event Podium Quiz ${runId}`
  const orgName = `E2E Event Org ${runId}`

  let orgId: string
  let quizId: string
  const playerIds: string[] = []
  // Populated as soon as each event is created (captured straight off the
  // create request's response, see below) so afterAll can always clean it
  // up, even if a later assertion in the test body throws. Deletes are also
  // attempted inside the test itself (that's what step (g) is proving), but
  // relying on that alone would leak the row on a failed assertion — hence
  // this belt-and-braces list plus .catch() on every cleanup call below.
  const eventIds: string[] = []

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()

    const org = await OrganizationsService.createOrganization({
      requestBody: { name: orgName },
    })
    orgId = org.id

    for (const name of [winnerName, secondName, thirdName]) {
      const p = await PlayersService.createPlayerRoute({
        requestBody: { display_name: name },
      })
      playerIds.push(p.id)
    }

    const quiz = await QuizzesService.createQuiz({
      requestBody: {
        name: quizName,
        start_date: "2026-03-01",
        end_date: "2026-03-01",
        organization_id: orgId,
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
    for (const id of eventIds) {
      await EventsService.deleteEvent({ id }).catch(() => {})
    }
    if (quizId) await QuizzesService.deleteQuiz({ id: quizId }).catch(() => {})
    for (const id of playerIds) {
      await PlayersService.deletePlayerRoute({ playerId: id }).catch(() => {})
    }
    if (orgId) {
      await OrganizationsService.deleteOrganization({ id: orgId }).catch(
        () => {},
      )
    }
  })

  test("create, attach a quiz, view the splash page, and delete", async ({
    page,
  }) => {
    await page.goto("/admin/events")

    // a. Create an in-person event.
    await page.getByRole("button", { name: "New Event" }).click()
    let dialog = page.getByRole("dialog")
    await dialog.locator('input[name="name"]').fill(eventName)
    await dialog.locator('select[name="organization_id"]').selectOption(orgId)
    await dialog.locator('input[name="start_date"]').fill("2026-09-01")
    await dialog.locator('input[name="end_date"]').fill("2026-09-03")
    await dialog.locator('input[name="venue"]').fill("Divani Caravel")
    await dialog.locator('input[name="city"]').fill("Athens")
    // The Country field is a plain <select> (CountrySelect); it's the second
    // <select> in this dialog after the Organization one.
    await dialog.locator("select").nth(1).selectOption({ label: "Greece" })

    // Capture the id/slug straight off the wire from the create request the
    // dialog itself fires — a post-hoc `readEvents` lookup by name would be
    // paginated and could silently miss the event (and thus leak it) if the
    // shared dev DB ever holds a full page of other events.
    const [createRes] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().endsWith("/api/v1/events/") &&
          res.request().method() === "POST",
      ),
      dialog.getByRole("button", { name: "Create" }).click(),
    ])
    await expect(page.getByText("Event created")).toBeVisible()
    const createdEvent = (await createRes.json()) as {
      id: string
      slug: string
    }
    eventIds.push(createdEvent.id)
    const eventSlug = createdEvent.slug

    // b. It appears in the admin table with the expected location text.
    const row = page.getByRole("row").filter({ hasText: eventName })
    await expect(row).toBeVisible()
    await expect(row.locator("td").nth(2)).toHaveText(
      "Divani Caravel, Athens, Greece",
    )

    // f. An event created with "Online" ticked renders its location as
    // "Online".
    await page.getByRole("button", { name: "New Event" }).click()
    dialog = page.getByRole("dialog")
    await dialog.locator('input[name="name"]').fill(onlineEventName)
    await dialog.locator('select[name="organization_id"]').selectOption(orgId)
    await dialog.locator('input[name="start_date"]').fill("2026-09-05")
    await dialog.locator('input[name="end_date"]').fill("2026-09-05")
    await dialog.getByRole("checkbox", { name: "Online event" }).check()
    const [onlineCreateRes] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().endsWith("/api/v1/events/") &&
          res.request().method() === "POST",
      ),
      dialog.getByRole("button", { name: "Create" }).click(),
    ])
    // A prior "Event created" toast may still be visible, so target the
    // latest one rather than assuming exactly one is on screen.
    await expect(page.getByText("Event created").last()).toBeVisible()
    const onlineEvent = (await onlineCreateRes.json()) as { id: string }
    eventIds.push(onlineEvent.id)

    const onlineRow = page.getByRole("row").filter({ hasText: onlineEventName })
    await expect(onlineRow).toBeVisible()
    await expect(onlineRow.locator("td").nth(2)).toHaveText("Online")

    // c. Attach the approved podium quiz to the in-person event via the
    // quiz metadata dialog.
    await page.goto(`/admin/quizzes/${quizId}`)
    await page.getByRole("button", { name: "Edit Metadata" }).click()
    const metaDialog = page.getByRole("dialog")
    // Comboboxes in this dialog, in DOM order: Organization, Event, Format.
    // The quiz was created with organization_id already set to this org, so
    // the Event combobox is enabled as soon as the dialog opens.
    await metaDialog.getByRole("combobox").nth(1).click()
    await page.getByRole("option", { name: eventName }).click()
    await metaDialog.getByRole("button", { name: "Save" }).click()
    await expect(page.getByText("Quiz updated")).toBeVisible()

    // d. The event is listed on the public /events index.
    await page.goto("/events")
    await expect(page.getByRole("link", { name: eventName })).toBeVisible()

    // e. Click through to the splash page and assert its contents.
    await page.getByRole("link", { name: eventName }).click()
    await expect(page).toHaveURL(`/events/${eventSlug}`)
    await expect(page.getByRole("heading", { name: eventName })).toBeVisible()
    await expect(
      page.getByText("Divani Caravel, Athens, Greece", { exact: true }),
    ).toBeVisible()
    const orgLink = page.getByRole("link", { name: orgName })
    await expect(orgLink).toBeVisible()
    await expect(page.getByText("Organised by")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Quizzes" })).toBeVisible()
    await expect(page.getByRole("link", { name: quizName })).toBeVisible()

    // Scope to the standings container specifically — the winner's name
    // also appears in the per-quiz finisher cell above this section, so an
    // unscoped text check would pass even if the aggregated medal table
    // were empty or broken. Assert the winner's row and their gold count,
    // proving the aggregation itself happened, not just that a name is
    // somewhere on the page.
    const standings = page.getByTestId("podium-standings")
    await expect(
      standings.getByRole("heading", { name: "Podium standings" }),
    ).toBeVisible()
    const winnerStandingsRow = standings
      .getByRole("row")
      .filter({ hasText: winnerName })
    await expect(winnerStandingsRow).toBeVisible()
    // Columns: Player, 🥇, 🥈, 🥉 — the winner finished 1st in the only
    // quiz, so their tally is exactly one gold and zero silver/bronze.
    await expect(winnerStandingsRow.locator("td").nth(1)).toHaveText("1")
    await expect(winnerStandingsRow.locator("td").nth(2)).toHaveText("0")
    await expect(winnerStandingsRow.locator("td").nth(3)).toHaveText("0")

    // g. Delete both events and prove the quiz survives — the UI-level
    // proof of ondelete="SET NULL" on quiz.event_id.
    await page.goto("/admin/events")
    const eventRow = page.getByRole("row").filter({ hasText: eventName })
    await eventRow.getByRole("button").last().click()
    await page.getByRole("button", { name: "Delete" }).click()
    await expect(page.getByText("Event deleted").last()).toBeVisible()
    await expect(eventRow).not.toBeVisible()

    const onlineEventRow = page
      .getByRole("row")
      .filter({ hasText: onlineEventName })
    await onlineEventRow.getByRole("button").last().click()
    await page.getByRole("button", { name: "Delete" }).click()
    await expect(page.getByText("Event deleted").last()).toBeVisible()
    await expect(onlineEventRow).not.toBeVisible()

    const survivingQuiz = await QuizzesService.readQuiz({ id: quizId })
    expect(survivingQuiz.id).toBe(quizId)
    expect(survivingQuiz.event_id).toBeNull()
  })
})
