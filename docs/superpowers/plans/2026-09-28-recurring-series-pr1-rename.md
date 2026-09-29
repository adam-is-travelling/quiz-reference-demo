# Recurring Series PR 1 (Rename) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename `Competition` to `RecurringSeries` throughout the backend, database, API and generated client, with no behaviour change and nothing different for users.

**Architecture:**
- An Alembic migration renames the `competition` table, the `quiz.competition_id` column and their constraint and index names in place, so every row survives.
- The API moves from `/api/v1/competitions` to `/api/v1/series`, so the generated client exposes `SeriesService`.
- The frontend UI layer (routes, components, labels, URLs, upload-wizard state) keeps the word "competition".
- The player-history surface keeps "competition" everywhere: its endpoint, query parameter, models, fields and crud function.

**Tech Stack:** FastAPI + SQLModel + Alembic (Postgres), pytest; React + TanStack Router/Query, `@hey-api/openapi-ts`, Playwright, bun.

**Spec:** `docs/superpowers/specs/2026-09-28-recurring-series-design.md` (section "PR 1: pure rename")

## Global Constraints

- **Backend and client naming:**
  - The model is `RecurringSeries` and the table is `recurringseries`.
  - The API is served at `/api/v1/series` with the tag `series`, and the client class is `SeriesService`.
  - The quiz field is `series_id`.
- **Frontend UI layer is unchanged:** component names (`CompetitionDialog`, `CompetitionPodium`), route files, URLs (`/competitions/...`), labels, query keys (`["competitions"]`) and the upload-wizard state field `quizMeta.competition_id` all stay as they are.
- **Player history is unchanged:**
  - `GET /players/{player_id}/competition-history?competition=`;
  - the `PlayerCompetitionGroup` and `PlayerCompetitionHistory` models;
  - the `competition_id`, `competition_name` and `competition_slug` fields on those models and on `PlayerResultWithQuiz`;
  - `crud.get_player_competition_history`;
  - its 404 detail "Competition not found".
- **Error text:** series routes return "Series not found".
- **Migration:** renames only, never drop-and-create, with a working downgrade.
- **Where to run backend commands:** on the host from `backend/` with `uv run ...`. `docker compose exec backend` runs a stale baked image.
- **Test data:** tests hit the dev DB. Only delete rows you create. Never run `docker compose down -v`.
- **E2E runs:** one run at a time, never concurrent. Mailcatcher must be up and the Docker `frontend` container stopped. Never pipe Playwright through `| tail`, because that hides the exit code.
- **Commit messages** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Staging upgrades on its next switch** (the `prestart` service runs `alembic upgrade head`). The migration uses exact constraint and index names. If any name differs, Postgres rolls the whole migration back instead of half-applying it. Covered by the schema test in Task 1 and the dev round-trip in Task 1, Step 13.
2. **Deleting a series still nulls `quiz.series_id`**; it does not delete quizzes or fail. Covered by the renamed `test_delete_series_nullifies_quiz_series_id` and the `ondelete` assertion in the schema test.
3. **Player history JSON still carries the `competition_*` keys, populated from the renamed column.** Covered by the unchanged assertions in `test_players.py` (Task 1).
4. **The old API path `/api/v1/competitions/` returns 404**, with no silent dual mount. Covered by `test_old_competitions_path_is_gone` (Task 1).
5. **Users' bookmarked `/competitions/<slug>` pages still load**, because only the API path changed. Covered by `competitions-public.spec.ts` in the Task 3 E2E run.

---

## File map

| File | Change |
|---|---|
| `backend/app/alembic/versions/b4e8f2a6c913_rename_competition_to_recurringseries.py` | **Create.** In-place renames |
| `backend/app/models.py` | `Competition*` becomes `RecurringSeries*`; `competition_id` becomes `series_id` on `Quiz*` |
| `backend/app/crud.py` | `create_competition`/`update_competition`/`delete_competition` become `create_series`/`update_series`/`delete_series`; player-history queries use `RecurringSeries` and `Quiz.series_id` |
| `backend/app/api/routes/competitions.py` → `series.py` | **Rename (git mv) and rewrite.** `/series` router |
| `backend/app/api/main.py` | Mount the `series` router |
| `backend/app/api/routes/players.py` | Resolve with the `RecurringSeries` model (endpoint unchanged) |
| `backend/app/api/routes/quizzes.py` | `competition_id` filter becomes `series_id` |
| `backend/app/podium.py` | Docstring wording |
| `backend/tests/test_recurring_series_schema.py` | **Create.** Schema test |
| `backend/tests/conftest.py`, `tests/utils/quiz.py`, `tests/test_slugs.py`, `tests/api/routes/test_slug_routes.py`, `tests/api/routes/test_players.py` | Renamed symbols |
| `backend/tests/api/routes/test_competitions.py` → `test_series.py` | **Rename (git mv)** and rewrite names, plus one new test |
| `frontend/openapi.json`, `frontend/src/client/*` | Regenerated |
| `frontend/src/components/Admin/CompetitionDialog.tsx`, `src/components/Upload/{UploadWizard.tsx,types.ts,steps/Step1QuizMeta.tsx,steps/Step5Preview.tsx}`, `src/routes/_public/{competitions.tsx,competitions_.$slug.tsx,organizations_.$slug.tsx}`, `src/routes/_layout/{upload.tsx,admin_.competitions.tsx}` | Client call sites |
| `frontend/tests/{competitions-public,players,upload,qualifier-quizzes}.spec.ts` | Client call sites |

