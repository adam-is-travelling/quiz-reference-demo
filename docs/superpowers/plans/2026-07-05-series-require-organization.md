# Series Require Organization + Org-Scoped Upload Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every quiz series belong to an organization (backend + migration), and rework the upload wizard's Series dropdown: beside the Organization dropdown, visible only when the selected org has series, scoped to that org, with a white "None" option.

**Architecture:** Backend-first: tighten `QuizSeries` model + Alembic migration (NOT NULL, FK `CASCADE`), validate org existence in routes, then regenerate the OpenAPI client, then update the two frontend consumers (`SeriesDialog`, `Step1EventMeta`). Series scoping in the wizard is client-side filtering on `organization_id` (already present on `QuizSeriesPublic`).

**Tech Stack:** FastAPI + SQLModel + Alembic + pytest (backend); React + TanStack Query + react-hook-form + Zod + shadcn/ui + Playwright (frontend); `@hey-api/openapi-ts` client generation.

**Spec:** `docs/superpowers/specs/2026-07-05-upload-series-dropdown-design.md`

## Global Constraints

- Branch: work happens on `organization-series-on-upload` (already checked out).
- Deleting an organization deletes its series (`ondelete="CASCADE"`); quizzes keep existing with `series_id` cleared (that FK is already `SET NULL`).
- A PATCH with explicit `organization_id: null` must NOT unset the org — it is treated as "no change".
- Org-existence failures return 404 with detail `"Organization not found"`.
- The wizard's "None" item uses sentinel value `"__none__"` (same convention as the existing org/format selects in `Step1EventMeta.tsx`).
- Backend tests/alembic run from the host: `.env` has `POSTGRES_SERVER=localhost` and the `db` service publishes `5432`, so `cd backend && uv run pytest ...` works while `docker compose up -d db` is running.
- The backend Docker image does NOT bind-mount source. After backend code changes, refresh the running container with `docker compose up -d --build backend` (needed before Playwright tasks).
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Backend — organization required on series

**Files:**
- Modify: `backend/tests/utils/quiz.py:40-48`
- Modify: `backend/tests/api/routes/test_series.py`
- Modify: `backend/app/models.py:165-195`
- Modify: `backend/app/crud.py:123-130`
- Modify: `backend/app/api/routes/series.py`
- Create: `backend/app/alembic/versions/c9d4e5f6a7b8_series_require_organization.py`

**Interfaces:**
- Consumes: existing `Organization`, `QuizSeries` models; `crud.create_series`; test fixtures `client`, `db`, `superuser_token_headers`, `organizer_token_headers`.
- Produces: `QuizSeriesCreate.organization_id: uuid.UUID` (required); `QuizSeries.organization_id: uuid.UUID` (NOT NULL, FK CASCADE); `QuizSeriesPublic.organization_id: uuid.UUID` (non-null). Task 2 regenerates the client from this schema.

- [ ] **Step 1: Ensure environment**

```bash
docker compose up -d db
cd backend && uv sync
```

- [ ] **Step 2: Update the test factory so series always get an org**

In `backend/tests/utils/quiz.py`, replace `create_random_series`:

```python
def create_random_series(
    db: Session, organization_id: uuid.UUID | None = None
) -> QuizSeries:
    if organization_id is None:
        organization_id = create_random_organization(db).id
    return crud.create_series(
        session=db,
        series_in=QuizSeriesCreate(
            name=random_lower_string(), organization_id=organization_id
        ),
    )
```

- [ ] **Step 3: Update existing tests to the new contract**

In `backend/tests/api/routes/test_series.py`:

Replace `test_create_series_as_superuser` (org is now required, response echoes it):

```python
def test_create_series_as_superuser(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    org = create_random_organization(db)
    data = {"name": "World Quizzing Championships", "organization_id": str(org.id)}
    response = client.post(
        f"{settings.API_V1_STR}/series/",
        headers=superuser_token_headers,
        json=data,
    )
    assert response.status_code == 200
    content = response.json()
    assert content["name"] == "World Quizzing Championships"
    assert content["organization_id"] == str(org.id)
```

