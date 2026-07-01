# Multi-country Players & Per-result Country Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each player an ordered list of countries (first = primary) and record the country a player competed under on each quiz result.

**Architecture:** Replace `Player.country` (single) with `Player.countries: list[str]` backed by a JSON column, mirroring `QuizFormat.rounds`. Add a nullable `QuizResult.country`. An Alembic migration backfills the player list from the old single value and drops the old column (no backfill for results). The CSV upload flow stores the parsed country on each result and seeds a new player's `countries`. Frontend gains a multi-country picker, displays all of a player's countries (primary emphasized), shows the per-result country in results tables, and shows the primary in list/search views.

**Tech Stack:** FastAPI + SQLModel + Alembic (Postgres) backend; React + TanStack Query/Router + generated OpenAPI client frontend; pytest (backend), bun:test unit + Playwright E2E (frontend).

## Global Constraints

- Every country code MUST validate against `VALID_COUNTRY_CODES` in `backend/app/countries.py` (includes home nations `ENG`/`SCO`/`WAL`/`NIR`).
- `Player.countries` is an **ordered** list; `countries[0]` is the primary. Order is preserved end-to-end. Empty list is allowed.
- `QuizResult.country` is **nullable**; existing results are **not** backfilled. The result country is **not** constrained to the player's `countries`.
- The `countries` DB column is JSON and non-null (default `[]`), following the `QuizFormat.rounds` pattern (`sa_column=Column(JSON, nullable=False)`).
- Current Alembic head is `09b03772bf36`. Player table is `player`; results table is `quizresult`.
- Backend DB-touching tests require the migration to be applied first: run `alembic upgrade head` (inside the backend container or venv) before `bash scripts/test.sh`. Test DB does NOT auto-create tables (`init_db` create_all is disabled).
- After all backend changes, regenerate the frontend client with `bash ./scripts/generate-client.sh` (run from repo root, backend stack running).

---

## Task 1: Player model — `countries` list

**Files:**
- Modify: `backend/app/models.py` (Player family + validators, lines ~273-333)
- Test: `backend/tests/test_player_model.py` (create)

**Interfaces:**
- Produces: `PlayerBase.countries: list[str]`, `PlayerCreate(countries=...)`, `PlayerUpdate.countries: list[str] | None`, `PlayerPublic.countries: list[str]`. Module helper `_validate_country_codes(v: list[str]) -> list[str]`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_player_model.py`:

```python
import pytest
from pydantic import ValidationError

from app.models import PlayerCreate, PlayerUpdate


def test_player_create_accepts_multiple_valid_countries() -> None:
    p = PlayerCreate(display_name="Test", countries=["GB", "IE", "ENG"])
    assert p.countries == ["GB", "IE", "ENG"]  # order preserved


def test_player_create_defaults_to_empty_list() -> None:
    p = PlayerCreate(display_name="Test")
    assert p.countries == []


def test_player_create_rejects_invalid_country() -> None:
    with pytest.raises(ValidationError):
        PlayerCreate(display_name="Test", countries=["GB", "ZZ"])


def test_player_update_none_countries_allowed() -> None:
    u = PlayerUpdate(countries=None)
    assert u.countries is None


def test_player_update_rejects_invalid_country() -> None:
    with pytest.raises(ValidationError):
        PlayerUpdate(countries=["ZZ"])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_player_model.py -v`
Expected: FAIL — `PlayerCreate` has no `countries` field / unexpected keyword.

- [ ] **Step 3: Write minimal implementation**

In `backend/app/models.py`, add a plural validator helper next to `_validate_country_code`:

```python
def _validate_country_codes(v: list[str]) -> list[str]:
    for code in v:
        if code not in VALID_COUNTRY_CODES:
            raise ValueError(f"Invalid country code: {code!r}")
    return v
