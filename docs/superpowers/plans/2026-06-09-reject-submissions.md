# Reject Submissions & Admin Event Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `rejected` event status with reject/restore endpoints, surface those controls on the admin pages, and give admins edit + delete capabilities on the public event detail page.

**Architecture:** `rejected` is added to the existing `EventStatus` PostgreSQL ENUM via an Alembic migration. Three new backend endpoints are added symmetrically alongside the existing `/approve`. The shared `MetadataEditDialog` component is extracted so it can be used by both the admin detail page and the public event detail page.

**Tech Stack:** Python/FastAPI, SQLModel, Alembic (PostgreSQL ENUM migration), React/TypeScript, TanStack Query, shadcn/ui, react-hook-form

---

## File Map

| File | Change |
|------|--------|
| `backend/app/models.py` | Add `rejected` to `EventStatus` |
| `backend/app/alembic/versions/<hash>_add_rejected_to_event_status.py` | New migration |
| `backend/app/crud.py` | Add `reject_event`, `set_event_pending`, `delete_event` |
| `backend/app/api/routes/events.py` | Add `reject_event`, `set_event_pending`, `delete_event` endpoints |
| `backend/tests/utils/quiz.py` | Add `create_rejected_event` |
| `backend/tests/api/routes/test_events.py` | New tests for all three endpoints + visibility |
| `frontend/src/components/Events/MetadataEditDialog.tsx` | New — extracted from admin detail page |
| `frontend/src/routes/_layout/admin_.events.tsx` | Add Rejected section, rename All→Approved, add Reject button to rows |
| `frontend/src/routes/_layout/admin_.events_.$id.tsx` | Add Reject/Return-to-Pending buttons, update badge, import shared dialog |
| `frontend/src/routes/_public/events_.$id.tsx` | Add admin Edit + Delete controls |

---

## Task 1: Add `rejected` to EventStatus + migration + test utility

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/tests/utils/quiz.py`
- Create: `backend/app/alembic/versions/<hash>_add_rejected_to_event_status.py`

- [ ] **Step 1: Add `rejected` to the EventStatus enum in `backend/app/models.py`**

Find the `EventStatus` class (currently at line ~167) and update it:

```python
class EventStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"
```

- [ ] **Step 2: Add `create_rejected_event` to `backend/tests/utils/quiz.py`**

Add after `create_approved_event`:

```python
def create_rejected_event(db: Session) -> QuizEvent:
    event = create_random_event(db)
    event.status = EventStatus.rejected
    db.add(event)
    db.commit()
    db.refresh(event)
    return event
```

Also add `create_rejected_event` to the imports block at the top of any test file that uses it (done in Task 2+).

- [ ] **Step 3: Write the visibility tests in `backend/tests/api/routes/test_events.py`**

Add these two tests. They will fail until the migration runs (or the test DB is recreated).

```python
def test_read_rejected_event_as_public_returns_404(
    client: TestClient, db: Session
) -> None:
    from tests.utils.quiz import create_rejected_event
    event = create_rejected_event(db)
    response = client.get(f"{settings.API_V1_STR}/events/{event.id}")
    assert response.status_code == 404


