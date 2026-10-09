import { expect, type Page, test } from "@playwright/test"
import { OpenAPI, UsersService } from "../src/client"
import { firstSuperuser, firstSuperuserPassword } from "./config.ts"
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

const BROWSE = ["Players", "Quizzes", "Organizations", "Competitions", "Events"]

const SUPERUSER_MANAGE = [
  "Admin Dashboard",
  "Upload Results",
  "Review Quizzes",
  "Formats",
  "Competitions",
  "Events",
  "Organizations",
  "Player Merges",
  "Users",
]

async function expectBrowseLinks(page: Page) {
  await expect(page.getByTestId("nav-browse").getByRole("link")).toHaveText(
    BROWSE,
  )
}

async function openManage(page: Page) {
  await page.getByTestId("nav-manage").click()
  return page.getByRole("menu")
}

test.describe("Top navigation (superuser, desktop)", () => {
  test("public and admin pages share the same top nav", async ({ page }) => {
    for (const path of ["/quizzes", "/", "/admin/formats", "/settings"]) {
      await page.goto(path)
      await expect(page.getByTestId("public-nav")).toBeVisible()
      await expectBrowseLinks(page)
      await expect(page.getByTestId("user-menu")).toBeVisible()
    }
  })

  test("Manage menu lists every admin page in order", async ({ page }) => {
    await page.goto("/quizzes")
    const menu = await openManage(page)
    await expect(menu.getByRole("menuitem")).toHaveText(SUPERUSER_MANAGE)
  })

  test("Manage items link to the admin pages, not the public ones", async ({
    page,
  }) => {
    await page.goto("/quizzes")
    const menu = await openManage(page)
    await menu.getByRole("menuitem", { name: "Competitions" }).click()
    await page.waitForURL("/admin/competitions")

    await page
      .getByTestId("nav-browse")
      .getByRole("link", {
        name: "Competitions",
      })
      .click()
    await page.waitForURL("/competitions")
  })

  test("current section is highlighted", async ({ page }) => {
    await page.goto("/players")
    await expect(
      page.getByTestId("nav-browse").getByRole("link", { name: "Players" }),
    ).toHaveAttribute("aria-current", "page")
    await expect(
      page.getByTestId("nav-browse").getByRole("link", { name: "Quizzes" }),
    ).not.toHaveAttribute("aria-current", "page")
  })

  test("logo goes to the home page", async ({ page }) => {
    await page.goto("/admin/formats")
    await page.getByTestId("nav-logo").click()
    await page.waitForURL("/")
  })

  test("there is no sidebar", async ({ page }) => {
    await page.goto("/admin")
    await expect(page.locator("[data-sidebar='sidebar']")).toHaveCount(0)
  })
})

test.describe("Top navigation by role", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  const organizerEmail = randomEmail()
  const organizerPassword = randomPassword()
  const plainEmail = randomEmail()
  const plainPassword = randomPassword()
  let organizerId: string | undefined
  let plainId: string | undefined

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()
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
    if (organizerId) {
      await UsersService.deleteUser({ userId: organizerId }).catch(() => {})
    }
    if (plainId) {
      await UsersService.deleteUser({ userId: plainId }).catch(() => {})
    }
  })

  test("organizer's Manage menu has only dashboard and upload", async ({
    page,
  }) => {
    await logInUser(page, organizerEmail, organizerPassword)
    const menu = await openManage(page)
    await expect(menu.getByRole("menuitem")).toHaveText([
      "Dashboard",
      "Upload Results",
    ])
  })

  test("plain member gets a Dashboard link and no Manage menu", async ({
    page,
  }) => {
    await logInUser(page, plainEmail, plainPassword)
    await page.goto("/quizzes")
    await expect(page.getByTestId("nav-manage")).toHaveCount(0)
    await expect(
      page
        .getByTestId("public-nav")
        .getByRole("link", { name: "Dashboard", exact: true }),
    ).toBeVisible()
  })

  test("guest's logo goes to the home page", async ({ page }) => {
    await page.goto("/players")
    await page.getByTestId("nav-logo").click()
    await page.waitForURL("/")
  })

  test("guest sees the browse links and Log In", async ({ page }) => {
    await page.goto("/quizzes")
    await expectBrowseLinks(page)
    await expect(page.getByTestId("nav-manage")).toHaveCount(0)
    await expect(page.getByTestId("user-menu")).toHaveCount(0)
    await expect(
      page.getByTestId("public-nav").getByRole("link", { name: "Log In" }),
    ).toBeVisible()
  })
})

test.describe("Mobile menu", () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test("desktop links are hidden behind the menu button", async ({ page }) => {
    await page.goto("/quizzes")
    await expect(page.getByTestId("nav-browse")).toBeHidden()
    await expect(page.getByTestId("nav-manage")).toBeHidden()
    await expect(page.getByTestId("mobile-menu-button")).toBeVisible()
  })

  test("menu shows browse, manage and account sections and navigates", async ({
    page,
  }) => {
    await page.goto("/quizzes")
    await page.getByTestId("mobile-menu-button").click()
    const sheet = page.getByRole("dialog")
    await expect(sheet.getByRole("heading", { name: "Browse" })).toBeVisible()
    await expect(sheet.getByRole("heading", { name: "Manage" })).toBeVisible()
    await expect(sheet.getByRole("heading", { name: "Account" })).toBeVisible()

    await sheet.getByRole("link", { name: "Review Quizzes" }).click()
    await page.waitForURL("/admin/quizzes")
    await expect(page.getByRole("dialog")).toHaveCount(0)
  })

  test("public section links in the menu go to public pages", async ({
    page,
  }) => {
    await page.goto("/admin")
    await page.getByTestId("mobile-menu-button").click()
    await page
      .getByTestId("mobile-browse")
      .getByRole("link", { name: "Events" })
      .click()
    await page.waitForURL("/events")
  })
})