```

Replace `PlayerBase.country` with `countries`:

```python
class PlayerBase(SQLModel):
    display_name: str = Field(max_length=255)
    countries: list[str] = Field(default_factory=list)
    city: str | None = Field(default=None, max_length=255)
    club: str | None = Field(default=None, max_length=255)
    bio: str | None = Field(default=None)
    photo_url: str | None = Field(default=None, max_length=512)

    @field_validator("countries")
    @classmethod
    def validate_countries(cls, v: list[str]) -> list[str]:
        return _validate_country_codes(v)
```

In `PlayerUpdate`, replace the `country` field/validator with:

```python
    countries: list[str] | None = Field(default=None)
```

and its validator:

```python
    @field_validator("countries")
    @classmethod
    def validate_countries(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        return _validate_country_codes(v)
```

In the `Player` table model, add the JSON-backed column (mirrors `QuizFormat.rounds`):

```python
class Player(PlayerBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    countries: list[str] = Field(
        default_factory=list, sa_column=Column(JSON, nullable=False)
    )
    slug: str | None = Field(default=None, unique=True, index=True, max_length=255)
    is_published: bool = Field(default=False)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),
    )
```

`PlayerCreate` and `PlayerPublic` inherit `countries` from `PlayerBase` — no change to their bodies. Leave the old singular `_validate_country_code` helper in place (still used by QuizResult in Task 3).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_player_model.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/tests/test_player_model.py
git commit -m "feat(models): replace Player.country with ordered countries list"
```

---

## Task 2: Migration — player `countries` + result `country`

**Files:**
- Create: `backend/app/alembic/versions/<generated>_multi_country.py`
- Modify: `backend/tests/utils/quiz.py:49-56` (`create_random_player` uses `countries`)

**Interfaces:**
- Consumes: models from Task 1.
- Produces: `player.countries` JSON column (non-null), `player.country` dropped, `quizresult.country` nullable String(3) column. `create_random_player` now creates players with `countries=["IE"]`.

- [ ] **Step 1: Update the test util so existing tests compile against the new model**

In `backend/tests/utils/quiz.py`, change `create_random_player`:

```python
def create_random_player(db: Session) -> Player:
    return crud.create_player(
        session=db,
        player_in=PlayerCreate(
            display_name=random_lower_string(), countries=["IE"]
        ),
    )
```

- [ ] **Step 2: Write the migration file**

Create `backend/app/alembic/versions/a1b2c3d4e5f6_multi_country.py` (use this revision id verbatim so downstream references match):

```python
"""multi-country players and per-result country

Revision ID: a1b2c3d4e5f6
Revises: 09b03772bf36
Create Date: 2026-07-01 00:00:00.000000

"""
import json

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

# revision identifiers, used by Alembic.
revision = "a1b2c3d4e5f6"
down_revision = "09b03772bf36"
branch_labels = None
depends_on = None


def upgrade():
    # player.countries: add nullable, backfill from country, then enforce non-null
    op.add_column("player", sa.Column("countries", sa.JSON(), nullable=True))
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, country FROM player")).fetchall()
    for row in rows:
        countries = [row.country] if row.country is not None else []
        conn.execute(
            sa.text("UPDATE player SET countries = CAST(:c AS JSON) WHERE id = :id"),
            {"c": json.dumps(countries), "id": str(row.id)},
        )
    op.alter_column("player", "countries", nullable=False)
    op.drop_column("player", "country")

    # quizresult.country: nullable, no backfill
    op.add_column(
        "quizresult",
        sa.Column(
            "country",
            sqlmodel.sql.sqltypes.AutoString(length=3),
            nullable=True,
        ),
    )


def downgrade():
    # player.country: restore from first element of countries
    op.add_column(
        "player",
        sa.Column(
            "country",
            sqlmodel.sql.sqltypes.AutoString(length=3),
            nullable=True,
        ),
    )
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, countries FROM player")).fetchall()
    for row in rows:
        countries = row.countries or []
        country = countries[0] if countries else None
        conn.execute(
            sa.text("UPDATE player SET country = :c WHERE id = :id"),
            {"c": country, "id": str(row.id)},
        )
    op.drop_column("player", "countries")

    op.drop_column("quizresult", "country")
```

- [ ] **Step 3: Apply the migration and verify schema**

