# Public Homepage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the authenticated-only root `/` with a public homepage showing recent events and quizzers, with a conditional sidebar for logged-in users.

**Architecture:** A new `_home` pathless layout conditionally renders the public nav (guests) or the full sidebar (logged-in users). A new `_home/index.tsx` homepage replaces the old `_layout/index.tsx` dashboard. All other routes and layouts are unchanged.

**Tech Stack:** TanStack Router (file-based routing), TanStack Query (useSuspenseQuery), React, TypeScript, Playwright (E2E)

---

### Task 1: Add homepage test IDs

**Files:**
- Modify: `frontend/src/test-ids.ts`

- [ ] **Step 1: Add four new test IDs**

Full file content of `frontend/src/test-ids.ts` after edit:

```typescript
export const Labels = {
  adminEventsPageHeading: "admin-events-page-heading",
  resultDeleteButton: "result-delete-button",
  uploadModeNew: "upload-mode-new",
  uploadModeExisting: "upload-mode-existing",
  uploadModeToggleNew: "upload-mode-toggle-new",
  uploadModeToggleExisting: "upload-mode-toggle-existing",
  uploadExistingEventSelect: "upload-existing-event-select",
  submitModeToggle: "submit-mode-toggle",
  homeGreeting: "home-greeting",
  homeRecentEvents: "home-recent-events",
  homeRecentQuizzers: "home-recent-quizzers",
  homeAdminLoginLink: "home-admin-login-link",
} as const
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/test-ids.ts
git commit -m "feat: add homepage test IDs"
```

---

### Task 2: Write failing E2E tests for the homepage

**Files:**
- Create: `frontend/tests/homepage.spec.ts`

- [ ] **Step 1: Create the test file**

Create `frontend/tests/homepage.spec.ts`:

```typescript
import { expect, test } from "@playwright/test"
import { Labels } from "../src/test-ids"

test.describe("Homepage (authenticated)", () => {
  test("renders recent events section", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId(Labels.homeRecentEvents)).toBeVisible()
  })

  test("renders recent quizzers section", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId(Labels.homeRecentQuizzers)).toBeVisible()
  })

  test("shows greeting for logged-in user", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId(Labels.homeGreeting)).toBeVisible()
  })

  test("does not show admin login link when authenticated", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId(Labels.homeAdminLoginLink)).not.toBeVisible()
  })

  test("shows sidebar for logged-in user", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId("user-menu")).toBeVisible()
  })
})

test.describe("Homepage (guest)", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("is accessible without login", async ({ page }) => {
    await page.goto("/")
    await expect(page).toHaveURL("/")
  })

  test("renders recent events section", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId(Labels.homeRecentEvents)).toBeVisible()
  })

  test("renders recent quizzers section", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId(Labels.homeRecentQuizzers)).toBeVisible()
  })

  test("shows admin login link", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId(Labels.homeAdminLoginLink)).toBeVisible()
  })

  test("does not show greeting when not logged in", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId(Labels.homeGreeting)).not.toBeVisible()
  })

  test("shows Events nav link", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByRole("link", { name: "Events" })).toBeVisible()
  })

  test("shows Organizations nav link", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByRole("link", { name: "Organizations" })).toBeVisible()
  })

  test("shows Quizzers nav link", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByRole("link", { name: "Quizzers" })).toBeVisible()
  })
})
```

- [ ] **Step 2: Verify tests fail**

Start the backend stack if not running, then:

```bash
cd frontend && bunx playwright test tests/homepage.spec.ts --reporter=list
```

Expected: authenticated tests fail (currently `/` redirects guests to `/login` and shows an old dashboard for logged-in users), guest tests fail because `/` redirects to `/login`. All failures confirm the tests are wired correctly.

- [ ] **Step 3: Commit**

```bash
git add frontend/tests/homepage.spec.ts
git commit -m "test: add failing homepage E2E tests"
```

---

### Task 3: Update logInUser utility

The `logInUser` helper asserts `"Welcome back, nice to see you again!"` from the old dashboard. After the change, login redirects to the new homepage. Update the assertion to verify the sidebar user-menu is visible (confirming the authenticated layout rendered).

