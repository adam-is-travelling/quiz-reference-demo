# `event` → `quiz` Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename every identifier and user-facing string that says "event" but means *a quiz*, so the word `Event` is free for the new Event model.

**Architecture:** A pure refactor. No schema changes, no new endpoints, no behaviour changes. Work proceeds in layers, but any rename that crosses the API boundary (a response-model field name) must land together with the client regeneration and the frontend update in the **same commit** — otherwise the frontend build breaks between commits.

**Tech Stack:** Python 3 / FastAPI / SQLModel backend, React + TypeScript + TanStack Router frontend, `@hey-api/openapi-ts` generated client, pytest, Playwright, Biome, ruff.

**Spec:** [`docs/superpowers/specs/2026-08-18-event-quiz-rename-design.md`](../specs/2026-08-18-event-quiz-rename-design.md)

## Global Constraints

- **Branch:** work on a new branch off `main`, e.g. `rename-event-to-quiz`. Do not build this on `add-events`. `main` is the trunk; `master` is a deleted upstream template branch — never diff or merge against it.
- **No behaviour changes.** No test may change its meaning. Test edits are limited to (1) a renamed symbol at a call site and (2) the two `"Events"` heading assertions in `competitions-public.spec.ts`. No test is deleted, no assertion weakened, no test count changes.
- **Never touch `backend/app/alembic/versions/`.** Those filenames, revision IDs and contents are immutable history.
- **Never touch historical specs.** `2026-05-27-upload-to-existing-event-design.md` and `2026-05-29-event-date-ux.md` are records of past decisions.
- **Never rename DOM event usages:** `addEventListener`, `removeEventListener`, `MouseEvent`, `ChangeEvent`, `KeyboardEvent`, `FormEvent`, `pointer-events-*`. Leave `frontend/src/components/ui/` alone entirely.
- **`frontend/src/client/` is generated.** Never hand-edit it. Regenerate with `bash ./scripts/generate-client.sh` from the repo root.
- **Run backend commands on the host**, from the repo-root venv. The `backend` container has no source mount and serves a stale baked image — `docker compose exec backend pytest` tests the wrong code.
- **Backend tests hit the dev database.** Only delete rows you create. No table-wide deletes. `backend/tests/test_cleanup_safety.py` guards this.
- **Never run `docker compose down -v`.** It wipes all volumes including the curated staging database.
- **`QuizResult.quiz_id` and the `quiz` table are already correct.** They do not change.

### Commands

```bash
# Backend tests — from repo root
source .venv/bin/activate && cd backend && bash ./scripts/test.sh

# A single backend test
source .venv/bin/activate && cd backend && python -m pytest tests/api/routes/test_competitions.py -v

# Frontend typecheck + build, and lint
cd frontend && bun run build
cd frontend && bun run lint

# Frontend unit tests (bun:test — NOT vitest, and NOT `bun run test`,
# which is actually the Playwright suite)
cd frontend && bun run test:unit

# Client regeneration — from repo ROOT, requires the stack running
bash ./scripts/generate-client.sh
```

Before any Playwright run, stop the Docker frontend container — it shadows port 5173 and the tests will hit a stale baked build:

```bash
docker compose stop frontend
cd frontend && bunx playwright test <spec>
```

---

### Task 1: Rename the podium response models

The API-boundary rename. Backend models, the route that builds them, the generated client, the frontend consumer and the Playwright assertions all move in one commit so the repo is green at every point.

**Files:**
- Modify: `backend/app/models.py:639-660`
- Modify: `backend/app/api/routes/competitions.py:12,70,96,134`
- Modify: `frontend/src/components/Competitions/CompetitionPodium.tsx:5,58,71,150,154,149,151`
- Modify: `frontend/tests/competitions-public.spec.ts:100,102,197,202`
- Regenerate: `frontend/src/client/schemas.gen.ts`, `frontend/src/client/types.gen.ts`
- Test: `backend/tests/api/routes/test_competitions.py`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `QuizPodium` (was `CompetitionEventPodium`) — unchanged fields `quiz_id: uuid.UUID`, `quiz_name: str`, `quiz_slug: str | None`, `start_date: date`, `end_date: date`, `finishers: list[PodiumFinisher]`. `CompetitionPodiumPublic.quizzes: list[QuizPodium]` (was `.events`). Task 5 of the Events plan renames the container to `PodiumPublic`; this task does not.

- [ ] **Step 1: Find the existing podium assertions that must keep passing**