Run: `cd backend && alembic upgrade head`
Expected: runs without error; `alembic current` shows `a1b2c3d4e5f6`.

Verify columns (psql or a quick check):
Run: `cd backend && python -c "from sqlmodel import Session; from app.core.db import engine; import sqlalchemy as sa;
c=Session(engine).connection();
print([r[0] for r in c.execute(sa.text(\"SELECT column_name FROM information_schema.columns WHERE table_name='player'\"))]);
print([r[0] for r in c.execute(sa.text(\"SELECT column_name FROM information_schema.columns WHERE table_name='quizresult'\"))])"`
Expected: `player` list contains `countries` and NOT `country`; `quizresult` list contains `country`.

- [ ] **Step 4: Run the existing player suite to confirm nothing broke**

Run: `cd backend && python -m pytest tests/api/routes/test_players.py -v`
Expected: PASS (existing tests still green with `countries`-based util).

- [ ] **Step 5: Commit**

```bash
git add backend/app/alembic/versions/a1b2c3d4e5f6_multi_country.py backend/tests/utils/quiz.py
git commit -m "feat(db): migrate player countries list and add result country"
```

---

## Task 3: QuizResult model — `country` field

**Files:**
- Modify: `backend/app/models.py` (QuizResult family + upload models, lines ~363-464)
- Test: `backend/tests/test_player_model.py` (append)

**Interfaces:**
- Produces: `QuizResult.country: str | None`, `QuizResultCreate.country`, `QuizResultUpdate.country`, `QuizResultPublic.country`, `QuizResultWithPlayer.country`, `PlayerResultWithQuiz.country`, `ResolvedResultRow.country` — all `str | None`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_player_model.py`:

```python
from app.models import QuizResultCreate


def test_quiz_result_create_accepts_valid_country() -> None:
    import uuid

    r = QuizResultCreate(
        player_id=uuid.uuid4(), final_rank=1, score=10.0, country="ENG"
    )
    assert r.country == "ENG"


def test_quiz_result_create_allows_null_country() -> None:
    import uuid

    r = QuizResultCreate(player_id=uuid.uuid4(), final_rank=1, score=10.0)
    assert r.country is None


def test_quiz_result_create_rejects_invalid_country() -> None:
    import uuid

    with pytest.raises(ValidationError):
        QuizResultCreate(
            player_id=uuid.uuid4(), final_rank=1, score=10.0, country="ZZ"
        )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_player_model.py -k quiz_result -v`
Expected: FAIL — `QuizResultCreate` has no `country`.

- [ ] **Step 3: Write minimal implementation**

In `backend/app/models.py`:

`QuizResultCreate` — add field + validator:

```python
class QuizResultCreate(SQLModel):
    player_id: uuid.UUID
    final_rank: int
    score: float
    round_scores: list[float | None] | None = None
    country: str | None = Field(default=None, max_length=3)

    @field_validator("country")
    @classmethod
    def validate_country(cls, v: str | None) -> str | None:
        return _validate_country_code(v)
```

`QuizResultUpdate` — add the same field + validator:

```python
    country: str | None = Field(default=None, max_length=3)

    @field_validator("country")
    @classmethod
    def validate_country(cls, v: str | None) -> str | None:
        return _validate_country_code(v)
```

`QuizResult` (table) — add column after `final_rank`:

```python
    country: str | None = Field(default=None, max_length=3)
```

Add `country: str | None = None` to `QuizResultPublic`, `QuizResultWithPlayer`, `PlayerResultWithQuiz`, and `ResolvedResultRow`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_player_model.py -k quiz_result -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/tests/test_player_model.py
git commit -m "feat(models): add nullable country to quiz result models"
```

---

## Task 4: CRUD — store result country & filter search by list membership

**Files:**
- Modify: `backend/app/crud.py` (`search_players` ~172-192, `create_quiz_results` ~298-329)
- Test: `backend/tests/api/routes/test_players.py` (append)

