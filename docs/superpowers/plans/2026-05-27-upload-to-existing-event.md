# Upload to Existing Event Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow organisers to upload CSV results to an existing event (append or replace), and allow admins to delete individual results from the event detail page.

**Architecture:** Backend gains a `mode` body field on `POST /{id}/results` controlling append-vs-replace behaviour. The upload wizard gains a new Step 0 (mode selection) and Step 1 toggle (new vs existing event), with Step 5 showing the append/replace choice only on the existing-event path. The admin event detail page gains a per-row delete button wired to the existing DELETE endpoint.

**Tech Stack:** FastAPI / SQLModel / pytest (backend); React / TanStack Router / TanStack Query / react-hook-form / Playwright (frontend).

---

### Task 1: Add `SubmitMode` enum and `mode` field to `SubmitResultsRequest`

**Files:**
- Modify: `backend/app/models.py` (around line 428 — `SubmitResultsRequest`)

**Context:** `SubmitResultsRequest` is the request body for `POST /{id}/results`. It currently only has a `results` list. We need to add a `mode` field defaulting to `"append"`.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/api/routes/test_events.py`:

```python
def test_submit_results_mode_defaults_to_append(
    client: TestClient, organizer_token_headers: dict[str, str], db: Session
) -> None:
    event = create_approved_event(db)
    player = create_random_player(db)
    # Submit without a mode field
    response = client.post(
        f"{settings.API_V1_STR}/events/{event.id}/results",
        json={"results": [{"player_id": str(player.id), "score": 10.0, "tiebreaker_rank": 1}]},
        headers=organizer_token_headers,
    )
    assert response.status_code == 200
```

- [ ] **Step 2: Run test to verify it fails**

```bash
docker compose exec backend bash scripts/tests-start.sh -x -k test_submit_results_mode_defaults_to_append
```

Expected: FAIL (validation error — `mode` not yet accepted).

- [ ] **Step 3: Add `SubmitMode` and update `SubmitResultsRequest`**

In `backend/app/models.py`, find `class SubmitResultsRequest` (line ~428) and replace it:

```python
class SubmitMode(str, enum.Enum):
    append = "append"
    replace = "replace"


class SubmitResultsRequest(SQLModel):
    results: list[ResolvedResultRow]
    mode: SubmitMode = SubmitMode.append
```

`enum` is already imported in models.py — check the top of the file; if not, add `import enum`.

- [ ] **Step 4: Run test to verify it passes**

```bash
docker compose exec backend bash scripts/tests-start.sh -x -k test_submit_results_mode_defaults_to_append
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/tests/api/routes/test_events.py
git commit -m "feat: add SubmitMode enum and mode field to SubmitResultsRequest"
```

---

### Task 2: Update `submit_results` endpoint to honour `mode`

**Files:**
- Modify: `backend/app/api/routes/events.py` (the `submit_results` function, currently clears all results unconditionally)

**Context:** Currently the endpoint always deletes existing results before inserting. With `mode=append` it should skip deletion; with `mode=replace` it should clear first (existing behaviour). After inserting, ranks are recomputed via `crud.create_event_results` which calls `_recompute_ranks` internally — verify this is the case, or call it explicitly.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/api/routes/test_events.py`:

```python
def test_submit_results_append(
    client: TestClient, organizer_token_headers: dict[str, str], db: Session
) -> None:
    event = create_approved_event(db)
    player1 = create_random_player(db)
    player2 = create_random_player(db)
    player3 = create_random_player(db)
    # First submission
    client.post(
        f"{settings.API_V1_STR}/events/{event.id}/results",
        json={"results": [
            {"player_id": str(player1.id), "score": 10.0, "tiebreaker_rank": 1},
            {"player_id": str(player2.id), "score": 8.0, "tiebreaker_rank": 1},
        ], "mode": "replace"},
        headers=organizer_token_headers,
    )
    # Append a third
    response = client.post(
        f"{settings.API_V1_STR}/events/{event.id}/results",
        json={"results": [
            {"player_id": str(player3.id), "score": 6.0, "tiebreaker_rank": 1},
        ], "mode": "append"},
        headers=organizer_token_headers,
    )
    assert response.status_code == 200
    assert response.json()["count"] == 3


def test_submit_results_replace(
    client: TestClient, organizer_token_headers: dict[str, str], db: Session
) -> None:
    event = create_approved_event(db)
    player1 = create_random_player(db)
    player2 = create_random_player(db)
    # First submission with two results
    client.post(
        f"{settings.API_V1_STR}/events/{event.id}/results",
        json={"results": [
            {"player_id": str(player1.id), "score": 10.0, "tiebreaker_rank": 1},
            {"player_id": str(player2.id), "score": 8.0, "tiebreaker_rank": 1},
        ], "mode": "replace"},
        headers=organizer_token_headers,
    )
    # Replace with one result
    response = client.post(
        f"{settings.API_V1_STR}/events/{event.id}/results",
        json={"results": [
            {"player_id": str(player1.id), "score": 10.0, "tiebreaker_rank": 1},
        ], "mode": "replace"},
        headers=organizer_token_headers,
    )
    assert response.status_code == 200
    assert response.json()["count"] == 1
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
docker compose exec backend bash scripts/tests-start.sh -x -k "test_submit_results_append or test_submit_results_replace"
```