Replace `test_create_series_forbidden_for_organizer` (body must be schema-valid or FastAPI returns 422 before the 403 check runs; a random UUID is fine because the permission check comes first):

```python
def test_create_series_forbidden_for_organizer(
    client: TestClient, organizer_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/series/",
        headers=organizer_token_headers,
        json={"name": "Should Fail", "organization_id": str(uuid.uuid4())},
    )
    assert response.status_code == 403
```

- [ ] **Step 4: Add new failing tests**

Append to `backend/tests/api/routes/test_series.py`:

```python
def test_create_series_without_organization_fails(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/series/",
        headers=superuser_token_headers,
        json={"name": "No Org Series"},
    )
    assert response.status_code == 422


def test_create_series_with_missing_organization_returns_404(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/series/",
        headers=superuser_token_headers,
        json={"name": "Ghost Org Series", "organization_id": str(uuid.uuid4())},
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Organization not found"


def test_update_series_with_null_organization_keeps_org(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    org = create_random_organization(db)
    series = create_random_series(db, organization_id=org.id)
    response = client.patch(
        f"{settings.API_V1_STR}/series/{series.id}",
        headers=superuser_token_headers,
        json={"organization_id": None},
    )
    assert response.status_code == 200
    assert response.json()["organization_id"] == str(org.id)


def test_update_series_with_missing_organization_returns_404(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    series = create_random_series(db)
    response = client.patch(
        f"{settings.API_V1_STR}/series/{series.id}",
        headers=superuser_token_headers,
        json={"organization_id": str(uuid.uuid4())},
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Organization not found"


def test_delete_organization_cascades_to_series(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    org = create_random_organization(db)
    series = create_random_series(db, organization_id=org.id)
    series_id = series.id
    response = client.delete(
        f"{settings.API_V1_STR}/organizations/{org.id}",
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    db.expire_all()
    assert db.get(QuizSeries, series_id) is None
```

- [ ] **Step 5: Run the series tests to verify failures**

```bash
cd backend && uv run pytest tests/api/routes/test_series.py -v
```

Expected: FAILURES — at minimum `test_create_series_without_organization_fails` (currently returns 200), `test_create_series_with_missing_organization_returns_404` (currently a 500/IntegrityError), and `test_delete_organization_cascades_to_series` (series survives org deletion today).

- [ ] **Step 6: Update the models**

In `backend/app/models.py` (lines 165-195), change the three series classes (leave `QuizSeriesBase`, `QuizSeriesUpdate`, and `QuizSeriesListPublic` as they are):

```python
class QuizSeriesCreate(QuizSeriesBase):
    organization_id: uuid.UUID


class QuizSeries(QuizSeriesBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    organization_id: uuid.UUID = Field(
        foreign_key="organization.id", ondelete="CASCADE"
    )


class QuizSeriesPublic(QuizSeriesBase):
    id: uuid.UUID
    organization_id: uuid.UUID
    organization_name: str | None = None
```

- [ ] **Step 7: Ignore explicit null org in updates**

In `backend/app/crud.py`, replace `update_series`:

```python
def update_series(
    *, session: Session, db_series: QuizSeries, series_in: QuizSeriesUpdate
) -> QuizSeries:
    update_data = series_in.model_dump(exclude_unset=True)
    if update_data.get("organization_id") is None:
        update_data.pop("organization_id", None)
    db_series.sqlmodel_update(update_data)
    session.add(db_series)
    session.commit()
    session.refresh(db_series)
    return db_series
```

- [ ] **Step 8: Validate the organization in the routes**

In `backend/app/api/routes/series.py`:

Simplify `_series_public` (org id can no longer be null):

```python
def _series_public(series: QuizSeries, session: Session) -> QuizSeriesPublic:
    org = session.get(Organization, series.organization_id)
    return QuizSeriesPublic(
        **series.model_dump(),
        organization_name=org.name if org else None,
    )
```

In `create_series`, after the superuser check and before `crud.create_series`:

