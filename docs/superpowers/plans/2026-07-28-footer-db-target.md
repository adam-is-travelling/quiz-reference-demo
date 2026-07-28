# Admin Footer Database-Target Line Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show superuser users a small muted `Database: <target>` line in the footer stating which database the app is pointed at; non-admin and anonymous users see the footer unchanged.

**Architecture:** Surface the existing `settings.DB_TARGET` via a new `UserMePublic` response model on `GET /users/me` (populated only for superusers), then render it conditionally in the shared `Footer` component.

**Tech Stack:** FastAPI + SQLModel, pytest, React + TanStack Query, Playwright, `@hey-api/openapi-ts`.

## Global Constraints

- `db_target` is populated on the `/users/me` GET response ONLY when the current user is a superuser; `null` otherwise. Access-controlled at the API, not just the UI.
- `UserPublic` and all other user responses are unchanged — the new field lives only on `UserMePublic` (the `/users/me` GET response).
- The response must never leak `hashed_password` — narrow through `UserPublic` before extending.
- Footer line styling is plain muted (`text-muted-foreground text-sm`), no color emphasis.
- No new DB tables or migrations.

---

### Task 1: Backend `UserMePublic` model + `/users/me` route

**Files:**
- Modify: `backend/app/models.py` (add `UserMePublic` after `UserPublic`, ~line 64)
- Modify: `backend/app/api/routes/users.py` (import + change `read_user_me`, line 123)
- Test: `backend/tests/api/routes/test_users.py` (extend the two existing `/me` tests)

**Interfaces:**
- Produces: `UserMePublic(UserPublic)` with `db_target: str | None = None`; `GET /users/me` now returns it.
- Consumes: existing `settings.DB_TARGET` (already imported in `users.py:13`), `UserPublic`, `CurrentUser`.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/api/routes/test_users.py`, extend the two existing `/me` tests. Add to the end of `test_get_users_superuser_me` (after the `email` assertion, ~line 23):

```python
    assert current_user["db_target"] == settings.DB_TARGET
```

Add to the end of `test_get_users_normal_user_me` (after the `email` assertion, ~line 34):

```python
    assert current_user["db_target"] is None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/api/routes/test_users.py -k "me" -v`
Expected: FAIL — `KeyError: 'db_target'` (field not yet in the response).

- [ ] **Step 3: Add the response model**

In `backend/app/models.py`, immediately after the `UserPublic` class (ends at line 63, before `class UsersPublic`), add:

```python
class UserMePublic(UserPublic):
    db_target: str | None = None
```

- [ ] **Step 4: Wire the route**

In `backend/app/api/routes/users.py`, add `UserMePublic` to the `from app.models import (...)` block (alphabetically near `UserPublic`, line 20):

```python
    UserMePublic,
    UserPublic,
