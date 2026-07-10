# Upload Results Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent malformed CSV rows from leaving a partially-uploaded quiz (orphan players, no results) by parsing CSVs correctly, blocking bad rows client-side before submission, and making the backend result-submission endpoint atomic.

**Architecture:** Three independent layers, each closing a different gap in the same bug: (1) a quote-aware CSV parser so a comma inside a name no longer shifts columns, (2) a pre-submit validation gate in the upload wizard that blocks the submit button until every row is clean, (3) a backend two-pass validate-then-write change to `submit_results` so a rejected batch never partially persists.

**Tech Stack:** FastAPI + SQLModel (backend), React + TanStack Router (frontend), bun test (frontend unit tests), Playwright (frontend E2E), pytest (backend).

## Global Constraints

- Backend tests live in `backend/tests/`, run via `bash ./scripts/test.sh` from `backend/` (or `docker compose exec backend bash scripts/tests-start.sh` against the running stack).
- Frontend unit tests use bun's built-in test runner (`bun:test`), live in `frontend/tests/*.test.ts`, run via `bun test:unit` from `frontend/`.
- Frontend E2E tests use Playwright, live in `frontend/tests/*.spec.ts`, run via `bunx playwright test` from `frontend/` (requires the backend stack running).
- Every existing test in `backend/tests/api/routes/test_players.py` and `test_quizzes.py` must keep passing unmodified — the backend change must not alter default behavior for any caller other than `submit_results`.
- Follow existing code style: no comments explaining *what* code does, only non-obvious *why*.

---

### Task 1: Backend — atomic, pre-validated `submit_results`

**Files:**
- Modify: `backend/app/crud.py:166-179` (`create_player`), `backend/app/crud.py:397-431` (`create_quiz_results`)
- Modify: `backend/app/api/routes/quizzes.py:263-328` (`submit_results`)
- Test: `backend/tests/api/routes/test_quizzes.py`

**Interfaces:**
- Produces: `crud.create_player(*, session: Session, player_in: PlayerCreate, commit: bool = True) -> Player` — new optional `commit` kwarg, default preserves existing behavior.
- Produces: `crud.create_quiz_results(*, session: Session, event_id: uuid.UUID, results: list[QuizResultCreate], commit: bool = True) -> list[QuizResult]` — same pattern.
- Consumes: nothing from other tasks (fully independent of the frontend tasks).

- [ ] **Step 1: Write the failing regression test**

Add to `backend/tests/api/routes/test_quizzes.py` (near the other `submit_results` tests, e.g. after `test_submit_results_creates_new_player` around line 339):

```python
def test_submit_results_rejects_batch_without_partial_writes(
    client: TestClient,
    organizer_token_headers: dict[str, str],
    db: Session,
) -> None:
    quiz = create_random_event(db)
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "player_create": {
                        "display_name": "Valid Row Player",
                        "country": "US",
                    },
                    "final_rank": 1,
                    "score": 50.0,
                },
                {
                    "player_create": {
                        "display_name": "Invalid Row Player",
                        "country": "US",
                    },
                    "final_rank": 2,
                    "score": None,
                },
            ]
        },
    )
    assert response.status_code == 422

    orphan = db.exec(
        select(Player).where(Player.display_name == "Valid Row Player")
    ).first()
    assert orphan is None


def test_submit_results_rejects_round_scores_without_partial_writes(
    client: TestClient,
    organizer_token_headers: dict[str, str],
    db: Session,
) -> None:
    fmt = create_random_format(db, num_rounds=2)
    quiz = create_random_event(db)
    quiz.format_id = fmt.id
    db.add(quiz)
    db.commit()

    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "player_create": {
                        "display_name": "First Valid Player",
                        "country": "US",
                    },
                    "final_rank": 1,
                    "score": 50.0,
                    "round_scores": [25.0, 25.0],
                },
                {
                    "player_create": {
                        "display_name": "Too Many Rounds Player",
                        "country": "US",
                    },
                    "final_rank": 2,
                    "score": 40.0,
                    "round_scores": [10.0, 10.0, 20.0],
                },
            ]
        },
    )
    assert response.status_code == 422

    orphan = db.exec(
        select(Player).where(Player.display_name == "First Valid Player")
    ).first()
    assert orphan is None
```

