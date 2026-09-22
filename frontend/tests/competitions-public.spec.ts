import { expect, test } from "@playwright/test"
import {
  CompetitionsService,
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

  test("detail page shows the Quizzes section", async ({ page }) => {
    await page.goto(`/competitions/${competitionSlug}`)
    await expect(page.getByRole("heading", { name: "Quizzes" })).toBeVisible()
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
        name: `Podium Quiz ${runId}`,
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
          {
            participants: [{ player_id: playerIds[0] }],
            final_rank: 1,
            score: 90,
          },
          {
            participants: [{ player_id: playerIds[1] }],
            final_rank: 2,
            score: 80,
          },
          {
            participants: [{ player_id: playerIds[2] }],
            final_rank: 3,
            score: 70,
          },
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

    await expect(page.getByRole("heading", { name: "Quizzes" })).toBeVisible()
    await expect(
      page.getByRole("heading", { name: "Podium standings" }),
    ).toBeVisible()

    // Finishers appear in the quizzes table
    await expect(page.getByText(winnerName).first()).toBeVisible()
    await expect(page.getByText(thirdName).first()).toBeVisible()
  })
})

test.describe("Competition page upload shortcut", () => {
  const runId = Date.now()
  const competitionName = `Upload Shortcut Competition ${runId}`
  const orgName = `Upload Shortcut Org ${runId}`
  const organizerEmail = `comp-organizer-${runId}@example.com`
  const organizerPassword = "comp-organizer-password-123"
  const plainEmail = `comp-plain-${runId}@example.com`
  const plainPassword = "comp-plain-password-123"
  let orgId: string
  let competitionId: string
  let competitionSlug: string
  let organizerId: string
  let plainId: string
  const submittedQuizIds: string[] = []

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()

    const org = await OrganizationsService.createOrganization({
      requestBody: { name: orgName },
    })
    orgId = org.id
    const competition = await CompetitionsService.createCompetition({
      requestBody: { name: competitionName, organization_id: orgId },
    })
    competitionId = competition.id
    competitionSlug = competition.slug

    organizerId = (
      await UsersService.createUser({
        requestBody: {
          email: organizerEmail,
          password: organizerPassword,
          is_superuser: false,
          is_organizer: true,
        },
      })
    ).id
    plainId = (
      await UsersService.createUser({
        requestBody: {
          email: plainEmail,
          password: plainPassword,
          is_superuser: false,
          is_organizer: false,
        },
      })
    ).id
  })

  test.afterAll(async () => {
    for (const id of submittedQuizIds) {
      await QuizzesService.deleteQuiz({ id }).catch(() => {})
    }
    if (organizerId) {
      await UsersService.deleteUser({ userId: organizerId }).catch(() => {})
    }
    if (plainId) {
      await UsersService.deleteUser({ userId: plainId }).catch(() => {})
    }
    if (competitionId) {
      await CompetitionsService.deleteCompetition({ id: competitionId }).catch(
        () => {},
      )
    }
    if (orgId) {
      await OrganizationsService.deleteOrganization({ id: orgId }).catch(
        () => {},
      )
    }
  })

  test("a superuser goes from the competition page to a prefilled upload", async ({
    page,
  }) => {
    await page.goto(`/competitions/${competitionSlug}`)
    await page.getByRole("link", { name: "Upload result" }).click()

    await expect(page).toHaveURL(`/upload?competition=${competitionSlug}`)
    await expect(page.locator('input[name="name"]')).toHaveValue(
      competitionName,
    )
    await expect(page.getByText(orgName).first()).toBeVisible()
    await expect(page.getByText(competitionName).first()).toBeVisible()
  })

  test("the prefilled fields stay editable", async ({ page }) => {
    await page.goto(`/upload?competition=${competitionSlug}`)
    const nameInput = page.locator('input[name="name"]')
    await expect(nameInput).toHaveValue(competitionName)
    await expect(nameInput).toBeEditable()
    await nameInput.fill(`${competitionName} — Round 2`)
    await expect(nameInput).toHaveValue(`${competitionName} — Round 2`)
  })

  test("/upload with no competition param still opens the mode chooser", async ({
    page,
  }) => {
    await page.goto("/upload")
    await expect(page.getByTestId(Labels.uploadModeNew)).toBeVisible()
  })

  test("an organizer sees the upload shortcut", async ({ browser }) => {
    // An empty storageState is required, not just omitted: contexts made with
    // browser.newContext() inside the test runner inherit the project's `use`
    // options, which include the superuser storageState file.
    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    })
    const otherPage = await ctx.newPage()
    try {
      await otherPage.goto("/login")
      await otherPage.getByTestId("email-input").fill(organizerEmail)
      await otherPage.getByTestId("password-input").fill(organizerPassword)
      await otherPage.getByRole("button", { name: "Log In" }).click()
      await otherPage.waitForURL("/")

      await otherPage.goto(`/competitions/${competitionSlug}`)
      await expect(
        otherPage.getByRole("heading", { name: competitionName }),
      ).toBeVisible()
      await expect(
        otherPage.getByRole("link", { name: "Upload result" }),
      ).toBeVisible()
    } finally {
      await ctx.close()
    }
  })

  test("a signed-in non-organizer does not see the upload shortcut", async ({
    browser,
  }) => {
    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    })
    const otherPage = await ctx.newPage()
    try {
      await otherPage.goto("/login")
      await otherPage.getByTestId("email-input").fill(plainEmail)
      await otherPage.getByTestId("password-input").fill(plainPassword)
      await otherPage.getByRole("button", { name: "Log In" }).click()
      await otherPage.waitForURL("/")

      await otherPage.goto(`/competitions/${competitionSlug}`)
      await expect(
        otherPage.getByRole("heading", { name: competitionName }),
      ).toBeVisible()
      await expect(
        otherPage.getByRole("link", { name: "Upload result" }),
      ).toHaveCount(0)
    } finally {
      await ctx.close()
    }
  })

  test("the prefilled competition and organization survive submission", async ({
    page,
  }) => {
    const quizName = `Prefill Submit Quiz ${runId}`

    await page.goto(`/upload?competition=${competitionSlug}`)
    await expect(page.locator('input[name="name"]')).toHaveValue(
      competitionName,
    )
    // Rename so the quiz is findable, but never touch the Organization or
    // Competition selects — the prefill is the whole point.
    await page.getByLabel("Quiz name *").fill(quizName)
    await page.getByRole("button", { name: "Next →" }).click()

    await page
      .getByLabel("Or paste data directly")
      .fill(
        `Name,Country,Score\nPrefill Alice ${runId},Ireland,50\nPrefill Bob ${runId},England,40`,
      )
    await page.getByRole("button", { name: "Next →" }).click()
    await page.getByRole("button", { name: "Next →" }).click()
    await page.getByRole("button", { name: "Next →" }).click()
    await page.getByRole("button", { name: "Submit for review" }).click()
    await expect(page.getByText("Results submitted for review.")).toBeVisible()

    const pending = await QuizzesService.readQuizzes({
      status: "pending",
      limit: 200,
    })
    const created = pending.data.find((q) => q.name === quizName)
    expect(created).toBeDefined()
    submittedQuizIds.push(created!.id)
    expect(created?.competition_id).toBe(competitionId)
    expect(created?.organization_id).toBe(orgId)
  })

  test("a logged-out visitor does not see the upload shortcut", async ({
    browser,
  }) => {
    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    })
    const otherPage = await ctx.newPage()
    try {
      await otherPage.goto(`/competitions/${competitionSlug}`)
      await expect(
        otherPage.getByRole("heading", { name: competitionName }),
      ).toBeVisible()
      await expect(
        otherPage.getByRole("link", { name: "Upload result" }),
      ).toHaveCount(0)
    } finally {
      await ctx.close()
    }
  })
})