Expected: FAIL (append test gets count=1 instead of 3).

- [ ] **Step 3: Update `submit_results` to branch on `mode`**

In `backend/app/api/routes/events.py`, replace the block that unconditionally clears results:

```python
@router.post("/{id}/results", response_model=EventResultsPublic)
def submit_results(
    *,
    session: SessionDep,
    current_user: CurrentOrganizer,  # noqa: ARG001
    id: uuid.UUID,
    request: SubmitResultsRequest,
) -> Any:
    event = session.get(QuizEvent, id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if request.mode == SubmitMode.replace:
        existing = session.exec(select(EventResult).where(EventResult.event_id == id)).all()
        for r in existing:
            session.delete(r)
        session.flush()

    creates: list[EventResultCreate] = []
    for row in request.results:
        if row.player_id:
            player_id = row.player_id
        elif row.player_create:
            player = crud.create_player(session=session, player_in=row.player_create)
            player_id = player.id
        else:
            raise HTTPException(
                status_code=400,
                detail="Each result row must supply player_id or player_create",
            )
        creates.append(
            EventResultCreate(
                player_id=player_id,
                score=row.score,
                tiebreaker_rank=row.tiebreaker_rank,
            )
        )
    db_results = crud.create_event_results(
        session=session, event_id=id, results=creates
    )
    return EventResultsPublic(data=db_results, count=len(db_results))
```

Also add `SubmitMode` to the import from `app.models` at the top of `events.py`. Check the existing import line — it will look like:

```python
from app.models import (
    ...
    SubmitResultsRequest,
    ...
)
```

Add `SubmitMode` to that list.

- [ ] **Step 4: Run tests to verify they pass**

