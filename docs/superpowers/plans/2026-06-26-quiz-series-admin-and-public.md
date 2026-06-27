# Quiz Series Admin & Public Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CRUD admin pages and a public read-only list page for Quiz Series, including a delete endpoint, org-name enrichment on all series responses, and full test coverage.

**Architecture:** The backend `series.py` route is rewritten to expose a `DELETE` endpoint and a `_series_public` helper (mirroring `_quiz_public` in `quizzes.py`) that joins with `Organization` to populate `organization_name` on every `QuizSeriesPublic` response. The frontend adds a `SeriesDialog` component and two new routes (`admin_.series.tsx`, `_public/series.tsx`), updates the existing detail page and navigation, and regenerates the OpenAPI client after backend changes.

**Tech Stack:** FastAPI + SQLModel (backend), React + TanStack Router + TanStack Query + shadcn/ui + react-hook-form + zod (frontend), pytest (backend tests), Playwright (E2E tests), bun (frontend tooling).

## Global Constraints

- All `DELETE` endpoints are superuser-only and return `{"ok": True}` as `dict[str, bool]`
- All new backend routes follow existing patterns: `SessionDep`, `CurrentUser`, `Any` return type with `response_model`
- All frontend components follow shadcn/ui + Tailwind patterns — no new libraries
- `routeTree.gen.ts` is auto-generated; never edit it manually (run `bun run build` to regenerate)
- The `_series_public` helper is the sole place that joins `Organization` — all endpoints call it
- After all backend changes in Task 1, run `scripts/generate-client.sh` from the project root before starting any frontend task

---

## File Map

| File | Action | Task |
|---|---|---|
| `backend/app/crud.py` | Add `delete_series` | 1 |
| `backend/app/models.py` | Add `organization_name` to `QuizSeriesPublic` | 1 |
| `backend/app/api/routes/series.py` | Full rewrite: `_series_public` helper + all endpoints + DELETE | 1 |
| `backend/tests/api/routes/test_series.py` | Add 6 new test cases | 1 |
| `frontend/src/client/` | Regenerated via script | 1 |
| `frontend/src/components/Admin/SeriesDialog.tsx` | Create | 2 |
| `frontend/src/routes/_layout/admin_.series.tsx` | Create | 3 |
| `frontend/src/components/Sidebar/AppSidebar.tsx` | Add Series sidebar item | 3 |
| `frontend/src/routes/_public/series.tsx` | Create | 4 |
| `frontend/src/components/Common/PublicNav.tsx` | Add Series nav link | 4 |
| `frontend/src/routes/_public/series.$id.tsx` | Add org name + link | 5 |
| `frontend/tests/series-admin.spec.ts` | Create | 6 |
| `frontend/tests/series-public.spec.ts` | Create | 6 |

---

### Task 1: Backend — Delete endpoint, org-name enrichment, tests, client regen

**Files:**
- Modify: `backend/app/crud.py`
- Modify: `backend/app/models.py`
- Modify: `backend/app/api/routes/series.py`
- Modify: `backend/tests/api/routes/test_series.py`
- Regenerate: `frontend/src/client/`

**Interfaces:**
- Produces: `QuizSeriesPublic` now has `organization_name: str | None = None`
- Produces: `DELETE /api/v1/series/{id}` returns `{"ok": True}`
- Produces: `SeriesService.deleteSeries({ id })` in the generated TypeScript client
- Produces: All series endpoints return `organization_name`

---

- [ ] **Step 1: Write failing delete tests**

Add to `backend/tests/api/routes/test_series.py`. The existing imports already include `create_random_organization` and `create_random_series`. Add `create_random_event` and `Quiz` to the imports:

```python
# Replace the existing import line:
from tests.utils.quiz import create_random_organization, create_random_series
# With:
from tests.utils.quiz import create_random_event, create_random_organization, create_random_series
```

Also add `Quiz` to the models import:

```python
# Replace:
from app.models import Organization, QuizSeries
# With:
from app.models import Organization, Quiz, QuizSeries
```

Then add these four test functions at the end of the file:

