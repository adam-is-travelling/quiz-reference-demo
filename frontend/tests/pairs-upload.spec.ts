import { expect, test } from "@playwright/test"
import { OpenAPI, PlayersService, QuizzesService } from "../src/client"
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

test.describe.configure({ mode: "serial" })

const runId = Date.now()

const COMBINED_QUIZ_NAME = `Pairs Combined Quiz ${runId}`
const TWO_COLUMN_QUIZ_NAME = `Pairs Two Column Quiz ${runId}`
const THREE_QUIZZER_QUIZ_NAME = `Pairs Three Quizzer Quiz ${runId}`

const COMBINED_CSV = `Team,Country,Score
Alice Combined & Bob Combined,Ireland,50
Carol Combined and Dave Combined,Ireland,48
Solo Combined,Ireland,40`

const TWO_COLUMN_CSV = `Player 1,Player 2,Country,Score
Alice Split,Bob Split,Ireland,50
Carol Split,Dave Split,Ireland,48`

const THREE_QUIZZER_CSV = `Team,Country,Score
Alice Three & Bob Three & Carol Three,Ireland,50`

// Names created (via the wizard's "create new player" auto-resolution) by
// the combined-column and two-column tests, so afterAll can clean them up
// even if a test fails partway through. The three-quizzer test never
// reaches submission, so it never creates players.
const COMBINED_PLAYER_NAMES = [
  "Alice Combined",
  "Bob Combined",
  "Carol Combined",
  "Dave Combined",
  "Solo Combined",
]
const TWO_COLUMN_PLAYER_NAMES = [
  "Alice Split",
  "Bob Split",
  "Carol Split",
  "Dave Split",
]

test.beforeAll(async () => {
  OpenAPI.BASE = process.env.VITE_API_URL!
  OpenAPI.TOKEN = await authenticate()
})

test.afterAll(async () => {
  // Delete the quizzes first (results cascade with them), then the
  // players the wizard auto-created for those quizzes. Looked up by exact
  // name at cleanup time — rather than an id captured mid-test — so
  // cleanup still runs even if a test fails after the quiz was created.
  for (const name of [COMBINED_QUIZ_NAME, TWO_COLUMN_QUIZ_NAME]) {
    const pending = await QuizzesService.readQuizzes({
      status: "pending",
      limit: 200,
      q: name,
    }).catch(() => null)
    for (const q of pending?.data ?? []) {
      if (q.name === name) {
        await QuizzesService.deleteQuiz({ id: q.id }).catch(() => {})
      }
    }
  }

  for (const name of [...COMBINED_PLAYER_NAMES, ...TWO_COLUMN_PLAYER_NAMES]) {
    const found = await PlayersService.searchPlayersRoute({
      q: name,
      limit: 5,
    }).catch(() => null)
    for (const r of found?.data ?? []) {
      if (r.player.display_name === name) {
        await PlayersService.deletePlayerRoute({
          playerId: r.player.id,
        }).catch(() => {})
      }
    }
  }
})

test("uploads a pairs quiz with both names in one column", async ({
  page,
}) => {
  await page.goto("/upload")
  await page.getByTestId(Labels.uploadModeNew).click()
  await page.getByTestId(Labels.uploadParticipantModePairs).click()
  await page.getByLabel("Quiz name *").fill(COMBINED_QUIZ_NAME)
  await page.getByRole("button", { name: "Next →" }).click() // Step1 -> Step2

  await page.getByLabel("Or paste data directly").fill(COMBINED_CSV)
  await page.getByRole("button", { name: "Next →" }).click() // Step2 -> Step3

  // The combined column ("Team") has a majority of & / and separators, so
  // the layout should auto-detect as "combined".
  await expect(page.getByTestId(Labels.pairsLayoutCombined)).toHaveClass(
    /bg-primary/,
  )
  await page.getByRole("button", { name: "Next →" }).click() // Step3 -> Step4

  // Step 4: brand-new names auto-resolve to "create new"; proceed once
  // matching has settled.
  await expect(page.getByRole("button", { name: "Next →" })).toBeEnabled()
  const toggle = page.getByRole("button", {
    name: /New players to be created/,
  })
  await expect(toggle).toBeVisible()
  await toggle.click()
  // Match the full "name · country · score" row line, not the shorter
  // "partner: <name>" line elsewhere on the page for the same name.
  await expect(
    page.getByText("Alice Combined · Ireland · Score: 50"),
  ).toBeVisible()
  await expect(
    page.getByText("Bob Combined · Ireland · Score: 50"),
  ).toBeVisible()
  await page.getByRole("button", { name: "Next →" }).click() // Step4 -> Step5

  // Step 5: submit.
  await page.getByRole("button", { name: "Submit for review" }).click()
  await expect(page.getByText("Results submitted for review.")).toBeVisible()

  // The created quiz is "pending" (awaiting approval) but visible to the
  // superuser. Navigate to its results table and check both names on each
  // pair are joined by exactly " & ", however the source row spelled the
  // separator ("&" or "and").
  const pending = await QuizzesService.readQuizzes({
    status: "pending",
    limit: 200,
    q: COMBINED_QUIZ_NAME,
  })
  const created = pending.data.find((q) => q.name === COMBINED_QUIZ_NAME)
  expect(created).toBeTruthy()

  await page.goto(`/quizzes/${created!.id}`)
  await expect(
    page.getByText("Alice Combined & Bob Combined"),
  ).toBeVisible()
  await expect(page.getByText("Carol Combined & Dave Combined")).toBeVisible()
  await expect(page.getByText("Solo Combined")).toBeVisible()
})