```python
    if not session.get(Organization, series_in.organization_id):
        raise HTTPException(status_code=404, detail="Organization not found")
```

In `update_series`, after the `Series not found` check and before `crud.update_series`:

```python
    if series_in.organization_id is not None and not session.get(
        Organization, series_in.organization_id
    ):
        raise HTTPException(status_code=404, detail="Organization not found")
```

- [ ] **Step 9: Write the migration**

Create `backend/app/alembic/versions/c9d4e5f6a7b8_series_require_organization.py`:

```python
"""series_require_organization

Revision ID: c9d4e5f6a7b8
Revises: a1b2c3d4e5f6
Create Date: 2026-07-05

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c9d4e5f6a7b8'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    # Organization is now required: remove orphaned series first.
    # Quizzes pointing at them are safe — quiz.series_id FK is ON DELETE SET NULL.
    conn.execute(sa.text("DELETE FROM quizseries WHERE organization_id IS NULL"))
    op.alter_column(
        'quizseries', 'organization_id', existing_type=sa.Uuid(), nullable=False
    )
    op.drop_constraint(
        'quizseries_organization_id_fkey', 'quizseries', type_='foreignkey'
    )
    op.create_foreign_key(
        None,
        'quizseries',
        'organization',
        ['organization_id'],
        ['id'],
        ondelete='CASCADE',
    )


def downgrade() -> None:
    op.drop_constraint(
        'quizseries_organization_id_fkey', 'quizseries', type_='foreignkey'
    )
    op.create_foreign_key(
        'quizseries_organization_id_fkey',
        'quizseries',
        'organization',
        ['organization_id'],
        ['id'],
        ondelete='SET NULL',
    )
    op.alter_column(
        'quizseries', 'organization_id', existing_type=sa.Uuid(), nullable=True
    )
```

(`create_foreign_key(None, ...)` lets Postgres assign the default name `quizseries_organization_id_fkey`, which is what `downgrade` drops.)

- [ ] **Step 10: Apply the migration**

```bash
cd backend && uv run alembic upgrade head && uv run alembic current
```

Expected: `Running upgrade a1b2c3d4e5f6 -> c9d4e5f6a7b8` and `current` prints `c9d4e5f6a7b8 (head)`.

- [ ] **Step 11: Run the series tests to verify they pass**

```bash
cd backend && uv run pytest tests/api/routes/test_series.py -v
```

Expected: all PASS.

- [ ] **Step 12: Run the full backend suite**

```bash
cd backend && bash scripts/test.sh
```

Expected: all PASS (catches other tests that create series, e.g. quiz tests).

- [ ] **Step 13: Rebuild the running backend container**

The image does not bind-mount source; the Playwright tasks later need the new backend live:

```bash
docker compose up -d --build backend
```

Expected: prestart runs migrations cleanly (already applied — no-op) and backend starts. Verify: `curl -sf http://localhost:8000/api/v1/utils/health-check/` prints `true`.

- [ ] **Step 14: Commit**

```bash
git add backend/app/models.py backend/app/crud.py backend/app/api/routes/series.py backend/app/alembic/versions/c9d4e5f6a7b8_series_require_organization.py backend/tests/utils/quiz.py backend/tests/api/routes/test_series.py
git commit -m "feat(backend): require organization on quiz series, cascade on org delete

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Regenerate the frontend OpenAPI client

**Files:**
- Modify (generated): `frontend/openapi.json`, `frontend/src/client/types.gen.ts`, `frontend/src/client/schemas.gen.ts`

**Interfaces:**
- Consumes: Task 1's backend schema.
- Produces: `QuizSeriesCreate = { name: string; description?: string | null; organization_id: string }` and `QuizSeriesPublic.organization_id: string` (required) in `frontend/src/client/types.gen.ts`. Tasks 3-4 rely on these types.

- [ ] **Step 1: Regenerate**

From the project root:

```bash
bash ./scripts/generate-client.sh
```

Expected: exits 0 (script exports OpenAPI from the local package via uv, regenerates `frontend/src/client/`, runs lint).

- [ ] **Step 2: Verify the generated types**

```bash
grep -A 5 "QuizSeriesCreate = {" frontend/src/client/types.gen.ts
```

Expected: `organization_id: string;` with no `?` and no `| null`.

- [ ] **Step 3: Type-check the frontend (expected failure — documents Task 3's work)**

```bash
cd frontend && bun run build
```

Expected: FAILS in `SeriesDialog.tsx` (it passes `organization_id: string | null` to `createSeries`/`updateSeries`). If it fails anywhere else, note it for the relevant task. Do not fix here.

- [ ] **Step 4: Commit**

```bash
git add frontend/openapi.json frontend/src/client/
git commit -m "chore(client): regenerate OpenAPI client for required series organization

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: SeriesDialog requires an organization (+ E2E spec updates)