```bash
docker compose exec backend bash scripts/tests-start.sh -x -k "test_submit_results_append or test_submit_results_replace"
```

Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/routes/events.py backend/tests/api/routes/test_events.py
git commit -m "feat: honour submit mode (append/replace) in submit_results endpoint"
```

---

### Task 3: Backend tests for result deletion

**Files:**
- Modify: `backend/tests/api/routes/test_events.py`

**Context:** The `DELETE /{id}/results/{result_id}` endpoint and `crud.delete_event_result` already exist. We just need tests to lock in the behaviour. Check the existing delete endpoint signature in `backend/app/api/routes/events.py` — it uses `CurrentUser` with a manual superuser check and returns `{"message": "..."}` with 200 (not 204).

- [ ] **Step 1: Write the tests**

Add to `backend/tests/api/routes/test_events.py`:

```python
def test_delete_event_result_superuser(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    event = create_approved_event(db)
    player = create_random_player(db)
    result = EventResult(
        event_id=event.id, player_id=player.id, score=20.0, tiebreaker_rank=1, final_rank=1
    )
    db.add(result)
    db.commit()
    db.refresh(result)

    response = client.delete(
        f"{settings.API_V1_STR}/events/{event.id}/results/{result.id}",
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    assert db.get(EventResult, result.id) is None


def test_delete_event_result_forbidden_for_organizer(
    client: TestClient, organizer_token_headers: dict[str, str], db: Session
) -> None:
    event = create_approved_event(db)
    player = create_random_player(db)
    result = EventResult(
        event_id=event.id, player_id=player.id, score=20.0, tiebreaker_rank=1, final_rank=1
    )
    db.add(result)
    db.commit()
    db.refresh(result)

    response = client.delete(
        f"{settings.API_V1_STR}/events/{event.id}/results/{result.id}",
        headers=organizer_token_headers,
    )
    assert response.status_code == 403
```

Make sure `EventResult` is imported at the top of the test file — check for it; if missing, add:

```python
from app.models import EventResult
```

- [ ] **Step 2: Run tests**

```bash
docker compose exec backend bash scripts/tests-start.sh -x -k "test_delete_event_result"
```

Expected: both PASS (endpoint already exists).

- [ ] **Step 3: Commit**

```bash
git add backend/tests/api/routes/test_events.py
git commit -m "test: add backend tests for event result deletion"
```

---

### Task 4: Regenerate frontend client

**Files:**
- Modify: `frontend/src/client/` (auto-generated — do not edit by hand)
- Modify: `frontend/openapi.json` (auto-generated)

**Context:** The backend now has a new `SubmitMode` enum and updated `SubmitResultsRequest`. The frontend client must be regenerated so TypeScript knows about `mode: "append" | "replace"`. Requires the Docker stack to be running.

- [ ] **Step 1: Verify the stack is running**

```bash
docker compose ps
```

Expected: `backend` service shows `Up` and `(healthy)`.

- [ ] **Step 2: Regenerate the client**

From the project root:

```bash
bash ./scripts/generate-client.sh
```

Expected output ends with `🚀 Done! Your output is in .../frontend/src/client`.

- [ ] **Step 3: Verify `SubmitMode` appeared in the client**

```bash
grep -r "SubmitMode\|append.*replace\|submit_mode" frontend/src/client/ | head -10
```

Expected: lines showing `SubmitMode`, `"append"`, `"replace"` in the generated types.

- [ ] **Step 4: Type-check**

```bash
cd frontend && bunx tsc -p tsconfig.build.json --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/client/ frontend/openapi.json
git commit -m "chore: regenerate frontend client with SubmitMode"
```

---

### Task 5: Extend `WizardState` with new fields

**Files:**
- Modify: `frontend/src/components/Upload/types.ts`

**Context:** `WizardState` needs four new fields: `eventMode`, `existingEventId`, `existingEventName`, `submitMode`. The step range also extends from `1–5` to `0–5` (Step 0 is the new mode selection screen). `INITIAL_STATE` must be updated to match.

- [ ] **Step 1: Update `types.ts`**

Replace the full contents of `frontend/src/components/Upload/types.ts`:

```ts
import type { ParsedResultWithCandidates, PlayerCreate } from "@/client"

export type EventMeta = {
  name: string
  start_date: string
  end_date: string
  organizer_name: string
  description: string
  series_id: string
  organization_id: string
  format_questions: string
  format_rounds: string
  format_categories: string
}

export type ColumnMapping = {
  player_name: number
  country: number
  score: number
  tiebreaker_rank: number
}

export type Resolution = {
  player_id: string | null
  player_create: PlayerCreate | null
}

export type WizardState = {
  step: 0 | 1 | 2 | 3 | 4 | 5
  eventMode: "new" | "existing"
  existingEventId: string | null
  existingEventName: string | null
  submitMode: "append" | "replace"
  eventMeta: EventMeta
  rawCsv: string
  parsedRows: string[][]
  columnMapping: ColumnMapping
  parsedResults: ParsedResultWithCandidates[]
  resolutions: Resolution[]
  eventId: string | null
}

export const INITIAL_STATE: WizardState = {
  step: 0,
  eventMode: "new",
  existingEventId: null,
  existingEventName: null,
  submitMode: "append",
  eventMeta: {
    name: "",
    start_date: "",
    end_date: "",
    organizer_name: "",
    description: "",
    series_id: "",
    organization_id: "",
    format_questions: "",
    format_rounds: "",
    format_categories: "",
  },
  rawCsv: "",
  parsedRows: [],
  columnMapping: { player_name: 0, country: 1, score: 2, tiebreaker_rank: 3 },
  parsedResults: [],
  resolutions: [],
  eventId: null,
}
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && bunx tsc -p tsconfig.build.json --noEmit
```

Expected: no new errors (existing steps reference `state.step` which will now allow `0`).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Upload/types.ts
git commit -m "feat: extend WizardState with eventMode, existingEvent, and submitMode fields"
```

---

### Task 6: `Step0ModeSelect` component

**Files:**
- Create: `frontend/src/components/Upload/steps/Step0ModeSelect.tsx`

**Context:** This is the new first screen of the wizard. It presents two options — "New event" and "Existing event" — as large clickable cards. Clicking either sets `eventMode` and advances to step 1. No form, no Next button — clicking the card is the action.

- [ ] **Step 1: Create `Step0ModeSelect.tsx`**

```tsx
import { Briefcase, FolderOpen } from "lucide-react"
import type { WizardState } from "../types"

interface Props {
  state: WizardState
  update: (patch: Partial<WizardState>) => void
}

export function Step0ModeSelect({ update }: Props) {
  const select = (mode: "new" | "existing") => {
    update({ eventMode: mode, step: 1 })
  }

  return (
    <div className="flex flex-col gap-4 max-w-xl">
      <p className="text-sm text-muted-foreground">
        Are you uploading results for a new event, or adding to one that already exists?
      </p>
      <div className="grid grid-cols-2 gap-4">
        <button
          type="button"
          onClick={() => select("new")}
          className="flex flex-col items-center gap-3 rounded-lg border-2 border-muted p-6 text-center hover:border-primary hover:bg-muted/50 transition-colors"
        >
          <Briefcase className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="font-semibold">New event</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Create a new event and upload results
            </p>
          </div>
        </button>
        <button
          type="button"
          onClick={() => select("existing")}
          className="flex flex-col items-center gap-3 rounded-lg border-2 border-muted p-6 text-center hover:border-primary hover:bg-muted/50 transition-colors"
        >
          <FolderOpen className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="font-semibold">Existing event</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Add or replace results for an event already in the system
            </p>
          </div>
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && bunx tsc -p tsconfig.build.json --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Upload/steps/Step0ModeSelect.tsx
git commit -m "feat: add Step0ModeSelect component for upload wizard"
```

---

### Task 7: `Step1EventMeta` — mode toggle and existing event picker

**Files:**
- Modify: `frontend/src/components/Upload/steps/Step1EventMeta.tsx`

**Context:** Step 1 needs a toggle at the top so the user can switch between "New event" and "Existing event" without going back to Step 0. When in "existing" mode the metadata form is replaced by a searchable select of approved events. Switching mode resets `existingEventId`, `existingEventName`, and `eventMeta` to their initial values. The `INITIAL_EVENT_META` constant must be extracted from `INITIAL_STATE` in `types.ts` — use the same values, don't import `INITIAL_STATE` directly (that would create a circular dependency risk). `Next →` is disabled in "existing" mode until an event is selected.

- [ ] **Step 1: Replace the full contents of `Step1EventMeta.tsx`**

```tsx
import { useQuery } from "@tanstack/react-query"
import { useForm } from "react-hook-form"

import { EventsService, OrganizationsService, SeriesService } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { EventMeta, WizardState } from "../types"

interface Props {
  state: WizardState
  update: (patch: Partial<WizardState>) => void
}

const EMPTY_EVENT_META: EventMeta = {
  name: "",
  start_date: "",
  end_date: "",
  organizer_name: "",
  description: "",
  series_id: "",
  organization_id: "",
  format_questions: "",
  format_rounds: "",
  format_categories: "",
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: "new" | "existing"
  onChange: (m: "new" | "existing") => void
}) {
  return (
    <div className="flex rounded-md border overflow-hidden self-start">
      {(["new", "existing"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={`px-4 py-1.5 text-sm ${
            mode === m
              ? "bg-primary text-primary-foreground"
              : "bg-background text-muted-foreground hover:bg-muted"
          }`}
        >
          {m === "new" ? "New event" : "Existing event"}
        </button>
      ))}
    </div>
  )
}

function ExistingEventPicker({
  value,
  onChange,
}: {
  value: string | null
  onChange: (id: string, name: string) => void
}) {
  const { data } = useQuery({
    queryFn: () => EventsService.readEvents({ skip: 0, limit: 200 }),
    queryKey: ["events", "all"],
  })

  return (
    <div className="grid gap-1.5">
      <Label>Select event</Label>
      <select
        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={value ?? ""}
        onChange={(e) => {
          const event = data?.data.find((ev) => ev.id === e.target.value)
          if (event) onChange(event.id, event.name)
        }}
      >
        <option value="" disabled>
          — choose an event —
        </option>
        {data?.data.map((ev) => (
          <option key={ev.id} value={ev.id}>
            {ev.name} ({ev.start_date})
          </option>
        ))}
      </select>
    </div>
  )
}

export function Step1EventMeta({ state, update }: Props) {
  const { data: orgs } = useQuery({
    queryFn: () => OrganizationsService.readOrganizations({ skip: 0, limit: 100 }),
    queryKey: ["organizations"],
  })
  const { data: seriesList } = useQuery({
    queryFn: () => SeriesService.readSeries({ skip: 0, limit: 100 }),
    queryKey: ["series"],
  })

  const { register, handleSubmit, setValue } = useForm<EventMeta>({
    defaultValues: state.eventMeta,
  })

  const onSubmit = (data: EventMeta) => {
    update({ eventMeta: data, step: 2 })
  }

  const handleModeChange = (mode: "new" | "existing") => {
    update({
      eventMode: mode,
      existingEventId: null,
      existingEventName: null,
      eventMeta: EMPTY_EVENT_META,
    })
  }

  return (
    <div className="flex flex-col gap-4 max-w-xl">
      <ModeToggle mode={state.eventMode} onChange={handleModeChange} />

      {state.eventMode === "existing" ? (
        <div className="flex flex-col gap-4">
          <ExistingEventPicker
            value={state.existingEventId}
            onChange={(id, name) =>
              update({ existingEventId: id, existingEventName: name })
            }
          />
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => update({ step: 0 })}>
              ← Back
            </Button>
            <Button
              onClick={() => update({ step: 2 })}
              disabled={!state.existingEventId}
            >
              Next →
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="name">Event name *</Label>
            <Input id="name" {...register("name", { required: true })} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="start_date">Start date *</Label>
              <Input id="start_date" type="date" {...register("start_date", { required: true })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="end_date">End date *</Label>
              <Input id="end_date" type="date" {...register("end_date", { required: true })} />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="organizer_name">Organiser name *</Label>
            <Input id="organizer_name" {...register("organizer_name", { required: true })} />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="description">Description</Label>
            <textarea
              id="description"
              rows={3}
              className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
              {...register("description")}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Series (optional)</Label>
            <Select onValueChange={(v) => setValue("series_id", v)}>
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                {seriesList?.data.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label>Organization (optional)</Label>
            <Select onValueChange={(v) => setValue("organization_id", v)}>
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                {orgs?.data.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="format_rounds">Rounds</Label>
              <Input id="format_rounds" type="number" {...register("format_rounds")} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="format_questions">Questions</Label>
              <Input id="format_questions" type="number" {...register("format_questions")} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="format_categories">Categories</Label>
              <Input id="format_categories" placeholder="comma-separated" {...register("format_categories")} />
            </div>
          </div>

          <div className="flex gap-3">
            <Button variant="outline" type="button" onClick={() => update({ step: 0 })}>
              ← Back
            </Button>
            <Button type="submit">Next →</Button>
          </div>
        </form>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && bunx tsc -p tsconfig.build.json --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Upload/steps/Step1EventMeta.tsx
git commit -m "feat: add mode toggle and existing event picker to Step1EventMeta"
```

---

### Task 8: Wire Step 0 into `UploadWizard`

**Files:**
- Modify: `frontend/src/components/Upload/UploadWizard.tsx`

**Context:** `UploadWizard` needs to render `Step0ModeSelect` when `state.step === 0`, update its step labels to include "Choose event" as the first label, and import the new component. `INITIAL_STATE` already sets `step: 0` from Task 5.

- [ ] **Step 1: Replace `UploadWizard.tsx`**

```tsx
import { useState } from "react"
import { Step0ModeSelect } from "./steps/Step0ModeSelect"
import { Step1EventMeta } from "./steps/Step1EventMeta"
import { Step2CsvInput } from "./steps/Step2CsvInput"
import { Step3ColumnMapping } from "./steps/Step3ColumnMapping"
import { Step4Disambiguation } from "./steps/Step4Disambiguation"
import { Step5Preview } from "./steps/Step5Preview"
import { INITIAL_STATE, type WizardState } from "./types"

const STEP_LABELS = [
  "Choose event",
  "Event details",
  "Results data",
  "Column mapping",
  "Match players",
  "Review & submit",
]

export function UploadWizard() {
  const [state, setState] = useState<WizardState>(INITIAL_STATE)

  const update = (patch: Partial<WizardState>) =>
    setState((s) => ({ ...s, ...patch }))

  return (
    <div className="flex flex-col gap-6">
      <ol className="flex gap-2">
        {STEP_LABELS.map((label, i) => {
          const active = i === state.step
          const done = i < state.step
          return (
            <li
              key={label}
              className={`flex items-center gap-1.5 text-sm ${
                active
                  ? "font-semibold text-foreground"
                  : done
                    ? "text-muted-foreground"
                    : "text-muted-foreground/50"
              }`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                  done
                    ? "bg-primary text-primary-foreground"
                    : active
                      ? "border-2 border-primary text-primary"
                      : "border border-muted-foreground/30"
                }`}
              >
                {done ? "✓" : i + 1}
              </span>
              <span className="hidden sm:inline">{label}</span>
            </li>
          )
        })}
      </ol>

      {state.step === 0 && <Step0ModeSelect state={state} update={update} />}
      {state.step === 1 && <Step1EventMeta state={state} update={update} />}
      {state.step === 2 && <Step2CsvInput state={state} update={update} />}
      {state.step === 3 && <Step3ColumnMapping state={state} update={update} />}
      {state.step === 4 && <Step4Disambiguation state={state} update={update} />}
      {state.step === 5 && <Step5Preview state={state} update={update} />}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && bunx tsc -p tsconfig.build.json --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Upload/UploadWizard.tsx