Run: `source .venv/bin/activate && cd backend && python -m pytest tests/api/routes/test_competitions.py -v -k podium`

Expected: PASS. Note the test names — they must still pass unchanged at the end of this task apart from the `["events"]` key becoming `["quizzes"]`.

- [ ] **Step 2: Rename the model in `backend/app/models.py`**

At line 639, rename the class and drop the now-inaccurate prefix — this model describes one quiz's podium, not a competition's:

```python
class QuizPodium(SQLModel):
    quiz_id: uuid.UUID
    quiz_name: str
    quiz_slug: str | None = None
    start_date: date
    end_date: date
    finishers: list[PodiumFinisher]
```

At line 657, rename the container's field:

```python
class CompetitionPodiumPublic(SQLModel):
    quizzes: list[QuizPodium]
    standings: list[PodiumStanding]
```

- [ ] **Step 3: Update `backend/app/api/routes/competitions.py`**

Line 12, in the import block: `CompetitionEventPodium,` → `QuizPodium,`. Keep the import list alphabetically sorted — ruff enforces this, so `QuizPodium` moves down next to `Quiz`.

Lines 64-104, rename the locals so they say what they hold:

```python
    quizzes = session.exec(
        select(Quiz)
        .where(Quiz.competition_id == competition.id, Quiz.status == QuizStatus.approved)
        .order_by(col(Quiz.start_date).desc())
    ).all()

    quiz_podiums: list[QuizPodium] = []
    tally: dict[uuid.UUID, PodiumStanding] = {}

    for quiz in quizzes:
        rows = session.exec(
            select(QuizResult, Player)
            .join(Player, QuizResult.player_id == Player.id)
            .where(
                QuizResult.quiz_id == quiz.id,
                col(QuizResult.final_rank).in_([1, 2, 3]),
            )
            .order_by(col(QuizResult.final_rank).asc())
        ).all()
```

and the append at line 95:

```python
        quiz_podiums.append(
            QuizPodium(
                quiz_id=quiz.id,
                quiz_name=quiz.name,
                quiz_slug=quiz.slug,
                start_date=quiz.start_date,
                end_date=quiz.end_date,
                finishers=finishers,
            )
        )
```

and the return at line 134:

```python
    return CompetitionPodiumPublic(quizzes=quiz_podiums, standings=standings)
```

- [ ] **Step 4: Update the backend test's response key**

In `backend/tests/api/routes/test_competitions.py`, every `data["events"]` reading the podium response becomes `data["quizzes"]`. Find them:

Run: `grep -n '\["events"\]' backend/tests/api/routes/test_competitions.py`

Change only that dictionary key. Do not change any assertion's expected value.

- [ ] **Step 5: Run backend tests**

Run: `source .venv/bin/activate && cd backend && bash ./scripts/test.sh`

Expected: PASS. A failure here means the rename changed behaviour — stop and fix before continuing.

- [ ] **Step 6: Regenerate the API client**

The backend must be running for the schema export to work.

Run: `bash ./scripts/generate-client.sh` (from repo root)

- [ ] **Step 7: Verify the client diff contains renames only**

Run: `git diff --stat frontend/src/client/ && git diff frontend/src/client/`

Expected: `CompetitionEventPodium` → `QuizPodium` and `events` → `quizzes` and nothing else. Any change to a field *type*, an endpoint path, or a required/optional marker means something other than a rename happened — stop and investigate.

- [ ] **Step 8: Update `CompetitionPodium.tsx`**

Line 5, in the type import: `CompetitionEventPodium,` → `QuizPodium,` (keep the import list sorted — Biome enforces it).

Lines 58 and 71: `ColumnDef<CompetitionEventPodium>` → `ColumnDef<QuizPodium>`, and rename `podiumEventColumns` → `podiumQuizColumns` (update its use at line 154).

Lines 149-154, the section heading and empty state:

```tsx
        <h2 className="text-lg font-semibold mb-4">Quizzes</h2>
        {podium.quizzes.length === 0 ? (
          <p className="text-muted-foreground">No quizzes published yet.</p>
        ) : (
          <DataTable columns={podiumQuizColumns} data={podium.quizzes} />
```

- [ ] **Step 9: Update the Playwright assertions**

`frontend/tests/competitions-public.spec.ts`, lines 100, 102, 197 and 202 — the heading the component now renders is "Quizzes":

```ts
  test("detail page shows the Quizzes section", async ({ page }) => {
    ...
    await expect(page.getByRole("heading", { name: "Quizzes" })).toBeVisible()
```

