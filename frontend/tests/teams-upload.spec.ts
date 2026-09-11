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
const CLUB_QUIZ_NAME = `Teams Club Quiz ${runId}`

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

// Two players share each of these names, so the matcher finds two candidates
// above the similarity threshold and can settle on neither — the cheapest way
// to put a genuinely unresolved player in a squad. One sits in each team, so
// the cross-team view has something from more than one card to gather up.
const AMBIGUOUS_A = `Ambig Alpha ${runId}`
const AMBIGUOUS_B = `Ambig Beta ${runId}`
const CLUB_TEAM_A = `Rangers ${runId}`
const CLUB_TEAM_B = `Hibernian ${runId}`
const CLUB_CSV = `Team,Players,Score
${CLUB_TEAM_A},"${AMBIGUOUS_A}",100
${CLUB_TEAM_B},"${AMBIGUOUS_B}",90`

const CREATED_PLAYER_NAMES = [
  AMBIGUOUS_A,
  AMBIGUOUS_B,
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
  CLUB_QUIZ_NAME,
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
  // The Country label carries no htmlFor, so it is matched as text rather
  // than via getByLabel.
  const countryLabel = englandDetails.getByText("Country", { exact: true })
  await expect(countryLabel).toBeVisible()

  // Switched to Club, the country control goes away entirely — a club's
  // country is optional and would only offer an "Unknown" to puzzle over.
  // The international checkbox goes too: only a national side can be one.
  const typeSelect = englandDetails.getByRole("combobox").first()
  await typeSelect.click()
  await page.getByRole("option", { name: "Club" }).click()
  await expect(countryLabel).toHaveCount(0)
  await expect(
    englandDetails.getByText("International (no single country)"),
  ).toHaveCount(0)

  // Back to National and the picker returns, so this is a display rule
  // rather than a one-way door.
  await typeSelect.click()
  await page.getByRole("option", { name: "National" }).click()
  await expect(countryLabel).toBeVisible()

  // Each team's own card carries its squad. These four are brand-new names,
  // so nothing needs review and the squads start collapsed behind a summary.
  await expect(
    englandDetails.getByText("2 to create", { exact: true }),
  ).toBeVisible()
  await expect(englandDetails.getByText(`Alice Teams ${runId}`)).toHaveCount(0)
  await englandDetails.getByTestId("team-squad-toggle-England A").click()
  await expect(englandDetails.getByText(`Alice Teams ${runId}`)).toBeVisible()
  await expect(englandDetails.getByText(`Bob Teams ${runId}`)).toBeVisible()
  // Scotland's players belong to Scotland's card, not England's — the whole
  // point of grouping per team.
  await expect(englandDetails.getByText(`Carol Teams ${runId}`)).toHaveCount(0)

  // Nothing needs addressing, so the cross-team view is empty and its tab
  // counts zero.
  await expect(page.getByTestId(Labels.step4ViewNeedsAttention)).toContainText(
    "(0)",
  )
  await page.getByTestId(Labels.step4ViewNeedsAttention).click()
  await expect(page.getByTestId("team-details-England A")).toHaveCount(0)
  await expect(page.getByText("Nothing needs addressing.")).toBeVisible()
  await page.getByTestId(Labels.step4ViewByTeam).click()
  await expect(page.getByTestId("team-details-England A")).toBeVisible()

  await expect(page.getByRole("button", { name: "Next →" })).toBeEnabled()
  await page.getByRole("button", { name: "Next →" }).click() // Step4 -> Step5

  // Four brand-new squad members across two rows, and nothing to correct.
  await expect(page.getByText("4 new players will be created.")).toBeVisible()
  await expect(page.getByTestId(Labels.uploadValidationErrors)).toHaveCount(0)
  await page.getByRole("button", { name: "Submit for review" }).click()
  await expect(page.getByText("Results submitted for review.")).toBeVisible()

  await page.goto(`/quizzes/${await findQuizId(COMBINED_QUIZ_NAME)}`)
  const englandRow = page.getByRole("row").filter({ hasText: "England A" })

  // The squad is collapsed: the row names the team and how many turned out,
  // not who they were. Asserting the absence first is what proves the
  // collapse, since the names being present would also satisfy the panel
  // assertions further down.
  await expect(englandRow.getByText(`Alice Teams ${runId}`)).toHaveCount(0)
  await expect(
    englandRow.getByRole("button", { name: "2 players" }),
  ).toBeVisible()

  // "England A" carries its country in its name, so the affiliation line
  // reads England rather than International — end-to-end proof that the
  // upload inferred it. (The International rendering is covered by "Rest of
  // the World" in the empty-squad test, whose name infers nothing.)
  await expect(englandRow.getByText("England", { exact: true })).toBeVisible()

  // Clicking through reveals the squad. This run is authenticated as the
  // superuser, so the panel holds the editor and the names are its removable
  // chips; a signed-out visitor gets the same names as player links instead.
  await englandRow.getByRole("button", { name: "2 players" }).click()
  const englandPanel = page.getByRole("dialog")
  await expect(englandPanel.getByText(`Alice Teams ${runId}`)).toBeVisible()
  await expect(englandPanel.getByText(`Bob Teams ${runId}`)).toBeVisible()
  await page.keyboard.press("Escape")

  // An admin gets an explicit way in as well as the count: collapsing the
  // editor behind "2 players" otherwise makes it look like nothing here is
  // editable. A signed-out visitor sees only the count.
  await expect(
    englandRow.getByRole("button", { name: "Edit team" }),
  ).toBeVisible()
  await englandRow.getByRole("button", { name: "Edit team" }).click()
  await expect(
    page.getByRole("dialog").getByLabel("Add a player"),
  ).toBeVisible()
  await page.keyboard.press("Escape")

  const scotlandRow = page.getByRole("row").filter({ hasText: "Scotland" })
  await scotlandRow.getByRole("button", { name: "2 players" }).click()
  const scotlandPanel = page.getByRole("dialog")
  await expect(scotlandPanel.getByText(`Carol Teams ${runId}`)).toBeVisible()
  await expect(scotlandPanel.getByText(`Dave Teams ${runId}`)).toBeVisible()
  await page.keyboard.press("Escape")
})

