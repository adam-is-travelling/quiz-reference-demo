import { expect, test } from "@playwright/test"
import { FormatsService, OpenAPI } from "../src/client"
import { firstSuperuser, firstSuperuserPassword } from "./config.ts"

async function authenticate(): Promise<string> {
  const res = await fetch(
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
  return (await res.json()).access_token
}

// Default Playwright project authenticates as the first superuser.
test.describe("Admin formats — per-round stats flag", () => {
  const runId = Date.now()
  const formatName = `PerRoundStats Format ${runId}`

  test.afterAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()
    const { data } = await FormatsService.readFormats({ limit: 200 })
    for (const f of data) {
      if (f.name === formatName) {
        await FormatsService.deleteFormat({ id: f.id }).catch(() => {})
      }
    }
  })

  test("creating a format with the checkbox shows the per-round-stats badge", async ({
    page,
  }) => {
    await page.goto("/admin/formats")
    await page.getByRole("button", { name: "New Format" }).click()

    await page.getByLabel("Name").fill(formatName)
    await page.getByPlaceholder("Round 1").fill("History")
    await page.getByLabel("Rounds eligible for per-round statistics").check()
    await page.getByRole("button", { name: "Create" }).click()

    const row = page.getByRole("row", { name: new RegExp(formatName) })
    await expect(row.getByText("Per-round stats")).toBeVisible()
  })
})