**Files:**
- Modify: `frontend/src/components/Admin/SeriesDialog.tsx`
- Modify: `frontend/tests/series-admin.spec.ts`
- Modify: `frontend/tests/series-public.spec.ts`

**Interfaces:**
- Consumes: Task 2's `QuizSeriesCreate` (required `organization_id: string`); `OrganizationsService.createOrganization` / `deleteOrganization` from `@/client`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Update the admin E2E spec (failing test first)**

In `frontend/tests/series-admin.spec.ts`, the "create, edit, and delete a series" test must select an organization. Replace the whole file's first `test.describe` block with:

```typescript
import { expect, test } from "@playwright/test"
import { OpenAPI, OrganizationsService } from "../src/client"
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

test.describe("Admin Series page", () => {
  let orgId: string
  let orgName: string

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()
    orgName = `E2E Series Org ${Date.now()}`
    const org = await OrganizationsService.createOrganization({
      requestBody: { name: orgName },
    })
    orgId = org.id
  })

  test.afterAll(async () => {
    if (orgId) {
      await OrganizationsService.deleteOrganization({ id: orgId })
    }
  })

  test("is accessible and shows correct heading", async ({ page }) => {
    await page.goto("/admin/series")
    await expect(page.getByRole("heading", { name: "Series" })).toBeVisible()
    await expect(
      page.getByText("Manage quiz series and tournaments."),
    ).toBeVisible()
  })

  test("Series link appears in admin sidebar", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByRole("link", { name: "Series" })).toBeVisible()
  })

  test("New Series button is visible", async ({ page }) => {
    await page.goto("/admin/series")
    await expect(page.getByRole("button", { name: "New Series" })).toBeVisible()
  })

  test("create without organization shows validation error", async ({
    page,
  }) => {
    await page.goto("/admin/series")
    await page.getByRole("button", { name: "New Series" }).click()
    await page.locator('input[name="name"]').fill("Missing Org Series")
    await page.getByRole("button", { name: "Create" }).click()
    await expect(page.getByText("Organization is required")).toBeVisible()
  })

  test("create, edit, and delete a series", async ({ page }) => {
    await page.goto("/admin/series")

    const seriesName = `Test Series ${Date.now()}`
    const updatedName = `Updated ${seriesName}`

    // Create
    await page.getByRole("button", { name: "New Series" }).click()
    await page.locator('input[name="name"]').fill(seriesName)
    await page.locator('select[name="organization_id"]').selectOption(orgId)
    await page.getByRole("button", { name: "Create" }).click()
    await expect(page.getByText("Series created")).toBeVisible()
    const row = page.getByRole("row").filter({ hasText: seriesName })
    await expect(row).toBeVisible()

    // Edit
    await row.getByRole("button").first().click()
    await page.locator('input[name="name"]').fill(updatedName)
    await page.getByRole("button", { name: "Save" }).click()
    await expect(page.getByText("Series updated")).toBeVisible()
    const updatedRow = page.getByRole("row").filter({ hasText: updatedName })
    await expect(updatedRow).toBeVisible()

    // Delete
    await updatedRow.getByRole("button").last().click()
    await page.getByRole("button", { name: "Delete" }).click()
    await expect(page.getByText("Series deleted")).toBeVisible()
    await expect(
      page.getByRole("row").filter({ hasText: updatedName }),
    ).not.toBeVisible()
  })
})

test.describe("Admin Series access control", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("unauthenticated user is redirected away from /admin/series", async ({
    page,
  }) => {
    await page.goto("/admin/series")
    await expect(page).not.toHaveURL(/\/admin\/series/)
  })
})
```