git commit -m "feat: wire Step0ModeSelect into UploadWizard, update step labels"
```

---

### Task 9: `Step5Preview` — append/replace toggle for existing event path

**Files:**
- Modify: `frontend/src/components/Upload/steps/Step5Preview.tsx`

**Context:** When `state.eventMode === "existing"`, Step 5 must (a) skip `createEvent` and use `state.existingEventId` directly, (b) show the existing event name instead of the metadata fields, and (c) show an append/replace toggle below the results table defaulting to `state.submitMode` ("append"). On the new-event path, behaviour is unchanged. Use string literals `"append"` and `"replace"` rather than importing the `SubmitMode` enum, since the generated client exports it as a type union.

- [ ] **Step 1: Replace `Step5Preview.tsx`**

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"

import { EventsService } from "@/client"
import { Button } from "@/components/ui/button"
import useCustomToast from "@/hooks/useCustomToast"
import type { WizardState } from "../types"

interface Props {
  state: WizardState
  update: (patch: Partial<WizardState>) => void
}

function buildEventMeta(meta: WizardState["eventMeta"]) {
  const format =
    meta.format_rounds || meta.format_questions
      ? {
          rounds: parseInt(meta.format_rounds || "0", 10),
          questions: parseInt(meta.format_questions || "0", 10),
          categories: meta.format_categories
            ? meta.format_categories.split(",").map((s) => s.trim()).filter(Boolean)
            : [],
        }
      : undefined

  return {
    name: meta.name,
    start_date: meta.start_date,
    end_date: meta.end_date,
    organizer_name: meta.organizer_name,
    description: meta.description || undefined,
    series_id: meta.series_id || undefined,
    organization_id: meta.organization_id || undefined,
    format,
  }
}

export function Step5Preview({ state, update }: Props) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const parseRows = state.parsedRows.slice(1).map((row) => ({
    player_name: row[state.columnMapping.player_name] ?? "",
    country: row[state.columnMapping.country] ?? "",
    score: parseFloat(row[state.columnMapping.score] ?? "0"),
    tiebreaker_rank: parseInt(row[state.columnMapping.tiebreaker_rank] ?? "1", 10),
  }))

  const submitMutation = useMutation({
    mutationFn: async () => {
      const results = state.resolutions.map((r, i) => ({
        player_id: r.player_id ?? undefined,
        player_create: r.player_create ?? undefined,
        score: parseRows[i]?.score ?? 0,
        tiebreaker_rank: parseRows[i]?.tiebreaker_rank ?? 1,
      }))

      if (state.eventMode === "existing") {
        await EventsService.submitResults({
          id: state.existingEventId!,
          requestBody: { results, mode: state.submitMode },
        })
      } else {
        const event = await EventsService.createEvent({
          requestBody: buildEventMeta(state.eventMeta),
        })
        await EventsService.submitResults({
          id: event.id,
          requestBody: { results, mode: "replace" },
        })
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] })
      showSuccessToast("Results submitted for review.")
      navigate({ to: "/" })
    },
    onError: () => {
      showErrorToast("Submission failed. Please try again.")
    },
  })

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      <div className="rounded-lg border p-4 flex flex-col gap-2 text-sm">
        {state.eventMode === "existing" ? (
          <p>
            <span className="font-medium">Event:</span> {state.existingEventName}
          </p>
        ) : (
          <>
            <p>
              <span className="font-medium">Event:</span> {state.eventMeta.name}
            </p>
            <p>
              <span className="font-medium">Dates:</span>{" "}
              {state.eventMeta.start_date} – {state.eventMeta.end_date}
            </p>
            <p>
              <span className="font-medium">Organiser:</span>{" "}
              {state.eventMeta.organizer_name}
            </p>
          </>
        )}
        <p>
          <span className="font-medium">Results:</span> {state.resolutions.length} entries
        </p>
        <p className="text-muted-foreground">
          {state.resolutions.filter((r) => r.player_create).length} new players will be created.
        </p>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted">
            <tr>
              <th className="px-3 py-2 text-left">Player</th>
              <th className="px-3 py-2 text-left">Score</th>
              <th className="px-3 py-2 text-left">Tiebreaker</th>
            </tr>
          </thead>
          <tbody>
            {state.resolutions.map((r, i) => {
              const row = parseRows[i]
              const name = r.player_create?.display_name ?? parseRows[i]?.player_name ?? "—"
              return (
                <tr key={i} className="border-t">
                  <td className="px-3 py-1.5">
                    {name}
                    {r.player_create && (
                      <span className="ml-1 text-muted-foreground">(new)</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums">{row?.score}</td>
                  <td className="px-3 py-1.5 tabular-nums">{row?.tiebreaker_rank}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {state.eventMode === "existing" && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">Submit mode</p>
          <div
            className="flex rounded-md border overflow-hidden self-start"
            data-testid="submit-mode-toggle"
          >
            {(["append", "replace"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => update({ submitMode: m })}
                className={`px-4 py-1.5 text-sm capitalize ${
                  state.submitMode === m
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {state.submitMode === "append"
              ? "New results will be added alongside existing ones."
              : "Existing results will be cleared before uploading."}
          </p>
        </div>
      )}

      <div className="flex gap-3">
        <Button variant="outline" onClick={() => update({ step: 4 })}>
          ← Back
        </Button>
        <Button onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending}>
          {submitMutation.isPending ? "Submitting…" : "Submit for review"}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && bunx tsc -p tsconfig.build.json --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Upload/steps/Step5Preview.tsx