test("a team quiz is editable from the admin quizzes page", async ({
  page,
}) => {
  const quizId = await findQuizId(COMBINED_QUIZ_NAME)
  await page.goto(`/admin/quizzes/${quizId}`)

  // The admin table used to render a team quiz as bare player names, with
  // nothing saying which team they played for.
  const englandRow = page.getByRole("row").filter({ hasText: "England A" })
  await expect(englandRow).toBeVisible()

  // Two edits live in this row and they say which is which.
  await expect(
    englandRow.getByRole("button", { name: "Edit score" }),
  ).toBeVisible()
  await englandRow.getByRole("button", { name: "Edit team" }).click()

  // Renaming through the panel must refresh the row underneath it. The admin
  // page keys its results query differently from the public page, so this is
  // what proves the panel invalidates the key its host actually reads.
  const renamed = `England B ${runId}`
  const nameField = page.getByRole("dialog").getByLabel("Team name")
  await nameField.fill(renamed)
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save team" })
    .click()
  await expect(page.getByText("Team updated")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("row").filter({ hasText: renamed })).toBeVisible()
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
  await walesRow.getByRole("button", { name: "2 players" }).click()
  const walesPanel = page.getByRole("dialog")
  await expect(walesPanel.getByText(`Erin Teams ${runId}`)).toBeVisible()
  await expect(walesPanel.getByText(`Frank Teams ${runId}`)).toBeVisible()
  await page.keyboard.press("Escape")
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
  // through. The squad-layout toggle is Step 3's own control, so waiting on
  // its test id keeps this click off Step 2's identically-named button —
  // and, unlike the prose, it does not move when the copy is reworded.
  await expect(page.getByTestId(Labels.lineupLayoutCombined)).toBeVisible()
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

  // An admin gets a way in even at zero players — filling a squad the upload
  // never listed is the whole reason this state exists. A visitor would see
  // plain "No squad recorded" here instead.
  const openSquad = page.getByRole("button", { name: "Add squad" })
  await expect(openSquad).toBeVisible()
  await openSquad.click()
  await expect(page.getByRole("dialog")).toBeVisible()

  // Add a brand-new squad member as the superuser. The "Create …" button is
  // not debounced — it tracks the input directly — so it only needs
  // Playwright's ordinary auto-waiting.
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

  // Now add an existing player through the search. Suggestions arrive ~300ms
  // after typing, so both candidates are awaited rather than clicked blind.
  //
  // Every suggestion locator here is `exact`. A suggestion button's
  // accessible name is exactly the display name, but `name` matches by
  // case-insensitive substring by default, which would also match the
  // `Create "…"` button and — once a player is in the squad — their chip's
  // `Remove <name>` control. The negative assertion below depends on the
  // difference: it must see zero suggestions, not the remove control.
  await search.fill(SEARCH_TOKEN)
  const pickedSuggestion = page.getByRole("button", {
    name: PICKED_PLAYER_NAME,
    exact: true,
  })
  await expect(pickedSuggestion).toBeVisible()
  await expect(
    page.getByRole("button", { name: UNPICKED_PLAYER_NAME, exact: true }),
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
    page.getByRole("button", { name: UNPICKED_PLAYER_NAME, exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: PICKED_PLAYER_NAME, exact: true }),
  ).toHaveCount(0)
  await search.fill("")

  // Exactly the two players added above, each with its own remove control.
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(2)

  // Closing the panel, the collapsed trigger now counts what was saved —
  // proving the row reflects the squad rather than a stale render.
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "2 players" })).toBeVisible()

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

