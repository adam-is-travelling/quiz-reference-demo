import { expect, type Page, test } from "@playwright/test"
import { OpenAPI, QuizzesService } from "../src/client"
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

const runId = Date.now()
const quizNames: string[] = []

test.beforeAll(async () => {
  OpenAPI.BASE = process.env.VITE_API_URL!
  OpenAPI.TOKEN = await authenticate()
})

test.afterAll(async () => {
  const pending = await QuizzesService.readQuizzes({
    status: "pending",
    limit: 200,
  }).catch(() => null)
  for (const q of pending?.data ?? []) {
    if (quizNames.includes(q.name)) {
      await QuizzesService.deleteQuiz({ id: q.id }).catch(() => {})
    }
  }
})

async function startUpload(page: Page, quizName: string, csv: string) {
  quizNames.push(quizName)
  await page.goto("/upload")
  await page.getByTestId(Labels.uploadModeNew).click()
  await page.getByLabel("Quiz name *").fill(quizName)
  await page.getByRole("button", { name: "Next →" }).click()
  await page.getByLabel("Or paste data directly").fill(csv)
  await page.getByRole("button", { name: "Next →" }).click()
}

async function createdQuizId(quizName: string): Promise<string> {
  const pending = await QuizzesService.readQuizzes({
    status: "pending",
    limit: 200,
  })
  const quiz = pending.data.find((q) => q.name === quizName)
  expect(quiz).toBeDefined()
  return quiz!.id
}

test("an individual upload with no country column flags new players and still submits", async ({
  page,
}) => {
  const quizName = `Countryless Upload ${runId}`
  await startUpload(
    page,
    quizName,
    `Name,Score\nNocountry Alice ${runId},50\nNocountry Bob ${runId},40`,
  )

  await expect(page.getByTestId(Labels.columnMappingCountry)).toContainText(
    "Not mapped",
  )
  await expect(
    page.getByRole("columnheader", { name: "Country" }),
  ).toHaveCount(0)
  await page.getByRole("button", { name: "Next →" }).click()

  await expect(page.getByTestId(Labels.countrylessBanner)).toContainText(
    "2 new players will be created without a country",
  )
  await page.getByRole("button", { name: "Next →" }).click()

  await expect(
    page.getByText("2 new players will be created without a country"),
  ).toBeVisible()
  await page.getByRole("button", { name: "Submit for review" }).click()
  await expect(page.getByText("Results submitted for review.")).toBeVisible()

  const results = await QuizzesService.readQuizResultsWithPlayers({
    id: await createdQuizId(quizName),
  })
  expect(results.data).toHaveLength(2)
  for (const r of results.data) {
    expect(r.participants?.[0]?.country ?? null).toBeNull()
  }
})

test("a venue column is stored per result and shown on the admin results table", async ({
  page,
}) => {
  const quizName = `Venue Upload ${runId}`
  await startUpload(
    page,
    quizName,
    `Name,Country,Venue,Score\nVenue Alice ${runId},Ireland,Leeds,50\nVenue Bob ${runId},England,Oslo,40`,
  )

  await expect(page.getByTestId(Labels.columnMappingVenue)).toContainText(
    "Venue",
  )
  await page.getByRole("button", { name: "Next →" }).click()
  await page.getByRole("button", { name: "Next →" }).click()
  await expect(page.getByRole("columnheader", { name: "Venue" })).toBeVisible()
  await page.getByRole("button", { name: "Submit for review" }).click()
  await expect(page.getByText("Results submitted for review.")).toBeVisible()

  const quizId = await createdQuizId(quizName)
  const results = await QuizzesService.readQuizResultsWithPlayers({
    id: quizId,
  })
  expect(results.data.map((r) => r.venue).sort()).toEqual(["Leeds", "Oslo"])

  await page.goto(`/admin/quizzes/${quizId}`)
  await expect(page.getByRole("columnheader", { name: "Venue" })).toBeVisible()
  await expect(page.getByRole("cell", { name: "Leeds" })).toBeVisible()
})

test("with no venue mapped there is no Venue column anywhere", async ({
  page,
}) => {
  const quizName = `No Venue Upload ${runId}`
  await startUpload(
    page,
    quizName,
    `Name,Country,Score\nNovenue Alice ${runId},Ireland,50`,
  )

  await expect(page.getByTestId(Labels.columnMappingVenue)).toContainText(
    "Not mapped",
  )
  await expect(page.getByRole("columnheader", { name: "Venue" })).toHaveCount(
    0,
  )
  await page.getByRole("button", { name: "Next →" }).click()
  await page.getByRole("button", { name: "Next →" }).click()
  await expect(page.getByRole("columnheader", { name: "Venue" })).toHaveCount(
    0,
  )
  await page.getByRole("button", { name: "Submit for review" }).click()
  await expect(page.getByText("Results submitted for review.")).toBeVisible()

  await page.goto(`/admin/quizzes/${await createdQuizId(quizName)}`)
  await expect(page.getByRole("columnheader", { name: "Rank" })).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "Venue" })).toHaveCount(
    0,
  )
})