- [ ] **Step 2: Update the public E2E spec's series setup**

In `frontend/tests/series-public.spec.ts`, the `beforeAll` creates a series without an org (now a 422). Update imports and setup/teardown:

```typescript
import { OpenAPI, OrganizationsService, SeriesService } from "../src/client"
```

Replace the `beforeAll`/`afterAll`:

```typescript
  let orgId: string

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()

    const org = await OrganizationsService.createOrganization({
      requestBody: { name: `E2E Series Org ${Date.now()}` },
    })
    orgId = org.id

    seriesName = `E2E Test Series ${Date.now()}`
    const created = await SeriesService.createSeries({
      requestBody: { name: seriesName, organization_id: orgId },
    })
    seriesId = created.id
  })

  test.afterAll(async () => {
    if (seriesId) {
      await SeriesService.deleteSeries({ id: seriesId })
    }
    if (orgId) {
      await OrganizationsService.deleteOrganization({ id: orgId })
    }
  })
```

- [ ] **Step 3: Run the two specs to verify failures**

Backend stack must be running (Task 1 Step 13). Playwright starts the Vite dev server itself.

```bash
cd frontend && bunx playwright test tests/series-admin.spec.ts tests/series-public.spec.ts
```

Expected: FAIL — "create without organization shows validation error" (no such message yet) and the TypeScript error in `SeriesDialog.tsx` from Task 2 may abort the run entirely. Both are resolved by Step 4.

- [ ] **Step 4: Make organization required in SeriesDialog**

In `frontend/src/components/Admin/SeriesDialog.tsx`:

Schema (line 20-24):

```typescript
const schema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  organization_id: z.string().min(1, "Organization is required"),
})
```

Mutation (lines 61-81) — `organization_id` is now always a non-empty string; pass it straight through:

```typescript
  const mutation = useMutation({
    mutationFn: (data: FormValues) => {
      if (isEdit) {
        return SeriesService.updateSeries({
          id: series.id,
          requestBody: {
            name: data.name,
            description: data.description || null,
            organization_id: data.organization_id,
          },
        })
      }
      return SeriesService.createSeries({
        requestBody: {
          name: data.name,
          description: data.description || null,
          organization_id: data.organization_id,
        },
      })
    },
```

Organization field (lines 126-139) — replace the `None` option with a disabled placeholder and render the validation error:

```tsx
          <div className="grid gap-1.5">
            <Label>Organization</Label>
            <select
              {...register("organization_id")}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="" disabled>
                — choose an organization —
              </option>
              {orgs?.data.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
            {errors.organization_id && (
              <p className="text-sm text-destructive">
                {errors.organization_id.message}
              </p>
            )}
          </div>
```

- [ ] **Step 5: Type-check and run the specs to verify they pass**

```bash
cd frontend && bun run build && bunx playwright test tests/series-admin.spec.ts tests/series-public.spec.ts
```

