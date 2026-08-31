import { expect, test } from "@playwright/test"
import {
  EventsService,
  OpenAPI,
  OrganizationsService,
  PlayersService,
  QuizzesService,
  UsersService,
} from "../src/client"
import { Labels } from "../src/test-ids"
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

    // b. It appears in the admin table with the expected location text, and
    // its name links through to the event's own public splash page (there is
    // no admin detail page for events — editing happens in the row dialog).
    const row = page.getByRole("row").filter({ hasText: eventName })
    await expect(row).toBeVisible()
    await expect(row.locator("td").nth(2)).toHaveText(
      "Divani Caravel, Athens, Greece",
    )
    const nameLink = row.getByRole("link", { name: eventName })
    await expect(nameLink).toHaveAttribute("href", `/events/${eventSlug}`)
    await nameLink.click()
    await expect(page).toHaveURL(`/events/${eventSlug}`)
    await page.goto("/admin/events")

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
    // The quiz's organizer only pins its own events to the top of the Event
    // combobox; every organizer's events are listed regardless.
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

test.describe("Upload wizard — submit with event (regression: event_id survives back-navigation)", () => {
  const runId = Date.now()
  const orgName = `Upload Event Org ${runId}`
  const eventName = `Upload Event ${runId}`
  const quizName = `Upload Event Quiz ${runId}`

  let orgId: string
  let eventId: string

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()

    const org = await OrganizationsService.createOrganization({
      requestBody: { name: orgName },
    })
    orgId = org.id

    const event = await EventsService.createEvent({
      requestBody: {
        name: eventName,
        start_date: "2026-10-01",
        end_date: "2026-10-01",
        is_online: true,
        organization_id: orgId,
      },
    })
    eventId = event.id
  })

  test.afterAll(async () => {
    const pending = await QuizzesService.readQuizzes({
      status: "pending",
      limit: 200,
    }).catch(() => null)
    for (const q of pending?.data ?? []) {
      if (q.name === quizName) {
        await QuizzesService.deleteQuiz({ id: q.id }).catch(() => {})
      }
    }
    if (eventId) {
      await EventsService.deleteEvent({ id: eventId }).catch(() => {})
    }
    if (orgId) {
      await OrganizationsService.deleteOrganization({ id: orgId }).catch(
        () => {},
      )
    }
  })

  test("selecting an org and event, then Back and Next without re-touching them, still attaches the event", async ({
    page,
  }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeNew).click()
    await page.getByLabel("Quiz name *").fill(quizName)

    // Select the org, which pins its events to the top of the Event combobox.
    await page.getByRole("combobox").nth(0).click()
    await page.getByRole("option", { name: orgName }).click()
    // This fresh org has no competitions, so the Event Select is the next
    // combobox along (no Competition Select is inserted between them).
    await page.getByRole("combobox").nth(1).click()
    await page.getByRole("option", { name: eventName }).click()

    await page.getByRole("button", { name: "Next →" }).click()

    // Go back to Step 1 and forward again WITHOUT re-touching the Event
    // Select. event_id is a controlled EventSelect, not a native
    // react-hook-form field driven by onChange — it is only ever written via
    // setValue from the Select's own onChange, never re-fired here. Under
    // shouldUnregister, an unregistered field is dropped from _formValues on
    // remount unless it's backed by a registered input — the exact condition
    // that silently detached the quiz from its event in production.
    await page.getByRole("button", { name: "← Back" }).click()
    await page.getByRole("button", { name: "Next →" }).click()

    await page
      .getByLabel("Or paste data directly")
      .fill(
        `Name,Country,Score\nAlice ${runId},Ireland,50\nBob ${runId},England,40`,
      )
    await page.getByRole("button", { name: "Next →" }).click() // Step2 -> Step3
    await page.getByRole("button", { name: "Next →" }).click() // Step3 -> Step4
    await expect(page.getByRole("button", { name: "Next →" })).toBeEnabled({
      timeout: 15000,
    }) // wait for async player search to settle
    await page.getByRole("button", { name: "Next →" }).click() // Step4 -> Step5

    await page.getByRole("button", { name: "Submit for review" }).click()
    await expect(page.getByText("Results submitted for review.")).toBeVisible()

    // Root-cause assertion: the created quiz is actually attached to the
    // event, not silently created unattached.
    const pending = await QuizzesService.readQuizzes({
      status: "pending",
      limit: 200,
    })
    const created = pending.data.find((q) => q.name === quizName)
    expect(created?.event_id).toBe(eventId)
  })
})

