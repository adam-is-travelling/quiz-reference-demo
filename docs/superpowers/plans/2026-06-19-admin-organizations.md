# Admin Organizations CRUD — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add create, edit, and delete for organizations to the admin Dashboard, including a backend DELETE endpoint, a regenerated frontend client, a reusable OrganizationDialog, an admin route, and a sidebar link.

**Architecture:** Backend gets a new `DELETE /organizations/{id}` endpoint (superuser-only, returns `{"ok": True}`, relies on DB-level `ondelete='SET NULL'` to null out quiz references). The frontend adds an `OrganizationDialog` component for create/edit (shadcn Dialog + react-hook-form + Zod), an `admin_.organizations.tsx` route with a table + AlertDialog for delete, and a sidebar entry under the superuser block.

**Tech Stack:** FastAPI · SQLModel · pytest · React · TanStack Query · TanStack Router · react-hook-form · Zod · shadcn/ui · Tailwind CSS v4 · TypeScript · Bun

## Global Constraints

- Superuser-only for create, update, delete — same guard as existing POST/PATCH endpoints
- Delete returns `{"ok": True}` to match the `delete_format` pattern
- Frontend invalidates `["organizations"]` query key on all mutations
- Follow `admin_.formats.tsx` + `FormatDialog` patterns exactly for UI structure
- All commands run from project root unless stated otherwise

---

### Task 1: Backend DELETE endpoint + tests

**Files:**
- Modify: `backend/app/api/routes/organizations.py`
- Modify: `backend/tests/api/routes/test_organizations.py`

**Interfaces:**
- Produces: `DELETE /organizations/{id}` → `{"ok": True}` (200) or 403/404

- [ ] **Step 1: Write the four failing tests**

Add these imports to `backend/tests/api/routes/test_organizations.py`:

```python
import uuid

from app.models import Organization, Quiz
from tests.utils.quiz import create_random_organization, create_random_event
```

Replace the existing `from app.models import Organization` line and `from tests.utils.quiz import create_random_organization` line with the above block.

Then add these four test functions at the bottom of the file:

```python
def test_delete_organization_as_superuser(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    org = create_random_organization(db)
    response = client.delete(
        f"{settings.API_V1_STR}/organizations/{org.id}",
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    get_response = client.get(f"{settings.API_V1_STR}/organizations/{org.id}")
    assert get_response.status_code == 404


def test_delete_organization_forbidden(
    client: TestClient,
    organizer_token_headers: dict[str, str],
    db: Session,
) -> None:
    org = create_random_organization(db)
    response = client.delete(
        f"{settings.API_V1_STR}/organizations/{org.id}",
        headers=organizer_token_headers,
    )
    assert response.status_code == 403


def test_delete_organization_not_found(
    client: TestClient,
    superuser_token_headers: dict[str, str],
) -> None:
    response = client.delete(
        f"{settings.API_V1_STR}/organizations/{uuid.uuid4()}",
        headers=superuser_token_headers,
    )
    assert response.status_code == 404


def test_delete_organization_nullifies_quiz_organization(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    org = create_random_organization(db)
    quiz = create_random_event(db)
    quiz.organization_id = org.id
    db.add(quiz)
    db.commit()
    db.refresh(quiz)
    quiz_id = quiz.id

    try:
        response = client.delete(
            f"{settings.API_V1_STR}/organizations/{org.id}",
            headers=superuser_token_headers,
        )
        assert response.status_code == 200

        db.expire_all()
        refreshed_quiz = db.get(Quiz, quiz_id)
        assert refreshed_quiz is not None
        assert refreshed_quiz.organization_id is None
    finally:
        db.expire_all()
        leftover = db.get(Quiz, quiz_id)
        if leftover:
            db.delete(leftover)
            db.commit()
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && source .venv/bin/activate && pytest tests/api/routes/test_organizations.py::test_delete_organization_as_superuser tests/api/routes/test_organizations.py::test_delete_organization_forbidden tests/api/routes/test_organizations.py::test_delete_organization_not_found tests/api/routes/test_organizations.py::test_delete_organization_nullifies_quiz_organization -v
```