```python
def test_delete_series_as_superuser(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    series = create_random_series(db)
    response = client.delete(
        f"{settings.API_V1_STR}/series/{series.id}",
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    get_response = client.get(f"{settings.API_V1_STR}/series/{series.id}")
    assert get_response.status_code == 404


def test_delete_series_forbidden_for_organizer(
    client: TestClient,
    organizer_token_headers: dict[str, str],
    db: Session,
) -> None:
    series = create_random_series(db)
    response = client.delete(
        f"{settings.API_V1_STR}/series/{series.id}",
        headers=organizer_token_headers,
    )
    assert response.status_code == 403


def test_delete_series_not_found(
    client: TestClient,
    superuser_token_headers: dict[str, str],
) -> None:
    response = client.delete(
        f"{settings.API_V1_STR}/series/{uuid.uuid4()}",
        headers=superuser_token_headers,
    )
    assert response.status_code == 404


def test_delete_series_nullifies_quiz_series_id(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    series = create_random_series(db)
    quiz = create_random_event(db)
    quiz.series_id = series.id
    db.add(quiz)
    db.commit()
    db.refresh(quiz)
    quiz_id = quiz.id

    try:
        response = client.delete(
            f"{settings.API_V1_STR}/series/{series.id}",
            headers=superuser_token_headers,
        )
        assert response.status_code == 200

        db.expire_all()
        refreshed_quiz = db.get(Quiz, quiz_id)
        assert refreshed_quiz is not None
        assert refreshed_quiz.series_id is None
    finally:
        db.expire_all()
        leftover = db.get(Quiz, quiz_id)
        if leftover:
            db.delete(leftover)
            db.commit()
```

- [ ] **Step 2: Run delete tests — verify they fail**

```bash
docker compose exec backend bash scripts/tests-start.sh tests/api/routes/test_series.py::test_delete_series_as_superuser tests/api/routes/test_series.py::test_delete_series_forbidden_for_organizer tests/api/routes/test_series.py::test_delete_series_not_found tests/api/routes/test_series.py::test_delete_series_nullifies_quiz_series_id -v
```

Expected: 4 FAILs (405 Method Not Allowed — no DELETE endpoint exists yet)

- [ ] **Step 3: Add `delete_series` to `crud.py`**

In `backend/app/crud.py`, add after the `update_series` function (around line 130):

```python
def delete_series(*, session: Session, db_series: QuizSeries) -> None:
    session.delete(db_series)
    session.commit()
```

- [ ] **Step 4: Add DELETE endpoint to `series.py`**

At the end of `backend/app/api/routes/series.py`, add:

```python
@router.delete("/{id}")
def delete_series(
    *, session: SessionDep, current_user: CurrentUser, id: uuid.UUID
) -> dict[str, bool]:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    series = session.get(QuizSeries, id)
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    crud.delete_series(session=session, db_series=series)
    return {"ok": True}
```

- [ ] **Step 5: Run delete tests — verify they pass**

```bash
docker compose exec backend bash scripts/tests-start.sh tests/api/routes/test_series.py::test_delete_series_as_superuser tests/api/routes/test_series.py::test_delete_series_forbidden_for_organizer tests/api/routes/test_series.py::test_delete_series_not_found tests/api/routes/test_series.py::test_delete_series_nullifies_quiz_series_id -v
```

Expected: 4 PASSes

- [ ] **Step 6: Write failing org-name tests**

Add these two test functions to `backend/tests/api/routes/test_series.py`:

```python
def test_read_series_includes_organization_name(
    client: TestClient,
    db: Session,
) -> None:
    org = create_random_organization(db)
    series = create_random_series(db, organization_id=org.id)
    response = client.get(f"{settings.API_V1_STR}/series/")
    assert response.status_code == 200
    data = response.json()["data"]
    match = next((s for s in data if s["id"] == str(series.id)), None)
    assert match is not None
    assert match["organization_name"] == org.name


def test_read_series_item_includes_organization_name(
    client: TestClient,
    db: Session,
) -> None:
    org = create_random_organization(db)
    series = create_random_series(db, organization_id=org.id)
    response = client.get(f"{settings.API_V1_STR}/series/{series.id}")
    assert response.status_code == 200
    assert response.json()["organization_name"] == org.name
```

- [ ] **Step 7: Run org-name tests — verify they fail**

```bash
docker compose exec backend bash scripts/tests-start.sh tests/api/routes/test_series.py::test_read_series_includes_organization_name tests/api/routes/test_series.py::test_read_series_item_includes_organization_name -v
```

Expected: 2 FAILs (`organization_name` not a key in response)

- [ ] **Step 8: Add `organization_name` to `QuizSeriesPublic` in `models.py`**

