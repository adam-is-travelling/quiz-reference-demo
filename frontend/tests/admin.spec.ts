import { expect, test } from "@playwright/test"
import { OpenAPI, PlayersService, QuizzesService } from "../src/client"
import { Labels } from "../src/test-ids"
import { firstSuperuser, firstSuperuserPassword } from "./config.ts"
import { createUser } from "./utils/privateApi"
import { randomEmail, randomPassword } from "./utils/random"
import { logInUser } from "./utils/user"

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

test("Admin page is accessible and shows correct title", async ({ page }) => {
  await page.goto("/admin")
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible()
  await expect(
    page.getByText("Manage user accounts and permissions"),
  ).toBeVisible()
})

test("Add User button is visible", async ({ page }) => {
  await page.goto("/admin")
  await expect(page.getByRole("button", { name: "Add User" })).toBeVisible()
})

test.describe("Admin user management", () => {
  test("Create a new user successfully", async ({ page }) => {
    await page.goto("/admin")

    const email = randomEmail()
    const password = randomPassword()
    const fullName = "Test User Admin"

    await page.getByRole("button", { name: "Add User" }).click()

    await page.getByPlaceholder("Email").fill(email)
    await page.getByPlaceholder("Full name").fill(fullName)
    await page.getByPlaceholder("Password").first().fill(password)
    await page.getByPlaceholder("Password").last().fill(password)

    await page.getByRole("button", { name: "Save" }).click()

    await expect(page.getByText("User created successfully")).toBeVisible()

    await expect(page.getByRole("dialog")).not.toBeVisible()

    const userRow = page.getByRole("row").filter({ hasText: email })
    await expect(userRow).toBeVisible()
  })

  test("Create a superuser", async ({ page }) => {
    await page.goto("/admin")

    const email = randomEmail()
    const password = randomPassword()

    await page.getByRole("button", { name: "Add User" }).click()

    await page.getByPlaceholder("Email").fill(email)
    await page.getByPlaceholder("Password").first().fill(password)
    await page.getByPlaceholder("Password").last().fill(password)
    await page.getByLabel("Is superuser?").check()
    await page.getByLabel("Is active?").check()

    await page.getByRole("button", { name: "Save" }).click()

    await expect(page.getByText("User created successfully")).toBeVisible()

    await expect(page.getByRole("dialog")).not.toBeVisible()

    const userRow = page.getByRole("row").filter({ hasText: email })
    await expect(userRow.getByText("Superuser")).toBeVisible()
  })

  test("Edit a user successfully", async ({ page }) => {
    await page.goto("/admin")

    const email = randomEmail()
    const password = randomPassword()
    const originalName = "Original Name"
    const updatedName = "Updated Name"

    await page.getByRole("button", { name: "Add User" }).click()
    await page.getByPlaceholder("Email").fill(email)
    await page.getByPlaceholder("Full name").fill(originalName)
    await page.getByPlaceholder("Password").first().fill(password)
    await page.getByPlaceholder("Password").last().fill(password)
    await page.getByRole("button", { name: "Save" }).click()

    await expect(page.getByText("User created successfully")).toBeVisible()
    await expect(page.getByRole("dialog")).not.toBeVisible()

    const userRow = page.getByRole("row").filter({ hasText: email })
    await userRow.getByRole("button").click()

    await page.getByRole("menuitem", { name: "Edit User" }).click()

    await page.getByPlaceholder("Full name").fill(updatedName)
    await page.getByRole("button", { name: "Save" }).click()

    await expect(page.getByText("User updated successfully")).toBeVisible()
    await expect(userRow.getByText(updatedName)).toBeVisible()
  })

  test("Delete a user successfully", async ({ page }) => {
    await page.goto("/admin")

    const email = randomEmail()
    const password = randomPassword()

    await page.getByRole("button", { name: "Add User" }).click()
    await page.getByPlaceholder("Email").fill(email)
    await page.getByPlaceholder("Password").first().fill(password)
    await page.getByPlaceholder("Password").last().fill(password)
    await page.getByRole("button", { name: "Save" }).click()

    await expect(page.getByText("User created successfully")).toBeVisible()

    await expect(page.getByRole("dialog")).not.toBeVisible()

    const userRow = page.getByRole("row").filter({ hasText: email })
    await userRow.getByRole("button").click()

    await page.getByRole("menuitem", { name: "Delete User" }).click()

    await page.getByRole("button", { name: "Delete" }).click()

    await expect(
      page.getByText("The user was deleted successfully"),
    ).toBeVisible()

    await expect(
      page.getByRole("row").filter({ hasText: email }),
    ).not.toBeVisible()
  })

  test("Cancel user creation", async ({ page }) => {
    await page.goto("/admin")

    await page.getByRole("button", { name: "Add User" }).click()
    await page.getByPlaceholder("Email").fill("test@example.com")

    await page.getByRole("button", { name: "Cancel" }).click()

    await expect(page.getByRole("dialog")).not.toBeVisible()
  })

  test("Email is required and must be valid", async ({ page }) => {
    await page.goto("/admin")

    await page.getByRole("button", { name: "Add User" }).click()

    await page.getByPlaceholder("Email").fill("invalid-email")
    await page.getByPlaceholder("Email").blur()

    await expect(page.getByText("Invalid email address")).toBeVisible()
  })

  test("Password must be at least 8 characters", async ({ page }) => {
    await page.goto("/admin")

    await page.getByRole("button", { name: "Add User" }).click()

    await page.getByPlaceholder("Email").fill(randomEmail())
    await page.getByPlaceholder("Password").first().fill("short")
    await page.getByPlaceholder("Password").last().fill("short")
    await page.getByRole("button", { name: "Save" }).click()

    await expect(
      page.getByText("Password must be at least 8 characters"),
    ).toBeVisible()
  })

  test("Passwords must match", async ({ page }) => {
    await page.goto("/admin")

    await page.getByRole("button", { name: "Add User" }).click()

    await page.getByPlaceholder("Email").fill(randomEmail())
    await page.getByPlaceholder("Password").first().fill(randomPassword())
    await page.getByPlaceholder("Password").last().fill("different12345")
    await page.getByPlaceholder("Password").last().blur()

    await expect(page.getByText("The passwords don't match")).toBeVisible()
  })
})