`create_random_format` is not currently imported in this file. Update the existing `from tests.utils.quiz import (...)` block (lines 10-13) from:

```python
from tests.utils.quiz import (
    create_approved_event,
    create_random_event,
    create_random_player,
)
```

to:

```python
from tests.utils.quiz import (
    create_approved_event,
    create_random_event,
    create_random_format,
    create_random_player,
)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && source .venv/bin/activate && pytest tests/api/routes/test_quizzes.py -k "rejects_batch_without_partial_writes or rejects_round_scores_without_partial_writes" -v`
Expected: Both FAIL. `test_submit_results_rejects_batch_without_partial_writes` fails because today's code raises 422 only after the first row's player was already committed, so the `orphan is None` assertion fails (an orphan player exists — assuming the current buggy commit-per-row order actually still returns 422 status correctly, the *status* assertion may pass, but the *orphan* assertion fails). `test_submit_results_rejects_round_scores_without_partial_writes` fails the same way.

- [ ] **Step 3: Modify `backend/app/crud.py` — add opt-in `commit` flag to `create_player`**

Replace lines 166-179:

```python
def create_player(*, session: Session, player_in: PlayerCreate) -> Player:
    slug = _generate_slug(session=session, display_name=player_in.display_name)
    player_data = player_in.model_dump(exclude={"countries"})
    player = Player(**player_data, slug=slug)
    session.add(player)
    session.commit()
    session.refresh(player)

    for index, code in enumerate(player_in.countries):
        session.add(
            PlayerCountry(player_id=player.id, code=code, is_primary=(index == 0))
        )
    session.commit()
    return player
```

with:

```python
def create_player(
    *, session: Session, player_in: PlayerCreate, commit: bool = True
) -> Player:
    slug = _generate_slug(session=session, display_name=player_in.display_name)
    player_data = player_in.model_dump(exclude={"countries"})
    player = Player(**player_data, slug=slug)
    session.add(player)
    session.flush()
    session.refresh(player)

    for index, code in enumerate(player_in.countries):
        session.add(
            PlayerCountry(player_id=player.id, code=code, is_primary=(index == 0))
        )
    if commit:
        session.commit()
    else:
        session.flush()
    return player
```

- [ ] **Step 4: Modify `backend/app/crud.py` — add opt-in `commit` flag to `create_quiz_results`**

Replace lines 397-431:

```python
def create_quiz_results(
    *, session: Session, event_id: uuid.UUID, results: list[QuizResultCreate]
) -> list[QuizResult]:
    db_results = []
    for r in results:
        existing = session.exec(
            select(QuizResult)
            .where(QuizResult.quiz_id == event_id)
            .where(QuizResult.player_id == r.player_id)
        ).first()
        if existing:
            existing.score = r.score
            existing.final_rank = r.final_rank
            if r.country is not None:
                existing.country = r.country
            if r.round_scores is not None:
                _apply_round_scores(existing, r.round_scores)
            session.add(existing)
            db_results.append(existing)
        else:
            result = QuizResult(
                quiz_id=event_id,
                player_id=r.player_id,
                score=r.score,
                final_rank=r.final_rank,
                country=r.country,
            )
            if r.round_scores is not None:
                _apply_round_scores(result, r.round_scores)
            session.add(result)
            db_results.append(result)
    session.commit()
    for result in db_results:
        session.refresh(result)
    return db_results
```

with:

```python
def create_quiz_results(
    *,
    session: Session,
    event_id: uuid.UUID,
    results: list[QuizResultCreate],
    commit: bool = True,
) -> list[QuizResult]:
    db_results = []
    for r in results:
        existing = session.exec(
            select(QuizResult)
            .where(QuizResult.quiz_id == event_id)
            .where(QuizResult.player_id == r.player_id)
        ).first()
        if existing:
            existing.score = r.score
            existing.final_rank = r.final_rank
            if r.country is not None:
                existing.country = r.country
            if r.round_scores is not None:
                _apply_round_scores(existing, r.round_scores)
            session.add(existing)
            db_results.append(existing)
        else:
            result = QuizResult(
                quiz_id=event_id,
                player_id=r.player_id,
                score=r.score,
                final_rank=r.final_rank,
                country=r.country,
            )
            if r.round_scores is not None:
                _apply_round_scores(result, r.round_scores)
            session.add(result)
            db_results.append(result)
    if commit:
        session.commit()
    else:
        session.flush()
    for result in db_results:
        session.refresh(result)
    return db_results
```