**Interfaces:**
- Consumes: `QuizResultCreate.country` (Task 3), `Player.countries` (Task 1).
- Produces: `search_players(..., country=...)` filters players whose `countries` list contains `country`; `create_quiz_results` persists `country` on create and update branches.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/api/routes/test_players.py`:

```python
def test_search_players_filters_by_country_membership(db: Session) -> None:
    from app.models import PlayerCreate

    match = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name="Zoltan Countrymatch", countries=["IE", "GB"]),
    )
    match.is_published = True
    db.add(match)
    other = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name="Zoltan Countrymatch", countries=["FR"]),
    )
    other.is_published = True
    db.add(other)
    db.commit()

    results = crud.search_players(session=db, q="Zoltan Countrymatch", country="GB")
    ids = {p.id for p, _ in results}
    assert match.id in ids
    assert other.id not in ids


def test_create_quiz_results_stores_country(db: Session) -> None:
    from app.models import PlayerCreate, QuizResultCreate

    event = create_approved_event(db)
    player = crud.create_player(
        session=db, player_in=PlayerCreate(display_name="Flag Bearer", countries=["ENG"])
    )
    crud.create_quiz_results(
        session=db,
        event_id=event.id,
        results=[
            QuizResultCreate(player_id=player.id, final_rank=1, score=50.0, country="ENG")
        ],
    )
    stored = db.exec(
        select(QuizResult).where(QuizResult.quiz_id == event.id)
    ).first()
    assert stored is not None
    assert stored.country == "ENG"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/api/routes/test_players.py -k "country_membership or stores_country" -v`
Expected: FAIL — search still filters on `Player.country` (AttributeError) / stored country is `None`.

- [ ] **Step 3: Write minimal implementation**

In `backend/app/crud.py` `search_players`, remove the SQL country filter and filter in Python after the query. Replace:

```python
    if published_only:
        stmt = stmt.where(Player.is_published == True)  # noqa: E712
    if country:
        stmt = stmt.where(col(Player.country).ilike(f"%{country}%"))
    players = session.exec(stmt).all()
```

with:

```python
    if published_only:
        stmt = stmt.where(Player.is_published == True)  # noqa: E712
    players = list(session.exec(stmt).all())
    if country:
        players = [p for p in players if country in p.countries]
```

In `create_quiz_results`, set `country` on both branches. In the update branch add after `existing.final_rank = r.final_rank`:

```python
            existing.country = r.country
```

In the create branch, add `country=r.country` to the `QuizResult(...)` constructor:

```python
            result = QuizResult(
                quiz_id=event_id,
                player_id=r.player_id,
                score=r.score,
                final_rank=r.final_rank,
                country=r.country,
            )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/api/routes/test_players.py -k "country_membership or stores_country" -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/crud.py backend/tests/api/routes/test_players.py
git commit -m "feat(crud): store result country and filter search by countries membership"
```

---

## Task 5: API — submit results with country & expose result country

**Files:**
- Modify: `backend/app/api/routes/quizzes.py` (`submit_results` ~303-310, `read_quiz_results_with_players` ~215-227)
- Modify: `backend/app/api/routes/players.py` (`get_player_history_route` ~73-86)
- Test: `backend/tests/api/routes/test_quizzes.py` (append)

**Interfaces:**
- Consumes: `ResolvedResultRow.country`, `QuizResultCreate.country`, `QuizResultWithPlayer.country`, `PlayerResultWithQuiz.country`.
- Produces: `POST /quizzes/{id}/results` persists `row.country`; `GET /quizzes/{id}/results/with-players` and `GET /players/{id}/history` include `country`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/api/routes/test_quizzes.py` (follow existing auth-header fixtures in that file for `superuser_token_headers` / organizer headers — reuse whatever the neighbouring result-submission tests use):

