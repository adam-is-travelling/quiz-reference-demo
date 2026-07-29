# Format Per-Round-Stats Eligibility Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a boolean `per_round_stats_eligible` (default `false`) to `QuizFormat` — settable in the admin format dialog and shown as a badge — marking whether a format's rounds are eligible for per-round statistics.

**Architecture:** One additive boolean column on `quizformat` (plain boolean + server default, no enum), surfaced through the existing generic CRUD/route and the generated client, then a checkbox in `FormatDialog` and a badge in the admin formats table.

**Tech Stack:** FastAPI + SQLModel, Alembic, pytest, React + react-hook-form + zod, Playwright.

## Global Constraints

- Field name is exactly `per_round_stats_eligible`; default `false` (non-breaking; existing formats backfill to false).
- Plain boolean column with a server default — no native PG enum, no `ALTER TYPE`.
- `UserPublic`-style narrowing not needed; the field belongs on all format responses.
- Only marks eligibility — no per-round statistics computation (out of scope).
- Tests must clean up only rows they create (per the merged non-destructive-cleanup guard).

---

### Task 1: Backend field + migration + tests

**Files:**
- Modify: `backend/app/models.py` (import `Boolean`; add field to `QuizFormatBase`, `QuizFormat`, `QuizFormatUpdate`)
- Create: `backend/app/alembic/versions/c1d2e3f4a5b6_add_per_round_stats_eligible.py`
- Test: `backend/tests/api/routes/test_formats.py`

**Interfaces:**
- Produces: `per_round_stats_eligible: bool` on `QuizFormatCreate`/`QuizFormatPublic` (default false) and `QuizFormatUpdate` (optional).

- [ ] **Step 1: Write the failing tests**

In `backend/tests/api/routes/test_formats.py`:

Add a default assertion at the end of `test_create_format_as_superuser` (after the `"id" in data` assertion):

```python
    assert data["per_round_stats_eligible"] is False
```

Then append two new tests:

```python
def test_create_format_with_per_round_stats(
    client: TestClient, superuser_token_headers: dict
) -> None:
    payload = {
        "name": "Topic Format",
        "rounds": ["History", "Sports"],
        "per_round_stats_eligible": True,
    }
    response = client.post(
        "/api/v1/formats/", json=payload, headers=superuser_token_headers
    )
    assert response.status_code == 200
    assert response.json()["per_round_stats_eligible"] is True


def test_update_format_per_round_stats(
    client: TestClient, db: Session, superuser_token_headers: dict
) -> None:
    fmt = create_random_format(db, num_rounds=2)
    assert fmt.per_round_stats_eligible is False
    response = client.patch(
        f"/api/v1/formats/{fmt.id}",
        json={"per_round_stats_eligible": True},
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    assert response.json()["per_round_stats_eligible"] is True
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/api/routes/test_formats.py -k "per_round_stats or create_format_as_superuser" -v`
Expected: FAIL — `KeyError: 'per_round_stats_eligible'` / attribute missing (field not defined yet).

- [ ] **Step 3: Add the model field**

In `backend/app/models.py`, add `Boolean` to the sqlalchemy import:

```python
from sqlalchemy import Boolean, Column, DateTime, JSON, UniqueConstraint
```

In `QuizFormatBase` (after `rounds`):

```python
    per_round_stats_eligible: bool = False
```

In `QuizFormat` (table model), add the column override (mirroring the `rounds` override) after the `rounds` line:

```python
    per_round_stats_eligible: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, server_default="false"),
    )
```

In `QuizFormatUpdate` (after `rounds`):

```python
    per_round_stats_eligible: bool | None = None
```

`QuizFormatPublic` inherits the field from `QuizFormatBase` — no change.

- [ ] **Step 4: Create the migration**

Create `backend/app/alembic/versions/c1d2e3f4a5b6_add_per_round_stats_eligible.py`:

```python
"""add per_round_stats_eligible to quizformat

Revision ID: c1d2e3f4a5b6
Revises: e7a1b2c3d4f5
Create Date: 2026-07-28 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "c1d2e3f4a5b6"
down_revision = "e7a1b2c3d4f5"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "quizformat",
        sa.Column(
            "per_round_stats_eligible",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade():
    op.drop_column("quizformat", "per_round_stats_eligible")
```

- [ ] **Step 5: Apply the migration**

Run: `cd backend && uv run alembic upgrade head`
Expected: applies `c1d2e3f4a5b6`; no errors.
Verify: `cd backend && uv run alembic current` shows `c1d2e3f4a5b6`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && uv run pytest tests/api/routes/test_formats.py -v`
Expected: PASS (all format tests, including the three new/updated assertions).

- [ ] **Step 7: Run the full backend suite (no regressions)**

Run: `cd backend && uv run pytest`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add backend/app/models.py backend/app/alembic/versions/c1d2e3f4a5b6_add_per_round_stats_eligible.py backend/tests/api/routes/test_formats.py
git commit -m "feat(backend): add per_round_stats_eligible flag to quiz format"
```