---

### Task 1: Backend rename (database, models, crud, API, tests)

A rename cannot pass tests halfway through: the models, the migration and the routes change together. So this is one task with many small steps.

**Files:** see the file map (all `backend/` rows).

**Interfaces:**
- Consumes: the current head revision, `a3c9d1e5b742`.
- Produces:
  - **Models:**
    - `app.models`: `RecurringSeriesBase`, `RecurringSeriesCreate`, `RecurringSeriesUpdate`, `RecurringSeries` (table `recurringseries`), `RecurringSeriesPublic` and `RecurringSeriesListPublic`.
    - `Quiz.series_id`, `QuizCreate.series_id`, `QuizUpdate.series_id` and `QuizPublic.series_id`, each `uuid.UUID | None`.
  - **crud:**
    - `crud.create_series(*, session, series_in: RecurringSeriesCreate) -> RecurringSeries`
    - `crud.update_series(*, session, db_series: RecurringSeries, series_in: RecurringSeriesUpdate) -> RecurringSeries`
    - `crud.delete_series(*, session, db_series: RecurringSeries) -> None`
  - **Route handlers** in `app/api/routes/series.py`, which determine the client method names: `read_series_list`, `read_series`, `read_series_podium`, `create_series`, `update_series`, `delete_series`.
  - **Test helpers:** `tests.utils.quiz.create_random_series(db, organization_id=None) -> RecurringSeries` and `create_approved_quiz_in_series(db, series_id=None, start_date=...) -> Quiz`.
  - **Migration revision:** `b4e8f2a6c913`.

- [ ] **Step 1: Write the failing schema test**

Create `backend/tests/test_recurring_series_schema.py`:

```python
from sqlalchemy import inspect
from sqlmodel import Session


def test_recurringseries_table_replaces_competition(db: Session) -> None:
    tables = inspect(db.get_bind()).get_table_names()
    assert "recurringseries" in tables
    assert "competition" not in tables


def test_quiz_references_series_by_series_id(db: Session) -> None:
    insp = inspect(db.get_bind())
    columns = {c["name"] for c in insp.get_columns("quiz")}
    assert "series_id" in columns
    assert "competition_id" not in columns

    fks = {fk["name"]: fk for fk in insp.get_foreign_keys("quiz")}
    fk = fks["quiz_series_id_fkey"]
    assert fk["referred_table"] == "recurringseries"
    assert fk["constrained_columns"] == ["series_id"]
    assert fk["options"].get("ondelete") == "SET NULL"


def test_recurringseries_constraint_and_index_names(db: Session) -> None:
    # Postgres carries names through a table rename; the migration renames them
    # so the schema never still reads "competition".
    insp = inspect(db.get_bind())
    assert insp.get_pk_constraint("recurringseries")["name"] == "recurringseries_pkey"
    assert "ix_recurringseries_slug" in {
        i["name"] for i in insp.get_indexes("recurringseries")
    }
    assert {fk["name"] for fk in insp.get_foreign_keys("recurringseries")} == {
        "recurringseries_organization_id_fkey"
    }
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd backend && uv run pytest tests/test_recurring_series_schema.py -q`
Expected: 3 failed. For example, `assert 'recurringseries' in [...]` fails.

- [ ] **Step 3: Write the migration**

Create `backend/app/alembic/versions/b4e8f2a6c913_rename_competition_to_recurringseries.py`:

```python
"""rename competition to recurringseries

Revision ID: b4e8f2a6c913
Revises: a3c9d1e5b742
Create Date: 2026-09-28 12:00:00.000000

"""
from alembic import op


# revision identifiers, used by Alembic.
revision = 'b4e8f2a6c913'
down_revision = 'a3c9d1e5b742'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Pure rename: every statement keeps its rows. Postgres carries index and
    # constraint names through a table/column rename, so rename them explicitly
    # (same approach as a7b3c9d1e2f4, series -> competition).
    op.rename_table("competition", "recurringseries")
    op.execute("ALTER INDEX competition_pkey RENAME TO recurringseries_pkey")
    op.execute("ALTER INDEX ix_competition_slug RENAME TO ix_recurringseries_slug")
    op.execute(
        "ALTER TABLE recurringseries RENAME CONSTRAINT "
        "competition_organization_id_fkey TO recurringseries_organization_id_fkey"
    )

    op.alter_column("quiz", "competition_id", new_column_name="series_id")
    op.execute(
        "ALTER TABLE quiz RENAME CONSTRAINT "
        "quiz_competition_id_fkey TO quiz_series_id_fkey"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE quiz RENAME CONSTRAINT "
        "quiz_series_id_fkey TO quiz_competition_id_fkey"
    )
    op.alter_column("quiz", "series_id", new_column_name="competition_id")

    op.execute(
        "ALTER TABLE recurringseries RENAME CONSTRAINT "
        "recurringseries_organization_id_fkey TO competition_organization_id_fkey"
    )
    op.execute("ALTER INDEX ix_recurringseries_slug RENAME TO ix_competition_slug")
    op.execute("ALTER INDEX recurringseries_pkey RENAME TO competition_pkey")
    op.rename_table("recurringseries", "competition")
```

- [ ] **Step 4: Apply the migration to dev**

Confirm the target first: `grep DB_TARGET .env` must print `DB_TARGET=dev`.

Run: `cd backend && uv run alembic upgrade head`
Expected: the log shows `a3c9d1e5b742 -> b4e8f2a6c913`. Don't run pytest yet. `conftest.py` still selects from the old `Competition` model, whose table no longer exists, so every test errors until Step 9. The schema test runs again in Step 12.

- [ ] **Step 5: Rename the models in `backend/app/models.py`**

Replace the whole `# Competition` section (`CompetitionBase` through `CompetitionListPublic`) with:

```python
# ---------------------------------------------------------------------------
# RecurringSeries (shown to users as "Competition")
# ---------------------------------------------------------------------------

class RecurringSeriesBase(SQLModel):
    name: str = Field(max_length=255)
    description: str | None = Field(default=None)


class RecurringSeriesCreate(RecurringSeriesBase):
    organization_id: uuid.UUID


class RecurringSeriesUpdate(SQLModel):
    name: str | None = Field(default=None, max_length=255)
    description: str | None = None
    organization_id: uuid.UUID | None = None
    slug: str | None = Field(default=None, min_length=1, max_length=255)

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, v: str | None) -> str | None:
        return _validate_slug_shape(v)


class RecurringSeries(RecurringSeriesBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    organization_id: uuid.UUID = Field(
        foreign_key="organization.id", ondelete="CASCADE"
    )
    slug: str = Field(unique=True, index=True, max_length=255)


class RecurringSeriesPublic(RecurringSeriesBase):
    id: uuid.UUID
    slug: str
    organization_id: uuid.UUID
    organization_name: str | None = None
    organization_slug: str | None = None


class RecurringSeriesListPublic(SQLModel):
    data: list[RecurringSeriesPublic]
    count: int
```

In the Quiz section, make these changes. Leave `PlayerResultWithQuiz`, `PlayerCompetitionGroup` and `PlayerCompetitionHistory` untouched.
- `QuizCreate`: `competition_id: uuid.UUID | None = None` becomes `series_id: uuid.UUID | None = None`
- `QuizUpdate`: the same change.
- `Quiz`:
  ```python
      series_id: uuid.UUID | None = Field(
          default=None, foreign_key="recurringseries.id", ondelete="SET NULL"
      )
  ```
- `QuizPublic`: `competition_id: uuid.UUID | None = None` becomes `series_id: uuid.UUID | None = None`

Check: `grep -n "ompetition" backend/app/models.py` should print only the `PlayerResultWithQuiz` fields (`competition_id`, `competition_name`), `PlayerCompetitionGroup` and `PlayerCompetitionHistory`.

- [ ] **Step 6: Rename the crud functions in `backend/app/crud.py`**