test.describe("Competition history ordering", () => {
  const runId = Date.now()
  const earliestName = `Chrono Earliest ${runId}`
  const middleName = `Chrono Middle ${runId}`
  const latestName = `Chrono Latest ${runId}`
  let orgId: string
  let competitionId: string
  let competitionSlug: string
  const quizIds: string[] = []

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()

    const org = await OrganizationsService.createOrganization({
      requestBody: { name: `Chrono Org ${runId}` },
    })
    orgId = org.id
    const competition = await CompetitionsService.createCompetition({
      requestBody: {
        name: `Chrono Competition ${runId}`,
        organization_id: orgId,
      },
    })
    competitionId = competition.id
    competitionSlug = competition.slug

    // Created out of order on purpose, so a passing assertion can only come
    // from the endpoint's ordering, not from insertion order.
    for (const [name, day] of [
      [middleName, "2026-05-01"],
      [latestName, "2027-09-01"],
      [earliestName, "2024-01-01"],
    ] as const) {
      const quiz = await QuizzesService.createQuiz({
        requestBody: {
          name,
          start_date: day,
          end_date: day,
          competition_id: competitionId,
        },
      })
      quizIds.push(quiz.id)
      await QuizzesService.approveQuiz({ id: quiz.id })
    }
  })

  test.afterAll(async () => {
    for (const id of quizIds) {
      await QuizzesService.deleteQuiz({ id }).catch(() => {})
    }
    if (competitionId) {
      await CompetitionsService.deleteCompetition({ id: competitionId }).catch(
        () => {},
      )
    }
    if (orgId) {
      await OrganizationsService.deleteOrganization({ id: orgId }).catch(
        () => {},
      )
    }
  })

  test.use({ storageState: { cookies: [], origins: [] } })

  test("the competition page lists quizzes earliest first", async ({
    page,
  }) => {
    await page.goto(`/competitions/${competitionSlug}`)
    await page.waitForLoadState("networkidle")

    const names = page.getByRole("link", {
      name: new RegExp(`Chrono (Earliest|Middle|Latest) ${runId}`),
    })
    await expect(names).toHaveText([earliestName, middleName, latestName])
  })
})
