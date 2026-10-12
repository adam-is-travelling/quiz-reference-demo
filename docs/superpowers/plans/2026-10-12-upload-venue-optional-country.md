# Upload: Optional Country, Per-Result Venue, Compact Mapping — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make country optional on upload (flagging countryless new players), store an optional free-text venue per result, and lay out the Step 3 column mapping as a compact grid on desktop.

**Architecture:** A nullable `venue` column on `quizresult`, threaded through the upload submit, PATCH and read schemas, normalised (trim, blank → null) by a shared Pydantic validator. The wizard gains an optional Venue mapping, a pure helper that counts countryless new players for Step 4/5 warnings, and a responsive grid in Step 3. Results tables show a Venue column only when some result has one.

**Tech Stack:** FastAPI + SQLModel + Alembic (backend), React + TanStack Query/Table + shadcn/ui + Tailwind v4 (frontend), `bun test` (unit), Playwright (E2E), pytest (backend).

**Spec:** `docs/superpowers/specs/2026-10-12-upload-venue-optional-country-design.md`

## Global Constraints

- Venue: `str | None`, `max_length=255`, one per **result** (not per participant). Free text; no Venue table.
- Venue normalisation: trim; empty / whitespace-only → `null`. On PATCH, explicit `null` or `""` clears; omitted leaves unchanged.
- Venue header detection: `["venue", "location", "site"]` (not `city`).
- Country is optional in **every** participant mode; undetected → "Not mapped" (`null`).
- "Countryless" = a participant resolution with `player_create` set and `countries` empty/absent. The warning never blocks.
- Banner copy: `N new player(s) will be created without a country. You can set one below, or later from their profile.` (singular "player" when N = 1).
- Country helper text: `Optional — new players without a country will be flagged on the next step.`
- Unmapped Country / Venue columns are omitted from the Step 3 preview; Venue is omitted from the Step 5 preview when unmapped; results tables show Venue only when ≥1 result has one.
- Segmented toggles keep `bg-primary` on the active option (E2E relies on it). Keep every existing `data-testid`.
- Backend commands run on the host from `backend/` with the repo-root venv: `../.venv/bin/pytest`, `../.venv/bin/alembic`. Never `docker compose exec backend …` (stale baked image). Never `docker compose down -v`.
- Backend tests only delete rows they create (see `tests/api/routes/test_quizzes.py` `clean_quizzes_data`).
- Never run two Playwright suites at once.

## Review Focus

1. **Over-long venue (>255 chars) in the CSV** — the whole submit would 422 with a generic toast. Expected: Step 5 shows a row validation error and blocks submit. Test in Task 4 (`validateUploadRows`).
2. **Re-uploading in append mode over an existing result** — the upsert path in `crud.create_quiz_results` must update `venue`, not just insert it. Test in Task 1.
3. **Country column mapped, but the value is unrecognised ("Narnia")** — the player is created countryless and must be flagged. Test in Task 3.
4. **Admin explicitly sets Venue to "Not mapped", goes to Step 4, then Back** — remounting Step 3 must not re-detect and re-map the Venue column. Test in Task 4 (`computeInitialMapping`).
5. **PATCHing a result without a `venue` key** (e.g. the existing score edit) must not wipe its venue. Test in Task 1.

---

### Task 1: Backend — `venue` on results

**Files:**
- Create: `backend/app/alembic/versions/e4b7c1d9a2f3_add_venue_to_quizresult.py`
- Modify: `backend/app/models.py` (`ResolvedResultRow` ~l.1027, `QuizResultCreate` ~l.810, `QuizResultUpdate` ~l.819, `QuizResult` ~l.862, `QuizResultPublic` ~l.920, `QuizResultWithPlayer` ~l.937)
- Modify: `backend/app/crud.py` (`create_quiz_results` ~l.1130-1150)
- Modify: `backend/app/api/routes/quizzes.py` (`_results_public` ~l.87, `read_quiz_results_with_players` ~l.307, `submit_results` ~l.509)
- Test: `backend/tests/api/routes/test_quiz_venue.py` (new)
- Regenerate: `frontend/openapi.json`, `frontend/src/client/`

**Interfaces:**
- Produces: `venue: string | null` on the generated client types `ResolvedResultRow`, `QuizResultUpdate`, `QuizResultPublic`, `QuizResultWithPlayer`; `QuizzesService.submitResults` and `updateQuizResult` accept it.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/api/routes/test_quiz_venue.py`:

```python
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete, select

from app.core.config import settings
from app.models import Player, Quiz, QuizResult, QuizResultPlayer
from tests.utils.quiz import create_approved_quiz, create_random_player, create_random_quiz


@pytest.fixture(autouse=True)
def clean_venue_data(db: Session) -> Generator[None, None, None]:
    pre_quizzes = {r.id for r in db.exec(select(Quiz)).all()}
    pre_players = {r.id for r in db.exec(select(Player)).all()}
    yield
    db.expire_all()
    new_quiz_ids = {r.id for r in db.exec(select(Quiz)).all()} - pre_quizzes
    if new_quiz_ids:
        db.execute(delete(Quiz).where(col(Quiz.id).in_(new_quiz_ids)))
    new_player_ids = {r.id for r in db.exec(select(Player)).all()} - pre_players
    if new_player_ids:
        db.execute(delete(Player).where(col(Player.id).in_(new_player_ids)))
    db.commit()


def _submit(client: TestClient, headers: dict[str, str], quiz_id, results, mode="replace"):
    return client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz_id}/results",
        headers=headers,
        json={"mode": mode, "results": results},
    )