In the import block, replace `Competition, CompetitionCreate, CompetitionUpdate,` with `RecurringSeries, RecurringSeriesCreate, RecurringSeriesUpdate,`, keeping alphabetical order (ruff fixes the order in Step 11). Keep `PlayerCompetitionGroup`.

Replace the `# --- Competition ---` section with:

```python
# --- RecurringSeries ---


def create_series(
    *, session: Session, series_in: RecurringSeriesCreate
) -> RecurringSeries:
    # Same empty-slug guard as create_organization — see comment there.
    base = clamp_slug_base(slugify(series_in.name)) or uuid.uuid4().hex[:12]
    series = RecurringSeries.model_validate(
        series_in,
        update={
            "slug": generate_unique_slug(
                session=session, model=RecurringSeries, base=base
            )
        },
    )
    session.add(series)
    session.commit()
    session.refresh(series)
    return series


def update_series(
    *,
    session: Session,
    db_series: RecurringSeries,
    series_in: RecurringSeriesUpdate,
) -> RecurringSeries:
    update_data = series_in.model_dump(exclude_unset=True)
    if update_data.get("organization_id") is None:
        update_data.pop("organization_id", None)
    if update_data.get("slug") is None:
        update_data.pop("slug", None)
    if update_data.get("slug") is not None:
        existing = session.exec(
            select(RecurringSeries).where(RecurringSeries.slug == update_data["slug"])
        ).first()
        if existing and existing.id != db_series.id:
            raise ValueError("Slug already in use")
    db_series.sqlmodel_update(update_data)
    session.add(db_series)
    session.commit()
    session.refresh(db_series)
    return db_series


def delete_series(*, session: Session, db_series: RecurringSeries) -> None:
    session.delete(db_series)
    session.commit()
```

In the `_SlugModel` docstring (around line 262), change `Organization/Competition/Quiz` to `Organization/RecurringSeries/Quiz`.

In the player-history functions (around lines 705–861), change only the model and column references. Local variable names, output field names (`competition_id=`, `competition_name=`, `competition_slug=`) and the function name `get_player_competition_history` stay the same:
- `select(QuizResult, Quiz, Competition)` becomes `select(QuizResult, Quiz, RecurringSeries)`
- `.join(Competition, Quiz.competition_id == Competition.id, isouter=True)` becomes `.join(RecurringSeries, Quiz.series_id == RecurringSeries.id, isouter=True)`
- every `quiz.competition_id` becomes `quiz.series_id` (lines ~739, ~752, ~849)
- `col(Quiz.competition_id).is_(None)` becomes `col(Quiz.series_id).is_(None)`
- `Quiz.competition_id == competition_id` becomes `Quiz.series_id == competition_id`
- `session.get(Competition, competition_id)` becomes `session.get(RecurringSeries, competition_id)`

Check: `grep -n "Competition\b\|\.competition_id\|CompetitionCreate\|CompetitionUpdate" backend/app/crud.py` should print nothing. The only `Competition` left should be inside `PlayerCompetitionGroup`.

- [ ] **Step 7: Replace the competitions router with the series router**

Run: `git mv backend/app/api/routes/competitions.py backend/app/api/routes/series.py`

Overwrite `backend/app/api/routes/series.py` with:

```python
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import Session, col, func, select

from app import crud
from app.api.deps import CurrentUser, SessionDep
from app.models import (
    Organization,
    PodiumPublic,
    Quiz,
    QuizStatus,
    RecurringSeries,
    RecurringSeriesCreate,
    RecurringSeriesListPublic,
    RecurringSeriesPublic,
    RecurringSeriesUpdate,
)
from app.podium import build_podium

router = APIRouter(prefix="/series", tags=["series"])


def _series_public(series: RecurringSeries, session: Session) -> RecurringSeriesPublic:
    org = session.get(Organization, series.organization_id)
    return RecurringSeriesPublic(
        **series.model_dump(),
        organization_name=org.name if org else None,
        organization_slug=org.slug if org else None,
    )


@router.get("/", response_model=RecurringSeriesListPublic)
def read_series_list(session: SessionDep, skip: int = 0, limit: int = 100) -> Any:
    count = session.exec(select(func.count()).select_from(RecurringSeries)).one()
    series_list = session.exec(
        select(RecurringSeries)
        .order_by(func.lower(RecurringSeries.name), col(RecurringSeries.id))
        .offset(skip)
        .limit(limit)
    ).all()
    return RecurringSeriesListPublic(
        data=[_series_public(s, session) for s in series_list],
        count=count,
    )


@router.get("/{id}", response_model=RecurringSeriesPublic)
def read_series(session: SessionDep, id: str) -> Any:
    series = crud.resolve_by_id_or_slug(session=session, model=RecurringSeries, value=id)
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    return _series_public(series, session)


@router.get("/{id}/podium", response_model=PodiumPublic)
def read_series_podium(session: SessionDep, id: str) -> Any:
    series = crud.resolve_by_id_or_slug(session=session, model=RecurringSeries, value=id)
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")

    quizzes = session.exec(
        select(Quiz)
        .where(Quiz.series_id == series.id, Quiz.status == QuizStatus.approved)
        # Series history reads as a chronology: earliest quiz first.
        .order_by(col(Quiz.start_date).asc())
    ).all()
    return build_podium(session=session, quizzes=quizzes)


@router.post("/", response_model=RecurringSeriesPublic)
def create_series(
    *, session: SessionDep, current_user: CurrentUser, series_in: RecurringSeriesCreate
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    if not session.get(Organization, series_in.organization_id):
        raise HTTPException(status_code=404, detail="Organization not found")
    series = crud.create_series(session=session, series_in=series_in)
    return _series_public(series, session)


@router.patch("/{id}", response_model=RecurringSeriesPublic)
def update_series(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: str,
    series_in: RecurringSeriesUpdate,
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    series = crud.resolve_by_id_or_slug(session=session, model=RecurringSeries, value=id)
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    if series_in.organization_id is not None and not session.get(
        Organization, series_in.organization_id
    ):
        raise HTTPException(status_code=404, detail="Organization not found")
    try:
        series = crud.update_series(
            session=session, db_series=series, series_in=series_in
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return _series_public(series, session)


@router.delete("/{id}")
def delete_series(
    *, session: SessionDep, current_user: CurrentUser, id: str
) -> dict[str, bool]:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    series = crud.resolve_by_id_or_slug(session=session, model=RecurringSeries, value=id)
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    crud.delete_series(session=session, db_series=series)
    return {"ok": True}
```

In `backend/app/api/main.py`, replace the `competitions,` import entry with `series,` (in alphabetical position) and `api_router.include_router(competitions.router)` with `api_router.include_router(series.router)`.

- [ ] **Step 8: Update the players route, the quizzes filter and the podium docstring**

`backend/app/api/routes/players.py`: in the `app.models` import, `Competition,` becomes `RecurringSeries,`. In `get_player_competition_history_route`, `model=Competition` becomes `model=RecurringSeries`. Leave the path, the `competition` query parameter, the `"Competition not found"` detail and every other name unchanged.

`backend/app/api/routes/quizzes.py` (around lines 117–125):
```python
    series_id: uuid.UUID | None = None,
```
```python
    if series_id:
        filters.append(Quiz.series_id == series_id)
```

`backend/app/podium.py` docstring: `competition route passes a competition's approved quizzes` becomes `series route passes a series' approved quizzes`.

- [ ] **Step 9: Update the shared test fixtures and helpers**

`backend/tests/conftest.py`: replace `Competition` with `RecurringSeries` in the import and in both model tuples (the snapshot tuple and the FK-ordered delete tuple). Keep each tuple's position unchanged.

`backend/tests/utils/quiz.py`: update the `app.models` import (`CompetitionCreate` becomes `RecurringSeriesCreate`, `Competition` becomes `RecurringSeries`), then replace the two helpers:

```python
def create_random_series(
    db: Session, organization_id: uuid.UUID | None = None
) -> RecurringSeries:
    if organization_id is None:
        organization_id = create_random_organization(db).id
    return crud.create_series(
        session=db,
        series_in=RecurringSeriesCreate(
            name=random_lower_string(), organization_id=organization_id
        ),
    )
```

```python
def create_approved_quiz_in_series(
    db: Session,
    series_id: uuid.UUID | None = None,
    start_date: date = date(2024, 1, 1),
) -> Quiz:
    user = create_random_user(db)
    quiz = crud.create_quiz(
        session=db,
        quiz_in=QuizCreate(
            name=random_lower_string(),
            start_date=start_date,
            end_date=start_date,
            series_id=series_id,
        ),
        submitted_by_id=user.id,
    )
    quiz.status = QuizStatus.approved
    db.add(quiz)
    db.commit()
    db.refresh(quiz)
    return quiz
```

`backend/tests/test_slugs.py`: the import `CompetitionCreate` becomes `RecurringSeriesCreate`, and the test body becomes:

```python
def test_series_slug_generated_on_create(db: Session) -> None:
```
```python
    comp = crud.create_series(
        session=db,
        series_in=RecurringSeriesCreate(name=name, organization_id=org.id),
    )
```
(Keep the rest of the test body as it is.)

- [ ] **Step 10: Rename and rewrite the route tests**

```bash
cd backend
git mv tests/api/routes/test_competitions.py tests/api/routes/test_series.py
perl -pi -e 's/Competition not found/Series not found/g; s/competitions/series/g; s/Competitions/Series/g; s/Competition/RecurringSeries/g; s/competition/series/g' tests/api/routes/test_series.py

perl -pi -e 's/create_approved_quiz_in_competition/create_approved_quiz_in_series/g; s/create_random_competition/create_random_series/g; s{/competitions/}{/series/}g; s/\bcompetition_id=/series_id=/g; s/Quiz\.competition_id/Quiz.series_id/g' tests/api/routes/test_slug_routes.py

perl -pi -e 's/\bCompetition\b/RecurringSeries/g; s/create_approved_quiz_in_competition/create_approved_quiz_in_series/g; s/create_random_competition/create_random_series/g; s/\bcompetition_id=/series_id=/g' tests/api/routes/test_players.py
```

In `test_players.py`, the history assertions (`group["competition_id"]`, `body["competition_name"]`, `params={"competition": ...}`, the `/competition-history` URLs) must remain unchanged. The perl above only touches the class, the helpers and keyword arguments. Confirm with `grep -n '"competition' tests/api/routes/test_players.py`, which should still show the history keys.

Append to `tests/api/routes/test_series.py`:

```python
def test_old_competitions_path_is_gone(client: TestClient) -> None:
    # PR 1 is a rename, not an alias: nothing may still call the old path.
    response = client.get(f"{settings.API_V1_STR}/competitions/")
    assert response.status_code == 404
```

- [ ] **Step 11: Lint**

Run: `cd backend && uv run ruff check --fix app tests && uv run ruff format app tests && uv run ruff check app tests`
Expected: `All checks passed!`. An `F811 redefinition` here means the perl rename collided two test names in `test_series.py`. Rename the second one (for example by adding a `_by_slug` suffix) and run again.

- [ ] **Step 12: Run the whole backend suite**

Run: `cd backend && uv run pytest -q`
Expected: every test passes, including the 3 schema tests, `test_series.py` (with `test_old_competitions_path_is_gone`), `test_players.py` and `test_slug_routes.py`.

Then run `grep -rni competition app --include='*.py' | grep -v alembic/versions` and read each hit. Every remaining hit must belong to one of these:
- the player-history surface: the `PlayerResultWithQuiz`, `PlayerCompetitionGroup` and `PlayerCompetitionHistory` fields, `get_player_competition_history` and its route in `players.py`;
- the "shown to users as Competition" comment in `models.py`.

- [ ] **Step 13: Round-trip the migration and check for drift**

```bash
cd backend
uv run alembic downgrade -1   # expect: b4e8f2a6c913 -> a3c9d1e5b742
uv run alembic upgrade head   # expect: a3c9d1e5b742 -> b4e8f2a6c913
uv run alembic check
```
Expected: both logs as shown. `alembic check` should print `No new upgrade operations detected.` If it reports operations, run `git stash && uv run alembic check && git stash pop` to see whether the same operations existed before this branch. Only operations that are new on this branch need fixing.

- [ ] **Step 14: Commit**