In `backend/app/models.py`, replace the `QuizSeriesPublic` class:

```python
class QuizSeriesPublic(QuizSeriesBase):
    id: uuid.UUID
    organization_id: uuid.UUID | None = None
    organization_name: str | None = None
```

- [ ] **Step 9: Rewrite `series.py` with `_series_public` helper**

Replace the entire content of `backend/app/api/routes/series.py` with:

```python
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import Session, func, select

from app.api.deps import CurrentUser, SessionDep
from app import crud
from app.models import (
    Organization,
    QuizSeries,
    QuizSeriesCreate,
    QuizSeriesListPublic,
    QuizSeriesPublic,
    QuizSeriesUpdate,
)

router = APIRouter(prefix="/series", tags=["series"])


def _series_public(series: QuizSeries, session: Session) -> QuizSeriesPublic:
    org = session.get(Organization, series.organization_id) if series.organization_id else None
    return QuizSeriesPublic(
        **series.model_dump(),
        organization_name=org.name if org else None,
    )


@router.get("/", response_model=QuizSeriesListPublic)
def read_series(
    session: SessionDep, skip: int = 0, limit: int = 100
) -> Any:
    count = session.exec(select(func.count()).select_from(QuizSeries)).one()
    series_list = session.exec(select(QuizSeries).offset(skip).limit(limit)).all()
    return QuizSeriesListPublic(
        data=[_series_public(s, session) for s in series_list],
        count=count,
    )


@router.get("/{id}", response_model=QuizSeriesPublic)
def read_series_item(session: SessionDep, id: uuid.UUID) -> Any:
    series = session.get(QuizSeries, id)
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    return _series_public(series, session)


@router.post("/", response_model=QuizSeriesPublic)
def create_series(
    *, session: SessionDep, current_user: CurrentUser, series_in: QuizSeriesCreate
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    series = crud.create_series(session=session, series_in=series_in)
    return _series_public(series, session)


@router.patch("/{id}", response_model=QuizSeriesPublic)
def update_series(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    series_in: QuizSeriesUpdate,
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    series = session.get(QuizSeries, id)
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    series = crud.update_series(session=session, db_series=series, series_in=series_in)
    return _series_public(series, session)


@router.delete("/{id}")
def delete_series(
    *, session: SessionDep, current_user: CurrentUser, id: uuid.UUID
) -> dict[str, bool]:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    series = session.get(QuizSeries, id)
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    crud.delete_series(session=session, db_series=series)
    return {"ok": True}
```

- [ ] **Step 10: Run all series tests — verify they all pass**

```bash
docker compose exec backend bash scripts/tests-start.sh tests/api/routes/test_series.py -v
```

Expected: All tests PASS (existing 7 + 6 new = 13 total)

- [ ] **Step 11: Regenerate the frontend OpenAPI client**

From the project root:

```bash
bash ./scripts/generate-client.sh
```

Expected: `frontend/src/client/` is updated; `SeriesService` now includes `deleteSeries`, and `QuizSeriesPublic` type includes `organization_name: string | null`.

- [ ] **Step 12: Commit**

```bash
git add backend/app/crud.py backend/app/models.py backend/app/api/routes/series.py backend/tests/api/routes/test_series.py frontend/src/client/
git commit -m "feat: add series delete endpoint, org-name enrichment, and backend tests"
```

---

### Task 2: Frontend Admin — SeriesDialog component

**Files:**
- Create: `frontend/src/components/Admin/SeriesDialog.tsx`

**Interfaces:**
- Consumes: `QuizSeriesPublic` (has `id`, `name`, `description`, `organization_id`, `organization_name`) from `@/client`
- Consumes: `SeriesService.createSeries`, `SeriesService.updateSeries` from `@/client`
- Consumes: `OrganizationsService.readOrganizations` from `@/client`
- Produces: `<SeriesDialog series={series} trigger={<Button />} />` — edit mode when `series` is provided, create mode when omitted

---

- [ ] **Step 1: Create `SeriesDialog.tsx`**

Create `frontend/src/components/Admin/SeriesDialog.tsx` with this content:

```tsx
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import type { QuizSeriesPublic } from "@/client"
import { OrganizationsService, SeriesService } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import useCustomToast from "@/hooks/useCustomToast"

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  organization_id: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

interface Props {
  series?: QuizSeriesPublic
  trigger: React.ReactNode
}

export function SeriesDialog({ series, trigger }: Props) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [open, setOpen] = useState(false)
  const isEdit = series !== undefined

  const { data: orgs } = useQuery({
    queryKey: ["organizations"],
    queryFn: () => OrganizationsService.readOrganizations({ skip: 0, limit: 100 }),
  })

  const defaultValues: FormValues = {
    name: series?.name ?? "",
    description: series?.description ?? "",
    organization_id: series?.organization_id ?? "",
  }

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  })

  const mutation = useMutation({
    mutationFn: (data: FormValues) => {
      const organization_id = data.organization_id || null
      if (isEdit) {
        return SeriesService.updateSeries({
          id: series.id,
          requestBody: {
            name: data.name,
            description: data.description || null,
            organization_id,
          },
        })
      }
      return SeriesService.createSeries({
        requestBody: {
          name: data.name,
          description: data.description || null,
          organization_id,
        },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["series"] })
      showSuccessToast(isEdit ? "Series updated" : "Series created")
      setOpen(false)
    },
    onError: () =>
      showErrorToast(
        isEdit ? "Failed to update series" : "Failed to create series",
      ),
  })

  const handleOpenChange = (v: boolean) => {
    setOpen(v)
    if (v) reset(defaultValues)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Series" : "New Series"}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={handleSubmit((data) => mutation.mutate(data))}
          className="flex flex-col gap-4 pt-2"
        >
          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input {...register("name")} />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label>Description</Label>
            <textarea
              {...register("description")}
              rows={2}
              className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Organization</Label>
            <select
              {...register("organization_id")}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">None</option>
              {orgs?.data.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </div>

          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending
              ? isEdit
                ? "Saving…"
                : "Creating…"
              : isEdit
                ? "Save"
                : "Create"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && bun run build
```

Expected: Build succeeds with no TypeScript errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Admin/SeriesDialog.tsx
git commit -m "feat: add SeriesDialog component for admin create/edit"
```

---

### Task 3: Frontend Admin — Admin series page + sidebar link

**Files:**
- Create: `frontend/src/routes/_layout/admin_.series.tsx`
- Modify: `frontend/src/components/Sidebar/AppSidebar.tsx`

**Interfaces:**
- Consumes: `SeriesDialog` from `@/components/Admin/SeriesDialog`
- Consumes: `SeriesService.readSeries`, `SeriesService.deleteSeries` from `@/client`
- Consumes: `QuizSeriesPublic` type (has `id`, `name`, `description`, `organization_name`)
- Produces: Route at `/admin/series`, accessible only to superusers

---

- [ ] **Step 1: Create `admin_.series.tsx`**

Create `frontend/src/routes/_layout/admin_.series.tsx`:

```tsx
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { Suspense } from "react"
import type { QuizSeriesPublic } from "@/client"
import { SeriesService } from "@/client"
import { SeriesDialog } from "@/components/Admin/SeriesDialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import useCustomToast from "@/hooks/useCustomToast"

export const Route = createFileRoute("/_layout/admin_/series")({
  component: AdminSeries,
  beforeLoad: async () => {
    const { UsersService } = await import("@/client")
    const user = await UsersService.readUserMe()
    if (!user.is_superuser) {
      throw redirect({ to: "/" })
    }
  },
  head: () => ({
    meta: [{ title: "Series - Admin" }],
  }),
})

function SeriesRow({ series }: { series: QuizSeriesPublic }) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const deleteMutation = useMutation({
    mutationFn: () => SeriesService.deleteSeries({ id: series.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["series"] })
      showSuccessToast("Series deleted")
    },
    onError: () => showErrorToast("Failed to delete series"),
  })

  return (
    <tr className="border-b">
      <td className="py-3 px-4 font-medium">{series.name}</td>
      <td className="py-3 px-4 text-muted-foreground">
        {series.description ?? "—"}
      </td>
      <td className="py-3 px-4 text-muted-foreground">
        {series.organization_name ?? "—"}
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <SeriesDialog
            series={series}
            trigger={
              <Button variant="outline" size="sm">
                <Pencil className="h-3 w-3" />
              </Button>
            }
          />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete series?</AlertDialogTitle>
                <AlertDialogDescription>
                  Deleting "{series.name}" will remove it from any associated
                  quizzes. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deleteMutation.mutate()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </td>
    </tr>
  )
}