// Regression: admin.quizzes.tsx was previously nested under admin.tsx in TanStack Router's
// flat-file convention. admin.tsx has no <Outlet />, so /admin/quizzes rendered the Users
// page instead of Quiz Review. Fix: rename to admin_.quizzes.tsx (trailing _ breaks nesting).
test.describe("Admin quiz review routing", () => {
  test("/admin/quizzes shows Quiz Review, not Users", async ({ page }) => {
    await page.goto("/admin/quizzes")
    await expect(page.getByTestId(Labels.adminQuizzesPageHeading)).toBeVisible()
    await expect(page.getByRole("heading", { name: "Users" })).not.toBeVisible()
  })

  test("/admin/quizzes shows Pending Review section", async ({ page }) => {
    await page.goto("/admin/quizzes")
    await expect(
      page.getByRole("heading", { name: "Pending Review" }),
    ).toBeVisible()
  })

  test("Review Quizzes sidebar link navigates to /admin/quizzes", async ({
    page,
  }) => {
    await page.goto("/")
    await page.getByRole("link", { name: "Review Quizzes" }).click()
    await page.waitForURL("/admin/quizzes")
    await expect(page.getByTestId(Labels.adminQuizzesPageHeading)).toBeVisible()
  })
})

test.describe("Admin quiz result deletion", () => {
  let quizId: string
  let playerId: string

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()

    const quiz = await QuizzesService.createQuiz({
      requestBody: {
        name: `E2E Result Deletion Quiz ${Date.now()}`,
        start_date: "2026-01-01",
        end_date: "2026-01-01",
      },
    })
    quizId = quiz.id

    const results = await QuizzesService.submitResults({
      id: quizId,
      requestBody: {
        results: [
          {
            participants: [
              { player_create: { display_name: `E2E Player ${Date.now()}` } },
            ],
            final_rank: 1,
            score: 100,
          },
        ],
      },
    })
    playerId = results.data[0].participants![0].player_id
  })

  test.afterAll(async () => {
    if (quizId) {
      await QuizzesService.deleteQuiz({ id: quizId })
    }
    if (playerId) {
      await PlayersService.deletePlayerRoute({ playerId })
    }
  })

  test("Delete button is visible on result rows when results exist", async ({
    page,
  }) => {
    await page.goto(`/admin/quizzes/${quizId}`)
    await expect(
      page.getByTestId(Labels.resultDeleteButton).first(),
    ).toBeVisible()
  })
})