def test_submit_stores_venue_and_reads_it_back(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    quiz = create_random_quiz(db)
    a = create_random_player(db)
    b = create_random_player(db)
    response = _submit(
        client,
        superuser_token_headers,
        quiz.id,
        [
            {"participants": [{"player_id": str(a.id)}], "final_rank": 1, "score": 50.0, "venue": "  The Crown, Leeds "},
            {"participants": [{"player_id": str(b.id)}], "final_rank": 2, "score": 40.0},
        ],
    )
    assert response.status_code == 200
    by_rank = {r["final_rank"]: r for r in response.json()["data"]}
    assert by_rank[1]["venue"] == "The Crown, Leeds"
    assert by_rank[2]["venue"] is None

    read = client.get(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/with-players",
        headers=superuser_token_headers,
    )
    by_rank = {r["final_rank"]: r for r in read.json()["data"]}
    assert by_rank[1]["venue"] == "The Crown, Leeds"
    assert by_rank[2]["venue"] is None


def test_whitespace_only_venue_is_stored_as_null(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    quiz = create_random_quiz(db)
    a = create_random_player(db)
    response = _submit(
        client,
        superuser_token_headers,
        quiz.id,
        [{"participants": [{"player_id": str(a.id)}], "final_rank": 1, "score": 50.0, "venue": "   "}],
    )
    assert response.status_code == 200
    assert response.json()["data"][0]["venue"] is None


def test_append_resubmit_updates_existing_result_venue(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    quiz = create_random_quiz(db)
    a = create_random_player(db)
    row = {"participants": [{"player_id": str(a.id)}], "final_rank": 1, "score": 50.0}
    _submit(client, superuser_token_headers, quiz.id, [{**row, "venue": "Leeds"}])
    response = _submit(
        client, superuser_token_headers, quiz.id, [{**row, "venue": "Oslo"}], mode="append"
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert len(data) == 1
    assert data[0]["venue"] == "Oslo"


def _seed_result(db: Session, venue: str | None) -> tuple[Quiz, QuizResult]:
    quiz = create_approved_quiz(db)
    player = create_random_player(db)
    result = QuizResult(quiz_id=quiz.id, score=30.0, final_rank=1, venue=venue)
    db.add(result)
    db.commit()
    db.refresh(result)
    db.add(QuizResultPlayer(quiz_result_id=result.id, slot=1, quiz_id=quiz.id, player_id=player.id))
    db.commit()
    return quiz, result


def test_patch_sets_and_clears_venue(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    quiz, result = _seed_result(db, venue=None)
    url = f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/{result.id}"

    set_resp = client.patch(url, json={"venue": " Oslo "}, headers=superuser_token_headers)
    assert set_resp.status_code == 200
    assert set_resp.json()["venue"] == "Oslo"

    clear_resp = client.patch(url, json={"venue": ""}, headers=superuser_token_headers)
    assert clear_resp.status_code == 200
    assert clear_resp.json()["venue"] is None


def test_patch_without_venue_keeps_it(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    quiz, result = _seed_result(db, venue="Leeds")
    response = client.patch(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/{result.id}",
        json={"score": 55.0},
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    assert response.json()["venue"] == "Leeds"


def test_venue_longer_than_255_is_rejected(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    quiz = create_random_quiz(db)
    a = create_random_player(db)
    response = _submit(
        client,
        superuser_token_headers,
        quiz.id,
        [{"participants": [{"player_id": str(a.id)}], "final_rank": 1, "score": 50.0, "venue": "x" * 256}],
    )
    assert response.status_code == 422
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `backend/`): `../.venv/bin/pytest tests/api/routes/test_quiz_venue.py -v`
Expected: FAIL — `QuizResult` has no `venue` (TypeError / KeyError on `"venue"`).

- [ ] **Step 3: Add the migration**

Create `backend/app/alembic/versions/e4b7c1d9a2f3_add_venue_to_quizresult.py`:

```python
"""add venue to quizresult

Revision ID: e4b7c1d9a2f3
Revises: d8e3f0a2b5c7
Create Date: 2026-10-12 12:00:00.000000

"""
import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op


# revision identifiers, used by Alembic.
revision = 'e4b7c1d9a2f3'
down_revision = 'd8e3f0a2b5c7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "quizresult",
        sa.Column("venue", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("quizresult", "venue")
```

Run (from `backend/`): `../.venv/bin/alembic heads` → must print only `e4b7c1d9a2f3 (head)`. Then `../.venv/bin/alembic upgrade head`.

- [ ] **Step 4: Add the model field, schemas and validator**

In `backend/app/models.py`, directly above `class QuizResultCreate`, add:

```python
def _normalize_venue(v: str | None) -> str | None:
    """Trim a venue; an empty or whitespace-only one means "no venue"."""
    if v is None:
        return None
    v = v.strip()
    return v or None
```

Add to `QuizResultCreate` and `QuizResultUpdate` (after `team_country`):

```python
    venue: str | None = Field(default=None, max_length=255)

    @field_validator("venue")
    @classmethod
    def normalize_venue(cls, v: str | None) -> str | None:
        return _normalize_venue(v)
```

Add the same field + validator to `ResolvedResultRow` (after `team_country`). `ResolvedResultRow` is defined later in the file than `_normalize_venue`, so the helper is in scope.

Add to the `QuizResult` table (after `team_country`):

```python
    # Where this result was sat, for quizzes written at several venues at
    # once. Free text, per result — no venue table (see the 2026-10-12 spec).
    venue: str | None = Field(default=None, max_length=255)
```

Add `venue: str | None = None` to `QuizResultPublic` and `QuizResultWithPlayer` (after `team_country`).

- [ ] **Step 5: Thread venue through CRUD and routes**

`backend/app/crud.py`, `create_quiz_results`: in the `if existing:` branch add `existing.venue = r.venue` after `existing.team_country = r.team_country`; in the `QuizResult(...)` constructor add `venue=r.venue,` after `team_country=r.team_country,`.

`update_quiz_result` needs no change: `model_dump(exclude_unset=True)` carries `venue` only when sent.

`backend/app/api/routes/quizzes.py`:
- `_results_public`: add `venue=r.venue,` after `team_country=r.team_country,`.
- `read_quiz_results_with_players` (the `QuizResultWithPlayer(...)` list, ~l.307): add `venue=r.venue,`.
- `submit_results` (the `QuizResultCreate(...)` ~l.509): add `venue=row.venue,`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `../.venv/bin/pytest tests/api/routes/test_quiz_venue.py -v` → all PASS.
Then the neighbouring suites: `../.venv/bin/pytest tests/api/routes/test_quizzes.py tests/api/routes/test_quiz_teams.py tests/api/routes/test_quiz_pairs.py tests/crud -q` → PASS.

- [ ] **Step 7: Lint and regenerate the client**

From `backend/`: `../.venv/bin/ruff check app tests && ../.venv/bin/ruff format app tests`.
From repo root: `bash ./scripts/generate-client.sh`. Confirm `grep -n "venue" frontend/src/client/types.gen.ts` lists `venue` on `QuizResultPublic`, `QuizResultUpdate`, `QuizResultWithPlayer`, `ResolvedResultRow`.
From `frontend/`: `bun run build` → succeeds.

- [ ] **Step 8: Commit**

```bash
git add backend/app/models.py backend/app/crud.py backend/app/api/routes/quizzes.py \
  backend/app/alembic/versions/e4b7c1d9a2f3_add_venue_to_quizresult.py \
  backend/tests/api/routes/test_quiz_venue.py frontend/openapi.json frontend/src/client
git commit -m "feat(backend): store an optional venue on each quiz result"
```

---

### Task 2: Country is optional in every mode

**Files:**
- Modify: `frontend/src/lib/columnDetection.ts` (`resolveCountryColumn`, l.~90-111)
- Modify: `frontend/src/components/Upload/steps/Step3ColumnMapping.tsx` (country select, l.346-382; comment l.109-113)
- Test: `frontend/tests/column-detection.test.ts` (`describe("resolveCountryColumn")`, l.103-129), `frontend/tests/step3-initial-mapping.test.ts` (l.168-181), `frontend/tests/upload.spec.ts` (l.266-286)

**Interfaces:**
- Produces: `resolveCountryColumn(existing: number | null, detected: number | null, defaultIndex: number): number | null` — the `participantMode` parameter is **removed**.

- [ ] **Step 1: Update the unit tests to the new rule**

Replace the `describe("resolveCountryColumn", …)` block in `frontend/tests/column-detection.test.ts` with:

```ts
describe("resolveCountryColumn", () => {
  const DEFAULT_INDEX = 1

  test("detection fails → null (Not mapped); country is optional in every mode", () => {
    expect(resolveCountryColumn(1, null, DEFAULT_INDEX)).toBeNull()
  })

  test("detection succeeds → the detected index", () => {
    expect(resolveCountryColumn(1, 3, DEFAULT_INDEX)).toBe(3)
  })

  test("a value already changed away from the default is returned untouched", () => {
    expect(resolveCountryColumn(4, null, DEFAULT_INDEX)).toBe(4)
    expect(resolveCountryColumn(4, 2, DEFAULT_INDEX)).toBe(4)
    expect(resolveCountryColumn(null, null, DEFAULT_INDEX)).toBeNull()
    expect(resolveCountryColumn(null, 2, DEFAULT_INDEX)).toBeNull()
  })
})
```

In `frontend/tests/step3-initial-mapping.test.ts`, rename the test at l.168 to `"individual falls back to the default name/score columns and leaves country unmapped"` and change `expect(mapping.country).toBe(1)` to `expect(mapping.country).toBeNull()`.

- [ ] **Step 2: Run to verify they fail**

Run (from `frontend/`): `bun test tests/column-detection.test.ts tests/step3-initial-mapping.test.ts`
Expected: FAIL (individual still falls back to 1; arity mismatch).

- [ ] **Step 3: Implement**

Replace `resolveCountryColumn` and its doc comment in `frontend/src/lib/columnDetection.ts`:

```ts
/**
 * Resolve the country column index, given the mapping's current value and a
 * fresh detection attempt.
 *
 * A value the user (or a prior detection pass) already moved away from the
 * compiled-in default is left untouched — including an explicit null ("Not
 * mapped"). Otherwise a successful detection wins, and failing that the
 * column is left unmapped: country is optional in every participant mode, and
 * new players created without one are flagged in Step 4.
 */
export function resolveCountryColumn(
  existing: number | null,
  detected: number | null,
  defaultIndex: number,
): number | null {
  if (existing !== defaultIndex) {
    return existing
  }
  return detected
}
```

Remove the now-unused `import type { ParticipantMode } from "@/components/Upload/types"` (line 1) — `resolveCountryColumn` was its only user.

In `Step3ColumnMapping.tsx` `computeInitialMapping`: replace the comment block above `countryDetected` with
`// Country is optional, so it lives outside REQUIRED_FIELDS. Same "only auto-detect while still at the compiled-in default" rule.`
and call `resolveCountryColumn(existing.country, countryDetected, DEFAULT_INDEX.country)`.

Replace the Country select block (label, `SelectContent`, helper text) so it is identical in every mode:

```tsx
      <div className="grid gap-1.5">
        <Label>Country column (optional)</Label>
        <Select
          value={
            mapping.country !== null ? String(mapping.country) : "__none__"
          }
          onValueChange={(v) =>
            setMapping((m) => ({
              ...m,
              country: v === "__none__" ? null : Number(v),
            }))
          }
        >
          <SelectTrigger data-testid={Labels.columnMappingCountry}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Not mapped</SelectItem>
            {header.map((col, i) => (
              <SelectItem key={i} value={String(i)}>
                {col || `Column ${i + 1}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Optional — new players without a country will be flagged on the next
          step.
        </p>
      </div>
```

(Task 5 moves this block into the grid; keep it self-contained.)

- [ ] **Step 4: Update the E2E fallback expectation**

In `frontend/tests/upload.spec.ts`, test `"Falls back to default columns when no header matches"` (l.266): replace the country assertion with

```ts
    await expect(page.getByTestId(Labels.columnMappingCountry)).toContainText(
      "Not mapped",
    )
```

(E2E runs in Task 7.)

- [ ] **Step 5: Run unit tests and build**

Run: `bun run test:unit` → PASS. `bun run build` → succeeds.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/columnDetection.ts frontend/src/components/Upload/steps/Step3ColumnMapping.tsx \
  frontend/tests/column-detection.test.ts frontend/tests/step3-initial-mapping.test.ts frontend/tests/upload.spec.ts
git commit -m "feat(upload): country column is optional for individual quizzes too"
```

---

### Task 3: Flag new players created without a country

**Files:**
- Create: `frontend/src/lib/countrylessPlayers.ts`
- Create: `frontend/tests/countryless-players.test.ts`
- Modify: `frontend/tests/match-players.test.ts` (append tests)
- Modify: `frontend/src/components/Upload/steps/Step4Disambiguation.tsx` (`RowDisambiguator` header ~l.174; main render ~l.651)
- Modify: `frontend/src/components/Upload/steps/Step5Preview.tsx` (summary ~l.184-193)
- Modify: `frontend/src/test-ids.ts`

**Interfaces:**
- Consumes: `Resolution` (`@/components/Upload/types`), `RowResolution` (`@/lib/matchPlayers`).
- Produces:
  - `isCountrylessNewPlayer(r: Resolution): boolean`
  - `countCountrylessNewPlayers(rows: RowResolution[]): number`
  - `countrylessMessage(n: number): string`
  - `Labels.countrylessBanner = "countryless-banner"`, `Labels.noCountryBadge = "no-country-badge"`

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/countryless-players.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import type { Resolution } from "@/components/Upload/types"
import {
  countCountrylessNewPlayers,
  countrylessMessage,
  isCountrylessNewPlayer,
} from "@/lib/countrylessPlayers"
import { getAutoResolution } from "@/lib/matchPlayers"

const create = (countries?: string[]): Resolution => ({
  player_id: null,
  player_create: { display_name: "Jane", countries },
})
const existing: Resolution = { player_id: "p1", player_create: null }
const unresolved: Resolution = { player_id: null, player_create: null }

describe("isCountrylessNewPlayer", () => {
  test("a new player with no countries is countryless", () => {
    expect(isCountrylessNewPlayer(create([]))).toBe(true)
    expect(isCountrylessNewPlayer(create(undefined))).toBe(true)
  })
  test("a new player with a country is not", () => {
    expect(isCountrylessNewPlayer(create(["IE"]))).toBe(false)
  })
  test("matched or unresolved rows are never countryless", () => {
    expect(isCountrylessNewPlayer(existing)).toBe(false)
    expect(isCountrylessNewPlayer(unresolved)).toBe(false)
  })
})

describe("countCountrylessNewPlayers", () => {
  test("counts across every participant of every row", () => {
    expect(
      countCountrylessNewPlayers([
        { participants: [create([]), create(["IE"])] },
        { participants: [existing] },
        { participants: [create(undefined)] },
      ]),
    ).toBe(2)
  })
})

describe("countrylessMessage", () => {
  test("singular and plural", () => {
    expect(countrylessMessage(1)).toBe(
      "1 new player will be created without a country. You can set one below, or later from their profile.",
    )
    expect(countrylessMessage(3)).toBe(
      "3 new players will be created without a country. You can set one below, or later from their profile.",
    )
  })
})

describe("auto-created players from the CSV", () => {
  test("an unrecognised country value yields a countryless new player", () => {
    const r = getAutoResolution(
      { player_name: "Jane", country: "Narnia", score: 1 },
      [],
    )
    expect(isCountrylessNewPlayer(r)).toBe(true)
  })
  test("a blank country (column unmapped) yields a countryless new player", () => {
    const r = getAutoResolution({ player_name: "Jane", country: "", score: 1 }, [])
    expect(isCountrylessNewPlayer(r)).toBe(true)
  })
})
```

Append to `frontend/tests/match-players.test.ts`:

```ts
describe("getAutoResolution — blank country", () => {
  test("a blank CSV country is never a mismatch: single high match auto-resolves", () => {
    const r = getAutoResolution(
      { player_name: "Jane Doe", country: "", score: 1 },
      [candidate("p1", 0.95)],
    )
    expect(r.autoResolved).toBe(true)
    expect(r.player_id).toBe("p1")
    expect(r.reviewClass).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/countryless-players.test.ts tests/match-players.test.ts`
Expected: countryless file FAILS (module not found); the match-players addition PASSES already (it pins existing behaviour).

- [ ] **Step 3: Implement the helper**

Create `frontend/src/lib/countrylessPlayers.ts`:

```ts
import type { Resolution } from "@/components/Upload/types"
import type { RowResolution } from "@/lib/matchPlayers"

/**
 * Whether this resolution will create a player with no country — the case the
 * upload wizard flags, because country is optional and a missing one is easy
 * to overlook. Matched players keep whatever countries they already have.
 */
export function isCountrylessNewPlayer(r: Resolution): boolean {
  return r.player_create !== null && (r.player_create.countries ?? []).length === 0
}

export function countCountrylessNewPlayers(rows: RowResolution[]): number {
  return rows
    .flatMap((row) => row.participants)
    .filter(isCountrylessNewPlayer).length
}

export function countrylessMessage(n: number): string {
  const noun = n === 1 ? "player" : "players"
  return `${n} new ${noun} will be created without a country. You can set one below, or later from their profile.`
}
```

Add to `Labels` in `frontend/src/test-ids.ts`:

```ts
  countrylessBanner: "countryless-banner",
  noCountryBadge: "no-country-badge",
```

- [ ] **Step 4: Run the unit tests**

Run: `bun test tests/countryless-players.test.ts tests/match-players.test.ts` → PASS.

- [ ] **Step 5: Step 4 banner and badge**

In `Step4Disambiguation.tsx` add imports:

```ts
import {
  countCountrylessNewPlayers,
  countrylessMessage,
  isCountrylessNewPlayer,
} from "@/lib/countrylessPlayers"
```

In `RowDisambiguator`, replace the header paragraph (`{parsedRow.player_name} · {parsedRow.country} · Score: …`) with:

```tsx
      <p className="text-sm font-medium flex flex-wrap items-center gap-x-2">
        <span>
          {parsedRow.player_name}
          {parsedRow.country ? ` · ${parsedRow.country}` : ""} · Score:{" "}
          {parsedRow.score}
        </span>
        {isCountrylessNewPlayer(resolution) && (
          <span
            data-testid={Labels.noCountryBadge}
            className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300"
          >
            No country
          </span>
        )}
      </p>
```

In `Step4Disambiguation` (the exported component), after `const overallStatus = …` add:

```ts
  const countrylessCount = useMemo(
    () => countCountrylessNewPlayers(resolutions),
    [resolutions],
  )
```

In the returned JSX, directly after the intro `<p>` ("Confirm or correct each player match…"), add:

```tsx
      {allSettled && countrylessCount > 0 && (
        <div
          data-testid={Labels.countrylessBanner}
          role="status"
          className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          {countrylessMessage(countrylessCount)}
        </div>
      )}
```

(`Labels` is already imported in this file; confirm with grep.)

- [ ] **Step 6: Step 5 summary**

In `Step5Preview.tsx` import `countCountrylessNewPlayers, countrylessMessage` from `@/lib/countrylessPlayers`, and after the "new players will be created." `<p>` add:

```tsx
        {countCountrylessNewPlayers(state.resolutions) > 0 && (
          <p className="text-amber-700 dark:text-amber-400">
            {countrylessMessage(countCountrylessNewPlayers(state.resolutions))}
          </p>
        )}
```

- [ ] **Step 7: Verify**

`bun run test:unit` → PASS. `bun run build` → succeeds. `bun run lint`.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/countrylessPlayers.ts frontend/tests/countryless-players.test.ts \
  frontend/tests/match-players.test.ts frontend/src/components/Upload/steps/Step4Disambiguation.tsx \
  frontend/src/components/Upload/steps/Step5Preview.tsx frontend/src/test-ids.ts
git commit -m "feat(upload): flag new players that will be created without a country"
```

---

### Task 4: Venue column in the upload wizard

**Files:**
- Modify: `frontend/src/components/Upload/types.ts` (`ColumnMapping`, `INITIAL_STATE`)
- Modify: `frontend/src/lib/columnDetection.ts` (add `VENUE_HEADER_NAMES`)
- Create: `frontend/src/lib/venue.ts`
- Modify: `frontend/src/lib/validateUploadRows.ts`
- Modify: `frontend/src/components/Upload/steps/Step3ColumnMapping.tsx` (`computeInitialMapping`, `previewColumns`, `PREVIEW_HEADINGS`, preview `cell`, new select)
- Modify: `frontend/src/components/Upload/steps/Step5Preview.tsx` (payload + preview table)
- Modify: `frontend/src/test-ids.ts`
- Test: `frontend/tests/step3-initial-mapping.test.ts`, `frontend/tests/step3-preview-columns.test.ts`, `frontend/tests/venue.test.ts` (new), `frontend/tests/validate-upload-rows.test.ts`

**Interfaces:**
- Consumes: generated `ResolvedResultRow.venue` (Task 1).
- Produces:
  - `ColumnMapping.venue?: number | null` — `undefined` = not yet decided (auto-detect on Step 3 mount); `null` = explicitly "Not mapped"; number = column. `computeInitialMapping` always returns a `number | null`.
  - `VENUE_HEADER_NAMES = ["venue", "location", "site"]`
  - `rowVenue(row: string[] | undefined, col: number | null | undefined): string | null`
  - `VENUE_MAX_LENGTH = 255`
  - `previewColumns(mode, defaultTeamType, mapped: { country: boolean; venue: boolean }): PreviewColumn[]` with `PreviewColumn` gaining `"venue"`
  - `Labels.columnMappingVenue = "column-mapping-venue"`

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/venue.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { rowVenue } from "@/lib/venue"

describe("rowVenue", () => {
  test("trims the mapped cell", () => {
    expect(rowVenue(["Ann", " Leeds "], 1)).toBe("Leeds")
  })
  test("blank or whitespace cell → null", () => {
    expect(rowVenue(["Ann", "   "], 1)).toBeNull()
    expect(rowVenue(["Ann"], 1)).toBeNull()
  })
  test("unmapped column or missing row → null", () => {
    expect(rowVenue(["Ann", "Leeds"], null)).toBeNull()
    expect(rowVenue(["Ann", "Leeds"], undefined)).toBeNull()
    expect(rowVenue(undefined, 1)).toBeNull()
  })
})
```

Append to `frontend/tests/step3-initial-mapping.test.ts`:

```ts
describe("computeInitialMapping — venue", () => {
  test("detects a Venue header", () => {
    const mapping = mappingFor(
      [
        ["Name", "Country", "Venue", "Score"],
        ["Alice", "Ireland", "Leeds", "50"],
      ],
      "individual",
    )
    expect(mapping.venue).toBe(2)
    expect(mapping.score).toBe(3)
  })

  test("detects a Location header", () => {
    const mapping = mappingFor(
      [
        ["Name", "Location", "Score"],
        ["Alice", "Oslo", "50"],
      ],
      "individual",
    )
    expect(mapping.venue).toBe(1)
  })

  test("no venue-like header → null", () => {
    const mapping = mappingFor(
      [
        ["Name", "Country", "Score"],
        ["Alice", "Ireland", "50"],
      ],
      "individual",
    )
    expect(mapping.venue).toBeNull()
  })

  test("an explicit Not mapped survives a remount (Back from Step 4)", () => {
    const csv = [
      ["Name", "Venue", "Score"],
      ["Alice", "Leeds", "50"],
    ]
    const state = {
      ...stateFor(csv, "individual"),
      columnMapping: { ...INITIAL_STATE.columnMapping, venue: null },
    } satisfies WizardState
    expect(computeInitialMapping(state, 0).venue).toBeNull()
  })
})
```

Replace the body of `frontend/tests/step3-preview-columns.test.ts` so every call passes the mapped flags, plus new cases:

```ts
import { describe, expect, test } from "bun:test"
import { previewColumns } from "@/components/Upload/steps/Step3ColumnMapping"

const COUNTRY_ONLY = { country: true, venue: false }

describe("previewColumns", () => {
  test("individual shows the player and their country", () => {
    expect(previewColumns("individual", "national", COUNTRY_ONLY)).toEqual([
      "pos",
      "player",
      "country",
      "score",
    ])
  })

  test("pairs shows both players", () => {
    expect(previewColumns("pairs", "national", COUNTRY_ONLY)).toEqual([
      "pos",
      "player",
      "player2",
      "country",
      "score",
    ])
  })

  test("national teams drop the player column but keep the country", () => {
    expect(previewColumns("teams", "national", COUNTRY_ONLY)).toEqual([
      "pos",
      "team",
      "lineup",
      "country",
      "score",
    ])
  })

  test("club teams drop the country column as well", () => {
    expect(previewColumns("teams", "club", COUNTRY_ONLY)).toEqual([
      "pos",
      "team",
      "lineup",
      "score",
    ])
  })

  test("the default team type only matters outside teams mode", () => {
    expect(previewColumns("individual", "club", COUNTRY_ONLY)).toEqual(
      previewColumns("individual", "national", COUNTRY_ONLY),
    )
    expect(previewColumns("pairs", "club", COUNTRY_ONLY)).toEqual(
      previewColumns("pairs", "national", COUNTRY_ONLY),
    )
  })

  test("an unmapped country column is not previewed", () => {
    expect(
      previewColumns("individual", "national", { country: false, venue: false }),
    ).toEqual(["pos", "player", "score"])
  })

  test("a mapped venue is previewed before the score", () => {
    expect(
      previewColumns("individual", "national", { country: true, venue: true }),
    ).toEqual(["pos", "player", "country", "venue", "score"])
    expect(
      previewColumns("teams", "club", { country: true, venue: true }),
    ).toEqual(["pos", "team", "lineup", "venue", "score"])
  })
})
```

Append inside the `describe("validateUploadRows", …)` block of `frontend/tests/validate-upload-rows.test.ts` (it already defines `baseMapping` and `resolution()`):

```ts
  test("a venue longer than 255 characters is a row error", () => {
    const parsedRows = [
      ["Name", "Country", "Score", "Venue"],
      ["Alice", "Ireland", "50", "x".repeat(256)],
    ]
    const errors = validateUploadRows(
      parsedRows,
      { ...baseMapping, venue: 3 },
      [resolution()],
      "individual",
    )
    expect(errors).toContainEqual({
      row: 1,
      message: "Venue is longer than 255 characters",
    })
  })

  test("a 255-character venue is fine", () => {
    const parsedRows = [
      ["Name", "Country", "Score", "Venue"],
      ["Alice", "Ireland", "50", "x".repeat(255)],
    ]
    expect(
      validateUploadRows(
        parsedRows,
        { ...baseMapping, venue: 3 },
        [resolution()],
        "individual",
      ),
    ).toEqual([])
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/venue.test.ts tests/step3-initial-mapping.test.ts tests/step3-preview-columns.test.ts tests/validate-upload-rows.test.ts` → FAIL.

- [ ] **Step 3: Types, detection, helper**

`types.ts` — add to `ColumnMapping` (after `country`):

```ts
  /**
   * undefined = not decided yet (Step 3 auto-detects on mount); null = the
   * admin chose "Not mapped", which a remount must respect.
   */
  venue?: number | null
```

Leave `INITIAL_STATE.columnMapping` without a `venue` key (undefined).

`columnDetection.ts` — after `COUNTRY_HEADER_NAMES`:

```ts
// Not "city": a results file's city column is far more often the player's
// home city than where the quiz was sat.
export const VENUE_HEADER_NAMES = ["venue", "location", "site"]
```

Create `frontend/src/lib/venue.ts`:

```ts
export const VENUE_MAX_LENGTH = 255

/** The trimmed venue for one CSV row, or null when unmapped or blank. */
export function rowVenue(
  row: string[] | undefined,
  col: number | null | undefined,
): string | null {
  if (row === undefined || col === null || col === undefined) return null
  const v = (row[col] ?? "").trim()
  return v === "" ? null : v
}
```

`validateUploadRows.ts` — import `rowVenue, VENUE_MAX_LENGTH` from `@/lib/venue`; inside `resolutions.forEach`, after the score checks and before the rounds check, add:

```ts
    const venue = rowVenue(row, columnMapping.venue)
    if (venue !== null && venue.length > VENUE_MAX_LENGTH) {
      errors.push({
        row: displayNumber,
        message: `Venue is longer than ${VENUE_MAX_LENGTH} characters`,
      })
    }
```

- [ ] **Step 4: Step 3 — detection, preview, select**

In `computeInitialMapping`, after the `country` block:

```ts
  // Venue is optional. undefined means nobody has decided yet, so detect;
  // null is an explicit "Not mapped" and must survive a remount.
  const venue =
    existing.venue !== undefined
      ? existing.venue
      : detectColumn(header, VENUE_HEADER_NAMES, claimed)
  if (venue !== null) claimed.add(venue)
```

and add `venue,` to the returned object. Import `VENUE_HEADER_NAMES`.

Change `previewColumns`:

```ts
export type PreviewColumn =
  | "pos"
  | "team"
  | "player"
  | "player2"
  | "lineup"
  | "country"
  | "venue"
  | "score"

export function previewColumns(
  participantMode: ParticipantMode,
  defaultTeamType: "national" | "club",
  mapped: { country: boolean; venue: boolean },
): PreviewColumn[] {
  const showCountry =
    mapped.country &&
    !(participantMode === "teams" && defaultTeamType === "club")
  const lead: PreviewColumn[] =
    participantMode === "teams"
      ? ["pos", "team", "lineup"]
      : participantMode === "pairs"
        ? ["pos", "player", "player2"]
        : ["pos", "player"]
  return [
    ...lead,
    ...(showCountry ? (["country"] as const) : []),
    ...(mapped.venue ? (["venue"] as const) : []),
    "score",
  ]
}
```

Extend the doc comment with one sentence: "Country and Venue appear only when mapped — an always-empty column previews nothing." Add `venue: "Venue"` to `PREVIEW_HEADINGS`.

In the component: `const columns = previewColumns(state.participantMode, state.defaultTeamType, { country: mapping.country !== null, venue: mapping.venue != null })` — note this now reads the **local** `mapping`, so move the line below the `useState` (it already is) and make sure it is not memoised against `state.columnMapping`. In the preview `cell` switch add:

```ts
                      case "venue":
                        return rowVenue(row, mapping.venue) ?? ""
```

Add the Venue select directly after the Country block:

```tsx
      <div className="grid gap-1.5">
        <Label>Venue column (optional)</Label>
        <Select
          value={mapping.venue != null ? String(mapping.venue) : "__none__"}
          onValueChange={(v) =>
            setMapping((m) => ({
              ...m,
              venue: v === "__none__" ? null : Number(v),
            }))
          }
        >
          <SelectTrigger data-testid={Labels.columnMappingVenue}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Not mapped</SelectItem>
            {header.map((col, i) => (
              <SelectItem key={i} value={String(i)}>
                {col || `Column ${i + 1}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
```

Add `columnMappingVenue: "column-mapping-venue",` to `Labels`.

- [ ] **Step 5: Step 5 — payload and preview**

In `Step5Preview.tsx` import `rowVenue`. In the results `map`, add to the returned object (alongside `final_rank`): `venue: rowVenue(row, state.columnMapping.venue),`. (One result = one CSV row in every mode, teams included, so the row's own venue is the result's venue.)

In the preview table: `const showVenue = state.columnMapping.venue != null` near the top of the component; add `{showVenue && <th className="px-3 py-2 text-left">Venue</th>}` before the Score `<th>`, and before the Score `<td>`:

```tsx
                  {showVenue && (
                    <td className="px-3 py-1.5">
                      {rowVenue(rawRow, state.columnMapping.venue) ?? "—"}
                    </td>
                  )}
```

- [ ] **Step 6: Verify**

`bun run test:unit` → PASS. `bun run build` → succeeds (fix any `previewColumns` caller still using two args). `bun run lint`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/Upload frontend/src/lib/columnDetection.ts frontend/src/lib/venue.ts \
  frontend/src/lib/validateUploadRows.ts frontend/src/test-ids.ts frontend/tests/venue.test.ts \
  frontend/tests/step3-initial-mapping.test.ts frontend/tests/step3-preview-columns.test.ts \
  frontend/tests/validate-upload-rows.test.ts
git commit -m "feat(upload): map an optional venue column onto each result"
```

---

### Task 5: Compact column-mapping grid

**Files:**
- Modify: `frontend/src/components/Upload/steps/Step3ColumnMapping.tsx` (render only)

**Interfaces:**
- Consumes: the Country and Venue blocks from Tasks 2 and 5.
- Produces: no new exports; all existing `data-testid`s and label texts unchanged.

Layout note: labels sit **above** their select inside each grid cell (not beside it). Long round labels ("Round 3 — Picture round") don't fit inline at 3-up, and stacked-in-cell still gives the vertical saving: ~2 lines per row of 3 fields instead of 2 lines per field.

- [ ] **Step 1: Restructure the render**

1. Outer wrapper: `className="flex flex-col gap-6 max-w-xl"` → `className="flex flex-col gap-6 max-w-xl md:max-w-4xl"`.
2. Wrap the required-fields map, Country, Venue, the pairs blocks, the teams block and Position in **one** container:

```tsx
      <div className="grid gap-4 md:grid-cols-3 md:gap-x-6 md:gap-y-4">
        {/* Player name*, Score* (REQUIRED_FIELDS map — keep as is, it now
            renders cells directly into this grid instead of its own
            `grid gap-4` wrapper) */}
        {/* Position */}
        {/* Country */}
        {/* Venue */}
        {/* pairs: Pairs layout toggle, Player 2 */}
        {/* teams: Team column, Squad layout, Squad column(s) */}
      </div>
```

Order inside: REQUIRED_FIELDS cells, Position, Country, Venue, then mode-specific. Remove the REQUIRED_FIELDS map's own `<div className="grid gap-4">` wrapper (its children become grid cells).
3. Segmented toggles (Pairs layout, Squad layout) and the Squad-columns button group get `md:col-span-3` on their wrapper `div`. The teams block's outer `<div className="space-y-4">` is removed so the Team column, Squad layout and Squad column(s) are each direct grid cells; change their `space-y-2` wrappers to `grid gap-1.5` to match. The squad-column helper text stays inside its cell.
4. The Country cell's helper text stays inside the Country cell.
5. Rounds: change the rounds container from `grid gap-4` to:

```tsx
        <div className="grid gap-2">
          <p className="text-sm font-medium">Round column mapping (optional)</p>
          <div className="grid gap-4 md:grid-cols-4 md:gap-3">
            {/* existing per-round cells, unchanged except the label: */}
            {/*  <Label className="truncate" title={...}>R{i + 1}{roundName ? ` — ${roundName}` : ""}</Label> */}
          </div>
        </div>
```

Round label becomes `R{i + 1}{roundName ? ` — ${roundName}` : ""}` with `className="truncate"` and `title` set to the full `Round {i + 1} — {roundName}` text. Keep `data-testid={`round-column-${i}`}`.

Below `md`, all `md:` classes fall away and the form is the same single column as today.

- [ ] **Step 2: Verify unit tests, build, lint**

`bun run test:unit` → PASS. `bun run build` → succeeds. `bun run lint`.

- [ ] **Step 3: Eyeball it**

Start the dev server (`bun run dev`, with the Docker frontend container stopped so port 5173 is free) and walk an individual upload with `Name,Country,Venue,Score,R1,R2,R3,R4` and a 4-round format: at ≥768px wide the fields sit 3 per row and rounds 4 per row; at 390px everything stacks. Repeat in pairs (toggle spans the row) and teams (Squad layout toggle spans the row).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Upload/steps/Step3ColumnMapping.tsx
git commit -m "feat(upload): compact grid for column mapping on desktop"
```

---

### Task 6: Show (and edit) venue on results tables

**Files:**
- Modify: `frontend/src/components/Quizzes/QuizResultsTable.tsx`
- Modify: `frontend/src/routes/_layout/admin_.quizzes_.$id.tsx`

**Interfaces:**
- Consumes: `QuizResultWithPlayer.venue` (Task 1), `QuizResultUpdate.venue`.

- [ ] **Step 1: Public results table**

`ColumnShape` becomes `{ hasTeams: boolean; hasPairs: boolean; hasVenue: boolean }`. In `buildColumns` destructure `hasVenue` and add:

```ts
  const venueColumn: ColumnDef<QuizResultWithPlayer> = {
    id: "venue",
    accessorFn: (row) => row.venue ?? "",
    header: "Venue",
    cell: ({ row }) => (
      <span className="text-muted-foreground">{row.original.venue ?? "—"}</span>
    ),
  }
```

After the teams/country `splice`, insert it before the score column:

```ts
  // Only quizzes sat at several venues record one; the rest keep exactly the
  // columns they had.
  if (hasVenue) {
    base.splice(base.indexOf(scoreColumn), 0, venueColumn)
  }
```

In `QuizResultsTable`: `const hasVenue = data.some((row) => Boolean(row.venue))`, pass `{ hasTeams, hasPairs, hasVenue }`, and add `hasVenue` to the `useMemo` deps.

- [ ] **Step 2: Admin quiz page**

`ResultRow` gains a `hasVenue: boolean` prop and `const [venue, setVenue] = useState(result.venue ?? "")`. Include `venue` in the PATCH body:

```ts
        requestBody: {
          score: Number(score),
          final_rank: rank !== "" ? Number(rank) : null,
          ...(hasVenue ? { venue } : {}),
        },
```

(Sent only when the column exists, so the score edit on a venue-less quiz sends exactly what it does today; the backend turns `""` into null.)

Render, before the Score `<td>`:

```tsx
      {hasVenue && (
        <td className="py-3 px-4">
          {editing ? (
            <Input
              aria-label="Venue"
              value={venue}
              maxLength={255}
              onChange={(e) => setVenue(e.target.value)}
              className="w-40"
            />
          ) : (
            (result.venue ?? "—")
          )}
        </td>
      )}
```

In the Cancel handler add `setVenue(result.venue ?? "")`. In `ResultsTable`: `const hasVenue = data.data.some((result) => Boolean(result.venue))`, a `{hasVenue && <th className="py-3 px-4 text-left text-sm font-medium">Venue</th>}` before the Score `<th>`, and pass `hasVenue` to each `ResultRow`. Leave the pencil's `aria-label` as `"Edit score"` — `tests/teams-upload.spec.ts:332` depends on it.

- [ ] **Step 3: Verify**

`bun run build` → succeeds. `bun run lint`. `bun run test:unit` → PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Quizzes/QuizResultsTable.tsx "frontend/src/routes/_layout/admin_.quizzes_.\$id.tsx"
git commit -m "feat(frontend): show venue on results tables when a quiz records one"
```

---

### Task 7: End-to-end coverage

**Files:**
- Create: `frontend/tests/upload-venue-country.spec.ts`

**Interfaces:**
- Consumes: `Labels.countrylessBanner`, `Labels.noCountryBadge`, `Labels.columnMappingVenue`, `Labels.columnMappingCountry`; `QuizzesService.readQuizzes`, `readQuizResultsWithPlayers`, `deleteQuiz`.

- [ ] **Step 1: Prepare the stack**

From repo root: `docker compose up -d --build backend` (the container serves baked code; it must include Task 1). Ensure `mailcatcher` is up (`docker compose up -d mailcatcher`). Stop the Docker frontend container so Playwright's dev server owns 5173: `docker compose stop frontend`. Make sure no other Playwright run is active.

- [ ] **Step 2: Write the spec**

Create `frontend/tests/upload-venue-country.spec.ts`:

```ts
import { expect, type Page, test } from "@playwright/test"
import { OpenAPI, QuizzesService } from "../src/client"
import { Labels } from "../src/test-ids"
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

const runId = Date.now()
const quizNames: string[] = []

test.beforeAll(async () => {
  OpenAPI.BASE = process.env.VITE_API_URL!
  OpenAPI.TOKEN = await authenticate()
})

test.afterAll(async () => {
  const pending = await QuizzesService.readQuizzes({
    status: "pending",
    limit: 200,
  }).catch(() => null)
  for (const q of pending?.data ?? []) {
    if (quizNames.includes(q.name)) {
      await QuizzesService.deleteQuiz({ id: q.id }).catch(() => {})
    }
  }
})

async function startUpload(page: Page, quizName: string, csv: string) {
  quizNames.push(quizName)
  await page.goto("/upload")
  await page.getByTestId(Labels.uploadModeNew).click()
  await page.getByLabel("Quiz name *").fill(quizName)
  await page.getByRole("button", { name: "Next →" }).click()
  await page.getByLabel("Or paste data directly").fill(csv)
  await page.getByRole("button", { name: "Next →" }).click()
}

async function createdQuizId(quizName: string): Promise<string> {
  const pending = await QuizzesService.readQuizzes({ status: "pending", limit: 200 })
  const quiz = pending.data.find((q) => q.name === quizName)
  expect(quiz).toBeDefined()
  return quiz!.id
}

test("an individual upload with no country column flags new players and still submits", async ({
  page,
}) => {
  const quizName = `Countryless Upload ${runId}`
  await startUpload(
    page,
    quizName,
    `Name,Score\nNocountry Alice ${runId},50\nNocountry Bob ${runId},40`,
  )

  await expect(page.getByTestId(Labels.columnMappingCountry)).toContainText(
    "Not mapped",
  )
  await expect(page.getByRole("columnheader", { name: "Country" })).toHaveCount(0)
  await page.getByRole("button", { name: "Next →" }).click()

  await expect(page.getByTestId(Labels.countrylessBanner)).toContainText(
    "2 new players will be created without a country",
  )
  await page.getByRole("button", { name: "Next →" }).click()

  await expect(
    page.getByText("2 new players will be created without a country"),
  ).toBeVisible()
  await page.getByRole("button", { name: "Submit for review" }).click()
  await expect(page.getByText("Results submitted for review.")).toBeVisible()

  const results = await QuizzesService.readQuizResultsWithPlayers({
    id: await createdQuizId(quizName),
  })
  expect(results.data).toHaveLength(2)
  for (const r of results.data) {
    expect(r.participants?.[0]?.country ?? null).toBeNull()
  }
})

test("a venue column is stored per result and shown on the admin results table", async ({
  page,
}) => {
  const quizName = `Venue Upload ${runId}`
  await startUpload(
    page,
    quizName,
    `Name,Country,Venue,Score\nVenue Alice ${runId},Ireland,Leeds,50\nVenue Bob ${runId},England,Oslo,40`,
  )

  await expect(page.getByTestId(Labels.columnMappingVenue)).toContainText("Venue")
  await page.getByRole("button", { name: "Next →" }).click()
  await page.getByRole("button", { name: "Next →" }).click()
  await expect(page.getByRole("columnheader", { name: "Venue" })).toBeVisible()
  await page.getByRole("button", { name: "Submit for review" }).click()
  await expect(page.getByText("Results submitted for review.")).toBeVisible()

  const quizId = await createdQuizId(quizName)
  const results = await QuizzesService.readQuizResultsWithPlayers({ id: quizId })
  expect(results.data.map((r) => r.venue).sort()).toEqual(["Leeds", "Oslo"])

  await page.goto(`/admin/quizzes/${quizId}`)
  await expect(page.getByRole("columnheader", { name: "Venue" })).toBeVisible()
  await expect(page.getByRole("cell", { name: "Leeds" })).toBeVisible()
})

test("with no venue mapped there is no Venue column anywhere", async ({ page }) => {
  const quizName = `No Venue Upload ${runId}`
  await startUpload(
    page,
    quizName,
    `Name,Country,Score\nNovenue Alice ${runId},Ireland,50`,
  )

  await expect(page.getByTestId(Labels.columnMappingVenue)).toContainText(
    "Not mapped",
  )
  await expect(page.getByRole("columnheader", { name: "Venue" })).toHaveCount(0)
  await page.getByRole("button", { name: "Next →" }).click()
  await page.getByRole("button", { name: "Next →" }).click()
  await expect(page.getByRole("columnheader", { name: "Venue" })).toHaveCount(0)
  await page.getByRole("button", { name: "Submit for review" }).click()
  await expect(page.getByText("Results submitted for review.")).toBeVisible()

  await page.goto(`/admin/quizzes/${await createdQuizId(quizName)}`)
  await expect(page.getByRole("columnheader", { name: "Rank" })).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "Venue" })).toHaveCount(0)
})
```

The admin detail URL is `/admin/quizzes/$id` (route `/_layout/admin_/quizzes_/$id`). Preview `<th>`s inside `<thead>` are exposed as `columnheader`.

- [ ] **Step 3: Run the new spec and the existing upload specs**

From `frontend/`, one at a time (never concurrently):

```bash
bunx playwright test tests/upload-venue-country.spec.ts; echo "exit=$?"
bunx playwright test tests/upload.spec.ts tests/pairs-upload.spec.ts tests/teams-upload.spec.ts; echo "exit=$?"
```

Expected: `exit=0` for both. (Don't pipe through `tail` — it hides Playwright's exit code.) Failures in pairs/teams specs that asserted country-select contents ("Country column (optional)" label text, an absent "Not mapped" option in individual mode) are expected fallout of Task 2 — update those assertions to the new copy; anything else is a real regression to fix.

- [ ] **Step 4: Restore the stack and commit**

`docker compose up -d --build frontend` (bring the stopped container back with current code).

```bash
git add frontend/tests/upload-venue-country.spec.ts frontend/tests/*.spec.ts
git commit -m "test(e2e): optional country flag and per-result venue on upload"
```

---

## Final verification (after Task 7)

- Backend: from `backend/`, `../.venv/bin/pytest -q` → PASS.
- Frontend: `bun run test:unit`, `bun run build`, `bun run lint` → clean.
- `uv run prek run --all-files` (from `backend/`) → clean.