```bash
git add -A backend
git commit -m "refactor(backend): rename Competition to RecurringSeries, serve at /series

Pure rename. The competition table, quiz.competition_id and their index and
constraint names are renamed in place; the API moves to /api/v1/series.
Player history keeps its competition naming.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Regenerate the client and update frontend call sites

**Files:**
- Regenerate: `frontend/openapi.json`, `frontend/src/client/*`
- Modify: `frontend/src/components/Admin/CompetitionDialog.tsx`, `frontend/src/components/Upload/UploadWizard.tsx`, `frontend/src/components/Upload/types.ts`, `frontend/src/components/Upload/steps/Step1QuizMeta.tsx`, `frontend/src/components/Upload/steps/Step5Preview.tsx`, `frontend/src/routes/_public/competitions.tsx`, `frontend/src/routes/_public/competitions_.$slug.tsx`, `frontend/src/routes/_public/organizations_.$slug.tsx`, `frontend/src/routes/_layout/upload.tsx`, `frontend/src/routes/_layout/admin_.competitions.tsx`

**Interfaces:**
- Consumes: the `/series` routes from Task 1.
- Produces (generated): `SeriesService.readSeriesList({ skip, limit })`, `SeriesService.readSeries({ id })`, `SeriesService.readSeriesPodium({ id })`, `SeriesService.createSeries({ requestBody })`, `SeriesService.updateSeries({ id, requestBody })` and `SeriesService.deleteSeries({ id })`, plus the types `RecurringSeriesPublic` and `QuizPublic.series_id`. `PlayersService.getPlayerCompetitionHistoryRoute` is unchanged.

- [ ] **Step 1: Regenerate the client**

Run from the repo root: `bash ./scripts/generate-client.sh`

Verify:
```bash
grep -n "class SeriesService\|class CompetitionsService" frontend/src/client/sdk.gen.ts
awk '/class SeriesService/,/^}/' frontend/src/client/sdk.gen.ts | grep -o "public static [a-zA-Z]*"
```
Expected: only `class SeriesService`, with the methods `readSeriesList`, `readSeries`, `readSeriesPodium`, `createSeries`, `updateSeries` and `deleteSeries`. If the names differ, stop and use the generated names everywhere below.

- [ ] **Step 2: Build and confirm it fails**

Run: `cd frontend && bun run build`
Expected: a TypeScript failure listing `CompetitionsService`, `CompetitionPublic` and `competition_id` errors in the files listed above. This error list is the checklist for Step 3.

- [ ] **Step 3: Update the call sites**

For each item below, the first form is the old code and the second is the new code.

`src/components/Admin/CompetitionDialog.tsx`:
```ts
import type { RecurringSeriesPublic } from "@/client"
import { ApiError, OrganizationsService, SeriesService } from "@/client"
```
- `competition?: CompetitionPublic` becomes `competition?: RecurringSeriesPublic`
- `CompetitionsService.updateCompetition({` becomes `SeriesService.updateSeries({`
- `CompetitionsService.createCompetition({` becomes `SeriesService.createSeries({`

`src/components/Upload/UploadWizard.tsx`: `import type { RecurringSeriesPublic } from "@/client"` and `prefillCompetition?: RecurringSeriesPublic | null`.

`src/components/Upload/types.ts`: in the import, `CompetitionPublic` becomes `RecurringSeriesPublic`, and the parameter at line ~148 becomes `competition: RecurringSeriesPublic,`. Leave the wizard state field `competition_id` as it is.

`src/components/Upload/steps/Step1QuizMeta.tsx`: in the import, `CompetitionsService` becomes `SeriesService`, and `CompetitionsService.readCompetitions({ skip: 0, limit: 100 })` becomes `SeriesService.readSeriesList({ skip: 0, limit: 100 })`. Leave `state.quizMeta.competition_id` as it is.

`src/components/Upload/steps/Step5Preview.tsx` (line ~26), where the wizard state maps onto the API field:
```ts
    series_id: meta.competition_id || undefined,
```

`src/routes/_public/competitions.tsx` and `src/routes/_public/organizations_.$slug.tsx`: `CompetitionsService` becomes `SeriesService` in the import, and `CompetitionsService.readCompetitions(` becomes `SeriesService.readSeriesList(`.

`src/routes/_public/competitions_.$slug.tsx`: in the import, `CompetitionsService` becomes `SeriesService`. `CompetitionsService.readCompetition({ id: slug })` becomes `SeriesService.readSeries({ id: slug })`, and `CompetitionsService.readCompetitionPodium({ id: slug })` becomes `SeriesService.readSeriesPodium({ id: slug })`.

`src/routes/_layout/upload.tsx`: `import { SeriesService, UsersService } from "@/client"`, and `CompetitionsService.readCompetition({ id: slug })` becomes `SeriesService.readSeries({ id: slug })`.

`src/routes/_layout/admin_.competitions.tsx`: `import type { RecurringSeriesPublic } from "@/client"` and `import { SeriesService } from "@/client"`. `{ competition: CompetitionPublic }` becomes `{ competition: RecurringSeriesPublic }`, `CompetitionsService.deleteCompetition({ id: competition.id })` becomes `SeriesService.deleteSeries({ id: competition.id })`, and `CompetitionsService.readCompetitions(` becomes `SeriesService.readSeriesList(`.

Leave query keys (`["competitions"]`, `["competition", slug]`, and so on), toast text and every label as they are.

- [ ] **Step 4: Build, lint and run the unit tests**

```bash
cd frontend
bun run build
bun run lint
bun run test:unit
grep -rn "CompetitionsService\|CompetitionPublic" src | grep -v "src/client/"
```
Expected: the build and lint succeed, all unit tests pass (`competition-prefill.test.ts` and `date-utils.test.ts` use wizard state, which is unchanged), and the grep prints nothing.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/openapi.json frontend/src
git commit -m "refactor(frontend): call SeriesService for competitions

Regenerated client after the backend rename; UI names, URLs and wizard
state keep \"competition\".

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Migrate the E2E specs and run the full suite

**Files:**
- Modify: `frontend/tests/competitions-public.spec.ts`, `frontend/tests/players.spec.ts`, `frontend/tests/upload.spec.ts`, `frontend/tests/qualifier-quizzes.spec.ts`

**Interfaces:**
- Consumes: the `SeriesService` methods and `QuizPublic.series_id` from Task 2.
- Produces: a green E2E suite against the rebuilt stack.

- [ ] **Step 1: Rewrite the client calls in the specs**

```bash
cd frontend/tests
perl -pi -e 's/CompetitionsService\.createCompetition\b/SeriesService.createSeries/g; s/CompetitionsService\.deleteCompetition\b/SeriesService.deleteSeries/g; s/CompetitionsService\.readCompetitions\b/SeriesService.readSeriesList/g; s/CompetitionsService\.readCompetition\b/SeriesService.readSeries/g; s/\bCompetitionsService\b/SeriesService/g; s/\bcompetition_id: /series_id: /g; s/created\?\.competition_id/created?.series_id/g' competitions-public.spec.ts players.spec.ts upload.spec.ts qualifier-quizzes.spec.ts
cd .. && bun run lint
grep -rn "CompetitionsService\|competition_id" tests
```
Expected: the grep prints only lines in `competition-prefill.test.ts` and `date-utils.test.ts`, which is wizard state and correct as it is. Every `series_id:` the perl created must be inside a quiz `requestBody`. Review `git diff tests` to confirm.

- [ ] **Step 2: Rebuild the backend container and prepare the stack**

```bash
grep DB_TARGET .env                        # must be DB_TARGET=dev
docker compose up -d --build backend       # baked image; prestart re-runs migrations (no-op)
docker compose logs backend | grep "Database target"
docker compose stop frontend               # frees :5173 for Playwright's dev server
docker compose up -d mailcatcher
```
Expected: the log shows `Database target: dev`, and `docker compose ps` shows mailcatcher running.

- [ ] **Step 3: Run the full E2E suite once**

Run: `cd frontend && bunx playwright test --config playwright.config.cts`
Nothing else may run Playwright at the same time. Don't pipe through `tail`.
Expected: all tests pass and the exit code is 0. If anything fails, rerun that single spec to tell a flaky failure from a real one before changing any code.

- [ ] **Step 4: Restore the Docker frontend and commit**

```bash
docker compose up -d --build frontend
git add frontend/tests
git commit -m "test(e2e): build competition fixtures through SeriesService

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Final verification and PR

**Files:** none changed.

- [ ] **Step 1: Hand-check that nothing looks different to users**

Against the rebuilt stack (http://localhost:5173), confirm these pages look and behave as before:
- `/competitions` lists competitions;
- `/competitions/<slug>` shows the podium;
- `/players/<slug>` shows a competition group, and its "competitions" drill-down page loads;
- `/admin/competitions` supports create, edit and delete;
- the upload wizard's competition dropdown works, and the chosen competition is saved on the quiz.

- [ ] **Step 2: Final checks**

```bash
cd backend && uv run pytest -q && cd ..
git status            # clean
git log --oneline main..HEAD
```
Expected: all tests pass, the tree is clean, and there are three refactor/test commits plus the spec and plan docs.

- [ ] **Step 3: Push and open the PR (confirm with the user first)**

```bash
git push -u origin refactor-recurring-events
gh pr create --base main --title "Rename Competition to RecurringSeries (PR 1 of 2)" --body "$(cat <<'EOF'
Pure rename, no behaviour change. First of two PRs for
docs/superpowers/specs/2026-09-28-recurring-series-design.md.

- DB: `competition` → `recurringseries`, `quiz.competition_id` → `series_id`; index and constraint names renamed in place (migration b4e8f2a6c913, round-trips).
- API: `/api/v1/competitions` → `/api/v1/series`; client `CompetitionsService` → `SeriesService`.
- Unchanged: every user-facing label and URL, and the player-history endpoint and fields.
- Staging picks up the migration automatically on its next switch via `prestart`.

Tests: backend suite, full E2E suite, alembic downgrade/upgrade round-trip, `alembic check`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