- [ ] **Step 5: Modify `backend/app/api/routes/quizzes.py` — two-pass validate-then-write**

Replace the `submit_results` function (lines 263-328):

```python
@router.post("/{id}/results", response_model=QuizResultsPublic)
def submit_results(
    *,
    session: SessionDep,
    current_user: CurrentOrganizer,  # noqa: ARG001
    id: uuid.UUID,
    request: SubmitResultsRequest,
) -> Any:
    event = session.get(Quiz, id)
    if not event:
        raise HTTPException(status_code=404, detail="Quiz not found")

    fmt = session.get(QuizFormat, event.format_id) if event.format_id else None
    num_rounds = len(fmt.rounds) if fmt else 0

    if request.mode == SubmitMode.replace:
        existing = session.exec(select(QuizResult).where(QuizResult.quiz_id == id)).all()
        for r in existing:
            session.delete(r)
        session.flush()

    creates: list[QuizResultCreate] = []
    for row in request.results:
        if row.round_scores is not None:
            if fmt is None:
                raise HTTPException(
                    status_code=422,
                    detail="Quiz has no format; round_scores are not accepted",
                )
            if len(row.round_scores) > num_rounds:
                raise HTTPException(
                    status_code=422,
                    detail="round_scores length exceeds format round count",
                )
        if row.score is None:
            raise HTTPException(
                status_code=422,
                detail="Each result row must supply a score",
            )
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
            QuizResultCreate(
                player_id=player_id,
                final_rank=row.final_rank,
                score=row.score,
                round_scores=row.round_scores,
                country=row.country,
            )
        )
    crud.create_quiz_results(
        session=session, event_id=id, results=creates
    )
    # Fetch all results for this quiz to return the complete list
    all_results = session.exec(
        select(QuizResult).where(QuizResult.quiz_id == id)
    ).all()
    return QuizResultsPublic(data=all_results, count=len(all_results))
```

with:

```python
@router.post("/{id}/results", response_model=QuizResultsPublic)
def submit_results(
    *,
    session: SessionDep,
    current_user: CurrentOrganizer,  # noqa: ARG001
    id: uuid.UUID,
    request: SubmitResultsRequest,
) -> Any:
    event = session.get(Quiz, id)
    if not event:
        raise HTTPException(status_code=404, detail="Quiz not found")

    fmt = session.get(QuizFormat, event.format_id) if event.format_id else None
    num_rounds = len(fmt.rounds) if fmt else 0

    errors: list[str] = []
    for i, row in enumerate(request.results):
        if row.round_scores is not None:
            if fmt is None:
                errors.append(
                    f"Row {i + 1}: quiz has no format; round_scores are not accepted"
                )
            elif len(row.round_scores) > num_rounds:
                errors.append(
                    f"Row {i + 1}: round_scores length exceeds format round count"
                )
        if row.score is None:
            errors.append(f"Row {i + 1}: score is required")
        if not row.player_id and not row.player_create:
            errors.append(f"Row {i + 1}: player_id or player_create is required")

    if errors:
        raise HTTPException(status_code=422, detail={"errors": errors})

    if request.mode == SubmitMode.replace:
        existing = session.exec(select(QuizResult).where(QuizResult.quiz_id == id)).all()
        for r in existing:
            session.delete(r)
        session.flush()

    creates: list[QuizResultCreate] = []
    for row in request.results:
        assert row.score is not None  # validated above
        if row.player_id:
            player_id = row.player_id
        else:
            assert row.player_create is not None  # validated above
            player = crud.create_player(
                session=session, player_in=row.player_create, commit=False
            )
            player_id = player.id
        creates.append(
            QuizResultCreate(
                player_id=player_id,
                final_rank=row.final_rank,
                score=row.score,
                round_scores=row.round_scores,
                country=row.country,
            )
        )
    crud.create_quiz_results(
        session=session, event_id=id, results=creates, commit=False
    )
    session.commit()

    # Fetch all results for this quiz to return the complete list
    all_results = session.exec(
        select(QuizResult).where(QuizResult.quiz_id == id)
    ).all()
    return QuizResultsPublic(data=all_results, count=len(all_results))
```