test.describe("Admin page access control", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("Non-superuser cannot access admin page", async ({ page }) => {
    const email = randomEmail()
    const password = randomPassword()

    await createUser({ email, password })
    await logInUser(page, email, password)

    await page.goto("/admin")

    await expect(page.getByRole("heading", { name: "Users" })).not.toBeVisible()
    await expect(page).not.toHaveURL(/\/admin/)
  })

  test("Superuser can access admin page", async ({ page }) => {
    await logInUser(page, firstSuperuser, firstSuperuserPassword)

    await page.goto("/admin")

    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible()
  })
})

test.describe("Deleting a rejected quiz", () => {
  // Serial: the fixtures are shared and the second test deletes what the first
  // inspects. It also keeps beforeAll to a single worker — two workers loading
  // this module in the same millisecond produced identical quiz names, and the
  // slug allocator is check-then-insert, so the duplicates raced to a 500.
  test.describe.configure({ mode: "serial" })

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  let rejectedQuizId: string
  let listRejectedQuizId: string
  let pendingQuizId: string
  let approvedQuizId: string
  let playerId: string
  const rejectedName = `E2E Rejected Deletable ${runId}`
  const listRejectedName = `E2E Rejected From List ${runId}`
  const pendingName = `E2E Pending Undeletable ${runId}`
  const approvedName = `E2E Approved Undeletable ${runId}`

  async function makeQuizWithResult(
    name: string,
    // The Rejected list paginates at 10 under start_date-descending order, so
    // a fixture that must be reachable on page 1 needs a date later than every
    // other suite's seeds (the pagination suite uses 2099-01/02).
    day = "2026-02-01",
  ): Promise<[string, string]> {
    const quiz = await QuizzesService.createQuiz({
      requestBody: { name, start_date: day, end_date: day },
    })
    const results = await QuizzesService.submitResults({
      id: quiz.id,
      requestBody: {
        results: [
          {
            participants: [
              { player_create: { display_name: `Del Player ${name}` } },
            ],
            final_rank: 1,
            score: 100,
          },
        ],
      },
    })
    return [quiz.id, results.data[0].participants![0].player_id]
  }

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()
    ;[rejectedQuizId, playerId] = await makeQuizWithResult(rejectedName)
    await QuizzesService.rejectQuiz({ id: rejectedQuizId })
    ;[listRejectedQuizId] = await makeQuizWithResult(
      listRejectedName,
      "2099-12-31",
    )
    await QuizzesService.rejectQuiz({ id: listRejectedQuizId })
    ;[pendingQuizId] = await makeQuizWithResult(pendingName)
    ;[approvedQuizId] = await makeQuizWithResult(approvedName)
    await QuizzesService.approveQuiz({ id: approvedQuizId })
  })

  test.afterAll(async () => {
    // rejectedQuizId is deleted by the test itself; the rest are ours to clean.
    for (const id of [
      rejectedQuizId,
      listRejectedQuizId,
      pendingQuizId,
      approvedQuizId,
    ]) {
      if (id) await QuizzesService.deleteQuiz({ id }).catch(() => {})
    }
    if (playerId) {
      await PlayersService.deletePlayerRoute({ playerId }).catch(() => {})
    }
  })

  test("Delete is offered only for rejected quizzes", async ({ page }) => {
    await page.goto(`/admin/quizzes/${pendingQuizId}`)
    await expect(page.getByRole("heading", { name: pendingName })).toBeVisible()
    await expect(page.getByTestId(Labels.quizDeleteButton)).toHaveCount(0)

    await page.goto(`/admin/quizzes/${approvedQuizId}`)
    await expect(
      page.getByRole("heading", { name: approvedName }),
    ).toBeVisible()
    await expect(page.getByTestId(Labels.quizDeleteButton)).toHaveCount(0)

    await page.goto(`/admin/quizzes/${rejectedQuizId}`)
    await expect(page.getByTestId(Labels.quizDeleteButton)).toBeVisible()
  })

  test("deleting from the detail page removes the quiz and its results", async ({
    page,
  }) => {
    await page.goto(`/admin/quizzes/${rejectedQuizId}`)
    await page.getByTestId(Labels.quizDeleteButton).click()

    // Cancelling leaves the quiz alone.
    await page.getByRole("button", { name: "Cancel" }).click()
    await expect(page.getByTestId(Labels.quizDeleteConfirm)).toHaveCount(0)
    expect(
      await QuizzesService.readQuiz({ id: rejectedQuizId }).catch(() => null),
    ).not.toBeNull()

    await page.getByTestId(Labels.quizDeleteButton).click()
    await page.getByTestId(Labels.quizDeleteConfirm).click()

    // Lands back on the list, and the quiz is gone from the API.
    await page.waitForURL("/admin/quizzes")
    await expect(page.getByText("Quiz deleted")).toBeVisible()

    const gone = await QuizzesService.readQuiz({ id: rejectedQuizId }).catch(
      () => null,
    )
    expect(gone).toBeNull()
    const results = await QuizzesService.readQuizResults({
      id: rejectedQuizId,
    }).catch(() => null)
    expect(results).toBeNull()
  })
  test("deleting from the Rejected list removes the row", async ({ page }) => {
    await page.goto("/admin/quizzes")
    // Pending / Rejected / Approved are sections on one page, not tabs, so the
    // row is reachable directly; its Delete only renders because it's rejected.
    await expect(page.getByRole("heading", { name: "Rejected" })).toBeVisible()

    const row = page.getByRole("row").filter({ hasText: listRejectedName })
    await expect(row).toBeVisible()
    await row
      .getByRole("button", { name: `Delete ${listRejectedName}` })
      .click()
    await page.getByTestId(Labels.quizDeleteConfirm).click()

    await expect(page.getByText("Quiz deleted")).toBeVisible()
    await expect(
      page.getByRole("row").filter({ hasText: listRejectedName }),
    ).toHaveCount(0)
    expect(
      await QuizzesService.readQuiz({ id: listRejectedQuizId }).catch(
        () => null,
      ),
    ).toBeNull()
  })
})