and the line 202 comment `// Finishers appear in the events table` → `// Finishers appear in the quizzes table`.

Leave line 156's `` name: `Podium Event ${runId}` `` alone for now — it is test *data*, renamed in Task 6.

- [ ] **Step 10: Typecheck, build and lint the frontend**

Run: `cd frontend && bun run build && bun run lint`

Expected: PASS with no type errors. A `Property 'events' does not exist` error means Step 6 did not regenerate, or Step 8 missed a site.

- [ ] **Step 11: Run the competitions E2E spec**

Run: `docker compose stop frontend && cd frontend && bunx playwright test competitions-public.spec.ts`

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add backend/app/models.py backend/app/api/routes/competitions.py \
        backend/tests/api/routes/test_competitions.py \
        frontend/src/client/ frontend/src/components/Competitions/CompetitionPodium.tsx \
        frontend/tests/competitions-public.spec.ts
git commit -m "refactor: rename CompetitionEventPodium to QuizPodium"
```

---

### Task 2: Rename `total_events` to `total_quizzes`

The second API-boundary rename. Same rule: backend, client and frontend in one commit.

**Files:**
- Modify: `backend/app/models.py:463`
- Modify: `backend/app/crud.py:516`
- Modify: `frontend/src/components/Players/PlayerProfile.tsx:59`
- Modify: `frontend/src/routes/_public/players_.$slug.tsx:77`
- Regenerate: `frontend/src/client/schemas.gen.ts`, `frontend/src/client/types.gen.ts`
- Test: `backend/tests/api/routes/test_players.py`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `PlayerHistoryGrouped.total_quizzes: int` (was `total_events`).

- [ ] **Step 1: Rename the field in `backend/app/models.py`**

Line 463, inside `class PlayerHistoryGrouped`:

```python
class PlayerHistoryGrouped(SQLModel):
    data: list[PlayerCompetitionGroup]
    total_quizzes: int
    wins: int
    podiums: int
```

- [ ] **Step 2: Rename the keyword argument in `backend/app/crud.py`**

Line 516:

```python
        data=data, total_quizzes=len(rows), wins=wins, podiums=podiums
```

- [ ] **Step 3: Update any backend test reading the key**

Run: `grep -rn "total_events" backend/tests/`

Change each `data["total_events"]` to `data["total_quizzes"]`. Change the key only, never the expected value.

- [ ] **Step 4: Run backend tests**

Run: `source .venv/bin/activate && cd backend && bash ./scripts/test.sh`

Expected: PASS.

- [ ] **Step 5: Regenerate the client and check the diff**

```bash
bash ./scripts/generate-client.sh
git diff frontend/src/client/
```

Expected: `total_events` → `total_quizzes` only.

- [ ] **Step 6: Update the two frontend consumers**

`frontend/src/components/Players/PlayerProfile.tsx:59` — note the *label* stays "Events" for now only if it refers to quizzes; it does, so it changes too:

```tsx
          { label: "Quizzes", value: history.total_quizzes },