git commit -m "feat: add append/replace toggle to Step5Preview for existing event path"
```

---

### Task 10: Playwright tests — admin event result deletion

**Files:**
- Create: `frontend/src/test-ids.ts`
- Modify: `frontend/src/routes/_layout/admin_.events_.$id.tsx`
- Modify: `frontend/src/routes/_layout/admin_.events.tsx`
- Modify: `frontend/tests/admin.spec.ts`

**Context:** The delete button is already implemented in `admin_.events_.$id.tsx`. We need to add `data-testid` attributes so Playwright can target elements reliably, then write the routing regression tests (which were discussed earlier but never committed) and the delete tests. Create `test-ids.ts` fresh — it does not exist on disk.

- [ ] **Step 1: Create `frontend/src/test-ids.ts`**

```ts
export const Labels = {
  adminEventsPageHeading: "admin-events-page-heading",
  resultDeleteButton: "result-delete-button",
} as const
```

- [ ] **Step 2: Add `data-testid` to the heading in `admin_.events.tsx`**

Add `import { Labels } from "@/test-ids"` to the imports, then update the `<h1>` in `AdminEvents`:

```tsx
<h1 className="text-2xl font-bold tracking-tight" data-testid={Labels.adminEventsPageHeading}>
  Event Review
</h1>
```

- [ ] **Step 3: Add `data-testid` to the delete button in `admin_.events_.$id.tsx`**

Add `import { Labels } from "@/test-ids"` to the imports, then update the destructive `Button` inside `ResultRow`:

```tsx
<Button
  size="sm"
  variant="destructive"
  data-testid={Labels.resultDeleteButton}
  onClick={() => deleteMutation.mutate()}
  disabled={deleteMutation.isPending}
