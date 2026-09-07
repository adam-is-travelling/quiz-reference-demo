import { expect, test } from "@playwright/test"
import type { PlayerPublic, QuizPublic, QuizStatus } from "../src/client"
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

const COMBINED_QUIZ_NAME = `Teams Combined Quiz ${runId}`
const NUMBERED_QUIZ_NAME = `Teams Numbered Quiz ${runId}`
const EMPTY_SQUAD_QUIZ_NAME = `Teams Empty Squad Quiz ${runId}`

// "Players" and "Player 1"/"Player 2" are the headers a real teams file
// carries, and they are also the ones Step 3 used to lose: the (unused in
// teams mode) "Player name" detection claimed them before the lineup
// detector ran. Step 3 now skips that field in teams mode, so these headers
// are the regression guard for it.
const COMBINED_CSV = `Team,Players,Score
England A,"Alice Teams ${runId}, Bob Teams ${runId}",100
Scotland,"Carol Teams ${runId} & Dave Teams ${runId}",90`

const NUMBERED_CSV = `Team,Player 1,Player 2,Score
Wales,Erin Teams ${runId},Frank Teams ${runId},80`

// Teams and scores, no squad column at all: a supported upload whose squads
// are filled in later from the quiz results page.
const EMPTY_SQUAD_CSV = `Team,Score
Rest of the World,70`

const INLINE_PLAYER_NAME = `Gwen Inline ${runId}`
// Two players sharing a search token: one is added to the squad, the other
// stays out of it, so a single search proves both that suggestions appear
// and that a player already in the squad is filtered out of them.
const SEARCH_TOKEN = `Bench ${runId}`
const PICKED_PLAYER_NAME = `Hilda ${SEARCH_TOKEN}`
const UNPICKED_PLAYER_NAME = `Ivan ${SEARCH_TOKEN}`

const CREATED_PLAYER_NAMES = [
  `Alice Teams ${runId}`,
  `Bob Teams ${runId}`,
  `Carol Teams ${runId}`,
  `Dave Teams ${runId}`,
  `Erin Teams ${runId}`,
  `Frank Teams ${runId}`,
  INLINE_PLAYER_NAME,
  PICKED_PLAYER_NAME,
  UNPICKED_PLAYER_NAME,
]

const QUIZ_NAMES = [
  COMBINED_QUIZ_NAME,
  NUMBERED_QUIZ_NAME,
  EMPTY_SQUAD_QUIZ_NAME,
]

// readQuizzes filters on exactly one status, and the third test approves its
// quiz to get the result into a player's history, so both buckets have to be
// searched — for the assertions and, more importantly, for cleanup.
const QUIZ_STATUSES: QuizStatus[] = ["pending", "approved"]

async function findQuiz(name: string): Promise<QuizPublic | undefined> {
  for (const status of QUIZ_STATUSES) {
    const listed = await QuizzesService.readQuizzes({
      status,
      limit: 200,
      q: name,
    })
    const found = listed.data.find((quiz) => quiz.name === name)
    if (found) return found
  }
  return undefined
}

async function findQuizId(name: string): Promise<string> {
  const found = await findQuiz(name)
  expect(found).toBeTruthy()
  return found!.id
}

async function findPlayer(name: string): Promise<PlayerPublic> {
  // The superuser's search sees unpublished players, which is what a player
  // created inline on a still-pending quiz is.
  const found = await PlayersService.searchPlayersRoute({ q: name, limit: 5 })
  const match = found.data.find((r) => r.player.display_name === name)
  expect(match).toBeTruthy()
  return match!.player
}

test.beforeAll(async () => {
  OpenAPI.BASE = process.env.VITE_API_URL!
  OpenAPI.TOKEN = await authenticate()
})