Expected: All four tests **FAIL** with `405 Method Not Allowed` or similar (endpoint doesn't exist yet).

- [ ] **Step 3: Add the DELETE endpoint**

In `backend/app/api/routes/organizations.py`, add this function after the existing `update_organization` function:

```python
@router.delete("/{id}")
def delete_organization(
    *, session: SessionDep, current_user: CurrentUser, id: uuid.UUID
) -> dict[str, bool]:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    org = session.get(Organization, id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    session.delete(org)
    session.commit()
    return {"ok": True}
```

No new imports needed — `uuid`, `HTTPException`, `SessionDep`, `CurrentUser`, and `Organization` are already imported.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && source .venv/bin/activate && pytest tests/api/routes/test_organizations.py -v
```

Expected: All tests **PASS** including the four new ones.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/routes/organizations.py backend/tests/api/routes/test_organizations.py
git commit -m "feat: add DELETE /organizations/{id} endpoint with tests"
```

---

### Task 2: Regenerate frontend client

**Files:**
- Modify: `frontend/src/client/sdk.gen.ts` (auto-generated)
- Modify: `frontend/src/client/types.gen.ts` (auto-generated)

**Interfaces:**
- Consumes: Task 1's `DELETE /organizations/{id}` endpoint
- Produces: `OrganizationsService.deleteOrganization({ id: string })` method available in `@/client`

- [ ] **Step 1: Run the client generator**

```bash
bash ./scripts/generate-client.sh
```

The script imports the Python app directly (no Docker needed), writes `frontend/openapi.json`, regenerates `frontend/src/client/`, and runs lint.

Expected output ends with something like `Checked X files. No issues found.`

- [ ] **Step 2: Verify the new method exists**

```bash
grep "deleteOrganization" frontend/src/client/sdk.gen.ts
```

Expected: A line like `public static deleteOrganization(data: ...)`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/client/ frontend/openapi.json
git commit -m "chore: regenerate client with deleteOrganization"
```

---

### Task 3: OrganizationDialog component

**Files:**
- Create: `frontend/src/components/Admin/OrganizationDialog.tsx`

**Interfaces:**
- Consumes: `OrganizationsService.createOrganization`, `OrganizationsService.updateOrganization`, `OrganizationPublic` from `@/client`
- Produces: `OrganizationDialog({ org?: OrganizationPublic, trigger: React.ReactNode })` — default export from `@/components/Admin/OrganizationDialog`

- [ ] **Step 1: Create the component**

Create `frontend/src/components/Admin/OrganizationDialog.tsx` with this content:

```typescript
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import type { OrganizationPublic } from "@/client"
import { OrganizationsService } from "@/client"
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
  website: z.string().optional(),
  logo_url: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

interface Props {
  org?: OrganizationPublic
  trigger: React.ReactNode
}

export function OrganizationDialog({ org, trigger }: Props) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [open, setOpen] = useState(false)
  const isEdit = org !== undefined

  const defaultValues: FormValues = {
    name: org?.name ?? "",
    description: org?.description ?? "",
    website: org?.website ?? "",
    logo_url: org?.logo_url ?? "",
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
      if (isEdit) {
        return OrganizationsService.updateOrganization({
          id: org.id,
          requestBody: {
            name: data.name,
            description: data.description || null,
            website: data.website || null,
            logo_url: data.logo_url || null,
          },
        })
      }
      return OrganizationsService.createOrganization({
        requestBody: {
          name: data.name,
          description: data.description || null,
          website: data.website || null,
          logo_url: data.logo_url || null,
        },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organizations"] })
      showSuccessToast(isEdit ? "Organization updated" : "Organization created")
      setOpen(false)
    },
    onError: () =>
      showErrorToast(
        isEdit ? "Failed to update organization" : "Failed to create organization",
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
          <DialogTitle>
            {isEdit ? "Edit Organization" : "New Organization"}
          </DialogTitle>
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
            <Label>Website</Label>
            <Input {...register("website")} placeholder="https://..." />
          </div>

          <div className="grid gap-1.5">
            <Label>Logo URL</Label>
            <Input {...register("logo_url")} placeholder="https://..." />
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
cd frontend && bun run build 2>&1 | tail -20
```

Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Admin/OrganizationDialog.tsx
git commit -m "feat: add OrganizationDialog component for create/edit"
```

---

### Task 4: Admin organizations route

**Files:**
- Create: `frontend/src/routes/_layout/admin_.organizations.tsx`
- Create: `frontend/src/components/ui/alert-dialog.tsx` (via shadcn CLI)

**Interfaces:**
- Consumes: `OrganizationDialog` from Task 3; `OrganizationsService.deleteOrganization` from Task 2; `OrganizationPublic` from `@/client`
- Produces: Route at `/admin/organizations` (TanStack Router file-based — no manual registration needed)

- [ ] **Step 1: Install the shadcn alert-dialog component**

```bash
cd frontend && bunx shadcn@latest add alert-dialog
```

When prompted, accept defaults. This creates `frontend/src/components/ui/alert-dialog.tsx`.

Verify it was created:

```bash
ls frontend/src/components/ui/alert-dialog.tsx
```

Expected: file exists.

- [ ] **Step 2: Create the route file**

Create `frontend/src/routes/_layout/admin_.organizations.tsx` with this content:

```typescript
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { Suspense } from "react"
import type { OrganizationPublic } from "@/client"
import { OrganizationsService } from "@/client"
import { OrganizationDialog } from "@/components/Admin/OrganizationDialog"
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

export const Route = createFileRoute("/_layout/admin_/organizations")({
  component: AdminOrganizations,
  beforeLoad: async () => {
    const { UsersService } = await import("@/client")
    const user = await UsersService.readUserMe()
    if (!user.is_superuser) {
      throw redirect({ to: "/" })
    }
  },
  head: () => ({
    meta: [{ title: "Organizations - Admin" }],
  }),
})

function OrgRow({ org }: { org: OrganizationPublic }) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const deleteMutation = useMutation({
    mutationFn: () => OrganizationsService.deleteOrganization({ id: org.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organizations"] })
      showSuccessToast("Organization deleted")
    },
    onError: () => showErrorToast("Failed to delete organization"),
  })

  return (
    <tr className="border-b">
      <td className="py-3 px-4 font-medium">{org.name}</td>
      <td className="py-3 px-4 text-muted-foreground">
        {org.description ?? "—"}
      </td>
      <td className="py-3 px-4 text-muted-foreground">
        {org.website ? (
          <a
            href={org.website}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            {org.website}
          </a>
        ) : (
          "—"
        )}
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <OrganizationDialog
            org={org}
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
                <AlertDialogTitle>Delete organization?</AlertDialogTitle>
                <AlertDialogDescription>
                  Deleting "{org.name}" will remove it from any associated
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

function OrgsTableContent() {
  const { data } = useSuspenseQuery({
    queryKey: ["organizations"],
    queryFn: () =>
      OrganizationsService.readOrganizations({ skip: 0, limit: 100 }),
  })

  if (data.data.length === 0) {
    return (
      <p className="text-muted-foreground text-sm py-4">
        No organizations yet. Create one to get started.
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
              Website
            </th>
            <th className="py-3 px-4" />
          </tr>
        </thead>
        <tbody>
          {data.data.map((org) => (
            <OrgRow key={org.id} org={org} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AdminOrganizations() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Organizations</h1>
          <p className="text-muted-foreground">
            Manage quiz governing bodies and associations.
          </p>
        </div>
        <OrganizationDialog
          trigger={
            <Button>
              <Plus className="h-4 w-4 mr-1" />
              New Organization
            </Button>
          }
        />
      </div>

      <Suspense
        fallback={
          <div className="animate-pulse h-40 w-full rounded bg-muted" />
        }
      >
        <OrgsTableContent />
      </Suspense>
    </div>
  )
}
```

- [ ] **Step 3: Type-check**

```bash
cd frontend && bun run build 2>&1 | tail -20
```

Expected: Build succeeds with no TypeScript errors. TanStack Router auto-generates the route from the file name.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ui/alert-dialog.tsx frontend/src/routes/_layout/admin_.organizations.tsx
git commit -m "feat: add admin organizations route with create/edit/delete"
```

---

### Task 5: Sidebar link

**Files:**
- Modify: `frontend/src/components/Sidebar/AppSidebar.tsx`

**Interfaces:**
- Consumes: Route `/admin/organizations` from Task 4
- Produces: "Organizations" link visible in sidebar for superusers

- [ ] **Step 1: Add the sidebar entry**

In `frontend/src/components/Sidebar/AppSidebar.tsx`, make two changes:

**Change 1** — add `Building2` to the lucide-react import:

```typescript
import {
  Building2,
  ClipboardCheck,
  ClipboardList,
  Home,
  LayoutList,
  Users,
} from "lucide-react"
```

**Change 2** — add the Organizations item between Formats and Admin in the superuser block:

```typescript
  if (currentUser?.is_superuser) {
    items.push(
      { icon: ClipboardCheck, title: "Review Quizzes", path: "/admin/quizzes" },
      { icon: LayoutList, title: "Formats", path: "/admin/formats" },
      { icon: Building2, title: "Organizations", path: "/admin/organizations" },
      { icon: Users, title: "Admin", path: "/admin" },
    )
  }
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && bun run build 2>&1 | tail -20
```

Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Sidebar/AppSidebar.tsx
git commit -m "feat: add Organizations link to admin sidebar"
```