- [ ] **Step 6: Run the new tests to verify they pass**

Run: `cd backend && pytest tests/api/routes/test_quizzes.py -k "rejects_batch_without_partial_writes or rejects_round_scores_without_partial_writes" -v`
Expected: Both PASS.

- [ ] **Step 7: Run the full backend test suite to confirm no regressions**

Run: `cd backend && bash ./scripts/test.sh`
Expected: All tests pass, including every test in `test_players.py` (which calls `crud.create_player` directly ~17 times without the new `commit` kwarg, so it must be unaffected) and every existing test in `test_quizzes.py`.

- [ ] **Step 8: Commit**

```bash
cd backend
git add app/crud.py app/api/routes/quizzes.py tests/api/routes/test_quizzes.py
git commit -m "fix(backend): validate all result rows before any writes in submit_results

Prevents a mid-batch invalid row from leaving orphan Player records
committed with no matching QuizResult. create_player and
create_quiz_results gain an opt-in commit=False parameter so
submit_results can batch everything into one transaction; all other
callers keep today's default commit=True behavior unchanged."
```

---

### Task 2: Frontend — quote-aware CSV parser

**Files:**
- Create: `frontend/src/lib/csv.ts`
- Modify: `frontend/src/components/Upload/steps/Step2CsvInput.tsx:12-18`
- Test: `frontend/tests/csv.test.ts`

**Interfaces:**
- Produces: `parseCsv(raw: string): string[][]` — exported from `frontend/src/lib/csv.ts`. Same signature and return shape as today's local function, so `Step2CsvInput.tsx`'s only change is the import + removing the local definition.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing unit tests**

Create `frontend/tests/csv.test.ts`:

```typescript
import { describe, expect, test } from "bun:test"
import { parseCsv } from "../src/lib/csv"

describe("parseCsv", () => {
  test("splits a simple comma-delimited row", () => {
    const rows = parseCsv("Name,Country,Score\nAlice,Ireland,50")
    expect(rows).toEqual([
      ["Name", "Country", "Score"],
      ["Alice", "Ireland", "50"],
    ])
  })

  test("keeps a quoted field containing a comma as one cell", () => {
    const rows = parseCsv('Name,Score\n"Smith, Jr., John",42')
    expect(rows).toEqual([
      ["Name", "Score"],
      ["Smith, Jr., John", "42"],
    ])
  })

  test("unescapes doubled quotes inside a quoted field", () => {
    const rows = parseCsv('Name,Score\n"Say ""Hi"" John",10')
    expect(rows).toEqual([
      ["Name", "Score"],
      ['Say "Hi" John', "10"],
    ])
  })

  test("detects and parses tab-delimited input", () => {
    const rows = parseCsv("Name\tCountry\tScore\nAlice\tIreland\t50")
    expect(rows).toEqual([
      ["Name", "Country", "Score"],
      ["Alice", "Ireland", "50"],
    ])
  })

  test("drops blank lines", () => {
    const rows = parseCsv("Name,Score\nAlice,50\n\nBob,40\n")
    expect(rows).toEqual([
      ["Name", "Score"],
      ["Alice", "50"],
      ["Bob", "40"],
    ])
  })

  test("trims whitespace around unquoted cells", () => {
    const rows = parseCsv("Name, Score \n Alice , 50 ")
    expect(rows).toEqual([
      ["Name", "Score"],
      ["Alice", "50"],
    ])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && bun test tests/csv.test.ts`
