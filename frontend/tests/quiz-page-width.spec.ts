import { expect, test } from "@playwright/test"
import { OpenAPI, QuizzesService } from "../src/client"

// Quiz results tables carry a column per round, so quiz pages get a wider
// cap than the rest of the site: room for one more ~110px round column.
test.use({ viewport: { width: 1920, height: 1000 } })

async function mainWidth(page: import("@playwright/test").Page) {
  return page.evaluate(() =>
    Math.round(document.querySelector("main")!.getBoundingClientRect().width),
  )
}

test("a quiz page is wider than other pages at max width", async ({ page }) => {
  OpenAPI.BASE = process.env.VITE_API_URL!
  const quizzes = await QuizzesService.readQuizzes({ limit: 1 })
  test.skip(quizzes.data.length === 0, "needs one approved quiz")

  await page.goto("/players")
  await page.locator("main").waitFor()
  expect(await mainWidth(page)).toBe(1280)

  await page.goto(`/quizzes/${quizzes.data[0].slug}`)
  await page.locator("main").waitFor()
  expect(await mainWidth(page)).toBe(1408)

  // The top nav widens with it, so the logo stays aligned with the content.
  const [navLeft, mainLeft] = await page.evaluate(() => [
    Math.round(
      document.querySelector("nav > div")!.getBoundingClientRect().left,
    ),
    Math.round(document.querySelector("main")!.getBoundingClientRect().left),
  ])
  expect(navLeft).toBe(mainLeft)
})