**Files:**
- Modify: `frontend/tests/utils/user.ts`

- [ ] **Step 1: Replace the assertion**

In `frontend/tests/utils/user.ts`, update `logInUser`:

```typescript
export async function logInUser(page: Page, email: string, password: string) {
  await page.goto("/login")

  await page.getByTestId("email-input").fill(email)
  await page.getByTestId("password-input").fill(password)
  await page.getByRole("button", { name: "Log In" }).click()
  await page.waitForURL("/")
  await expect(page.getByTestId("user-menu")).toBeVisible()
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/tests/utils/user.ts
git commit -m "test: update logInUser to check for user-menu after homepage rework"
```

---

### Task 4: Create `_home.tsx` layout

This layout wraps the homepage. It mirrors `_layout.tsx` for logged-in users (full sidebar) and `_public.tsx` for guests (public nav). It has no auth guard.

**Files:**
- Create: `frontend/src/routes/_home.tsx`

- [ ] **Step 1: Create the file**

Create `frontend/src/routes/_home.tsx`:

```typescript
import { createFileRoute, Outlet } from "@tanstack/react-router"

import { Footer } from "@/components/Common/Footer"
import { PublicNav } from "@/components/Common/PublicNav"
import AppSidebar from "@/components/Sidebar/AppSidebar"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { isLoggedIn } from "@/hooks/useAuth"

export const Route = createFileRoute("/_home")({
  component: HomeLayout,
})

function HomeLayout() {
  if (isLoggedIn()) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1 text-muted-foreground" />
          </header>
          <main className="flex-1 p-6 md:p-8">
            <div className="mx-auto max-w-7xl">
              <Outlet />
            </div>
          </main>
          <Footer />
        </SidebarInset>
      </SidebarProvider>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      <PublicNav />
      <main className="flex-1 container mx-auto max-w-7xl px-4 py-8">
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/routes/_home.tsx
git commit -m "feat: add _home layout with conditional sidebar/public-nav"
```

---

### Task 5: Create homepage and remove old dashboard

These two changes must be done together: creating the new `_home/index.tsx` and deleting `_layout/index.tsx` both affect the `/` route. Doing one without the other causes a duplicate-route conflict or missing route.

**Files:**
- Create: `frontend/src/routes/_home/index.tsx`
- Delete: `frontend/src/routes/_layout/index.tsx`

- [ ] **Step 1: Create the homepage component**

Create `frontend/src/routes/_home/index.tsx`:

```typescript
import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Suspense } from "react"

import { EventsService, PlayersService } from "@/client"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import useAuth, { isLoggedIn } from "@/hooks/useAuth"
import { Labels } from "@/test-ids"

function getRecentEventsQueryOptions() {
  return {
    queryFn: () => EventsService.readEvents({ skip: 0, limit: 5 }),
    queryKey: ["events", "recent"],
  }
}

function getRecentPlayersQueryOptions() {
  return {
    queryFn: () => PlayersService.listPlayers({ skip: 0, limit: 5 }),
    queryKey: ["players", "recent"],
  }
}

export const Route = createFileRoute("/_home/")({
  component: HomePage,
  head: () => ({ meta: [{ title: "Home" }] }),
})

function RecentEvents() {
  const { data } = useSuspenseQuery(getRecentEventsQueryOptions())

  return (
    <div data-testid={Labels.homeRecentEvents}>
      <h2 className="text-lg font-semibold mb-3">Recent Events</h2>
      {data.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No events yet</p>
      ) : (
        <ul className="space-y-2">
          {data.data.map((event) => (
            <li key={event.id} className="flex items-baseline gap-2">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <Link
                to={"/events/$id" as any}
                params={{ id: event.id }}
                className="text-sm hover:underline"
              >
                {event.name}
              </Link>
              <span className="text-xs text-muted-foreground">
                {event.start_date}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RecentQuizzers() {
  const { data } = useSuspenseQuery(getRecentPlayersQueryOptions())

  return (
    <div data-testid={Labels.homeRecentQuizzers}>
      <h2 className="text-lg font-semibold mb-3">Recent Quizzers</h2>
      {data.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No quizzers yet</p>
      ) : (
        <ul className="space-y-2">
          {data.data.map((player) => {
            const row = (
              <span className="flex items-center gap-2">
                <Avatar className="h-6 w-6">
                  {player.photo_url && <AvatarImage src={player.photo_url} />}
                  <AvatarFallback className="text-xs">
                    {player.display_name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm">{player.display_name}</span>
              </span>
            )

            return (
              <li key={player.id}>
                {player.slug ? (
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  <Link
                    to={"/quizzer/$slug" as any}
                    params={{ slug: player.slug }}
                    className="hover:underline"
                  >
                    {row}
                  </Link>
                ) : (
                  row
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function HomePage() {
  const { user } = useAuth()
  const loggedIn = isLoggedIn()

  return (
    <div className="flex flex-col gap-8">
      {loggedIn && user && (
        <p
          className="text-sm text-muted-foreground"
          data-testid={Labels.homeGreeting}
        >
          Hi, {user.full_name || user.email}
        </p>
      )}
      {!loggedIn && (
        <p className="text-sm text-muted-foreground">
          Quiz competition results, players, and events.
        </p>
      )}

      <nav className="flex gap-6">
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Link to={"/events" as any} className="text-sm font-medium hover:underline">
          Events
        </Link>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Link to={"/organizations" as any} className="text-sm font-medium hover:underline">
          Organizations
        </Link>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Link to={"/quizzers" as any} className="text-sm font-medium hover:underline">
          Quizzers
        </Link>
      </nav>

      <div className="grid gap-8 md:grid-cols-2">
        <Suspense
          fallback={<p className="text-sm text-muted-foreground">Loading…</p>}
        >
          <RecentEvents />
        </Suspense>
        <Suspense
          fallback={<p className="text-sm text-muted-foreground">Loading…</p>}
        >
          <RecentQuizzers />
        </Suspense>
      </div>

      {!loggedIn && (
        <p className="text-xs text-muted-foreground text-center mt-4">
          <Link
            to="/login"
            className="hover:underline"
            data-testid={Labels.homeAdminLoginLink}
          >
            Admin Login
          </Link>
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Delete the old dashboard**

```bash
rm frontend/src/routes/_layout/index.tsx
```

- [ ] **Step 3: Regenerate routeTree.gen.ts**

The TanStack Router Vite plugin regenerates `routeTree.gen.ts` when the dev server starts. Start it briefly:

```bash
cd frontend && timeout 20 bun run dev || true
```

Confirm `frontend/src/routeTree.gen.ts` is updated (check its modification time or diff it — `_home` routes should appear, `_layout/` index should be gone).

- [ ] **Step 4: Verify the TypeScript build passes**

```bash
cd frontend && bun run build
```

Expected: exits 0. If you see type errors about `as any` on `Link` `to` props for routes like `/events` or `/quizzers`, that is expected and the `as any` casts handle it. If you see errors about missing imports or unknown test IDs, fix them before continuing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/routes/_home/index.tsx frontend/src/routeTree.gen.ts
git rm frontend/src/routes/_layout/index.tsx
git commit -m "feat: public homepage at root with recent events and quizzers"
```

---

### Task 6: Run the full test suite

- [ ] **Step 1: Run homepage tests**

```bash
cd frontend && bunx playwright test tests/homepage.spec.ts --reporter=list
```

Expected: all 13 tests pass.

- [ ] **Step 2: Run the full E2E suite**

```bash
cd frontend && bunx playwright test --reporter=list
```

Expected: all tests pass. The existing admin tests that navigate to `/` and use the sidebar (`Review Events sidebar link navigates to /admin/events`) continue to work because logged-in users still see the sidebar on the homepage.

- [ ] **Step 3: Commit any test fixes**

If any existing tests needed small adjustments (e.g., a test that checked for the old "Welcome back" text outside of `logInUser`), fix and commit:

```bash
git add -p
git commit -m "test: fix remaining assertions broken by homepage rework"
```
