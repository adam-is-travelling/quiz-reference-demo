# Upload to Existing Event Design

## Goal

Allow organisers to upload CSV results to an existing event instead of always creating a new one, with a choice to append or replace existing results. Also allow admins to delete individual results from an event.

## Architecture

Two independent changes: (1) the upload wizard gains an "existing event" mode, and (2) the admin event detail page gains per-result deletion. The backend needs two modifications: a `mode` field on `SubmitResultsRequest` and a new `DELETE /{event_id}/results/{result_id}` endpoint.

## Tech Stack

FastAPI / SQLModel backend; React + TanStack Router + TanStack Query frontend; existing wizard component pattern.

---

## Backend

### `SubmitResultsRequest` — add `mode` field

`backend/app/models.py`:

```python
from enum import Enum

class SubmitMode(str, Enum):
    append = "append"
    replace = "replace"

class SubmitResultsRequest(SQLModel):
    results: list[ResolvedResultRow]
    mode: SubmitMode = SubmitMode.append
```

### `submit_results` endpoint — honour `mode`

`backend/app/api/routes/events.py`, `POST /{id}/results`:

- If `mode == "replace"`: existing behaviour — delete all current results before inserting.
- If `mode == "append"`: skip deletion, insert new results alongside existing ones, then recompute ranks across the full set.

### New `DELETE /{event_id}/results/{result_id}` endpoint

`backend/app/api/routes/events.py`:

```python
@router.delete("/{event_id}/results/{result_id}", status_code=204)
def delete_event_result(
    *,
    event_id: uuid.UUID,
    result_id: uuid.UUID,
    session: SessionDep,
    current_user: CurrentSuperuser,
) -> None:
    db_result = session.get(EventResult, result_id)
    if not db_result or db_result.event_id != event_id:
        raise HTTPException(status_code=404, detail="Event result not found")
    crud.delete_event_result(session=session, db_result=db_result)
```

`backend/app/crud.py` — add `delete_event_result`:

```python
def delete_event_result(*, session: Session, db_result: EventResult) -> None:
    event_id = db_result.event_id
    session.delete(db_result)
    session.commit()
    _recompute_ranks(session=session, event_id=event_id)
```

### Backend tests

`backend/tests/api/routes/test_events.py`:

- `test_submit_results_append` — submit two results, then append one more, assert total count is 3.
- `test_submit_results_replace` — submit two results, then replace with one, assert total count is 1.
- `test_delete_event_result_superuser` — delete a result, assert 204 and result is gone.
- `test_delete_event_result_forbidden_for_organizer` — assert 403.

---

## Frontend — Upload Wizard

### `WizardState` changes (`types.ts`)

Add two fields:

```ts
eventMode: "new" | "existing"
existingEventId: string | null
existingEventName: string | null
submitMode: "append" | "replace"
```

Update `INITIAL_STATE`:

```ts
eventMode: "new",
existingEventId: null,
existingEventName: null,
submitMode: "append",
```

### Step 0 — Event mode selection (`Step0ModeSelect.tsx`)

New component at `frontend/src/components/Upload/steps/Step0ModeSelect.tsx`.

Two large radio/button options:
- **New event** — create event metadata in Step 1
- **Existing event** — pick from a list in Step 1

Clicking either sets `eventMode` and advances to step 1. No other content on this screen.

### Step 1 — Toggle + conditional content (`Step1EventMeta.tsx`)

A segmented toggle at the top ("New event" / "Existing event") reflects and updates `eventMode`. Switching mode resets `existingEventId`, `existingEventName`, and `eventMeta` to initial values.

**New event mode:** existing metadata form, unchanged.

**Existing event mode:** replaces the form with a searchable `<select>` (or combobox) listing events fetched via `EventsService.readEvents({ skip: 0, limit: 200 })`. Selecting an event stores its `id` as `existingEventId` and its `name` as `existingEventName`. Next → is disabled until an event is selected.

### Steps 2–4 — Unchanged

### Step 5 — Preview (`Step5Preview.tsx`)

**New event path:** unchanged.

**Existing event path:**
- Show event name (read-only) instead of the event metadata fields.
- Show an append/replace toggle below the results table, defaulting to "Append":
  - **Append** — new results are added to existing ones.
  - **Replace** — existing results are cleared first.
- On submit, call `EventsService.submitResults` with the existing event ID and `mode: state.submitMode`.
- Skip `EventsService.createEvent`.

### `UploadWizard.tsx`

- Step labels become: `["Choose event", "Event details", "Results data", "Column mapping", "Match players", "Review & submit"]` — Step 0 is index 0, rest shift by 1.
- `state.step` range extends to `0 | 1 | 2 | 3 | 4 | 5 | 6`.
- Render `<Step0ModeSelect>` when `state.step === 0`.
- Initial step is `0`.

---

## Frontend — Admin Event Detail Page

### Per-result delete button (`admin_.events_.$id.tsx`)

Each result row already has a pencil (edit) button. Add a trash icon button (`Trash2` from lucide-react) alongside it.

Clicking delete calls `EventsService.deleteEventResult({ eventId, resultId })` via a `useMutation`. On success, invalidate `["admin", "event", id]`. No confirmation dialog — the action is immediately reversible by re-uploading.

---

## Frontend — Playwright Tests

New file: `frontend/tests/upload.spec.ts`

All tests in this file use the default superuser storage state (pre-authenticated). Tests that require an existing event in the database use the private API helpers (same pattern as `admin.spec.ts`) to create one before the test.

### Step 0 — mode selection

- **`Upload wizard shows mode selection as first step`** — navigate to `/upload`, assert both "New event" and "Existing event" options are visible before any other wizard content.
- **`Selecting New event advances to event details step`** — click "New event", assert the event name input is visible.
- **`Selecting Existing event advances to event picker step`** — click "Existing event", assert the event picker/dropdown is visible and the event name input is not.

### Step 1 — toggle

- **`Toggle switches between new and existing event mode`** — select "New event" from Step 0, then click the "Existing event" toggle in Step 1, assert the metadata form is replaced by the event picker.
- **`Switching mode resets selection`** — select "Existing event", pick an event, switch to "New event" via toggle, switch back to "Existing event", assert no event is pre-selected.

### Step 5 — append/replace (existing event path)

- **`Append/replace toggle is visible in preview for existing event`** — complete the wizard to Step 5 using an existing event, assert the append/replace toggle is visible.
- **`Append is selected by default`** — assert "Append" option is selected when Step 5 first renders.
- **`Append/replace toggle is not visible for new event path`** — complete the wizard to Step 5 using new event mode, assert the toggle is not present.

### Admin event detail — delete result

New tests added to `frontend/tests/admin.spec.ts` under a new `describe` block: `"Admin event result deletion"`.

- **`Delete button is visible on each result row`** — navigate to an admin event detail page that has results, assert at least one delete button is visible.
- **`Deleting a result removes it from the list`** — click delete on a result row, assert that row is no longer visible.

---

## Regenerate frontend client

After backend changes, run `bash ./scripts/generate-client.sh` from the project root to pick up `SubmitMode`, the updated `SubmitResultsRequest`, and the new DELETE endpoint.