```

Then replace the `read_user_me` route (currently lines 123-128):

```python
@router.get("/me", response_model=UserMePublic)
def read_user_me(current_user: CurrentUser) -> Any:
    """
    Get current user.
    """
    user_public = UserPublic.model_validate(current_user)
    return UserMePublic(
        **user_public.model_dump(),
        db_target=settings.DB_TARGET if current_user.is_superuser else None,
    )
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && uv run pytest tests/api/routes/test_users.py -k "me" -v`
Expected: PASS.

- [ ] **Step 6: Run the full users test file (no regressions)**

Run: `cd backend && uv run pytest tests/api/routes/test_users.py -v`
Expected: all pass (the `hashed_password`-narrowing keeps every other `/me` response identical).

- [ ] **Step 7: Commit**

```bash
git add backend/app/models.py backend/app/api/routes/users.py backend/tests/api/routes/test_users.py
git commit -m "feat(backend): expose db_target on /users/me for superusers"
```

---

### Task 2: Frontend footer line + client regen + E2E

**Files:**
- Modify (generated): `frontend/src/client/*` via `scripts/generate-client.sh`
- Modify: `frontend/src/hooks/useAuth.ts` (type the current-user query as `UserMePublic`)
- Modify: `frontend/src/components/Common/Footer.tsx` (conditional db-target line)
- Test: `frontend/tests/footer.spec.ts` (new)

**Interfaces:**
- Consumes: `UserMePublic` type + `db_target` field from the regenerated client (Task 1 endpoint).

- [ ] **Step 1: Regenerate the typed client**

The backend stack must be running with Task 1's change (rebuild first — the stack serves baked images):

Run: `docker compose up -d --build backend`
Then from the project root: `bash ./scripts/generate-client.sh`
Verify: `grep -n "db_target" frontend/src/client/types.gen.ts`
Expected: a `db_target?: string | null` field on the `UserMePublic` type.

- [ ] **Step 2: Write the failing E2E test**

Create `frontend/tests/footer.spec.ts`:

```typescript
import { expect, test } from "@playwright/test"

// The default project storageState authenticates as the first superuser.
test.describe("Footer database target (admin)", () => {
  test("shows the database line for a logged-in superuser", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId("footer-db-target")).toBeVisible()
    await expect(page.getByTestId("footer-db-target")).toContainText(
      /Database:\s*(dev|staging)/,
    )
  })
})

test.describe("Footer database target (anonymous)", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("does not show the database line when logged out", async ({ page }) => {
    await page.goto("/series")
    await page.waitForLoadState("networkidle")
    await expect(page.getByRole("heading", { name: "Series" })).toBeVisible()
    await expect(page.getByTestId("footer-db-target")).toHaveCount(0)
  })
})
```

- [ ] **Step 3: Run the E2E test to verify it fails**

Stop the Docker frontend container first so Playwright's local dev server serves the current source (the container serves a stale baked build):

Run: `docker compose stop frontend`
Run: `cd frontend && bunx playwright test footer.spec.ts`
Expected: FAIL — the superuser test can't find `footer-db-target` (not implemented yet).

- [ ] **Step 4: Type the current-user query as `UserMePublic`**

In `frontend/src/hooks/useAuth.ts`, change the type import (line 7) from `UserPublic` to `UserMePublic`:

```typescript
  type UserMePublic,
  type UserRegister,
```

and the query generic (line 23):

```typescript
  const { data: user } = useQuery<UserMePublic | null, Error>({
```

(`UserMePublic` extends `UserPublic`, so all existing `user.*` accesses still type-check.)

- [ ] **Step 5: Render the db-target line in the footer**

Replace `frontend/src/components/Common/Footer.tsx` with:

```tsx
import { FaGithub, FaLinkedinIn } from "react-icons/fa"
import { FaXTwitter } from "react-icons/fa6"

import useAuth from "@/hooks/useAuth"

const socialLinks = [
  {
    icon: FaGithub,
    href: "https://github.com/fastapi/fastapi",
    label: "GitHub",
  },
  { icon: FaXTwitter, href: "https://x.com/fastapi", label: "X" },
  {
    icon: FaLinkedinIn,
    href: "https://linkedin.com/company/fastapi",
    label: "LinkedIn",
  },
]

export function Footer() {
  const currentYear = new Date().getFullYear()
  const { user } = useAuth()
  const showDbTarget = Boolean(user?.is_superuser && user.db_target)

  return (
    <footer className="border-t py-4 px-6">
      <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
        <div className="flex flex-col items-center gap-1 sm:items-start">
          <p className="text-muted-foreground text-sm">
            Full Stack FastAPI Template - {currentYear}
          </p>
          {showDbTarget && (
            <p
              data-testid="footer-db-target"
              className="text-muted-foreground text-sm"
            >
              Database: {user?.db_target}
            </p>
          )}
        </div>
        <div className="flex items-center gap-4">
          {socialLinks.map(({ icon: Icon, href, label }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={label}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <Icon className="h-5 w-5" />
            </a>
          ))}
        </div>
      </div>
    </footer>
  )
}
```

- [ ] **Step 6: Type-check, lint, run the E2E test**

Run: `cd frontend && bun run build`
Expected: type-check + build succeed.

Run: `cd frontend && bun run lint`
Expected: biome passes.

Run: `cd frontend && bunx playwright test footer.spec.ts`
Expected: PASS (both tests).

- [ ] **Step 7: Restore the Docker frontend container**

Run: `docker compose start frontend`
(So the running stack is back to normal. Optionally `docker compose up -d --build frontend` to bake the new footer into the served image.)

- [ ] **Step 8: Commit**

```bash
git add frontend/src/client frontend/openapi.json frontend/src/hooks/useAuth.ts frontend/src/components/Common/Footer.tsx frontend/tests/footer.spec.ts
git commit -m "feat(frontend): show active database in footer for admin users"
```

---

## Notes for the implementer

- `useAuth()` is safe to call in `Footer` — the footer always renders inside the router/query providers (both `_public.tsx` and `_layout.tsx`). On public pages with no token, the current-user query is disabled (`enabled: isLoggedIn()`), so `user` is undefined and the line is hidden.
- The default Playwright project (`chromium`) uses the superuser `storageState` from `auth.setup.ts`, so the first footer test is authenticated as the superuser without an explicit login. The anonymous test clears `storageState`.
- `db_target` is `dev` or `staging` depending on the running stack's `DB_TARGET`; the E2E asserts on either value.