test.describe("Dashboard label reflects the role", () => {
  // "/" is the shared home page, so only a superuser should see it labelled as
  // an admin dashboard.
  test("a superuser sees it called Admin Dashboard", async ({ page }) => {
    await page.goto("/")
    await expect(
      page.getByRole("link", { name: "Admin Dashboard" }).first(),
    ).toBeVisible()
  })

  test.describe("as a plain member", () => {
    test.use({ storageState: { cookies: [], origins: [] } })

    test("it is just Dashboard", async ({ page }) => {
      const email = randomEmail()
      const password = randomPassword()
      await createUser({ email, password })
      await logInUser(page, email, password)

      await page.goto("/")
      await expect(
        page.getByRole("link", { name: "Dashboard", exact: true }).first(),
      ).toBeVisible()
      await expect(
        page.getByRole("link", { name: "Admin Dashboard" }),
      ).toHaveCount(0)
    })
  })
})

test.describe("Quiz Review pagination", () => {
  // Shared fixtures across the tests, so keep them in one worker.
  test.describe.configure({ mode: "serial" })

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const TOTAL = 12
  const PAGE_SIZE = 10
  const rejectedIds: string[] = []
  const approvedIds: string[] = []

  // Zero-padded: an unpadded "#1" is a substring of "#10".."#12", so row
  // filters would match four rows instead of one.
  const pad = (i: number) => String(i).padStart(2, "0")
  const rejectedName = (i: number) => `E2E Page Rejected ${runId} #${pad(i)}`
  const approvedName = (i: number) => `E2E Page Approved ${runId} #${pad(i)}`

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()

    // Far-future dates so these sort to the top of the existing
    // start_date-descending order and occupy page 1 of their section
    // predictably. Descending means #12 leads and #01 is pushed to page 2.
    for (let i = 1; i <= TOTAL; i++) {
      const day = pad(i)
      const rejected = await QuizzesService.createQuiz({
        requestBody: {
          name: rejectedName(i),
          start_date: `2099-01-${day}`,
          end_date: `2099-01-${day}`,
        },
      })
      rejectedIds.push(rejected.id)
      await QuizzesService.rejectQuiz({ id: rejected.id })

      const approved = await QuizzesService.createQuiz({
        requestBody: {
          name: approvedName(i),
          start_date: `2099-02-${day}`,
          end_date: `2099-02-${day}`,
        },
      })
      approvedIds.push(approved.id)
      await QuizzesService.approveQuiz({ id: approved.id })
    }
  })

  test.afterAll(async () => {
    for (const id of [...rejectedIds, ...approvedIds]) {
      await QuizzesService.deleteQuiz({ id }).catch(() => {})
    }
  })

  const row = (page: import("@playwright/test").Page, name: string) =>
    page.getByRole("row").filter({ hasText: name })

  test("shows 10 per page and pages through the rest", async ({ page }) => {
    await page.goto("/admin/quizzes")

    // Count the section's own rows, not just ours: other suites seed rejected
    // quizzes too, and what matters is that a page holds at most PAGE_SIZE.
    const rejectedBody = page
      .getByTestId("quizzes-table-rejected")
      .locator("tbody tr")
    await expect(rejectedBody).toHaveCount(PAGE_SIZE)
    await expect(row(page, rejectedName(12))).toBeVisible()
    await expect(row(page, rejectedName(1))).toHaveCount(0)

    await page
      .getByRole("button", { name: "rejected: go to next page" })
      .click()
    await expect(row(page, rejectedName(1))).toBeVisible()
    await expect(row(page, rejectedName(12))).toHaveCount(0)

    // ...and back again.
    await page
      .getByRole("button", { name: "rejected: go to previous page" })
      .click()
    await expect(row(page, rejectedName(12))).toBeVisible()
  })

  test("a section shows a pager exactly when it overflows one page", async ({
    page,
  }) => {
    await page.goto("/admin/quizzes")

    // Asserted against the live counts rather than assumed totals: other
    // suites leave rows in these sections, so the invariant under test is the
    // rule itself — a pager appears iff the section has more than one page.
    for (const status of ["pending", "rejected", "approved"] as const) {
      const { count } = await QuizzesService.readQuizzes({
        status,
        skip: 0,
        limit: 1,
      })
      const pager = page.getByRole("button", {
        name: `${status}: go to next page`,
      })
      if (count > PAGE_SIZE) {
        await expect(pager).toBeVisible()
      } else {
        await expect(pager).toHaveCount(0)
      }
    }
  })

  test("each section pages independently", async ({ page }) => {
    await page.goto("/admin/quizzes")
    await expect(row(page, approvedName(12))).toBeVisible()

    await page
      .getByRole("button", { name: "rejected: go to next page" })
      .click()
    await expect(row(page, rejectedName(1))).toBeVisible()

    // Advancing Rejected left Approved on its first page.
    await expect(row(page, approvedName(12))).toBeVisible()
    await expect(row(page, approvedName(1))).toHaveCount(0)
  })
})