def test_superuser_can_filter_rejected(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    from tests.utils.quiz import create_rejected_event
    create_rejected_event(db)
    response = client.get(
        f"{settings.API_V1_STR}/events/",
        headers=superuser_token_headers,
        params={"status": "rejected"},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert all(e["status"] == "rejected" for e in data)
```

- [ ] **Step 4: Run the new tests to confirm they fail**

```bash
cd backend
bash ./scripts/test.sh -k "test_read_rejected_event_as_public_returns_404 or test_superuser_can_filter_rejected" -- -v
```

Expected: Both FAIL — `EventStatus` has no `rejected` member (or DB type mismatch).

- [ ] **Step 5: Create the Alembic migration**

From inside the backend container (or local venv with DB running):

```bash
cd backend
source .venv/bin/activate
alembic revision -m "add_rejected_to_event_status"
```

Open the generated file at `backend/app/alembic/versions/<generated_hash>_add_rejected_to_event_status.py` and replace its upgrade/downgrade with:

```python
"""add rejected to event_status

Revision ID: <leave as generated>
Revises: a3f9b2c1d4e5
Branch labels: None
Depends on: None
"""
from alembic import op
import sqlalchemy as sa


def upgrade():
    # ALTER TYPE ... ADD VALUE cannot run inside a transaction in PostgreSQL
    connection = op.get_bind()
    connection.execution_options(isolation_level="AUTOCOMMIT")
    connection.execute(sa.text("ALTER TYPE eventstatus ADD VALUE IF NOT EXISTS 'rejected'"))


def downgrade():
    connection = op.get_bind()
    connection.execution_options(isolation_level="AUTOCOMMIT")
    # Move rejected events back to pending before removing the value
    connection.execute(sa.text(
        "UPDATE quizevent SET status = 'pending' WHERE status = 'rejected'"
    ))
    connection.execute(sa.text("ALTER TYPE eventstatus RENAME TO eventstatus_old"))
    connection.execute(sa.text("CREATE TYPE eventstatus AS ENUM ('pending', 'approved')"))
    connection.execute(sa.text(
        "ALTER TABLE quizevent ALTER COLUMN status TYPE eventstatus "
        "USING status::text::eventstatus"
    ))
    connection.execute(sa.text("DROP TYPE eventstatus_old"))
```

- [ ] **Step 6: Run the migration**

```bash
# Inside Docker:
docker compose exec backend alembic upgrade head
# Or locally with venv active and DB reachable:
alembic upgrade head
```

Expected output ends with: `Running upgrade a3f9b2c1d4e5 -> <new_hash>, add rejected to event_status`

- [ ] **Step 7: Run the visibility tests to confirm they pass**

```bash
cd backend
bash ./scripts/test.sh -k "test_read_rejected_event_as_public_returns_404 or test_superuser_can_filter_rejected" -- -v
```

Expected: Both PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/app/models.py \
        backend/app/alembic/versions/*_add_rejected_to_event_status.py \
        backend/tests/utils/quiz.py \
        backend/tests/api/routes/test_events.py
git commit -m "feat: add rejected EventStatus value with migration and visibility tests"
```

---

## Task 2: `POST /events/{id}/reject` endpoint

**Files:**
- Modify: `backend/app/crud.py`
- Modify: `backend/app/api/routes/events.py`
- Modify: `backend/tests/api/routes/test_events.py`

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/api/routes/test_events.py`:

```python
def test_reject_event_as_superuser(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    event = create_random_event(db)
    response = client.post(
        f"{settings.API_V1_STR}/events/{event.id}/reject",
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    assert response.json()["status"] == "rejected"


def test_reject_event_as_organizer_forbidden(
    client: TestClient,
    organizer_token_headers: dict[str, str],
    db: Session,
) -> None:
    event = create_random_event(db)
    response = client.post(
        f"{settings.API_V1_STR}/events/{event.id}/reject",
        headers=organizer_token_headers,
    )
    assert response.status_code == 403


def test_reject_event_as_regular_user_forbidden(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
) -> None:
    event = create_random_event(db)
    response = client.post(
        f"{settings.API_V1_STR}/events/{event.id}/reject",
        headers=normal_user_token_headers,
    )
    assert response.status_code == 403


def test_reject_already_rejected_event(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    from tests.utils.quiz import create_rejected_event
    event = create_rejected_event(db)
    response = client.post(
        f"{settings.API_V1_STR}/events/{event.id}/reject",
        headers=superuser_token_headers,
    )
    assert response.status_code == 400


def test_reject_approved_event_forbidden(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    event = create_approved_event(db)
    response = client.post(
        f"{settings.API_V1_STR}/events/{event.id}/reject",
        headers=superuser_token_headers,
    )
    assert response.status_code == 400
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend
bash ./scripts/test.sh -k "test_reject" -- -v
```

Expected: All FAIL with 404 (route not found).

- [ ] **Step 3: Add `reject_event` to `backend/app/crud.py`**

Add after `approve_event`:

```python
def reject_event(*, session: Session, db_event: QuizEvent) -> QuizEvent:
    db_event.status = EventStatus.rejected
    session.add(db_event)
    session.commit()
    session.refresh(db_event)
    return db_event
```

Also add `reject_event` to the imports in `crud.py` is not needed — it's defined there. But update the `__init__` imports if applicable (there is no `__init__` re-export here; routes import directly from `crud`).

- [ ] **Step 4: Add the reject endpoint to `backend/app/api/routes/events.py`**

Add after the `approve_event` endpoint. Also add `reject_event` to the crud import at the top of the file (the routes file uses `crud.reject_event` style, so no import change needed — it imports `crud` as a module).

```python
@router.post("/{id}/reject", response_model=QuizEventPublic)
def reject_event(
    *, session: SessionDep, current_user: CurrentUser, id: uuid.UUID
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    event = session.get(QuizEvent, id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.status != EventStatus.pending:
        raise HTTPException(status_code=400, detail="Only pending events can be rejected")
    return crud.reject_event(session=session, db_event=event)
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd backend
bash ./scripts/test.sh -k "test_reject" -- -v
```

Expected: All 5 PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/crud.py \
        backend/app/api/routes/events.py \
        backend/tests/api/routes/test_events.py
git commit -m "feat: add POST /events/{id}/reject endpoint"
```

---

## Task 3: `POST /events/{id}/set-pending` endpoint

**Files:**
- Modify: `backend/app/crud.py`
- Modify: `backend/app/api/routes/events.py`
- Modify: `backend/tests/api/routes/test_events.py`

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/api/routes/test_events.py`:

```python
def test_set_pending_from_rejected(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    from tests.utils.quiz import create_rejected_event
    event = create_rejected_event(db)
    response = client.post(
        f"{settings.API_V1_STR}/events/{event.id}/set-pending",
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    assert response.json()["status"] == "pending"


def test_set_pending_from_non_rejected_returns_400(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    # Both pending and approved events should return 400
    for create_fn in (create_random_event, create_approved_event):
        event = create_fn(db)
        response = client.post(
            f"{settings.API_V1_STR}/events/{event.id}/set-pending",
            headers=superuser_token_headers,
        )
        assert response.status_code == 400


def test_set_pending_as_organizer_forbidden(
    client: TestClient,
    organizer_token_headers: dict[str, str],
    db: Session,
) -> None:
    from tests.utils.quiz import create_rejected_event
    event = create_rejected_event(db)
    response = client.post(
        f"{settings.API_V1_STR}/events/{event.id}/set-pending",
        headers=organizer_token_headers,
    )
    assert response.status_code == 403


def test_set_pending_as_regular_user_forbidden(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
) -> None:
    from tests.utils.quiz import create_rejected_event
    event = create_rejected_event(db)
    response = client.post(
        f"{settings.API_V1_STR}/events/{event.id}/set-pending",
        headers=normal_user_token_headers,
    )
    assert response.status_code == 403
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend
bash ./scripts/test.sh -k "test_set_pending" -- -v
```

Expected: All FAIL with 404 (route not found).

- [ ] **Step 3: Add `set_event_pending` to `backend/app/crud.py`**

Add after `reject_event`:

```python
def set_event_pending(*, session: Session, db_event: QuizEvent) -> QuizEvent:
    db_event.status = EventStatus.pending
    session.add(db_event)
    session.commit()
    session.refresh(db_event)
    return db_event
```

- [ ] **Step 4: Add the set-pending endpoint to `backend/app/api/routes/events.py`**

Add after the `reject_event` endpoint:

```python
@router.post("/{id}/set-pending", response_model=QuizEventPublic)
def set_event_pending(
    *, session: SessionDep, current_user: CurrentUser, id: uuid.UUID
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    event = session.get(QuizEvent, id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.status != EventStatus.rejected:
        raise HTTPException(status_code=400, detail="Only rejected events can be returned to pending")
    return crud.set_event_pending(session=session, db_event=event)
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd backend
bash ./scripts/test.sh -k "test_set_pending" -- -v
```

Expected: All 4 PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/crud.py \
        backend/app/api/routes/events.py \
        backend/tests/api/routes/test_events.py
git commit -m "feat: add POST /events/{id}/set-pending endpoint"
```

---

## Task 4: `DELETE /events/{id}` endpoint

**Files:**
- Modify: `backend/app/crud.py`
- Modify: `backend/app/api/routes/events.py`
- Modify: `backend/tests/api/routes/test_events.py`

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/api/routes/test_events.py`:

```python
def test_delete_event_as_superuser(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    event = create_random_event(db)
    event_id = event.id
    response = client.delete(
        f"{settings.API_V1_STR}/events/{event_id}",
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    db.expire_all()
    assert db.get(QuizEvent, event_id) is None


def test_delete_event_cascades_results(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    event = create_random_event(db)
    player = create_random_player(db)
    result = EventResult(event_id=event.id, player_id=player.id, score=10.0)
    db.add(result)
    db.commit()
    db.refresh(result)
    result_id = result.id

    client.delete(
        f"{settings.API_V1_STR}/events/{event.id}",
        headers=superuser_token_headers,
    )

    db.expire_all()
    assert db.get(EventResult, result_id) is None


def test_delete_event_as_organizer_forbidden(
    client: TestClient,
    organizer_token_headers: dict[str, str],
    db: Session,
) -> None:
    event = create_random_event(db)
    response = client.delete(
        f"{settings.API_V1_STR}/events/{event.id}",
        headers=organizer_token_headers,
    )
    assert response.status_code == 403


def test_delete_event_as_regular_user_forbidden(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
) -> None:
    event = create_random_event(db)
    response = client.delete(
        f"{settings.API_V1_STR}/events/{event.id}",
        headers=normal_user_token_headers,
    )
    assert response.status_code == 403
```

Also add `QuizEvent` to the imports at the top of `test_events.py` if not already present:

```python
from app.models import EventResult, QuizEvent
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend
bash ./scripts/test.sh -k "test_delete_event" -- -v
```

Expected: All FAIL with 405 Method Not Allowed (no DELETE on `/events/{id}` yet).

- [ ] **Step 3: Add `delete_event` to `backend/app/crud.py`**

Add after `set_event_pending`:

```python
def delete_event(*, session: Session, db_event: QuizEvent) -> None:
    session.delete(db_event)
    session.commit()
```

- [ ] **Step 4: Add the delete endpoint to `backend/app/api/routes/events.py`**

Add after the `set_event_pending` endpoint:

```python
@router.delete("/{id}")
def delete_event(
    *, session: SessionDep, current_user: CurrentUser, id: uuid.UUID
) -> dict[str, str]:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    event = session.get(QuizEvent, id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    crud.delete_event(session=session, db_event=event)
    return {"message": "Event deleted successfully"}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd backend
bash ./scripts/test.sh -k "test_delete_event" -- -v
```

Expected: All 4 PASS.

- [ ] **Step 6: Run full test suite**

```bash
cd backend
bash ./scripts/test.sh
```

Expected: All tests pass (no regressions).

- [ ] **Step 7: Commit**

```bash
git add backend/app/crud.py \
        backend/app/api/routes/events.py \
        backend/tests/api/routes/test_events.py
git commit -m "feat: add DELETE /events/{id} endpoint"
```

---

## Task 5: Regenerate frontend API client

**Files:**
- Modify: `frontend/src/client/` (auto-generated)
- Modify: `frontend/openapi.json` (auto-generated)

The new endpoints (`/reject`, `/set-pending`, `DELETE /{id}`) need to be reflected in the TypeScript client before the frontend tasks can use them.

- [ ] **Step 1: Ensure the backend stack is running**

```bash
docker compose watch
```

Wait for `backend` to be healthy.

- [ ] **Step 2: Regenerate the client**

```bash
bash ./scripts/generate-client.sh
```

Expected: No errors. `frontend/src/client/sdk.gen.ts` is updated.

- [ ] **Step 3: Verify the new methods exist**

```bash
grep -E "rejectEvent|setEventPending|deleteEvent" frontend/src/client/sdk.gen.ts
```

Expected: Three matches.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/client/ frontend/openapi.json
git commit -m "chore: regenerate API client with reject, set-pending, delete event endpoints"
```

---

## Task 6: Extract `MetadataEditDialog` to shared component

**Files:**
- Create: `frontend/src/components/Events/MetadataEditDialog.tsx`
- Modify: `frontend/src/routes/_layout/admin_.events_.$id.tsx`

The dialog currently lives inline in the admin detail route. Extract it so both the admin and public event pages can import it.

- [ ] **Step 1: Create `frontend/src/components/Events/MetadataEditDialog.tsx`**

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Pencil } from "lucide-react"
import { useState } from "react"
import { useForm } from "react-hook-form"
import type { QuizEventPublic, QuizEventUpdate } from "@/client"
import { EventsService } from "@/client"
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

export function MetadataEditDialog({ event }: { event: QuizEventPublic }) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [open, setOpen] = useState(false)
  const [isMultiDay, setIsMultiDay] = useState(
    event.start_date !== event.end_date,
  )
  const { register, handleSubmit, reset } = useForm({
    defaultValues: {
      name: event.name,
      start_date: event.start_date,
      end_date: event.end_date,
      organizer_name: event.organizer_name,
      description: event.description ?? "",
    },
    shouldUnregister: true,
  })

  const mutation = useMutation({
    mutationFn: (data: QuizEventUpdate) =>
      EventsService.updateEvent({ id: event.id, requestBody: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "event", event.id] })
      queryClient.invalidateQueries({ queryKey: ["admin", "events"] })
      queryClient.invalidateQueries({ queryKey: ["events", event.id] })
      queryClient.invalidateQueries({ queryKey: ["events"] })
      showSuccessToast("Event updated")
      setOpen(false)
    },
    onError: () => showErrorToast("Failed to update event"),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (v) {
          reset({
            name: event.name,
            start_date: event.start_date,
            end_date: event.end_date,
            organizer_name: event.organizer_name,
            description: event.description ?? "",
          })
        }
        setIsMultiDay(event.start_date !== event.end_date)
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="h-4 w-4 mr-1" />
          Edit Metadata
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Event Metadata</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={handleSubmit((data) =>
            mutation.mutate({
              ...data,
              end_date: isMultiDay ? data.end_date : data.start_date,
            }),
          )}
          className="flex flex-col gap-4 pt-2"
        >
          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input {...register("name", { required: true })} />
          </div>
          <div className="grid gap-1.5">
            <Label>{isMultiDay ? "Start Date" : "Date"}</Label>
            <Input
              type="date"
              {...register("start_date", { required: true })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isMultiDay}
              onChange={(e) => setIsMultiDay(e.target.checked)}
            />
            Multi-day event
          </label>
          {isMultiDay && (
            <div className="grid gap-1.5">
              <Label>End Date</Label>
              <Input
                type="date"
                {...register("end_date", { required: isMultiDay })}
              />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label>Organizer Name</Label>
            <Input {...register("organizer_name")} />
          </div>
          <div className="grid gap-1.5">
            <Label>Description</Label>
            <textarea
              {...register("description")}
              rows={3}
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Update `frontend/src/routes/_layout/admin_.events_.$id.tsx` to import the shared component**

Remove the entire local `MetadataEditDialog` function (lines 48–167 in the original file) and replace the import block at the top with the shared component import. The local function and its imports (`Pencil`, `useForm`, `QuizEventUpdate`, `Dialog*`, `Input`, `Label`) can be removed if no longer used by anything else in the file.

Add this import:
```tsx
import { MetadataEditDialog } from "@/components/Events/MetadataEditDialog"
```

Remove from the import list any symbols that were only used by the local `MetadataEditDialog`: `useForm`, `QuizEventUpdate`, `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogTrigger`, `Input`, `Label`, `Pencil`.

Keep the usage in `EventDetailContent` unchanged — it still renders `<MetadataEditDialog event={event} />`.

- [ ] **Step 3: Type-check**

```bash
cd frontend
bun run build
```

Expected: Builds without errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Events/MetadataEditDialog.tsx \
        frontend/src/routes/_layout/admin_.events_.$id.tsx
git commit -m "refactor: extract MetadataEditDialog to shared component"
```

---

## Task 7: Admin Event Review page updates

**Files:**
- Modify: `frontend/src/routes/_layout/admin_.events.tsx`

Changes:
1. Add a Reject button to `EventRow` (shown only for pending events)
2. Add a "Rejected" section below "Pending Review"
3. Rename "All Events" section to "Approved Events" and pass `status="approved"` explicitly

- [ ] **Step 1: Replace `frontend/src/routes/_layout/admin_.events.tsx` with the updated version**

```tsx
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import {
  createFileRoute,
  Link as RouterLink,
  redirect,
} from "@tanstack/react-router"
import { Suspense } from "react"
import type { EventStatus, QuizEventPublic } from "@/client"
import { EventsService } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Labels } from "@/test-ids"
import useCustomToast from "@/hooks/useCustomToast"

export const Route = createFileRoute("/_layout/admin_/events")({
  component: AdminEvents,
  beforeLoad: async () => {
    const { UsersService } = await import("@/client")
    const user = await UsersService.readUserMe()
    if (!user.is_superuser) {
      throw redirect({ to: "/" })
    }
  },
  head: () => ({
    meta: [{ title: "Event Review - Admin" }],
  }),
})

function statusBadgeVariant(status: EventStatus) {
  if (status === "pending") return "destructive"
  if (status === "rejected") return "secondary"
  return "default"
}

function EventRow({ event }: { event: QuizEventPublic }) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const rejectMutation = useMutation({
    mutationFn: () => EventsService.rejectEvent({ id: event.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "events"] })
      showSuccessToast("Event rejected")
    },
    onError: () => showErrorToast("Failed to reject event"),
  })

  const dateRange =
    event.start_date === event.end_date
      ? event.start_date
      : `${event.start_date} – ${event.end_date}`

  return (
    <tr className="border-b">
      <td className="py-3 px-4 font-medium">
        <RouterLink
          to="/admin/events/$id"
          params={{ id: event.id }}
          className="hover:underline"
        >
          {event.name}
        </RouterLink>
      </td>
      <td className="py-3 px-4">{dateRange}</td>
      <td className="py-3 px-4">{event.organizer_name}</td>
      <td className="py-3 px-4">
        <Badge variant={statusBadgeVariant(event.status)}>
          {event.status}
        </Badge>
      </td>
      <td className="py-3 px-4">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <RouterLink to="/admin/events/$id" params={{ id: event.id }}>
              Review
            </RouterLink>
          </Button>
          {event.status === "pending" && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => rejectMutation.mutate()}
              disabled={rejectMutation.isPending}
            >
              {rejectMutation.isPending ? "Rejecting…" : "Reject"}
            </Button>
          )}
        </div>
      </td>
    </tr>
  )
}

function EventsTableContent({ status }: { status?: EventStatus }) {
  const { data } = useSuspenseQuery({
    queryKey: ["admin", "events", status ?? "all"],
    queryFn: () => EventsService.readEvents({ status, skip: 0, limit: 100 }),
  })
  const events = data.data

  if (events.length === 0) {
    return (
      <p className="text-muted-foreground text-sm py-4">
        {status === "pending"
          ? "No events pending review."
          : status === "rejected"
            ? "No rejected events."
            : "No events yet."}
      </p>
    )
  }

  return (
    <div className="rounded-md border">
      <table className="w-full">
        <thead className="bg-muted">
          <tr>
            <th className="py-3 px-4 text-left text-sm font-medium">Name</th>
            <th className="py-3 px-4 text-left text-sm font-medium">Date</th>
            <th className="py-3 px-4 text-left text-sm font-medium">
              Organizer
            </th>
            <th className="py-3 px-4 text-left text-sm font-medium">Status</th>
            <th className="py-3 px-4" />
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AdminEvents() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1
          className="text-2xl font-bold tracking-tight"
          data-testid={Labels.adminEventsPageHeading}
        >
          Event Review
        </h1>
        <p className="text-muted-foreground">
          Approve submitted events and manage results.
        </p>
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-3">Pending Review</h2>
        <Suspense
          fallback={
            <div className="animate-pulse h-24 w-full rounded bg-muted" />
          }
        >
          <EventsTableContent status="pending" />
        </Suspense>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Rejected</h2>
        <Suspense
          fallback={
            <div className="animate-pulse h-24 w-full rounded bg-muted" />
          }
        >
          <EventsTableContent status="rejected" />
        </Suspense>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Approved Events</h2>
        <Suspense
          fallback={
            <div className="animate-pulse h-24 w-full rounded bg-muted" />
          }
        >
          <EventsTableContent status="approved" />
        </Suspense>
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd frontend
bun run build
```

Expected: Builds without errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/routes/_layout/admin_.events.tsx
git commit -m "feat: add rejected section and reject button to admin event review page"
```

---

## Task 8: Admin Event Detail page — Reject/Return-to-Pending buttons

**Files:**
- Modify: `frontend/src/routes/_layout/admin_.events_.$id.tsx`

- [ ] **Step 1: Update `EventDetailContent` in `admin_.events_.$id.tsx`**

The `MetadataEditDialog` import was added in Task 6. Now update `EventDetailContent` to add reject/set-pending mutations and update the button row and badge variant.

Add these imports at the top of the file (if not already present):

```tsx
import { EventsService } from "@/client"
```

(It is already imported — no change needed there.)

Replace the `EventDetailContent` function with:

```tsx
function EventDetailContent({ id }: { id: string }) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const { data: event } = useSuspenseQuery({
    queryKey: ["admin", "event", id],
    queryFn: () => EventsService.readEvent({ id }),
  })

  const approveMutation = useMutation({
    mutationFn: () => EventsService.approveEvent({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "event", id] })
      queryClient.invalidateQueries({ queryKey: ["admin", "events"] })
      queryClient.invalidateQueries({ queryKey: ["events"] })
      showSuccessToast("Event approved and published")
    },
    onError: () => showErrorToast("Approval failed"),
  })

  const rejectMutation = useMutation({
    mutationFn: () => EventsService.rejectEvent({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "event", id] })
      queryClient.invalidateQueries({ queryKey: ["admin", "events"] })
      showSuccessToast("Event rejected")
    },
    onError: () => showErrorToast("Failed to reject event"),
  })

  const setPendingMutation = useMutation({
    mutationFn: () => EventsService.setEventPending({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "event", id] })
      queryClient.invalidateQueries({ queryKey: ["admin", "events"] })
      showSuccessToast("Event returned to pending")
    },
    onError: () => showErrorToast("Failed to return event to pending"),
  })

  const dateRange =
    event.start_date === event.end_date
      ? event.start_date
      : `${event.start_date} – ${event.end_date}`

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold tracking-tight">{event.name}</h1>
            <Badge
              variant={
                event.status === "pending"
                  ? "destructive"
                  : event.status === "rejected"
                    ? "secondary"
                    : "default"
              }
            >
              {event.status}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            {dateRange} · {event.organizer_name}
          </p>
        </div>
        <div className="flex gap-2">
          {event.status === "pending" && (
            <>
              <Button
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending}
              >
                {approveMutation.isPending ? "Approving…" : "Approve"}
              </Button>
              <Button
                variant="destructive"
                onClick={() => rejectMutation.mutate()}
                disabled={rejectMutation.isPending}
              >
                {rejectMutation.isPending ? "Rejecting…" : "Reject"}
              </Button>
            </>
          )}
          {event.status === "rejected" && (
            <Button
              variant="outline"
              onClick={() => setPendingMutation.mutate()}
              disabled={setPendingMutation.isPending}
            >
              {setPendingMutation.isPending
                ? "Returning…"
                : "Return to Pending"}
            </Button>
          )}
          <MetadataEditDialog event={event} />
        </div>
      </div>

      {event.description && (
        <p className="text-sm text-muted-foreground">{event.description}</p>
      )}

      <section>
        <h2 className="text-lg font-semibold mb-3">Results</h2>
        <Suspense
          fallback={
            <div className="animate-pulse h-40 w-full rounded bg-muted" />
          }
        >
          <ResultsTable eventId={id} />
        </Suspense>
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd frontend
bun run build
```

Expected: Builds without errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/routes/_layout/admin_.events_.$id.tsx
git commit -m "feat: add reject and return-to-pending buttons on admin event detail page"
```

---

## Task 9: Public event detail page — admin Edit + Delete controls

**Files:**
- Modify: `frontend/src/routes/_public/events_.$id.tsx`

When the logged-in user is a superuser, the event header shows Edit (opens `MetadataEditDialog`) and Delete (opens confirmation dialog, then redirects to `/events`).

- [ ] **Step 1: Replace `frontend/src/routes/_public/events_.$id.tsx` with the updated version**

```tsx
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Trash2 } from "lucide-react"
import { Suspense, useState } from "react"

import { EventsService } from "@/client"
import type { QuizEventPublic } from "@/client"
import { MetadataEditDialog } from "@/components/Events/MetadataEditDialog"
import { EventResultsTable } from "@/components/Events/EventResultsTable"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"

function getEventQueryOptions(id: string) {
  return {
    queryFn: () => EventsService.readEvent({ id }),
    queryKey: ["events", id],
  }
}

function getEventResultsQueryOptions(id: string) {
  return {
    queryFn: () => EventsService.readEventResultsWithPlayers({ id }),
    queryKey: ["events", id, "results"],
  }
}

export const Route = createFileRoute("/_public/events_/$id")({
  component: EventDetailPage,
  head: () => ({ meta: [{ title: "Event" }] }),
})

function AdminControls({ event }: { event: QuizEventPublic }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const deleteMutation = useMutation({
    mutationFn: () => EventsService.deleteEvent({ id: event.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] })
      showSuccessToast("Event deleted")
      navigate({ to: "/events" })
    },
    onError: () => showErrorToast("Failed to delete event"),
  })

  return (
    <div className="flex gap-2">
      <MetadataEditDialog event={event} />
      <Button
        variant="destructive"
        size="sm"
        onClick={() => setConfirmOpen(true)}
      >
        <Trash2 className="h-4 w-4 mr-1" />
        Delete
      </Button>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete event?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete the event and all its results. This
            cannot be undone.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function EventMeta({ id }: { id: string }) {
  const { data: event } = useSuspenseQuery(getEventQueryOptions(id))
  const { user } = useAuth()
  const fmt = event.format as {
    questions?: number
    rounds?: number
    categories?: string[]
  } | null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{event.name}</h1>
          <p className="text-muted-foreground">
            {event.start_date === event.end_date
              ? event.start_date
              : `${event.start_date} – ${event.end_date}`}
            {" · "}
            Organised by {event.organizer_name}
          </p>
        </div>
        {user?.is_superuser && <AdminControls event={event} />}
      </div>
      {event.description && (
        <p className="text-sm text-muted-foreground">{event.description}</p>
      )}
      {fmt && (
        <div className="flex gap-4 text-sm text-muted-foreground">
          {fmt.rounds && <span>{fmt.rounds} rounds</span>}
          {fmt.questions && <span>{fmt.questions} questions</span>}
          {fmt.categories?.length ? (
            <span>{fmt.categories.join(", ")}</span>
          ) : null}
        </div>
      )}
    </div>
  )
}

function EventResults({ id }: { id: string }) {
  const { data } = useSuspenseQuery(getEventResultsQueryOptions(id))

  if (data.data.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center">
        No results published yet.
      </p>
    )
  }

  return <EventResultsTable data={data.data} />
}

function EventDetailPage() {
  const { id } = Route.useParams()

  return (
    <div className="flex flex-col gap-8">
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <EventMeta id={id} />
      </Suspense>
      <div>
        <h2 className="text-lg font-semibold mb-4">Results</h2>
        <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
          <EventResults id={id} />
        </Suspense>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd frontend
bun run build
```

Expected: Builds without errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/routes/_public/events_.$id.tsx
git commit -m "feat: show admin edit/delete controls on public event detail page"
```

---

## Done

All tasks complete. The full test suite should pass:

```bash
cd backend && bash ./scripts/test.sh
```

And the frontend should build cleanly:

```bash
cd frontend && bun run build
```