test.describe("Upload wizard — attach an event owned by a different organizer", () => {
  const runId = Date.now()
  const quizOrgName = `Cross Quiz Org ${runId}`
  const eventOrgName = `Cross Event Org ${runId}`
  const eventName = `Cross Organizer Event ${runId}`
  const quizName = `Cross Organizer Quiz ${runId}`

  let quizOrgId: string
  let eventOrgId: string
  let eventId: string

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()

    // The quiz is submitted under one organizer...
    quizOrgId = (
      await OrganizationsService.createOrganization({
        requestBody: { name: quizOrgName },
      })
    ).id
    // ...while the event it gets attached to belongs to another.
    eventOrgId = (
      await OrganizationsService.createOrganization({
        requestBody: { name: eventOrgName },
      })
    ).id

    eventId = (
      await EventsService.createEvent({
        requestBody: {
          name: eventName,
          start_date: "2026-11-01",
          end_date: "2026-11-01",
          is_online: true,
          organization_id: eventOrgId,
        },
      })
    ).id
  })

  test.afterAll(async () => {
    const pending = await QuizzesService.readQuizzes({
      status: "pending",
      limit: 200,
    }).catch(() => null)
    for (const q of pending?.data ?? []) {
      if (q.name === quizName) {
        await QuizzesService.deleteQuiz({ id: q.id }).catch(() => {})
      }
    }
    if (eventId) {
      await EventsService.deleteEvent({ id: eventId }).catch(() => {})
    }
    for (const id of [quizOrgId, eventOrgId]) {
      if (id) {
        await OrganizationsService.deleteOrganization({ id }).catch(() => {})
      }
    }
  })

  test("a quiz under one organizer can be attached to another organizer's event", async ({
    page,
  }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeNew).click()
    await page.getByLabel("Quiz name *").fill(quizName)

    // Pick the quiz's own organizer, which is NOT the event's organizer.
    await page.getByRole("combobox").nth(0).click()
    await page.getByRole("option", { name: quizOrgName }).click()

    // These fresh orgs have no competitions, so the Event Select is the next
    // combobox along (no Competition Select is inserted between them).
    await page.getByRole("combobox").nth(1).click()
    // The other organizer's event is offered, grouped under its own name.
    await expect(page.getByRole("option", { name: eventName })).toBeVisible()
    await page.getByRole("option", { name: eventName }).click()

    await page.getByRole("button", { name: "Next →" }).click()
    await page
      .getByLabel("Or paste data directly")
      .fill(
        `Name,Country,Score\nAlice ${runId},Ireland,50\nBob ${runId},England,40`,
      )
    await page.getByRole("button", { name: "Next →" }).click() // Step2 -> Step3
    await page.getByRole("button", { name: "Next →" }).click() // Step3 -> Step4
    await expect(page.getByRole("button", { name: "Next →" })).toBeEnabled({
      timeout: 15000,
    }) // wait for async player search to settle
    await page.getByRole("button", { name: "Next →" }).click() // Step4 -> Step5

    await page.getByRole("button", { name: "Submit for review" }).click()
    await expect(page.getByText("Results submitted for review.")).toBeVisible()

    // The quiz keeps its own organizer while pointing at the other's event.
    const pending = await QuizzesService.readQuizzes({
      status: "pending",
      limit: 200,
    })
    const created = pending.data.find((q) => q.name === quizName)
    expect(created?.organization_id).toBe(quizOrgId)
    expect(created?.event_id).toBe(eventId)
  })
})