test.afterAll(async () => {
  // Quizzes first — results and their participant rows cascade with them,
  // and a player that still has results cannot be deleted — then the players
  // this run created. Everything is looked up by the exact name this run
  // generated, at cleanup time rather than from an id captured mid-test, so
  // teardown still works if a test failed partway through and never touches
  // a row this spec did not create.
  for (const name of QUIZ_NAMES) {
    for (const status of QUIZ_STATUSES) {
      const listed = await QuizzesService.readQuizzes({
        status,
        limit: 200,
        q: name,
      }).catch(() => null)
      for (const quiz of listed?.data ?? []) {
        if (quiz.name === name) {
          await QuizzesService.deleteQuiz({ id: quiz.id }).catch(() => {})
        }
      }
    }
  }

  for (const name of CREATED_PLAYER_NAMES) {
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

test("uploads a teams quiz with the squad in one column", async ({ page }) => {
  await page.goto("/upload")
  await page.getByTestId(Labels.uploadModeNew).click()
  await page.getByTestId(Labels.uploadParticipantModeTeams).click()

  // Choosing Teams reveals the default team type, with National preselected.
  await expect(
    page.getByTestId(Labels.uploadDefaultTeamTypeNational),
  ).toHaveClass(/bg-primary/)
  await expect(
    page.getByTestId(Labels.uploadDefaultTeamTypeClub),
  ).not.toHaveClass(/bg-primary/)

  await page.getByLabel("Quiz name *").fill(COMBINED_QUIZ_NAME)
  await page.getByRole("button", { name: "Next →" }).click() // Step1 -> Step2

  await page.getByLabel("Or paste data directly").fill(COMBINED_CSV)
  await page.getByRole("button", { name: "Next →" }).click() // Step2 -> Step3

  // Every squad cell carries a comma or an ampersand, so the layout must
  // auto-detect as combined.
  await expect(page.getByTestId(Labels.lineupLayoutCombined)).toHaveClass(
    /bg-primary/,
  )
  // The preview's Lineup cell is rendered from the resolved column mapping,
  // so it is empty (and these fail) if the squad column was not picked up.
  // Scotland's row also proves "&" and "," both split, and both normalize to
  // the same joined rendering.
  await expect(
    page.getByText(`Alice Teams ${runId}, Bob Teams ${runId}`),
  ).toBeVisible()
  await expect(
    page.getByText(`Carol Teams ${runId}, Dave Teams ${runId}`),
  ).toBeVisible()
  await page.getByRole("button", { name: "Next →" }).click() // Step3 -> Step4

  // Both teams appear in the panel, prefilled from the National default —
  // and the international checkbox only renders for a national side.
  const englandDetails = page.getByTestId("team-details-England A")
  await expect(englandDetails).toBeVisible()
  await expect(page.getByTestId("team-details-Scotland")).toBeVisible()
  await expect(
    englandDetails.getByText("National", { exact: true }),
  ).toBeVisible()
  await expect(
    englandDetails.getByText("International (no single country)"),
  ).toBeVisible()

  await expect(page.getByRole("button", { name: "Next →" })).toBeEnabled()
  await page.getByRole("button", { name: "Next →" }).click() // Step4 -> Step5

  // Four brand-new squad members across two rows, and nothing to correct.
  await expect(page.getByText("4 new players will be created.")).toBeVisible()
  await expect(page.getByTestId(Labels.uploadValidationErrors)).toHaveCount(0)
  await page.getByRole("button", { name: "Submit for review" }).click()
  await expect(page.getByText("Results submitted for review.")).toBeVisible()

  await page.goto(`/quizzes/${await findQuizId(COMBINED_QUIZ_NAME)}`)
  const englandRow = page.getByRole("row").filter({ hasText: "England A" })
  await expect(englandRow.getByText(`Alice Teams ${runId}`)).toBeVisible()
  await expect(englandRow.getByText(`Bob Teams ${runId}`)).toBeVisible()
  // A national team with no country is an international side, and that is
  // what the affiliation line under the team name must say.
  await expect(
    englandRow.getByText("International", { exact: true }),
  ).toBeVisible()

  const scotlandRow = page.getByRole("row").filter({ hasText: "Scotland" })
  await expect(scotlandRow.getByText(`Carol Teams ${runId}`)).toBeVisible()
  await expect(scotlandRow.getByText(`Dave Teams ${runId}`)).toBeVisible()
})

test("uploads a teams quiz with one column per squad member", async ({
  page,
}) => {
  await page.goto("/upload")
  await page.getByTestId(Labels.uploadModeNew).click()
  await page.getByTestId(Labels.uploadParticipantModeTeams).click()
  await page.getByLabel("Quiz name *").fill(NUMBERED_QUIZ_NAME)
  await page.getByRole("button", { name: "Next →" }).click() // Step1 -> Step2

  await page.getByLabel("Or paste data directly").fill(NUMBERED_CSV)
  await page.getByRole("button", { name: "Next →" }).click() // Step2 -> Step3

  // Two numbered squad headers and no separators in the cells, so the
  // layout must flip away from its "combined" default.
  await expect(page.getByTestId(Labels.lineupLayoutNumbered)).toHaveClass(
    /bg-primary/,
  )
  await expect(page.getByTestId(Labels.lineupLayoutCombined)).not.toHaveClass(
    /bg-primary/,
  )
  // Both columns are read, in header order.
  await expect(
    page.getByText(`Erin Teams ${runId}, Frank Teams ${runId}`),
  ).toBeVisible()
  await page.getByRole("button", { name: "Next →" }).click() // Step3 -> Step4

  await expect(page.getByTestId("team-details-Wales")).toBeVisible()
  await expect(page.getByRole("button", { name: "Next →" })).toBeEnabled()
  await page.getByRole("button", { name: "Next →" }).click() // Step4 -> Step5

  await expect(page.getByText("2 new players will be created.")).toBeVisible()
  await expect(page.getByTestId(Labels.uploadValidationErrors)).toHaveCount(0)
  await page.getByRole("button", { name: "Submit for review" }).click()
  await expect(page.getByText("Results submitted for review.")).toBeVisible()

  await page.goto(`/quizzes/${await findQuizId(NUMBERED_QUIZ_NAME)}`)
  const walesRow = page.getByRole("row").filter({ hasText: "Wales" })
  await expect(walesRow.getByText(`Erin Teams ${runId}`)).toBeVisible()
  await expect(walesRow.getByText(`Frank Teams ${runId}`)).toBeVisible()
})

test("records a team with no squad, then fills it in from the results page", async ({
  page,
}) => {
  // Two existing players sharing a search token. Only one of them is added
  // to the squad, so the second search below can tell "the suggestion list
  // filters out who is already in the squad" apart from "the search found
  // nothing at all".
  for (const display_name of [PICKED_PLAYER_NAME, UNPICKED_PLAYER_NAME]) {
    await PlayersService.createPlayerRoute({
      requestBody: { display_name, countries: [] },
    })
  }

  await page.goto("/upload")
  await page.getByTestId(Labels.uploadModeNew).click()
  await page.getByTestId(Labels.uploadParticipantModeTeams).click()
  await page.getByLabel("Quiz name *").fill(EMPTY_SQUAD_QUIZ_NAME)
  await page.getByRole("button", { name: "Next →" }).click() // Step1 -> Step2

  await page.getByLabel("Or paste data directly").fill(EMPTY_SQUAD_CSV)
  await page.getByRole("button", { name: "Next →" }).click() // Step2 -> Step3

  // No squad column exists in this file; the wizard must still let it
  // through. ("Squad layout" is Step 3's own copy, so waiting on it keeps
  // this click off Step 2's identically-named button.)
  await expect(page.getByText("Squad layout")).toBeVisible()
  await page.getByRole("button", { name: "Next →" }).click() // Step3 -> Step4

  await expect(page.getByTestId("team-details-Rest of the World")).toBeVisible()
  await expect(page.getByRole("button", { name: "Next →" })).toBeEnabled()
  await page.getByRole("button", { name: "Next →" }).click() // Step4 -> Step5

  // The zero-participant path: no players, no validation errors, and a
  // submit button that is actually enabled.
  await expect(page.getByText("0 new players will be created.")).toBeVisible()
  await expect(page.getByTestId(Labels.uploadValidationErrors)).toHaveCount(0)
  const submit = page.getByRole("button", { name: "Submit for review" })
  await expect(submit).toBeEnabled()
  await submit.click()
  await expect(page.getByText("Results submitted for review.")).toBeVisible()

  await page.goto(`/quizzes/${await findQuizId(EMPTY_SQUAD_QUIZ_NAME)}`)
  await expect(page.getByText("Rest of the World")).toBeVisible()
  await expect(page.getByText("No squad recorded")).toBeVisible()

  // Add a brand-new squad member inline as the superuser. The "Create …"
  // button is not debounced — it tracks the input directly — so it only
  // needs Playwright's ordinary auto-waiting.
  const search = page.getByLabel("Add a player")
  await search.fill(INLINE_PLAYER_NAME)
  await page
    .getByRole("button", { name: `Create "${INLINE_PLAYER_NAME}"` })
    .click()
  await expect(page.getByText("Squad updated")).toBeVisible()
  // The chip's own remove control, rather than the bare name: the name also
  // appears on the "Create …" button and (below) in the suggestion list, and
  // the chip is the thing that proves the participant was saved.
  await expect(
    page.getByRole("button", { name: `Remove ${INLINE_PLAYER_NAME}` }),
  ).toBeVisible()
  await expect(page.getByText("No squad recorded")).toHaveCount(0)

  // Now add an existing player through the search. Suggestions arrive ~300ms
  // after typing, so both candidates are awaited rather than clicked blind.
  await search.fill(SEARCH_TOKEN)
  const pickedSuggestion = page.getByRole("button", {
    name: PICKED_PLAYER_NAME,
  })
  await expect(pickedSuggestion).toBeVisible()
  await expect(
    page.getByRole("button", { name: UNPICKED_PLAYER_NAME }),
  ).toBeVisible()
  await pickedSuggestion.click()
  // Waiting for the chip also waits out the save: the editor clears the
  // search box on success, so the next fill cannot be wiped mid-flight.
  await expect(
    page.getByRole("button", { name: `Remove ${PICKED_PLAYER_NAME}` }),
  ).toBeVisible()

  // The same search again: the player now in the squad must drop out of the
  // suggestions while the one still on the bench does not. Waiting for the
  // bench player's button first is what stops this passing vacuously before
  // the debounced search has even run.
  await search.fill(SEARCH_TOKEN)
  await expect(
    page.getByRole("button", { name: UNPICKED_PLAYER_NAME }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: PICKED_PLAYER_NAME }),
  ).toHaveCount(0)
  await search.fill("")

  // Exactly the two players added above, each with its own remove control.
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(2)

  // A team result reaches a player's history only once the quiz is approved,
  // so approve it here rather than asserting on something the page will
  // never show.
  await QuizzesService.approveQuiz({
    id: await findQuizId(EMPTY_SQUAD_QUIZ_NAME),
  })

  // The inline-added player's own page now names the team they turned out
  // for — and an international side is labelled as one.
  const player = await findPlayer(INLINE_PLAYER_NAME)
  expect(player.slug).toBeTruthy()
  await page.goto(`/players/${player.slug}`)
  await expect(
    page.getByText("for Rest of the World (International)"),
  ).toBeVisible()
})