function SeriesTableContent() {
  const { data } = useSuspenseQuery({
    queryKey: ["series"],
    queryFn: () => SeriesService.readSeries({ skip: 0, limit: 100 }),
  })

  if (data.data.length === 0) {
    return (
      <p className="text-muted-foreground text-sm py-4">
        No series yet. Create one to get started.
      </p>
    )
  }

  return (
    <div className="rounded-md border">
      <table className="w-full">
        <thead className="bg-muted">
          <tr>
            <th className="py-3 px-4 text-left text-sm font-medium">Name</th>
            <th className="py-3 px-4 text-left text-sm font-medium">
              Description
            </th>
            <th className="py-3 px-4 text-left text-sm font-medium">
              Organization
            </th>
            <th className="py-3 px-4" />
          </tr>
        </thead>
        <tbody>
          {data.data.map((series) => (
            <SeriesRow key={series.id} series={series} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AdminSeries() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Series</h1>
          <p className="text-muted-foreground">
            Manage quiz series and tournaments.
          </p>
        </div>
        <SeriesDialog
          trigger={
            <Button>
              <Plus className="h-4 w-4 mr-1" />
              New Series
            </Button>
          }
        />
      </div>

      <Suspense
        fallback={
          <div className="animate-pulse h-40 w-full rounded bg-muted" />
        }
      >
        <SeriesTableContent />
      </Suspense>
    </div>
  )
}
```

- [ ] **Step 2: Add Series link to the admin sidebar**

In `frontend/src/components/Sidebar/AppSidebar.tsx`, add `List` to the lucide-react import and insert the Series entry:

```tsx
// Replace the import line:
import {
  Building2,
  ClipboardCheck,
  ClipboardList,
  Home,
  LayoutList,
  Users,
} from "lucide-react"

// With:
import {
  Building2,
  ClipboardCheck,
  ClipboardList,
  Home,
  LayoutList,
  List,
  Users,
} from "lucide-react"
```

Then in the superuser block, insert the Series entry between Formats and Organizations:

```tsx
// Replace:
    items.push(
      { icon: ClipboardCheck, title: "Review Quizzes", path: "/admin/quizzes" },
      { icon: LayoutList, title: "Formats", path: "/admin/formats" },
      { icon: Building2, title: "Organizations", path: "/admin/organizations" },
      { icon: Users, title: "Admin", path: "/admin" },
    )

// With:
    items.push(
      { icon: ClipboardCheck, title: "Review Quizzes", path: "/admin/quizzes" },
      { icon: LayoutList, title: "Formats", path: "/admin/formats" },
      { icon: List, title: "Series", path: "/admin/series" },
      { icon: Building2, title: "Organizations", path: "/admin/organizations" },
      { icon: Users, title: "Admin", path: "/admin" },
    )
```

- [ ] **Step 3: Type-check**

```bash
cd frontend && bun run build
```

Expected: Build succeeds. The route tree is regenerated and includes `/_layout/admin_/series`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/routes/_layout/admin_.series.tsx frontend/src/components/Sidebar/AppSidebar.tsx frontend/src/routeTree.gen.ts
git commit -m "feat: add admin series page and sidebar link"
```

---

### Task 4: Frontend Public — Series list page + nav link

**Files:**
- Create: `frontend/src/routes/_public/series.tsx`
- Modify: `frontend/src/components/Common/PublicNav.tsx`

**Interfaces:**
- Consumes: `SeriesService.readSeries` from `@/client`
- Consumes: `QuizSeriesPublic` type (has `id`, `name`, `description`, `organization_name`)
- Produces: Public route at `/series` — no auth required

---

- [ ] **Step 1: Create `_public/series.tsx`**

Create `frontend/src/routes/_public/series.tsx`:

```tsx
import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Suspense } from "react"

import { SeriesService } from "@/client"

function getSeriesQueryOptions() {
  return {
    queryFn: () => SeriesService.readSeries({ skip: 0, limit: 100 }),
    queryKey: ["series"],
  }
}

export const Route = createFileRoute("/_public/series")({
  component: SeriesPage,
  head: () => ({ meta: [{ title: "Series" }] }),
})

function SeriesListContent() {
  const { data } = useSuspenseQuery(getSeriesQueryOptions())

  if (data.data.length === 0) {
    return (
      <p className="text-muted-foreground py-4">No series published yet.</p>
    )
  }

  return (
    <div className="rounded-md border">
      <table className="w-full">
        <thead className="bg-muted">
          <tr>
            <th className="py-3 px-4 text-left text-sm font-medium">Name</th>
            <th className="py-3 px-4 text-left text-sm font-medium">
              Description
            </th>
            <th className="py-3 px-4 text-left text-sm font-medium">
              Organization
            </th>
          </tr>
        </thead>
        <tbody>
          {data.data.map((series) => (
            <tr
              key={series.id}
              className="border-b hover:bg-muted/50 transition-colors"
            >
              <td className="py-3 px-4">
                <Link
                  to="/series/$id"
                  params={{ id: series.id }}
                  className="font-medium hover:underline"
                >
                  {series.name}
                </Link>
              </td>
              <td className="py-3 px-4 text-muted-foreground">
                {series.description ?? "—"}
              </td>
              <td className="py-3 px-4 text-muted-foreground">
                {series.organization_name ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SeriesPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Series</h1>
        <p className="text-muted-foreground">Quiz series and tournaments</p>
      </div>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <SeriesListContent />
      </Suspense>
    </div>
  )
}
```

- [ ] **Step 2: Add Series link to `PublicNav.tsx`**

In `frontend/src/components/Common/PublicNav.tsx`, add the Series link after the Organizations link:

```tsx
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <Link
            to={"/series" as any}
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Series
          </Link>
```

The full `items` section of the nav should look like:

```tsx
        <div className="flex items-center gap-6">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <Link to={"/quizzes" as any}>
            <Logo asLink={false} />
          </Link>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <Link
            to={"/quizzes" as any}
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Quizzes
          </Link>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <Link
            to={"/organizations" as any}
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Organizations
          </Link>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <Link
            to={"/series" as any}
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Series
          </Link>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <Link
            to={"/players" as any}
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Players
          </Link>
        </div>
```

- [ ] **Step 3: Type-check**

```bash
cd frontend && bun run build
```

Expected: Build succeeds. Route tree includes `/_public/series`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/routes/_public/series.tsx frontend/src/components/Common/PublicNav.tsx frontend/src/routeTree.gen.ts
git commit -m "feat: add public series list page and nav link"
```

---

### Task 5: Frontend Public — Update series detail page with org link

**Files:**
- Modify: `frontend/src/routes/_public/series.$id.tsx`

**Interfaces:**
- Consumes: `SeriesService.readSeriesItem` — now returns `QuizSeriesPublic` with `organization_id` and `organization_name`
- Produces: Series detail page now shows org name as a link to `/organizations/$id` when set

---

- [ ] **Step 1: Update `series.$id.tsx`**

Replace the entire content of `frontend/src/routes/_public/series.$id.tsx`:

```tsx
import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Suspense } from "react"

import { QuizzesService, SeriesService } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { eventColumns } from "@/components/Events/columns"

function getSeriesQueryOptions(id: string) {
  return {
    queryFn: () => SeriesService.readSeriesItem({ id }),
    queryKey: ["series", id],
  }
}

function getSeriesQuizzesQueryOptions(seriesId: string) {
  return {
    queryFn: () =>
      QuizzesService.readQuizzes({ seriesId, skip: 0, limit: 100 }),
    queryKey: ["quizzes", { seriesId }],
  }
}

export const Route = createFileRoute("/_public/series/$id")({
  component: SeriesDetailPage,
})

function SeriesDetail({ id }: { id: string }) {
  const { data: series } = useSuspenseQuery(getSeriesQueryOptions(id))
  const { data: events } = useSuspenseQuery(getSeriesQuizzesQueryOptions(id))

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{series.name}</h1>
        {series.description && (
          <p className="text-muted-foreground">{series.description}</p>
        )}
        {series.organization_id && series.organization_name && (
          <p className="text-sm text-muted-foreground mt-1">
            Organised by{" "}
            <Link
              to="/organizations/$id"
              params={{ id: series.organization_id }}
              className="hover:underline text-foreground"
            >
              {series.organization_name}
            </Link>
          </p>
        )}
      </div>
      <div>
        <h2 className="text-lg font-semibold mb-4">Events</h2>
        {events.data.length === 0 ? (
          <p className="text-muted-foreground">No events published yet.</p>
        ) : (
          <DataTable columns={eventColumns} data={events.data} />
        )}
      </div>
    </div>
  )
}

function SeriesDetailPage() {
  const { id } = Route.useParams()
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
      <SeriesDetail id={id} />
    </Suspense>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && bun run build
```

Expected: Build succeeds with no TypeScript errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/routes/_public/series.\$id.tsx
git commit -m "feat: show organization name with link on series detail page"
```

---

### Task 6: Playwright E2E Tests

**Files:**
- Create: `frontend/tests/series-admin.spec.ts`
- Create: `frontend/tests/series-public.spec.ts`

**Interfaces:**
- Consumes: Default Playwright storage state (superuser logged in) for admin tests
- Consumes: `OpenAPI` and `SeriesService` from `../src/client` for seeding test data in public tests
- Produces: E2E coverage for admin CRUD and public browsing of series

---

- [ ] **Step 1: Create `series-admin.spec.ts`**

Create `frontend/tests/series-admin.spec.ts`:

```ts
import { expect, test } from "@playwright/test"

test.describe("Admin Series page", () => {
  test("is accessible and shows correct heading", async ({ page }) => {
    await page.goto("/admin/series")
    await expect(
      page.getByRole("heading", { name: "Series" }),
    ).toBeVisible()
    await expect(
      page.getByText("Manage quiz series and tournaments."),
    ).toBeVisible()
  })

  test("Series link appears in admin sidebar", async ({ page }) => {
    await page.goto("/")
    await expect(
      page.getByRole("link", { name: "Series" }),
    ).toBeVisible()
  })

  test("New Series button is visible", async ({ page }) => {
    await page.goto("/admin/series")
    await expect(
      page.getByRole("button", { name: "New Series" }),
    ).toBeVisible()
  })

  test("create, edit, and delete a series", async ({ page }) => {
    await page.goto("/admin/series")

    const seriesName = `Test Series ${Date.now()}`
    const updatedName = `Updated ${seriesName}`

    // Create
    await page.getByRole("button", { name: "New Series" }).click()
    await page.locator('input[name="name"]').fill(seriesName)
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

- [ ] **Step 2: Create `series-public.spec.ts`**

Create `frontend/tests/series-public.spec.ts`:

```ts
import { expect, test } from "@playwright/test"
import { OpenAPI, SeriesService } from "../src/client"
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

test.describe("Public Series listing page", () => {
  let seriesId: string
  let seriesName: string

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()

    seriesName = `E2E Test Series ${Date.now()}`
    const created = await SeriesService.createSeries({
      requestBody: { name: seriesName },
    })
    seriesId = created.id
  })

  test.afterAll(async () => {
    if (seriesId) {
      await SeriesService.deleteSeries({ id: seriesId })
    }
  })

  test.use({ storageState: { cookies: [], origins: [] } })

  test("is accessible without login", async ({ page }) => {
    await page.goto("/series")
    await expect(page).toHaveURL("/series")
    await expect(
      page.getByRole("heading", { name: "Series" }),
    ).toBeVisible()
  })

  test("Series link appears in public nav", async ({ page }) => {
    await page.goto("/series")
    await expect(
      page.getByRole("link", { name: "Series" }).first(),
    ).toBeVisible()
  })

  test("seeded series appears in the list", async ({ page }) => {
    await page.goto("/series")
    await page.waitForLoadState("networkidle")
    await expect(page.getByRole("link", { name: seriesName })).toBeVisible()
  })

  test("clicking a series row navigates to the detail page", async ({
    page,
  }) => {
    await page.goto("/series")
    await page.waitForLoadState("networkidle")
    await page.getByRole("link", { name: seriesName }).click()
    await expect(page).toHaveURL(`/series/${seriesId}`)
    await expect(
      page.getByRole("heading", { name: seriesName }),
    ).toBeVisible()
  })

  test("detail page shows the Events section", async ({ page }) => {
    await page.goto(`/series/${seriesId}`)
    await expect(
      page.getByRole("heading", { name: "Events" }),
    ).toBeVisible()
  })
})
```

- [ ] **Step 3: Run the Playwright tests (requires full stack running)**

Start the full stack if not already running:

```bash
docker compose watch
```

Then in a separate terminal:

```bash
cd frontend && bunx playwright test tests/series-admin.spec.ts tests/series-public.spec.ts --reporter=list
```

Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add frontend/tests/series-admin.spec.ts frontend/tests/series-public.spec.ts
git commit -m "test: add Playwright E2E specs for admin and public series pages"
```