>
  <Trash2 className="h-3 w-3" />
</Button>
```

- [ ] **Step 4: Type-check**

```bash
cd frontend && bunx tsc -p tsconfig.build.json --noEmit
```

Expected: no errors.

- [ ] **Step 5: Add tests to `frontend/tests/admin.spec.ts`**

Add `import { Labels } from "../src/test-ids"` alongside the existing imports at the top of the file, then add two new describe blocks at the end:

```ts
// Regression: admin.events.tsx was previously nested under admin.tsx in TanStack Router's
// flat-file convention. admin.tsx has no <Outlet />, so /admin/events rendered the Users
// page instead of Event Review. Fix: rename to admin_.events.tsx (trailing _ breaks nesting).
test.describe("Admin event review routing", () => {
  test("/admin/events shows Event Review, not Users", async ({ page }) => {
    await page.goto("/admin/events")
    await expect(page.getByTestId(Labels.adminEventsPageHeading)).toBeVisible()
    await expect(page.getByRole("heading", { name: "Users" })).not.toBeVisible()
  })

  test("/admin/events shows Pending Review section", async ({ page }) => {
    await page.goto("/admin/events")
    await expect(page.getByRole("heading", { name: "Pending Review" })).toBeVisible()
  })

  test("Review Events sidebar link navigates to /admin/events", async ({ page }) => {
    await page.goto("/")
    await page.getByRole("link", { name: "Review Events" }).click()
    await page.waitForURL("/admin/events")
    await expect(page.getByTestId(Labels.adminEventsPageHeading)).toBeVisible()
  })
})