```

`frontend/src/routes/_public/players_.$slug.tsx:77`:

```tsx
      {history.total_quizzes === 0 && (
```

- [ ] **Step 7: Build and lint**

Run: `cd frontend && bun run build && bun run lint`

Expected: PASS.

- [ ] **Step 8: Run the players E2E spec**

Run: `docker compose stop frontend && cd frontend && bunx playwright test players.spec.ts`

Expected: PASS. If a test asserts on the literal text "Events" in the player profile stat row, update that assertion to "Quizzes" — this is the one other permitted user-facing string change.

- [ ] **Step 9: Commit**

```bash
git add backend/app/models.py backend/app/crud.py backend/tests/ \
        frontend/src/client/ frontend/src/components/Players/PlayerProfile.tsx \
        frontend/src/routes/_public/players_.\$slug.tsx frontend/tests/
git commit -m "refactor: rename PlayerHistoryGrouped.total_events to total_quizzes"
```

---

### Task 3: Rename backend-internal `Quiz` locals and parameters

No API surface changes here, so no client regeneration. `crud.py` keyword parameters are called by name from route handlers and tests, so definitions and call sites move together.

**Files:**
- Modify: `backend/app/crud.py:573-651` (and any other `db_event`/`event_in` sites)
- Modify: `backend/app/api/routes/quizzes.py` (lines 49-52, 76, 83, 90-96, 101-106, 115-123, 135-140, 150-155, 165-170, 180-183, 191-199, 209-213)
- Modify: `backend/app/api/routes/formats.py:74`
- Modify: `backend/tests/test_slugs.py:101,124,170,193`
- Modify: `backend/tests/utils/quiz.py:79,105`

**Interfaces:**
- Consumes: nothing from Tasks 1-2.
- Produces: `crud.create_quiz(*, session, quiz_in: QuizCreate, submitted_by_id: uuid.UUID) -> Quiz`; `crud.update_quiz(*, session, db_quiz: Quiz, quiz_in: QuizUpdate) -> Quiz`; `crud.approve_quiz(*, session, db_quiz: Quiz) -> Quiz`; `crud.reject_quiz(*, session, db_quiz: Quiz) -> Quiz`; `crud.set_quiz_pending(*, session, db_quiz: Quiz) -> Quiz`; `crud.delete_quiz(*, session, db_quiz: Quiz) -> None`. Task 4 and the Events plan call these by keyword.

- [ ] **Step 1: List every site before changing anything**

Run:

```bash
grep -rn "db_event\|event_in\|event_podiums\|\bevent\b\|event_id" backend/app backend/tests \
  --include="*.py" | grep -v alembic/versions
```

Keep this list. Every line must be either changed or consciously left (only `Quiz.event_id` does not exist yet, so at this point every `event_id` naming a quiz is renamed).

- [ ] **Step 2: Rename the `crud.py` function parameters**

In `backend/app/crud.py`, lines 573-651:

```python
def create_quiz(
    *, session: Session, quiz_in: QuizCreate, submitted_by_id: uuid.UUID
) -> Quiz:
    ...
    name_part = clamp_slug_base(slugify(quiz_in.name))
    parts = [
        part for part in (name_part, quiz_in.start_date.isoformat()) if part
    ]
    quiz = Quiz.model_validate(
        quiz_in,
        ...
    )
    session.add(quiz)
    ...
    session.refresh(quiz)
    return quiz


def update_quiz(*, session: Session, db_quiz: Quiz, quiz_in: QuizUpdate) -> Quiz:
    data = quiz_in.model_dump(exclude_unset=True)
    ...
        if existing and existing.id != db_quiz.id:
            ...
    db_quiz.sqlmodel_update(data)
    session.add(db_quiz)
    ...
    return db_quiz


def approve_quiz(*, session: Session, db_quiz: Quiz) -> Quiz:
    rows = session.exec(
        select(QuizResult.player_id).where(QuizResult.quiz_id == db_quiz.id)
    )
    ...
    db_quiz.status = QuizStatus.approved
    session.add(db_quiz)
    ...
    return db_quiz
```

Apply the same `db_event` → `db_quiz` substitution to `reject_quiz`, `set_quiz_pending` and `delete_quiz`.

- [ ] **Step 3: Rename the route locals and call sites in `quizzes.py`**

`backend/app/api/routes/quizzes.py`. Line 49:

```python
def _quiz_public(quiz: Quiz, session: Session) -> QuizPublic:
    fmt = session.get(QuizFormat, quiz.format_id) if quiz.format_id else None
    return QuizPublic(
        **quiz.model_dump(exclude={"format"}),
```

Line 76-83, the list handler:

```python
    quizzes = session.exec(
        ...
    )
    return QuizzesPublic(data=[_quiz_public(q, session) for q in quizzes], count=count)
```

Every remaining `event = crud.resolve_by_id_or_slug(session=session, model=Quiz, value=id)` becomes `quiz = ...`, with the following `if not event:` → `if not quiz:` and `event.status` → `quiz.status`, `event.id` → `quiz.id`.

Every `crud` call updates its keyword: `crud.create_quiz(session=session, quiz_in=quiz_in, ...)`, `crud.update_quiz(session=session, db_quiz=quiz, quiz_in=quiz_in)`, `crud.approve_quiz(session=session, db_quiz=quiz)`, and so on. The handler parameter `event_in: QuizCreate` at line 101 and `event_in: QuizUpdate` at line 115 become `quiz_in`.

**Careful:** the create handler at line 101 takes `event_in` as a FastAPI *body* parameter. Renaming it does not change the JSON shape — FastAPI parses a single Pydantic body parameter as the whole body regardless of its Python name. Step 6 proves this.

- [ ] **Step 4: Fix the user-facing string in `formats.py`**

Line 74:

```python
            detail="Format is in use by one or more quizzes",
```

- [ ] **Step 5: Update the `event_in=` keyword call sites in tests**

`backend/tests/test_slugs.py` lines 101, 124, 170, 193 and `backend/tests/utils/quiz.py` lines 79, 105 pass `event_in=QuizCreate(...)`. Change the keyword to `quiz_in=`. Do not rename the helper functions themselves — that is Task 4.

- [ ] **Step 6: Run backend tests**

Run: `source .venv/bin/activate && cd backend && bash ./scripts/test.sh`

Expected: PASS. In particular the quiz create/update route tests must pass, proving the body parameter rename did not change the wire format.

- [ ] **Step 7: Confirm the OpenAPI schema is unchanged**

This task must not move the API surface at all.

```bash
bash ./scripts/generate-client.sh
git diff --stat frontend/src/client/
```

Expected: **empty diff**. If anything changed, a rename leaked into the API surface — investigate before committing.

- [ ] **Step 8: Commit**

```bash
git add backend/app/crud.py backend/app/api/routes/quizzes.py \
        backend/app/api/routes/formats.py backend/tests/
git commit -m "refactor(backend): rename Quiz locals and params from event to quiz"
```

---

### Task 4: Rename the backend test helpers

**Files:**
- Modify: `backend/tests/utils/quiz.py:71,88-94,97,120-126`
- Modify: `backend/tests/api/routes/test_competitions.py:14,164,302-311`
- Modify: every other file importing those helpers

**Interfaces:**
- Consumes: `crud.create_quiz(*, session, quiz_in, submitted_by_id)` from Task 3.
- Produces: `create_random_quiz(db: Session, ...) -> Quiz`, `create_approved_quiz(db: Session) -> Quiz`, `create_approved_quiz_in_competition(...) -> Quiz`, `create_rejected_quiz(db: Session) -> Quiz` in `tests/utils/quiz.py`. The Events plan uses `create_approved_quiz`.

- [ ] **Step 1: Find every importer**

Run: `grep -rn "create_random_event\|create_approved_event\|create_rejected_event" backend/tests/`

- [ ] **Step 2: Rename the helper definitions**

In `backend/tests/utils/quiz.py`:

| Line | Before | After |
| --- | --- | --- |
| 71 | `def create_random_event(` | `def create_random_quiz(` |
| 88 | `def create_approved_event(db: Session) -> Quiz:` | `def create_approved_quiz(db: Session) -> Quiz:` |
| 97 | `def create_approved_event_in_competition(` | `def create_approved_quiz_in_competition(` |
| 120 | `def create_rejected_event(db: Session) -> Quiz:` | `def create_rejected_quiz(db: Session) -> Quiz:` |

Inside each body, the local `event` holding a `Quiz` becomes `quiz`:

```python
def create_approved_quiz(db: Session) -> Quiz:
    quiz = create_random_quiz(db)
    quiz.status = QuizStatus.approved
    db.add(quiz)
    db.commit()
    db.refresh(quiz)
    return quiz


def create_rejected_quiz(db: Session) -> Quiz:
    quiz = create_random_quiz(db)
    quiz.status = QuizStatus.rejected
    db.add(quiz)
    db.commit()
    db.refresh(quiz)
    return quiz
```

- [ ] **Step 3: Update every call site**

Including `backend/tests/api/routes/test_competitions.py` line 14's import, line 164, and the local helper at lines 302-311:

```python
def _approved_quiz_in_competition(
    ...
) -> Quiz:
    quiz = create_random_quiz(db)
    quiz.name = name
    quiz.competition_id = competition_id
    quiz.start_date = start
    quiz.end_date = start
    quiz.status = QuizStatus.approved
    db.add(quiz)
```

Rename `_approved_event_in_competition` → `_approved_quiz_in_competition` and update its callers in the same file.

- [ ] **Step 4: Run the full backend suite**

Run: `source .venv/bin/activate && cd backend && bash ./scripts/test.sh`

Expected: PASS, with the **same number of tests collected** as before the rename. Compare the collected count against Task 1 Step 1's output.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/
git commit -m "refactor(tests): rename event helpers to quiz"
```

---

### Task 5: Rename the `Events` component directory

**Files:**
- Rename: `frontend/src/components/Events/` → `frontend/src/components/Quizzes/`
- Rename: `EventResultsTable.tsx` → `QuizResultsTable.tsx`
- Modify: `frontend/src/routes/_public/quizzes.tsx:8`
- Modify: `frontend/src/routes/_public/quizzes_.$slug.tsx:11,12,60,141`
- Modify: `frontend/src/routes/_layout/admin_.quizzes_.$id.tsx:15,341`

**Interfaces:**
- Consumes: nothing from Tasks 1-4.
- Produces: `@/components/Quizzes/QuizResultsTable` exporting `QuizResultsTable`; `@/components/Quizzes/MetadataEditDialog` exporting `MetadataEditDialog` with prop `quiz` (was `event`); `@/components/Quizzes/columns` exporting `quizColumns` (was `eventColumns`).

- [ ] **Step 1: Move the files with `git mv` so history follows**

```bash
git mv frontend/src/components/Events frontend/src/components/Quizzes
git mv frontend/src/components/Quizzes/EventResultsTable.tsx \
       frontend/src/components/Quizzes/QuizResultsTable.tsx
```

`columns.tsx` and `MetadataEditDialog.tsx` keep their filenames.

- [ ] **Step 2: Rename the exported symbols**

In `QuizResultsTable.tsx`, rename the exported component `EventResultsTable` → `QuizResultsTable`.

In `columns.tsx`, rename the exported `eventColumns` → `quizColumns`.

In `MetadataEditDialog.tsx`, rename the `event` prop to `quiz`, along with its type annotation and every use inside the component body.

Inside all three files, rename local variables named `event` that hold a quiz.

- [ ] **Step 3: Update the three importing routes**

`frontend/src/routes/_public/quizzes.tsx:8`:

```tsx
import { quizColumns } from "@/components/Quizzes/columns"
```

…and its use further down the file.

`frontend/src/routes/_public/quizzes_.$slug.tsx` lines 11-12:

```tsx
import { MetadataEditDialog } from "@/components/Quizzes/MetadataEditDialog"
import { QuizResultsTable } from "@/components/Quizzes/QuizResultsTable"
```

line 141:

```tsx
  return <QuizResultsTable data={data.data} format={quiz.format} />
```

and line 60's `<MetadataEditDialog ... />` — update the prop name if it passes `event={...}`.

`frontend/src/routes/_layout/admin_.quizzes_.$id.tsx` line 15's import, and line 341:

```tsx
          <MetadataEditDialog quiz={quiz} />
```

Keep import blocks alphabetically sorted — Biome enforces it.

- [ ] **Step 4: Build and lint**

Run: `cd frontend && bun run build && bun run lint`

Expected: PASS. A "Cannot find module '@/components/Events/...'" error means a stale import survived.

- [ ] **Step 5: Run the affected E2E specs**

Run: `docker compose stop frontend && cd frontend && bunx playwright test admin.spec.ts upload.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A frontend/src/components frontend/src/routes
git commit -m "refactor(frontend): rename Events components to Quizzes"
```

---

### Task 6: Rename the upload wizard's quiz metadata

**Files:**
- Rename: `frontend/src/components/Upload/steps/Step1EventMeta.tsx` → `Step1QuizMeta.tsx`
- Modify: `frontend/src/components/Upload/types.ts:15,26,59-63,69,75-79,91`
- Modify: `frontend/src/components/Upload/UploadWizard.tsx:3,11,12,60`
- Modify: `frontend/src/components/Upload/steps/Step0ModeSelect.tsx:12,18,30,32,44,46`
- Modify: `frontend/src/components/Upload/steps/Step5Preview.tsx:18,77,79,84,105,107,108,113,117,121,178`
- Modify: `frontend/tests/date-utils.test.ts:2,18,23,30,32,38`
- Modify: `frontend/tests/admin.spec.ts:200` (stale comment)
- Modify: `frontend/tests/competitions-public.spec.ts:156` (test data string)

**Interfaces:**
- Consumes: nothing from Tasks 1-5.
- Produces: `QuizMeta` type and `emptyQuizMeta(): QuizMeta` from `@/components/Upload/types`; `WizardState` fields `quizMode`, `existingQuizId`, `existingQuizName`, `quizMeta`, `quizId`; `Step1QuizMeta` component. The Events plan adds an `event_id` field to `QuizMeta` — that name will then mean a real Event, which is why this rename comes first.

- [ ] **Step 1: Rename the type and factory in `types.ts`**

```ts
export type QuizMeta = {
  name: string
  start_date: string
  end_date: string
  organizer_name: string | null
  description: string
  competition_id: string
  organization_id: string
  format_id: string
}

export function emptyQuizMeta(): QuizMeta {
  const t = today()
  return {
    name: "",
    start_date: t,
    end_date: t,
    organizer_name: null,
    description: "",
    competition_id: "",
    organization_id: "",
    format_id: "",
  }
}
```

- [ ] **Step 2: Rename the `WizardState` fields in `types.ts`**

```ts
export type WizardState = {
  step: 0 | 1 | 2 | 3 | 4 | 5
  quizMode: "new" | "existing"
  existingQuizId: string | null
  existingQuizName: string | null
  submitMode: "append" | "replace"
  quizMeta: QuizMeta
  rawCsv: string
  parsedRows: string[][]
  columnMapping: ColumnMapping
  parsedResults: ParsedResultWithCandidates[]
  resolutions: Resolution[]
  quizId: string | null
  selectedFormat: QuizFormatPublic | null
}

export const INITIAL_STATE: WizardState = {
  step: 0,
  quizMode: "new",
  existingQuizId: null,
  existingQuizName: null,
  submitMode: "append",
  quizMeta: emptyQuizMeta(),
  rawCsv: "",
  parsedRows: [],
  columnMapping: {
    player_name: 0,
    country: 1,
    score: 2,
    position: null,
    rounds: [],
  },
  parsedResults: [],
  resolutions: [],
  quizId: null,
  selectedFormat: null,
}
```

- [ ] **Step 3: Rename the step component file and its export**

```bash
git mv frontend/src/components/Upload/steps/Step1EventMeta.tsx \
       frontend/src/components/Upload/steps/Step1QuizMeta.tsx
```

Rename the exported component `Step1EventMeta` → `Step1QuizMeta`, and inside it every `state.eventMeta` → `state.quizMeta` and every `eventMeta:` update key → `quizMeta:`.

- [ ] **Step 4: Update `UploadWizard.tsx`**

Line 3: `import { Step1QuizMeta } from "./steps/Step1QuizMeta"`.
Lines 11-12, the step labels: `"Choose quiz"` and `"Quiz details"`.
Line 60: `{state.step === 1 && <Step1QuizMeta state={state} update={update} />}`.

- [ ] **Step 5: Update `Step0ModeSelect.tsx`**

Line 12: `update({ quizMode: mode, step: 1 })`.

The user-facing copy on lines 18, 30, 32, 44 and 46 says "event" meaning a quiz:

```tsx
        Are you uploading results for a new quiz, or adding to one that already
        ...
            <p className="font-semibold">New quiz</p>
              Create a new quiz and upload results
        ...
            <p className="font-semibold">Existing quiz</p>
              Add or replace results for a quiz already in the system
```

- [ ] **Step 6: Update `Step5Preview.tsx`**

Line 18: `function buildQuizMeta(meta: WizardState["quizMeta"]) {` and its call at line 84.
Lines 77, 105, 178: `state.eventMode` → `state.quizMode`.
Line 79: `state.existingEventId!` → `state.existingQuizId!`.
Line 108: `state.existingEventName` → `state.existingQuizName`.
Lines 113, 117, 121: `state.eventMeta` → `state.quizMeta`.
Lines 107 and 113, the labels: `<span className="font-medium">Quiz:</span>`.

- [ ] **Step 7: Update the vitest file**

`frontend/tests/date-utils.test.ts` line 2:

```ts
import { emptyQuizMeta, today } from "../src/components/Upload/types"
```

line 18: `describe("emptyQuizMeta", () => {`, and lines 23, 30, 32, 38: `emptyQuizMeta()`.

- [ ] **Step 8: Fix the two stale test strings**

`frontend/tests/admin.spec.ts:200` — the comment references a route that no longer exists:

```ts
// Regression: admin.quizzes.tsx was previously nested under admin.tsx in TanStack Router's
```

`frontend/tests/competitions-public.spec.ts:156` — test data:

```ts
        name: `Podium Quiz ${runId}`,
```

- [ ] **Step 9: Grep the whole upload directory for stragglers**

Run:

```bash
grep -rniE "event" frontend/src/components/Upload | grep -viE "ChangeEvent|pointer-events"
```

Expected: no output.

- [ ] **Step 10: Build, lint and run the unit tests**

Run: `cd frontend && bun run build && bun run lint && bun run test:unit`

Expected: PASS.

- [ ] **Step 11: Run the upload E2E spec**

Run: `docker compose stop frontend && cd frontend && bunx playwright test upload.spec.ts competitions-public.spec.ts`

Expected: PASS. If an assertion matches user-facing copy changed in Steps 5 or 6 ("New event", "Existing event", "Event:"), update the assertion string to match — that is a permitted string change.

- [ ] **Step 12: Commit**

```bash
git add -A frontend/src frontend/tests
git commit -m "refactor(frontend): rename upload wizard quiz metadata step"
```

---

### Task 7: Verify the rename is complete

No code changes unless the sweep finds something. This task is the gate.

**Files:**
- Verify only.

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces: a clean tree.

- [ ] **Step 1: Sweep for surviving "event" references**

Run:

```bash
grep -rniE "event" frontend/src frontend/tests backend/app backend/tests \
  --include="*.tsx" --include="*.ts" --include="*.py" \
  | grep -v "components/ui/" \
  | grep -viE "pointer-events|addEventListener|removeEventListener|MouseEvent|ChangeEvent|KeyboardEvent|FormEvent"
```

Expected: every remaining hit is inside `backend/app/alembic/versions/`. If a hit is anywhere else, rename it and fold the fix into whichever task's commit it belongs to.

- [ ] **Step 2: Confirm migrations were untouched**

Run: `git diff main --stat -- backend/app/alembic/`

Expected: **empty**. Any diff here is a mistake — revert it.

- [ ] **Step 3: Confirm no schema change**

Run: `source .venv/bin/activate && cd backend && alembic upgrade head && alembic check`

`alembic check` **fails**, and that is expected — it fails identically on `main`. Two drifts predate this branch:

1. `Detected removed index 'ix_player_country_code' on 'player_country'`
2. `Detected type change ... name='eventstatus'` → `name='quizstatus'` on `quiz.status`

The second is an "event" survivor at the database layer: an earlier commit renamed the Python enum class to `QuizStatus` without a migration to rename the Postgres type, so the type is still called `eventstatus`. It is genuinely part of the same naming problem this branch addresses, but fixing it needs a schema migration, which this spec explicitly excludes — and folding a migration into a pure-rename PR is exactly the mixing this branch exists to avoid. It is recorded as follow-up work.

What this step actually proves is that the rename introduced **no new** drift. Compare the two:

```bash
source .venv/bin/activate && cd backend && alembic check 2>&1 | grep "Detected" > /tmp/check-branch.txt
git stash && git checkout main
source .venv/bin/activate && cd backend && alembic check 2>&1 | grep "Detected" > /tmp/check-main.txt
git checkout rename-event-to-quiz && git stash pop
diff /tmp/check-main.txt /tmp/check-branch.txt
```

`diff` must report **no differences**. Any drift present on the branch but not on `main` was introduced here and must be investigated.

- [ ] **Step 4: Run the full backend suite**

Run: `source .venv/bin/activate && cd backend && bash ./scripts/test.sh`

Expected: PASS, same test count as before the branch.

- [ ] **Step 5: Run the full frontend build, lint and unit tests**

Run: `cd frontend && bun run build && bun run lint && bun run test:unit`

Expected: PASS.

- [ ] **Step 6: Run the full Playwright suite**

Run: `docker compose stop frontend && cd frontend && bunx playwright test`

Expected: PASS.

- [ ] **Step 7: Review the client diff across the whole branch**

Run: `git diff main -- frontend/src/client/`

Expected: `CompetitionEventPodium` → `QuizPodium`, `events` → `quizzes`, `total_events` → `total_quizzes` and their references — **plus** the `maxLength: 255, minLength: 1` constraints on `CompetitionUpdate.slug`, `OrganizationUpdate.slug` and `QuizUpdate.slug`.

Those three are **not** part of this rename. They are pre-existing drift: commit `ee8760f` added the constraints to `models.py` without regenerating the client, so the first regeneration on this branch necessarily picks them up. Task 1 isolates them in their own commit (`chore(client): regenerate after slug-length drift from ee8760f`) so the rename commits stay rename-only.

Verify the isolation held rather than the whole-branch diff being pure:

```bash
# The drift lives in exactly one commit
git log --oneline main..HEAD -- frontend/src/client/
# No rename commit may contain a length constraint
git log -p main..HEAD --grep="refactor" -- frontend/src/client/ | grep "Length"
```

The second command must produce **no output**. Beyond the three slug fields, no type, path or optionality changes anywhere.

- [ ] **Step 8: Open the PR**

```bash
git push -u origin rename-event-to-quiz
gh pr create --base main --title "refactor: rename event to quiz" --body "$(cat <<'EOF'
Pure rename, no behaviour change. Frees the word `Event` for the new Event model.

Every identifier and user-facing string that said "event" but meant *a quiz* is renamed.
Alembic migrations are untouched — `alembic check` confirms no schema change.

Spec: `docs/superpowers/specs/2026-08-18-event-quiz-rename-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