Expected: build succeeds (Task 4 hasn't broken anything yet — `Step1EventMeta.tsx` compiles unchanged) and all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Admin/SeriesDialog.tsx frontend/tests/series-admin.spec.ts frontend/tests/series-public.spec.ts
git commit -m "feat(admin): require organization when creating or editing a series

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Upload wizard — org-scoped Series dropdown

**Files:**
- Modify: `frontend/src/components/Upload/steps/Step1EventMeta.tsx:117-313`

**Interfaces:**
- Consumes: `QuizSeriesPublic.organization_id: string` (Task 2); existing `WizardState.eventMeta.series_id: string` from `frontend/src/components/Upload/types.ts` (unchanged).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add controlled series state**

In `Step1EventMeta.tsx`, after the `selectedFormatId` state (line 123-125), add:

```typescript
  const [selectedSeriesId, setSelectedSeriesId] = useState<string>(
    state.eventMeta.series_id || "__none__",
  )
```

And after the state declarations, derive the org-scoped series list:

```typescript
  const orgSeries =
    selectedOrgId !== "__none__"
      ? (seriesList?.data.filter((s) => s.organization_id === selectedOrgId) ??
        [])
      : []
```

- [ ] **Step 2: Replace the Series and Organization blocks with one row**

Delete the current Series block (lines 246-260) and the current Organization block (lines 262-290). In the Organization block's place, insert a single flex row (same pattern as the multi-day date pair). Organization keeps its exact current `onValueChange` logic plus the series reset:

```tsx
          <div className="flex gap-3">
            <div className="grid flex-1 gap-1.5">
              <Label>Organization</Label>
              <Select
                value={selectedOrgId}
                onValueChange={(v) => {
                  setSelectedOrgId(v)
                  setSelectedSeriesId("__none__")
                  setValue("series_id", "")
                  if (v === "__none__") {
                    setValue("organization_id", "")
                    setValue("organizer_name", null)
                  } else {
                    const org = orgs?.data.find((o) => o.id === v)
                    setValue("organization_id", v)
                    setValue("organizer_name", org?.name ?? null)
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No Organization</SelectItem>
                  {orgs?.data.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {orgSeries.length > 0 && (
              <div className="grid flex-1 gap-1.5">
                <Label>Series (optional)</Label>
                <Select
                  value={selectedSeriesId}
                  onValueChange={(v) => {
                    setSelectedSeriesId(v)
                    setValue("series_id", v === "__none__" ? "" : v)
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {orgSeries.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
```

Notes for the implementer:
- `orgSeries.length > 0` already implies an org is selected (`orgSeries` is `[]` when `selectedOrgId === "__none__"`), satisfying both visibility conditions.
- "None" renders white because it is a real selected `SelectItem` value, not a `placeholder` (placeholders render `text-muted-foreground`).
- Returning to this step restores both selects: org from `state.eventMeta.organization_id` (existing behavior), series from the new `selectedSeriesId` initializer.

- [ ] **Step 3: Type-check and lint**

```bash
cd frontend && bun run build && bun run lint
```

Expected: both exit 0.

- [ ] **Step 4: Run the upload E2E spec for regressions**

```bash
cd frontend && bunx playwright test tests/upload.spec.ts
```

Expected: PASS (the spec doesn't interact with series/organization, so this is a regression check on the form layout change).

- [ ] **Step 5: Verify visually**

With the stack running, log in at http://localhost:5173 as the superuser from `.env` (`FIRST_SUPERUSER` / `FIRST_SUPERUSER_PASSWORD`), go to Upload → New quiz, and confirm:
- No Series dropdown when Organization is "No Organization".
- Selecting an org that has series shows Series beside it on the same row, "None" in the normal foreground color.
- Selecting an org with no series shows no Series dropdown.
- Picking a series, then switching org, resets series to "None".

(If no org with a series exists in dev data, create one via Admin → Series first.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Upload/steps/Step1EventMeta.tsx
git commit -m "feat(upload): scope series dropdown to selected organization

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Final verification

**Files:** none new — fixes only if something fails.

- [ ] **Step 1: Full backend suite**

```bash
cd backend && bash scripts/test.sh
```

Expected: all PASS.

- [ ] **Step 2: Pre-commit hooks over everything**

```bash
cd backend && uv run prek run --all-files
```

Expected: all hooks pass (ruff, biome). If hooks modify files, re-add and amend/commit the fixes.

- [ ] **Step 3: Full Playwright suite**

```bash
cd frontend && bunx playwright test
```

Expected: all PASS.

- [ ] **Step 4: Commit any straggler fixes**

Only if Steps 1-3 changed files:

```bash
git add -A && git commit -m "chore: lint/test fixes for series organization requirement

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