Expected: FAIL with a module-not-found error (`frontend/src/lib/csv.ts` doesn't exist yet).

- [ ] **Step 3: Create `frontend/src/lib/csv.ts`**

```typescript
function detectDelimiter(raw: string): string {
  const firstLine = raw.split("\n")[0] ?? ""
  const tabCount = (firstLine.match(/\t/g) ?? []).length
  const commaCount = (firstLine.match(/,/g) ?? []).length
  return tabCount > commaCount ? "\t" : ","
}

function parseDelimited(raw: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let inQuotes = false

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i]
    if (inQuotes) {
      if (char === '"' && raw[i + 1] === '"') {
        cell += '"'
        i++
        continue
      }
      if (char === '"') {
        inQuotes = false
        continue
      }
      cell += char
      continue
    }
    if (char === '"') {
      inQuotes = true
      continue
    }
    if (char === delimiter) {
      row.push(cell.trim())
      cell = ""
      continue
    }
    if (char === "\r") continue
    if (char === "\n") {
      row.push(cell.trim())
      rows.push(row)
      row = []
      cell = ""
      continue
    }
    cell += char
  }
  row.push(cell.trim())
  rows.push(row)

  return rows.filter((r) => r.some((c) => c.length > 0))
}

export function parseCsv(raw: string): string[][] {
  const trimmed = raw.trim()
  return parseDelimited(trimmed, detectDelimiter(trimmed))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && bun test tests/csv.test.ts`
Expected: All 6 tests PASS.

- [ ] **Step 5: Wire `Step2CsvInput.tsx` to the new parser**

In `frontend/src/components/Upload/steps/Step2CsvInput.tsx`, replace lines 1-18:

```typescript
import { useRef } from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import type { WizardState } from "../types"

interface Props {
  state: WizardState
  update: (patch: Partial<WizardState>) => void
}

function parseCsv(raw: string): string[][] {
  return raw
    .trim()
    .split("\n")
    .map((line) => line.split(/,|\t/).map((cell) => cell.trim()))
    .filter((row) => row.some((cell) => cell.length > 0))
}
```

with:

```typescript
import { useRef } from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { parseCsv } from "@/lib/csv"
import type { WizardState } from "../types"

interface Props {
  state: WizardState
  update: (patch: Partial<WizardState>) => void
}
```

- [ ] **Step 6: Run full frontend unit test suite and typecheck**

Run: `cd frontend && bun test:unit && bun run build`
Expected: All unit tests pass; `bun run build` (type-check + production build) succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
cd frontend
git add src/lib/csv.ts src/components/Upload/steps/Step2CsvInput.tsx tests/csv.test.ts
git commit -m "fix(frontend): make CSV/TSV parsing quote-aware

A comma inside a quoted name (e.g. 'Smith, Jr., John') previously
shifted every later column in that row, corrupting the score cell.
parseCsv now respects quoted fields per CSV convention and detects
comma vs. tab delimiter once per file instead of treating them as
interchangeable per line."
```

---

### Task 3: Frontend — pre-submit row validation gate

**Files:**
- Create: `frontend/src/lib/validateUploadRows.ts`
- Modify: `frontend/src/components/Upload/steps/Step5Preview.tsx`
- Modify: `frontend/src/test-ids.ts`
- Test: `frontend/tests/validate-upload-rows.test.ts`

**Interfaces:**
- Produces: `RowError` type `{ row: number; message: string }` and `validateUploadRows(parsedRows: string[][], columnMapping: ColumnMapping, resolutions: Resolution[]): RowError[]`, exported from `frontend/src/lib/validateUploadRows.ts`.
- Produces: `Labels.uploadValidationErrors` test-id string `"upload-validation-errors"` in `frontend/src/test-ids.ts`.
- Consumes: `ColumnMapping`, `Resolution` types from `frontend/src/components/Upload/types.ts` (already defined, unchanged).

- [ ] **Step 1: Write the failing unit tests**

Create `frontend/tests/validate-upload-rows.test.ts`:

```typescript
import { describe, expect, test } from "bun:test"
import { validateUploadRows } from "../src/lib/validateUploadRows"
import type { ColumnMapping, Resolution } from "../src/components/Upload/types"

const baseMapping: ColumnMapping = {
  player_name: 0,
  country: 1,
  score: 2,
  position: null,
  rounds: [],
}

function resolution(): Resolution {
  return { player_id: "some-id", player_create: null }
}

describe("validateUploadRows", () => {
  test("returns no errors for clean rows", () => {
    const parsedRows = [
      ["Name", "Country", "Score"],
      ["Alice", "Ireland", "50"],
    ]
    const errors = validateUploadRows(parsedRows, baseMapping, [resolution()])
    expect(errors).toEqual([])
  })

  test("flags a missing player name", () => {
    const parsedRows = [
      ["Name", "Country", "Score"],
      ["", "Ireland", "50"],
    ]
    const errors = validateUploadRows(parsedRows, baseMapping, [resolution()])
    expect(errors).toEqual([{ row: 1, message: "Player name is missing" }])
  })

  test("flags a missing score", () => {
    const parsedRows = [
      ["Name", "Country", "Score"],
      ["Alice", "Ireland", ""],
    ]
    const errors = validateUploadRows(parsedRows, baseMapping, [resolution()])
    expect(errors).toEqual([{ row: 1, message: "Score is missing" }])
  })

  test("flags a non-numeric score", () => {
    const parsedRows = [
      ["Name", "Country", "Score"],
      ["Alice", "Ireland", "DNF"],
    ]
    const errors = validateUploadRows(parsedRows, baseMapping, [resolution()])
    expect(errors).toEqual([
      { row: 1, message: 'Score "DNF" is not a number' },
    ])
  })

  test("allows a blank round score but flags a non-numeric one", () => {
    const mapping: ColumnMapping = { ...baseMapping, rounds: [3, 4] }
    const parsedRows = [
      ["Name", "Country", "Score", "R1", "R2"],
      ["Alice", "Ireland", "50", "", "bad"],
    ]
    const errors = validateUploadRows(parsedRows, mapping, [resolution()])
    expect(errors).toEqual([
      { row: 1, message: 'Round 2 score "bad" is not a number' },
    ])
  })

  test("uses the player_create display_name when present", () => {
    const parsedRows = [
      ["Name", "Country", "Score"],
      ["", "Ireland", "50"],
    ]
    const resolutions: Resolution[] = [
      {
        player_id: null,
        player_create: { display_name: "New Player", countries: ["IE"] },
      },
    ]
    const errors = validateUploadRows(parsedRows, baseMapping, resolutions)
    expect(errors).toEqual([])
  })
})
```

This matches the generated `PlayerCreate` type (`frontend/src/client/types.gen.ts:71-78`): `{ display_name: string; city?: string | null; club?: string | null; bio?: string | null; photo_url?: string | null; countries?: Array<string> }` — `display_name` and `countries` are the only fields the test needs.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && bun test tests/validate-upload-rows.test.ts`
Expected: FAIL with a module-not-found error.

- [ ] **Step 3: Create `frontend/src/lib/validateUploadRows.ts`**

```typescript
import type { ColumnMapping, Resolution } from "@/components/Upload/types"

export interface RowError {
  row: number
  message: string
}

export function validateUploadRows(
  parsedRows: string[][],
  columnMapping: ColumnMapping,
  resolutions: Resolution[],
): RowError[] {
  const errors: RowError[] = []

  resolutions.forEach((resolution, i) => {
    const row = parsedRows[i + 1]
    if (!row) return

    const displayNumber = i + 1
    const name =
      resolution.player_create?.display_name ?? row[columnMapping.player_name]
    if (!name?.trim()) {
      errors.push({ row: displayNumber, message: "Player name is missing" })
    }

    const rawScore = row[columnMapping.score]
    if (!rawScore?.trim()) {
      errors.push({ row: displayNumber, message: "Score is missing" })
    } else if (Number.isNaN(parseFloat(rawScore))) {
      errors.push({
        row: displayNumber,
        message: `Score "${rawScore}" is not a number`,
      })
    }

    columnMapping.rounds.forEach((colIdx, roundIdx) => {
      if (colIdx === null) return
      const raw = row[colIdx]
      if (raw?.trim() && Number.isNaN(parseFloat(raw))) {
        errors.push({
          row: displayNumber,
          message: `Round ${roundIdx + 1} score "${raw}" is not a number`,
        })
      }
    })
  })

  return errors
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && bun test tests/validate-upload-rows.test.ts`
Expected: All 6 tests PASS.

- [ ] **Step 5: Add the test-id for the error banner**

In `frontend/src/test-ids.ts`, add a new entry alongside the existing `columnMapping*` labels (after `columnMappingPosition: "column-mapping-position",`):

```typescript
  uploadValidationErrors: "upload-validation-errors",
```

- [ ] **Step 6: Wire the validation gate into `Step5Preview.tsx`**

In `frontend/src/components/Upload/steps/Step5Preview.tsx`, the current imports (lines 1-9) are:

```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"

import { QuizzesService } from "@/client"
import { Button } from "@/components/ui/button"
import useCustomToast from "@/hooks/useCustomToast"
import { resolveCountryCode } from "@/lib/countries"
import { Labels } from "@/test-ids"
import type { WizardState } from "../types"
```

Replace with:

```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useMemo } from "react"

import { QuizzesService } from "@/client"
import { Button } from "@/components/ui/button"
import useCustomToast from "@/hooks/useCustomToast"
import { resolveCountryCode } from "@/lib/countries"
import { validateUploadRows } from "@/lib/validateUploadRows"
import { Labels } from "@/test-ids"
import type { WizardState } from "../types"
```

(`Labels` was already imported for the existing `data-testid={Labels.submitModeToggle}` usage — no change needed to that line, only the two new lines above.)

Add the computed errors right after the existing `parseRows` declaration (after line 38, before `const submitMutation = ...`):

```typescript
  const validationErrors = useMemo(
    () =>
      validateUploadRows(state.parsedRows, state.columnMapping, state.resolutions),
    [state.parsedRows, state.columnMapping, state.resolutions],
  )
```

Add the error banner in the JSX, right before the final `<div className="flex gap-3">` submit-button row:

```tsx
      {validationErrors.length > 0 && (
        <div
          data-testid={Labels.uploadValidationErrors}
          className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 flex flex-col gap-1 text-sm text-destructive"
        >
          {validationErrors.map((e, idx) => (
            <p key={idx}>
              Row {e.row}: {e.message}
            </p>
          ))}
        </div>
      )}

```

Update the submit button's `disabled` condition:

```tsx
        <Button
          onClick={() => submitMutation.mutate()}
          disabled={submitMutation.isPending || validationErrors.length > 0}
        >
```

- [ ] **Step 7: Run full frontend unit test suite and typecheck**

Run: `cd frontend && bun test:unit && bun run build`
Expected: All unit tests pass; build succeeds with no type errors.

- [ ] **Step 8: Commit**

```bash
cd frontend
git add src/lib/validateUploadRows.ts src/components/Upload/steps/Step5Preview.tsx src/test-ids.ts tests/validate-upload-rows.test.ts
git commit -m "fix(frontend): block upload submission on invalid rows

Adds a pre-submit validation pass over parsed CSV rows that flags
missing player names, missing/non-numeric scores, and non-numeric
round scores. The submit button stays disabled until every row is
clean, so a malformed cell can no longer reach the API as a silent
NaN-turned-null score."
```

---

### Task 4: Frontend — end-to-end coverage tying parsing and validation together

**Files:**
- Modify: `frontend/tests/upload.spec.ts`

**Interfaces:**
- Consumes: `Labels.uploadValidationErrors` (Task 3), the quote-aware `parseCsv` (Task 2, exercised indirectly through the UI — no direct import needed).

- [ ] **Step 1: Write the new Playwright tests**

`Step4Disambiguation.tsx` runs an async player-name search (`PlayersService.searchPlayersRoute`) before its "Next →" button becomes enabled. For a name with zero matching candidates, `getAutoResolution` (lines 25-39) auto-resolves to "create new player" with no manual interaction required — the test just needs to wait for "Next →" to become enabled rather than clicking immediately. The `chromium` Playwright project already carries superuser auth via `playwright/.auth/user.json` (see `players.spec.ts:117`), so no login step is needed. Use distinctive names (not "Alice"/"Bob", which other tests' fixture data may already contain) so each row reliably has zero candidates and auto-resolves without hitting the "Needs Review" path.

Add to `frontend/tests/upload.spec.ts`, as a new describe block:

```typescript
test.describe("Upload wizard — result row validation", () => {
  test("a quoted comma in a name does not shift columns or trip validation", async ({
    page,
  }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeNew).click()
    await page.getByLabel("Quiz name *").fill("Test Quiz")
    await page.getByRole("button", { name: "Next →" }).click()
    await page
      .getByLabel("Or paste data directly")
      .fill('Name,Country,Score\n"Smith, Jr., John",Ireland,42')
    await page.getByRole("button", { name: "Next →" }).click() // Step2 -> Step3
    await page.getByRole("button", { name: "Next →" }).click() // Step3 -> Step4
    await expect(
      page.getByRole("button", { name: "Next →" }),
    ).toBeEnabled({ timeout: 15000 }) // wait for async player search to settle
    await page.getByRole("button", { name: "Next →" }).click() // Step4 -> Step5

    await expect(page.getByTestId(Labels.uploadValidationErrors)).toHaveCount(
      0,
    )
    await expect(
      page.getByRole("button", { name: "Submit for review" }),
    ).toBeEnabled()
  })

  test("a non-numeric score blocks submission with a row error", async ({
    page,
  }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeNew).click()
    await page.getByLabel("Quiz name *").fill("Test Quiz")
    await page.getByRole("button", { name: "Next →" }).click()
    await page
      .getByLabel("Or paste data directly")
      .fill("Name,Country,Score\nNonnumeric Score Tester,Ireland,DNF")
    await page.getByRole("button", { name: "Next →" }).click() // Step2 -> Step3
    await page.getByRole("button", { name: "Next →" }).click() // Step3 -> Step4
    await expect(
      page.getByRole("button", { name: "Next →" }),
    ).toBeEnabled({ timeout: 15000 }) // wait for async player search to settle
    await page.getByRole("button", { name: "Next →" }).click() // Step4 -> Step5

    await expect(
      page.getByTestId(Labels.uploadValidationErrors),
    ).toContainText('Score "DNF" is not a number')
    await expect(
      page.getByRole("button", { name: "Submit for review" }),
    ).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run the new tests against the running stack**

Run (from `frontend/`, with the backend stack up via `docker compose watch` in another terminal): `bunx playwright test upload.spec.ts -g "result row validation"`
Expected: Both tests PASS. If Step4's flow differs from the plain "Next →" assumption above, fix the navigation in Step 1 and re-run until green.

- [ ] **Step 3: Run the full Playwright suite to confirm no regressions**

Run: `cd frontend && bunx playwright test`
Expected: All tests pass, including the pre-existing `upload.spec.ts` tests.

- [ ] **Step 4: Commit**

```bash
cd frontend
git add tests/upload.spec.ts
git commit -m "test(frontend): cover quoted-name parsing and score validation E2E

Exercises the full upload wizard for the two scenarios this feature
set out to fix: a comma-containing quoted name no longer shifts
columns, and a non-numeric score blocks submission with a visible
per-row error instead of silently reaching the API as null."
```

---

### Task 5: Full regression check

**Files:** None (verification only).

- [ ] **Step 1: Run the full backend suite**

Run: `cd backend && bash ./scripts/test.sh`
Expected: All tests pass.

- [ ] **Step 2: Run the full frontend unit suite**

Run: `cd frontend && bun test:unit`
Expected: All tests pass.

- [ ] **Step 3: Run the full frontend build/typecheck**

Run: `cd frontend && bun run build`
Expected: Succeeds with no type errors.

- [ ] **Step 4: Run the full Playwright suite against the live stack**

Run: `docker compose watch` (in one terminal, if not already running), then `cd frontend && bunx playwright test` (in another).
Expected: All tests pass.

- [ ] **Step 5: Manually verify the original bug is fixed**

Start the stack (`docker compose watch`), open the upload wizard in a browser, and paste a CSV containing a name with an embedded comma in quotes (e.g. `Name,Country,Score` / `"Doe, Jr., Jane",Ireland,37`) alongside a row with a deliberately broken score (e.g. `Bob,England,N/A`). Confirm: the quoted-comma row parses correctly and shows no error; the broken-score row shows a validation error and the submit button stays disabled until it's fixed; after fixing it, submission succeeds and the quiz shows both results with no orphan players in the admin players list.