test.describe("Admin event result deletion", () => {
  test("Delete button is visible on result rows when results exist", async ({ page }) => {
    await page.goto("/admin/events")
    const firstReviewLink = page.getByRole("link", { name: "Review" }).first()
    const count = await firstReviewLink.count()
    if (count === 0) {
      test.skip()
      return
    }
    await firstReviewLink.click()
    await expect(page.getByTestId(Labels.resultDeleteButton).first()).toBeVisible()
  })
})
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/test-ids.ts frontend/src/routes/_layout/admin_.events.tsx frontend/src/routes/_layout/admin_.events_.$id.tsx frontend/tests/admin.spec.ts
git commit -m "test: add test IDs and Playwright tests for admin event routing and result deletion"
```

---

### Task 11: Playwright tests — upload wizard mode selection

**Files:**
- Modify: `frontend/src/test-ids.ts`
- Modify: `frontend/src/components/Upload/steps/Step0ModeSelect.tsx`
- Modify: `frontend/src/components/Upload/steps/Step1EventMeta.tsx`
- Create: `frontend/tests/upload.spec.ts`

**Context:** Tests cover Step 0 (both options visible, each advances to Step 1 in the correct mode) and the Step 1 toggle (switching mode resets selection). Requires `data-testid` attributes on Step 0 buttons, Step 1 toggle buttons, and the event picker select.

- [ ] **Step 1: Update `frontend/src/test-ids.ts`**

```ts
export const Labels = {
  adminEventsPageHeading: "admin-events-page-heading",
  resultDeleteButton: "result-delete-button",
  uploadModeNew: "upload-mode-new",
  uploadModeExisting: "upload-mode-existing",
  uploadModeToggleNew: "upload-mode-toggle-new",
  uploadModeToggleExisting: "upload-mode-toggle-existing",
  uploadExistingEventSelect: "upload-existing-event-select",
  submitModeToggle: "submit-mode-toggle",
} as const
```

- [ ] **Step 2: Add `data-testid` attributes to `Step0ModeSelect.tsx`**

Add `import { Labels } from "@/test-ids"` and add `data-testid` to each card button:

```tsx
<button
  type="button"
  data-testid={Labels.uploadModeNew}
  onClick={() => select("new")}
  className="flex flex-col items-center gap-3 rounded-lg border-2 border-muted p-6 text-center hover:border-primary hover:bg-muted/50 transition-colors"
>
```

```tsx
<button
  type="button"
  data-testid={Labels.uploadModeExisting}
  onClick={() => select("existing")}
  className="flex flex-col items-center gap-3 rounded-lg border-2 border-muted p-6 text-center hover:border-primary hover:bg-muted/50 transition-colors"