---

### Task 2: Frontend checkbox + badge + E2E

**Files:**
- Modify (generated): `frontend/src/client/*` via `scripts/generate-client.sh`
- Modify: `frontend/src/components/Admin/FormatDialog.tsx`
- Modify: `frontend/src/routes/_layout/admin_.formats.tsx`
- Test: `frontend/tests/formats.spec.ts` (new)

**Interfaces:**
- Consumes: `per_round_stats_eligible` on the generated format types (Task 1 endpoint).

- [ ] **Step 1: Regenerate the client**

Backend stack must run with Task 1's change (rebuild — baked image):

Run: `docker compose up -d --build backend`
Run: `bash ./scripts/generate-client.sh`
Verify: `grep -n "per_round_stats_eligible" frontend/src/client/types.gen.ts`
Expected: the field appears on the `QuizFormatPublic`/`QuizFormatCreate` types.

- [ ] **Step 2: Write the failing E2E test**

Create `frontend/tests/formats.spec.ts`:

```typescript
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
    await page
      .getByLabel("Rounds eligible for per-round statistics")
      .check()
    await page.getByRole("button", { name: "Create" }).click()

    const row = page.getByRole("row", { name: new RegExp(formatName) })
    await expect(row.getByText("Per-round stats")).toBeVisible()
  })
})
```

- [ ] **Step 3: Run the E2E to verify it fails**

Stop the Docker frontend so Playwright's dev server serves current source:

Run: `docker compose stop frontend`
Run: `cd frontend && bunx playwright test formats.spec.ts`
Expected: FAIL — the checkbox label and/or badge don't exist yet.

- [ ] **Step 4: Add the checkbox to FormatDialog**

In `frontend/src/components/Admin/FormatDialog.tsx`:

Add `per_round_stats_eligible` to the zod schema (inside `z.object({...})`):

```typescript
  per_round_stats_eligible: z.boolean(),
```

Add it to `defaultValues`:

```typescript
    per_round_stats_eligible: format?.per_round_stats_eligible ?? false,
```

Include it in BOTH mutation payloads (the `updateFormat` and `createFormat` request bodies) alongside `rounds`:

```typescript
            per_round_stats_eligible: data.per_round_stats_eligible,
```

Give the Name field a label association (so the E2E and a11y can target it) — change the Name block:

```tsx
          <div className="grid gap-1.5">
            <Label htmlFor="format-name">Name</Label>
            <Input id="format-name" {...register("name")} />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>
```

Add the checkbox block immediately before the submit `<Button>`:

```tsx
          <div className="flex items-center gap-2">
            <input
              id="per-round-stats"
              type="checkbox"
              className="h-4 w-4 rounded border-input"
              {...register("per_round_stats_eligible")}
            />
            <Label htmlFor="per-round-stats" className="cursor-pointer">
              Rounds eligible for per-round statistics
            </Label>
          </div>
```

- [ ] **Step 5: Add the badge to the formats table**

In `frontend/src/routes/_layout/admin_.formats.tsx`, import `Badge`:

```typescript
import { Badge } from "@/components/ui/badge"
```

In `FormatRow`, replace the Rounds cell (currently the `<td>` rendering `roundCount`) with one that also shows the badge when eligible:

```tsx
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <span>{roundCount === 1 ? "1 round" : `${roundCount} rounds`}</span>
          {format.per_round_stats_eligible && (
            <Badge variant="secondary">Per-round stats</Badge>
          )}
        </div>
      </td>
```

- [ ] **Step 6: Type-check, lint, run the E2E**

Run: `cd frontend && bun run build`
Expected: type-check + build succeed.

Run: `cd frontend && bun run lint`
Expected: biome passes.

Run: `cd frontend && bunx playwright test formats.spec.ts`
Expected: PASS.

- [ ] **Step 7: Restore the Docker frontend container**

Run: `docker compose start frontend`
(Optionally `docker compose up -d --build frontend` to bake the change into the served image.)

- [ ] **Step 8: Commit**

```bash
git add frontend/src/client frontend/src/components/Admin/FormatDialog.tsx frontend/src/routes/_layout/admin_.formats.tsx frontend/tests/formats.spec.ts
git commit -m "feat(frontend): per-round-stats eligibility checkbox and badge for formats"
```

---

## Notes for the implementer

- `frontend/openapi.json` is gitignored; it won't stage (expected).
- The default Playwright `chromium` project is authenticated as the first superuser via `auth.setup.ts`, so `/admin/formats` (superuser-only) loads without an explicit login.
- The E2E cleans up only the format it created (found by its unique run-scoped name), consistent with the non-destructive-cleanup rule.
- `create_random_format` doesn't set the flag, so it defaults to `false` — the update test relies on that.
- Migration head on this branch is `e7a1b2c3d4f5`; the new migration chains from it.