test("a club quiz drops the per-team type picker and gathers what needs addressing", async ({
  page,
}) => {
  // Two players per name, so neither name can be auto-resolved.
  for (const name of [AMBIGUOUS_A, AMBIGUOUS_A, AMBIGUOUS_B, AMBIGUOUS_B]) {
    await PlayersService.createPlayerRoute({
      requestBody: { display_name: name },
    })
  }

  await page.goto("/upload")
  await page.getByTestId(Labels.uploadModeNew).click()
  await page.getByTestId(Labels.uploadParticipantModeTeams).click()
  await page.getByTestId(Labels.uploadDefaultTeamTypeClub).click()

  await page.getByLabel("Quiz name *").fill(CLUB_QUIZ_NAME)
  await page.getByRole("button", { name: "Next →" }).click() // Step1 -> Step2
  await page.getByLabel("Or paste data directly").fill(CLUB_CSV)
  await page.getByRole("button", { name: "Next →" }).click() // Step2 -> Step3
  await page.getByRole("button", { name: "Next →" }).click() // Step3 -> Step4

  // Every team in a club quiz is a club, so there is no type to pick. The
  // country and international controls are national-only and already absent,
  // which leaves the card with no dropdown of any kind.
  const rangers = page.getByTestId(`team-details-${CLUB_TEAM_A}`)
  await expect(rangers).toBeVisible()
  await expect(rangers.getByRole("combobox")).toHaveCount(0)
  await expect(rangers.getByText("National", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("option", { name: "National" })).toHaveCount(0)

  // One unresolved player in each of the two teams.
  await expect(page.getByTestId(Labels.step4ViewNeedsAttention)).toContainText(
    "(2)",
  )

  // The cross-team view gathers both, out of their separate cards, each still
  // labelled with the team it came from.
  await page.getByTestId(Labels.step4ViewNeedsAttention).click()
  await expect(page.getByTestId(`team-details-${CLUB_TEAM_A}`)).toHaveCount(0)
  const attention = page.getByTestId(Labels.step4NeedsAttentionList)
  await expect(attention.getByText(AMBIGUOUS_A).first()).toBeVisible()
  await expect(attention.getByText(AMBIGUOUS_B).first()).toBeVisible()
  await expect(attention.getByText(CLUB_TEAM_A)).toBeVisible()
  await expect(attention.getByText(CLUB_TEAM_B)).toBeVisible()

  // Next is blocked until both are decided, and the tab count tracks what is
  // left rather than the size of the list.
  await expect(page.getByRole("button", { name: "Next →" })).toBeDisabled()
  await attention.getByLabel("Create new player").first().check()
  await expect(page.getByTestId(Labels.step4ViewNeedsAttention)).toContainText(
    "(1)",
  )

  // Deciding one does not drop it out of the list underfoot.
  await expect(attention.getByText(AMBIGUOUS_A).first()).toBeVisible()

  await attention.getByLabel("Create new player").last().check()
  await expect(page.getByTestId(Labels.step4ViewNeedsAttention)).toContainText(
    "(0)",
  )

  // Back on the per-team view both cards now report themselves settled.
  await page.getByTestId(Labels.step4ViewByTeam).click()
  await expect(rangers).toContainText("1 confirmed")
  await expect(page.getByRole("button", { name: "Next →" })).toBeEnabled()
})