```python
def test_submit_results_persists_country(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    from app.models import PlayerCreate
    from tests.utils.quiz import create_approved_event

    event = create_approved_event(db)
    player = crud.create_player(
        session=db, player_in=PlayerCreate(display_name="Country Rep", countries=["GB"])
    )
    r = client.post(
        f"{settings.API_V1_STR}/quizzes/{event.id}/results",
        headers=superuser_token_headers,
        json={
            "results": [
                {"player_id": str(player.id), "final_rank": 1, "score": 42.0, "country": "SCO"}
            ],
            "mode": "replace",
        },
    )
    assert r.status_code == 200

    wp = client.get(
        f"{settings.API_V1_STR}/quizzes/{event.id}/results/with-players",
        headers=superuser_token_headers,
    )
    assert wp.status_code == 200
    rows = wp.json()["data"]
    assert rows[0]["country"] == "SCO"
```

(If `test_quizzes.py` imports differ, match its existing imports for `crud`, `settings`, `TestClient`, `Session`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/api/routes/test_quizzes.py -k persists_country -v`
Expected: FAIL — response `country` is `None` (not yet wired through).

- [ ] **Step 3: Write minimal implementation**

In `quizzes.py` `submit_results`, add `country=row.country` to the `QuizResultCreate(...)` built in the loop:

```python
        creates.append(
            QuizResultCreate(
                player_id=player_id,
                final_rank=row.final_rank,
                score=row.score,
                round_scores=row.round_scores,
                country=row.country,
            )
        )
```

In `read_quiz_results_with_players`, add `country=r.country` to each `QuizResultWithPlayer(...)`:

```python
        QuizResultWithPlayer(
            id=r.id,
            quiz_id=r.quiz_id,
            player_id=r.player_id,
            player_display_name=p.display_name,
            player_slug=p.slug,
            score=r.score,
            final_rank=r.final_rank,
            country=r.country,
            round_scores=_get_round_scores(r, num_rounds),
        )
```

In `players.py` `get_player_history_route`, add `country=result.country` to each `PlayerResultWithQuiz(...)`:

```python
            PlayerResultWithQuiz(
                result_id=result.id,
                quiz_id=quiz.id,
                quiz_name=quiz.name,
                start_date=quiz.start_date,
                end_date=quiz.end_date,
                score=result.score,
                final_rank=result.final_rank,
                country=result.country,
            )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/api/routes/test_quizzes.py -k persists_country -v`
Expected: PASS.

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && bash scripts/test.sh`
Expected: PASS (all tests). Fix any references to the removed `Player.country` surfaced here.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/routes/quizzes.py backend/app/api/routes/players.py backend/tests/api/routes/test_quizzes.py
git commit -m "feat(api): persist and expose per-result country"
```

---

## Task 6: Regenerate the frontend client

**Files:**
- Modify: `frontend/openapi.json`, `frontend/src/client/**` (generated)

**Interfaces:**
- Consumes: backend schema from Tasks 1–5.
- Produces: `PlayerPublic.countries: string[]`, `PlayerCreate.countries`, `PlayerUpdate.countries`, `QuizResultWithPlayer.country`, `PlayerHistory` row `country`, `QuizResultCreate.country` in the generated TS client.

- [ ] **Step 1: Regenerate**

Run (backend stack running): `bash ./scripts/generate-client.sh`

- [ ] **Step 2: Verify the new shapes exist**

Run: `cd frontend && grep -n "countries" src/client/types.gen.ts | head`
Expected: `countries?: Array<string>` (or `Array<string>`) appears on the Player types; `country` appears on `QuizResultWithPlayer` and the history row type.

- [ ] **Step 3: Commit**

```bash
git add frontend/openapi.json frontend/src/client
git commit -m "chore(client): regenerate for multi-country + result country"
```

---

## Task 7: `CountryMultiSelect` component + player edit form

**Files:**
- Create: `frontend/src/components/ui/CountryMultiSelect.tsx`
- Modify: `frontend/src/routes/_layout/admin_.players.$id.tsx` (form field ~51-58, 122-131; subtitle ~86)

**Interfaces:**
- Consumes: `COUNTRIES`, `countryName` from `@/lib/countries`; `PlayerUpdate.countries` from Task 6.
- Produces: `CountryMultiSelect({ value: string[], onChange: (codes: string[]) => void })`.

- [ ] **Step 1: Create the component**

Create `frontend/src/components/ui/CountryMultiSelect.tsx`:

```tsx
import { COUNTRIES, countryName } from "@/lib/countries"

interface CountryMultiSelectProps {
  value: string[]
  onChange: (codes: string[]) => void
}

export function CountryMultiSelect({ value, onChange }: CountryMultiSelectProps) {
  const available = COUNTRIES.filter((c) => !value.includes(c.code))
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {value.length === 0 && (
          <span className="text-xs text-muted-foreground">
            No countries added
          </span>
        )}
        {value.map((code, i) => (
          <span
            key={code}
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
          >
            {i === 0 && (
              <span className="text-amber-500" title="Primary">
                ★
              </span>
            )}
            {countryName(code)}
            <button
              type="button"
              aria-label={`Remove ${countryName(code)}`}
              onClick={() => onChange(value.filter((c) => c !== code))}
              className="text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <select
        value=""
        onChange={(e) => {
          if (e.target.value) onChange([...value, e.target.value])
        }}
        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="">+ Add country…</option>
        {available.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  )
}
```

- [ ] **Step 2: Wire it into the player edit form**

In `frontend/src/routes/_layout/admin_.players.$id.tsx`:

Replace the import on line 13:

```tsx
import { CountryMultiSelect } from "@/components/ui/CountryMultiSelect"
```

In `useForm` `defaultValues`, replace the line `country: player.country ?? null,` with:

```tsx
      countries: player.countries ?? [],
```

Replace the subtitle line 86 (`{[countryName(player.country), player.city, player.club]`) with the primary country:

```tsx
            {[countryName(player.countries[0]), player.city, player.club]
```

Replace the Country form block (lines 122-131):

```tsx
        <div className="grid gap-1.5">
          <Label>Countries</Label>
          <Controller
            name="countries"
            control={control}
            render={({ field }) => (
              <CountryMultiSelect
                value={field.value ?? []}
                onChange={field.onChange}
              />
            )}
          />
          <p className="text-xs text-muted-foreground">
            The first country is the player&apos;s primary country.
          </p>
        </div>
```

Remove the now-unused `countryName` import only if no longer referenced (it is still used in the subtitle, so keep it). Remove the old `CountrySelect` import.

- [ ] **Step 3: Type-check**

Run: `cd frontend && bun run build`
Expected: build succeeds (tsc + vite). Fix any residual `player.country` references it flags.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ui/CountryMultiSelect.tsx "frontend/src/routes/_layout/admin_.players.\$id.tsx"
git commit -m "feat(frontend): multi-country picker on player edit form"
```

---

## Task 8: Display all countries on player views + primary in list

**Files:**
- Modify: `frontend/src/components/Players/PlayerProfile.tsx` (subtitle ~86-90)
- Modify: `frontend/src/routes/_public/players.tsx` (Country column ~66-74)

**Interfaces:**
- Consumes: `PlayerPublic.countries` from Task 6; `Badge`, `countryName`.

- [ ] **Step 1: Update the public player profile to show all countries**

In `frontend/src/components/Players/PlayerProfile.tsx`, replace the subtitle paragraph (lines 86-90) with a countries badge row plus city/club text. Replace:

```tsx
          <p className="text-muted-foreground">
            {[countryName(player.country), player.city, player.club]
              .filter(Boolean)
              .join(" · ")}
          </p>
```

with:

```tsx
          {player.countries.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {player.countries.map((code, i) => (
                <Badge key={code} variant={i === 0 ? "default" : "secondary"}>
                  {countryName(code)}
                </Badge>
              ))}
            </div>
          )}
          <p className="text-muted-foreground">
            {[player.city, player.club].filter(Boolean).join(" · ")}
          </p>
```

(`Badge` is already imported in this file.)

- [ ] **Step 2: Update the players list Country column to show the primary**

In `frontend/src/routes/_public/players.tsx`, change the Country cell (around line 71) from `row.original.country` to the primary:

```tsx
        {countryName(row.original.countries[0]) || "—"}
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && bun run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Players/PlayerProfile.tsx frontend/src/routes/_public/players.tsx
git commit -m "feat(frontend): show all player countries; primary in list"
```

---

## Task 9: Show per-result country in results tables

**Files:**
- Modify: `frontend/src/components/Events/EventResultsTable.tsx` (add column ~47-55)
- Modify: `frontend/src/components/Players/PlayerProfile.tsx` (history columns ~20-58)

**Interfaces:**
- Consumes: `QuizResultWithPlayer.country`, `PlayerHistory` row `country`, `countryName`.

- [ ] **Step 1: Add a Country column to the event results table**

In `frontend/src/components/Events/EventResultsTable.tsx`, import `countryName`:

```tsx
import { countryName } from "@/lib/countries"
```

Insert a Country column into `base` after the `player_display_name` column (before `score`):

```tsx
    {
      accessorKey: "country",
      header: "Country",
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {countryName(row.original.country) || "—"}
        </span>
      ),
    },
```

- [ ] **Step 2: Add a Country column to the player history table**

In `frontend/src/components/Players/PlayerProfile.tsx`, add to `historyColumns` (after the `start_date` column):

```tsx
  {
    accessorKey: "country",
    header: "Country",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {countryName(row.original.country) || "—"}
      </span>
    ),
  },
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && bun run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Events/EventResultsTable.tsx frontend/src/components/Players/PlayerProfile.tsx
git commit -m "feat(frontend): show per-result country in results tables"
```

---

## Task 10: Upload flow — country → result & seed new player

**Files:**
- Modify: `frontend/src/components/Upload/steps/Step4Disambiguation.tsx` (export + logic ~25-64, 129, 194-215)
- Modify: `frontend/src/components/Upload/steps/Step5Preview.tsx` (result build ~54-60)
- Test: `frontend/tests/upload-auto-resolution.test.ts` (create)

**Interfaces:**
- Consumes: `PlayerCreate.countries`, `PlayerSearchResult` (with `player.countries`), `resolveCountryCode`, `ResolvedResultRow.country`.
- Produces: exported `getAutoResolution(parsedRow, candidates)`; new players created with `countries: [code]`; each submitted result carries `country`.

- [ ] **Step 1: Write the failing unit test**

Create `frontend/tests/upload-auto-resolution.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import type { PlayerSearchResult } from "../src/client"
import { getAutoResolution } from "../src/components/Upload/steps/Step4Disambiguation"

function candidate(over: Partial<PlayerSearchResult["player"]>, similarity: number): PlayerSearchResult {
  return {
    similarity,
    player: {
      id: "p1",
      display_name: "Jane Doe",
      countries: ["IE"],
      city: null,
      club: null,
      bio: null,
      photo_url: null,
      slug: null,
      is_published: true,
      created_at: null,
      ...over,
    },
  } as PlayerSearchResult
}

describe("getAutoResolution", () => {
  test("no candidates -> create new with seeded countries", () => {
    const r = getAutoResolution(
      { player_name: "Jane Doe", country: "IE", score: 1 },
      [],
    )
    expect(r.player_create?.countries).toEqual(["IE"])
    expect(r.autoResolved).toBe(true)
  })

  test("single high-confidence match with same country auto-resolves", () => {
    const r = getAutoResolution(
      { player_name: "Jane Doe", country: "IE", score: 1 },
      [candidate({ countries: ["IE"] }, 0.95)],
    )
    expect(r.player_id).toBe("p1")
    expect(r.autoResolved).toBe(true)
  })

  test("country mismatch flags for review", () => {
    const r = getAutoResolution(
      { player_name: "Jane Doe", country: "GB", score: 1 },
      [candidate({ countries: ["IE"] }, 0.95)],
    )
    expect(r.player_id).toBe("p1")
    expect(r.autoResolved).toBe(false)
  })

  test("empty candidate countries do not count as mismatch", () => {
    const r = getAutoResolution(
      { player_name: "Jane Doe", country: "GB", score: 1 },
      [candidate({ countries: [] }, 0.95)],
    )
    expect(r.autoResolved).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && bun test tests/upload-auto-resolution.test.ts`
Expected: FAIL — `getAutoResolution` is not exported / uses `player.country`.

- [ ] **Step 3: Update Step4Disambiguation**

In `frontend/src/components/Upload/steps/Step4Disambiguation.tsx`:

- Export the function: change `function getAutoResolution(` to `export function getAutoResolution(`.
- In the no-candidates branch, seed `countries` instead of `country`:

```tsx
    const seeded = resolveCountryCode(parsedRow.country)
    return {
      player_id: null,
      player_create: {
        display_name: parsedRow.player_name,
        countries: seeded ? [seeded] : [],
      },
      autoResolved: true,
    }
```

- Fix the mismatch check to use the candidate's `countries` list:

```tsx
    const csvCountry = resolveCountryCode(parsedRow.country)
    const countryMismatch =
      csvCountry !== null &&
      candidate.player.countries.length > 0 &&
      !candidate.player.countries.includes(csvCountry)
```

- In `selectNew` and the two inline `onChange` handlers inside the `creating` block, replace `country: newCountry` / `country: code` with `countries`:

`selectNew`:

```tsx
  const selectNew = () => {
    setCreating(true)
    onChange({
      player_id: null,
      player_create: {
        display_name: newName,
        countries: newCountry ? [newCountry] : [],
      },
    })
  }
```

Name `onChange` handler `player_create`:

```tsx
                  player_create: {
                    display_name: e.target.value,
                    countries: newCountry ? [newCountry] : [],
                  },
```

Country `onChange` handler `player_create`:

```tsx
                  player_create: {
                    display_name: newName,
                    countries: code ? [code] : [],
                  },
```

- In the auto-apply effect, `setNewCountry(auto.player_create.country ?? null)` becomes:

```tsx
      setNewCountry(auto.player_create.countries?.[0] ?? null)
```

- In the candidate list render, `countryName(c.player.country)` becomes `countryName(c.player.countries[0])`.

- [ ] **Step 4: Wire result country in Step5Preview**

In `frontend/src/components/Upload/steps/Step5Preview.tsx`, import `resolveCountryCode`:

```tsx
import { resolveCountryCode } from "@/lib/countries"
```

In the `results` map inside `submitMutation`, add `country` to the returned object:

```tsx
        return {
          player_id: r.player_id ?? undefined,
          player_create: r.player_create ?? undefined,
          final_rank,
          score: parseRows[i]?.score ?? 0,
          round_scores: hasRoundData ? roundScores : undefined,
          country: resolveCountryCode(parseRows[i]?.country) ?? undefined,
        }
```

- [ ] **Step 5: Run unit test to verify it passes**

Run: `cd frontend && bun test tests/upload-auto-resolution.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Type-check the whole frontend**

Run: `cd frontend && bun run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add "frontend/src/components/Upload/steps/Step4Disambiguation.tsx" frontend/src/components/Upload/steps/Step5Preview.tsx frontend/tests/upload-auto-resolution.test.ts
git commit -m "feat(upload): store result country and seed new player countries"
```

---

## Task 11: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Backend suite**

Run: `cd backend && bash scripts/test.sh`
Expected: PASS (all).

- [ ] **Step 2: Frontend unit tests**

Run: `cd frontend && bun run test:unit`
Expected: PASS (existing + new `upload-auto-resolution` and `player-model`-style tests).

- [ ] **Step 3: Frontend build**

Run: `cd frontend && bun run build`
Expected: succeeds.

- [ ] **Step 4: Lint**

Run: `cd frontend && bun run lint` and `cd backend && uv run prek run --all-files`
Expected: clean (or auto-fixed; re-commit if files change).

- [ ] **Step 5: E2E smoke (optional, requires stack)**

Run: `cd frontend && bunx playwright test players.spec.ts upload.spec.ts`
Expected: PASS. These exercise the player pages and upload wizard end-to-end against the multi-country changes.

- [ ] **Step 6: Commit any lint fixups**

```bash
git add -A
git commit -m "chore: lint fixups for multi-country feature"
```