test("uploads a pairs quiz with two name columns", async ({ page }) => {
  await page.goto("/upload")
  await page.getByTestId(Labels.uploadModeNew).click()
  await page.getByTestId(Labels.uploadParticipantModePairs).click()
  await page.getByLabel("Quiz name *").fill(TWO_COLUMN_QUIZ_NAME)
  await page.getByRole("button", { name: "Next →" }).click() // Step1 -> Step2

  await page.getByLabel("Or paste data directly").fill(TWO_COLUMN_CSV)
  await page.getByRole("button", { name: "Next →" }).click() // Step2 -> Step3

  // Separate "Player 1" / "Player 2" columns, no & / and separators, so the
  // layout should auto-detect as "two-columns".
  await expect(page.getByTestId(Labels.pairsLayoutTwoColumns)).toHaveClass(
    /bg-primary/,
  )
  await page.getByRole("button", { name: "Next →" }).click() // Step3 -> Step4

  await expect(page.getByRole("button", { name: "Next →" })).toBeEnabled()
  const toggle = page.getByRole("button", {
    name: /New players to be created/,
  })
  await expect(toggle).toBeVisible()
  await toggle.click()
  await expect(
    page.getByText("Alice Split · Ireland · Score: 50"),
  ).toBeVisible()
  await expect(
    page.getByText("Bob Split · Ireland · Score: 50"),
  ).toBeVisible()
  await page.getByRole("button", { name: "Next →" }).click() // Step4 -> Step5

  await page.getByRole("button", { name: "Submit for review" }).click()
  await expect(page.getByText("Results submitted for review.")).toBeVisible()

  const pending = await QuizzesService.readQuizzes({
    status: "pending",
    limit: 200,
    q: TWO_COLUMN_QUIZ_NAME,
  })
  const created = pending.data.find((q) => q.name === TWO_COLUMN_QUIZ_NAME)
  expect(created).toBeTruthy()

  await page.goto(`/quizzes/${created!.id}`)
  await expect(page.getByText("Alice Split & Bob Split")).toBeVisible()
  await expect(page.getByText("Carol Split & Dave Split")).toBeVisible()
})

test("blocks a row with three quizzers", async ({ page }) => {
  await page.goto("/upload")
  await page.getByTestId(Labels.uploadModeNew).click()
  await page.getByTestId(Labels.uploadParticipantModePairs).click()
  await page.getByLabel("Quiz name *").fill(THREE_QUIZZER_QUIZ_NAME)
  await page.getByRole("button", { name: "Next →" }).click() // Step1 -> Step2

  await page.getByLabel("Or paste data directly").fill(THREE_QUIZZER_CSV)
  await page.getByRole("button", { name: "Next →" }).click() // Step2 -> Step3
  await page.getByRole("button", { name: "Next →" }).click() // Step3 -> Step4

  // Step 4: three brand-new names still auto-resolve to "create new" — the
  // three-quizzer cap is enforced at Step 5, not during matching.
  await expect(page.getByRole("button", { name: "Next →" })).toBeEnabled()
  await page.getByRole("button", { name: "Next →" }).click() // Step4 -> Step5

  await expect(page.getByTestId(Labels.uploadValidationErrors)).toContainText(
    "found 3",
  )
  await expect(
    page.getByRole("button", { name: "Submit for review" }),
  ).toBeDisabled()
})