>
```

- [ ] **Step 3: Add `data-testid` attributes to `Step1EventMeta.tsx`**

Add `import { Labels } from "@/test-ids"`. In `ModeToggle`, replace the mapped buttons with explicit ones that carry testids:

```tsx
function ModeToggle({ mode, onChange }: { mode: "new" | "existing"; onChange: (m: "new" | "existing") => void }) {
  return (
    <div className="flex rounded-md border overflow-hidden self-start">
      <button
        type="button"
        data-testid={Labels.uploadModeToggleNew}
        onClick={() => onChange("new")}
        className={`px-4 py-1.5 text-sm ${mode === "new" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
      >
        New event
      </button>
      <button
        type="button"
        data-testid={Labels.uploadModeToggleExisting}
        onClick={() => onChange("existing")}
        className={`px-4 py-1.5 text-sm ${mode === "existing" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
      >
        Existing event
      </button>
    </div>
  )
}
```

In `ExistingEventPicker`, add `data-testid` to the `<select>`:

```tsx
<select
  data-testid={Labels.uploadExistingEventSelect}
  className="flex h-9 w-full rounded-md ..."
  value={value ?? ""}
  onChange={...}
>
```

- [ ] **Step 4: Type-check**

```bash
cd frontend && bunx tsc -p tsconfig.build.json --noEmit
```

Expected: no errors.

- [ ] **Step 5: Create `frontend/tests/upload.spec.ts`**

```ts
import { expect, test } from "@playwright/test"
import { Labels } from "../src/test-ids"

test.describe("Upload wizard — mode selection", () => {
  test("Wizard shows mode selection as first step", async ({ page }) => {
    await page.goto("/upload")
    await expect(page.getByTestId(Labels.uploadModeNew)).toBeVisible()
    await expect(page.getByTestId(Labels.uploadModeExisting)).toBeVisible()
  })

  test("Selecting New event advances to event details form", async ({ page }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeNew).click()
    await expect(page.getByLabel("Event name *")).toBeVisible()
    await expect(page.getByTestId(Labels.uploadExistingEventSelect)).not.toBeVisible()
  })

  test("Selecting Existing event advances to event picker", async ({ page }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeExisting).click()
    await expect(page.getByTestId(Labels.uploadExistingEventSelect)).toBeVisible()
    await expect(page.getByLabel("Event name *")).not.toBeVisible()
  })

  test("Toggle switches from new to existing mode", async ({ page }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeNew).click()
    await expect(page.getByLabel("Event name *")).toBeVisible()
    await page.getByTestId(Labels.uploadModeToggleExisting).click()
    await expect(page.getByTestId(Labels.uploadExistingEventSelect)).toBeVisible()
    await expect(page.getByLabel("Event name *")).not.toBeVisible()
  })

  test("Toggle switches from existing to new mode", async ({ page }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeExisting).click()
    await page.getByTestId(Labels.uploadModeToggleNew).click()
    await expect(page.getByLabel("Event name *")).toBeVisible()
    await expect(page.getByTestId(Labels.uploadExistingEventSelect)).not.toBeVisible()
  })
})
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/test-ids.ts frontend/src/components/Upload/steps/Step0ModeSelect.tsx frontend/src/components/Upload/steps/Step1EventMeta.tsx frontend/tests/upload.spec.ts
git commit -m "test: add Playwright tests for upload wizard mode selection"
```

---

### Task 12: Playwright tests — Step 5 submit mode toggle

**Files:**
- Modify: `frontend/tests/upload.spec.ts`

**Context:** The append/replace toggle in Step 5 has `data-testid="submit-mode-toggle"` from Task 9, and `submitModeToggle` is already in `Labels` from Task 11. Because reaching Step 5 requires a full CSV upload flow, these tests verify the toggle's presence and default at a shallower level: confirming that the existing-event path correctly reaches Step 1 (with picker visible), and that navigating back to Step 0 resets to mode selection. A deep end-to-end submission test is out of scope for this plan.

- [ ] **Step 1: Add tests to `frontend/tests/upload.spec.ts`**

```ts
test.describe("Upload wizard — submit mode", () => {
  test("Submit mode toggle is not present on new event path at Step 1", async ({ page }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeNew).click()
    await expect(page.getByTestId(Labels.submitModeToggle)).not.toBeVisible()
  })

  test("Navigating back from Step 1 returns to mode selection", async ({ page }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeNew).click()
    await page.getByRole("button", { name: "← Back" }).click()
    await expect(page.getByTestId(Labels.uploadModeNew)).toBeVisible()
    await expect(page.getByTestId(Labels.uploadModeExisting)).toBeVisible()
  })

  test("Navigating back from existing Step 1 returns to mode selection", async ({ page }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeExisting).click()
    await page.getByRole("button", { name: "← Back" }).click()
    await expect(page.getByTestId(Labels.uploadModeNew)).toBeVisible()
    await expect(page.getByTestId(Labels.uploadModeExisting)).toBeVisible()
  })
})
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && bunx tsc -p tsconfig.build.json --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/tests/upload.spec.ts
git commit -m "test: add Playwright tests for upload wizard submit mode and back navigation"
```