test.describe("Event page — attach an existing quiz (superuser only)", () => {
  // Serial: both tests share one beforeAll fixture set. Left parallel, each
  // test lands in its own worker, every worker re-imports this module and
  // re-runs beforeAll — and two workers importing in the same millisecond get
  // the same Date.now() runId, so the second createOrganization dies on the
  // unique organization slug. Same reason players.spec.ts runs serial.
  test.describe.configure({ mode: "serial" })

  const runId = Date.now()
  const orgName = `Attach Org ${runId}`
  const eventName = `Attach Target Event ${runId}`
  const quizName = `Attach Me Quiz ${runId}`
  const playerName = `Attach Player ${runId}`
  const plainUserEmail = `attach-plain-${runId}@example.com`
  const plainUserPassword = "attach-plain-password-123"

  let orgId: string
  let eventId: string
  let eventSlug: string
  let quizId: string
  let playerId: string
  let plainUserId: string

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()

    orgId = (
      await OrganizationsService.createOrganization({
        requestBody: { name: orgName },
      })
    ).id

    const event = await EventsService.createEvent({
      requestBody: {
        name: eventName,
        start_date: "2026-07-01",
        end_date: "2026-07-02",
        is_online: true,
        organization_id: orgId,
      },
    })
    eventId = event.id
    eventSlug = event.slug

    playerId = (
      await PlayersService.createPlayerRoute({
        requestBody: { display_name: playerName },
      })
    ).id

    // An approved quiz that starts out attached to no event at all — the
    // thing the event page is supposed to be able to pull in.
    const quiz = await QuizzesService.createQuiz({
      requestBody: {
        name: quizName,
        start_date: "2026-07-01",
        end_date: "2026-07-01",
        organization_id: orgId,
      },
    })
    quizId = quiz.id
    await QuizzesService.submitResults({
      id: quizId,
      requestBody: {
        results: [{ player_id: playerId, final_rank: 1, score: 10 }],
      },
    })
    await QuizzesService.approveQuiz({ id: quizId })

    // A plain signed-in user — neither superuser nor organizer.
    plainUserId = (
      await UsersService.createUser({
        requestBody: {
          email: plainUserEmail,
          password: plainUserPassword,
          is_superuser: false,
          is_organizer: false,
        },
      })
    ).id
  })

  test.afterAll(async () => {
    if (quizId) await QuizzesService.deleteQuiz({ id: quizId }).catch(() => {})
    if (eventId) {
      await EventsService.deleteEvent({ id: eventId }).catch(() => {})
    }
    if (playerId) {
      await PlayersService.deletePlayerRoute({ playerId }).catch(() => {})
    }
    if (plainUserId) {
      await UsersService.deleteUser({ userId: plainUserId }).catch(() => {})
    }
    if (orgId) {
      await OrganizationsService.deleteOrganization({ id: orgId }).catch(
        () => {},
      )
    }
  })

  test("a superuser can attach an existing quiz from the event page", async ({
    page,
  }) => {
    await page.goto(`/events/${eventSlug}`)

    // The quiz is not on this event yet.
    await expect(page.getByText("No quizzes published yet.")).toBeVisible()

    await page.getByRole("button", { name: "Add existing quiz" }).click()
    const dialog = page.getByRole("dialog")
    await dialog
      .getByTestId(Labels.attachQuizSelect)
      .selectOption({ label: `${quizName} (2026-07-01)` })
    await dialog.getByRole("button", { name: "Attach" }).click()
    await expect(page.getByText("Quiz attached to event")).toBeVisible()

    // It now shows in the event's own quiz list, and the attachment is real.
    await expect(page.getByRole("link", { name: quizName })).toBeVisible()
    const attached = await QuizzesService.readQuiz({ id: quizId })
    expect(attached.event_id).toBe(eventId)
  })

  test("a signed-in non-superuser gets no attach control", async ({
    browser,
  }) => {
    // An empty storageState is required, not just omitted: contexts made with
    // browser.newContext() inside the test runner inherit the project's `use`
    // options, which include the superuser storageState file — so a bare
    // newContext() would silently still be the superuser.
    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    })
    const otherPage = await ctx.newPage()
    try {
      await otherPage.goto("/login")
      await otherPage.getByTestId("email-input").fill(plainUserEmail)
      await otherPage.getByTestId("password-input").fill(plainUserPassword)
      await otherPage.getByRole("button", { name: "Log In" }).click()
      await otherPage.waitForURL("/")

      await otherPage.goto(`/events/${eventSlug}`)
      await expect(
        otherPage.getByRole("heading", { name: eventName }),
      ).toBeVisible()
      await expect(
        otherPage.getByRole("button", { name: "Add existing quiz" }),
      ).toHaveCount(0)
    } finally {
      await ctx.close()
    }
  })
})
