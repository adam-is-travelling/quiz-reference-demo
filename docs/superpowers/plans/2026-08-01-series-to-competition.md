# Rename "series" to "competition" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the domain concept "series" to "competition" everywhere in live code — database schema, Python models, HTTP API paths, generated client, frontend routes, components, and tests.

**Architecture:** A rename cannot land incrementally without breaking the build, so the work is grouped into three atomic tasks that each end in a green state: the whole backend (migration + models + crud + routes + tests), then the whole frontend (client regen + routes + components + specs), then full-stack verification across both database targets. Steps inside each task are small; the tasks themselves are necessarily large because Python fails to import and TypeScript fails to type-check the moment a shared symbol is half-renamed.

**Tech Stack:** FastAPI, SQLModel, Alembic, PostgreSQL 18, React, TanStack Router/Query, `@hey-api/openapi-ts`, Playwright, Docker Compose.

## Global Constraints

- Model class is `Competition`; table is `competition`. The `Quiz` prefix is dropped.
- Every identifier maps `series` → `competition`, `Series` → `Competition` in place.
- Plural-sensitive identifiers take real plurals: `seriesList` → `competitionList`, `allSeries` → `allCompetitions`, `orgSeries` → `orgCompetitions`, `read_series` → `read_competitions`.
- `SeriesEventPodium` → `CompetitionEventPodium`. The word "Event" refers to a quiz event and stays.
- No back-compatible routes, aliases, or redirects. Old paths simply stop existing.
- Do not modify anything under `docs/superpowers/specs/` or `docs/superpowers/plans/`, and do not modify existing Alembic migration files.
- `frontend/src/client/` is generated. Never hand-edit it; regenerate with `bash ./scripts/generate-client.sh`.
- Test cleanup stays non-destructive: fixtures delete only rows they created, tracked by id diff. Never add a table-wide delete.
- New migration's `down_revision` is `"c1d2e3f4a5b6"` (verified current head, in code and in the live `alembic_version` table).
- **Never run backend code via `docker compose exec backend`.** The backend container has no source bind mount (only `htmlcov`); `develop.watch` syncs only under `docker compose watch`, and this stack runs via plain `up -d`. `docker compose exec backend …` therefore executes the *old baked image* — alembic would report "already at head" and pytest would pass against pre-rename code, both false greens.
- Run backend commands **on the host** instead, from the `backend/` directory, using the repo-root uv workspace venv: `/Users/ahancock/dev/quiz-reference-demo/.venv/bin/alembic` and `.../.venv/bin/pytest`. Note the venv is at the **repo root**, not `backend/.venv` (which is an empty stub). `.env` sets `POSTGRES_SERVER=localhost` and compose publishes db on `5432`, so this reaches the same database the stack uses. Verified working: `alembic current` → `c1d2e3f4a5b6 (head)`.
- Docker is only needed to rebuild the *image* for the OpenAPI client generation (Task 2) and the final verification (Task 3).
- **Never run `docker compose down -v`** — it destroys both database volumes, including the curated staging data. `down` without `-v` is safe but unnecessary here.

---

### Task 1: Backend rename — migration, models, crud, routes, tests

Atomic. Renaming `QuizSeries` in `models.py` immediately breaks `crud.py` and the route modules, and applying the migration immediately breaks every query against the old table name. This task ends with the full backend suite green.

**Files:**
- Create: `backend/app/alembic/versions/a7b3c9d1e2f4_rename_series_to_competition.py`
- Modify: `backend/app/models.py` (lines 171-205, 226-268, 392-426, 594-613)
- Modify: `backend/app/crud.py` (lines 122-148, 359-463, imports at 25-36)
- Rename: `backend/app/api/routes/series.py` → `backend/app/api/routes/competitions.py`
- Modify: `backend/app/api/main.py` (lines 10, 21)
- Modify: `backend/app/api/routes/players.py` (lines 19, 40, 172-192)
- Modify: `backend/app/api/routes/quizzes.py` (lines 64, 70-71)
- Rename: `backend/tests/api/routes/test_series.py` → `backend/tests/api/routes/test_competitions.py`
- Modify: `backend/tests/api/routes/test_players.py`, `backend/tests/utils/quiz.py`, `backend/tests/conftest.py`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: the HTTP surface Task 2's generated client is built from —
  `GET|POST /api/v1/competitions/`, `GET|PATCH|DELETE /api/v1/competitions/{id}`,
  `GET /api/v1/competitions/{id}/podium`,
  `GET /api/v1/players/{player_id}/competition-history?competition_id=&skip=&limit=`,
  `GET /api/v1/quizzes/?competition_id=`.
  Router tag is `competitions` (this is what names the client service).
  Response models: `CompetitionPublic`, `CompetitionListPublic`, `CompetitionPodiumPublic`, `PlayerCompetitionHistory`.

- [ ] **Step 1: Write the migration**

Create `backend/app/alembic/versions/a7b3c9d1e2f4_rename_series_to_competition.py`:

```python
"""rename series to competition

Revision ID: a7b3c9d1e2f4
Revises: c1d2e3f4a5b6
Create Date: 2026-08-01 00:00:00.000000

"""
from alembic import op

# revision identifiers, used by Alembic.
revision = "a7b3c9d1e2f4"
down_revision = "c1d2e3f4a5b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # NOTE: the FK on `quiz` is named `quizevent_series_id_fkey`, not
    # `quiz_series_id_fkey` — Postgres kept the original name through the
    # earlier quizevent -> quiz table rename (revision 09b03772bf36).
    op.drop_constraint("quizevent_series_id_fkey", "quiz", type_="foreignkey")

    op.alter_column("quiz", "series_id", new_column_name="competition_id")

    op.rename_table("quizseries", "competition")

    # Postgres carries constraint/index names through a table rename, so rename
    # them explicitly or the schema still reads "quizseries".
    op.execute("ALTER INDEX quizseries_pkey RENAME TO competition_pkey")
    op.execute(
        "ALTER TABLE competition RENAME CONSTRAINT "
        "quizseries_organization_id_fkey TO competition_organization_id_fkey"
    )

    op.create_foreign_key(
        "quiz_competition_id_fkey",
        "quiz",
        "competition",
        ["competition_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("quiz_competition_id_fkey", "quiz", type_="foreignkey")

    op.execute(
        "ALTER TABLE competition RENAME CONSTRAINT "
        "competition_organization_id_fkey TO quizseries_organization_id_fkey"
    )
    op.execute("ALTER INDEX competition_pkey RENAME TO quizseries_pkey")

    op.rename_table("competition", "quizseries")

    op.alter_column("quiz", "competition_id", new_column_name="series_id")

    op.create_foreign_key(
        "quizevent_series_id_fkey",
        "quiz",
        "quizseries",
        ["series_id"],
        ["id"],
        ondelete="SET NULL",
    )
```

- [ ] **Step 2: Verify the migration round-trips**

The stack is already running against `DB_TARGET=dev`. Run alembic **on the host** (see
Global Constraints — `docker compose exec backend` would run the stale baked image and
silently do nothing):

```bash
cd backend
ALEMBIC=/Users/ahancock/dev/quiz-reference-demo/.venv/bin/alembic
$ALEMBIC upgrade head
docker compose exec -T db psql -U postgres -d app -c "\d competition"
docker compose exec -T db psql -U postgres -d app -c "SELECT conname FROM pg_constraint WHERE conrelid='quiz'::regclass AND conname LIKE '%competition%';"
```

Expected: table `competition` exists with `competition_pkey` and
`competition_organization_id_fkey`; `quiz` has `quiz_competition_id_fkey`.

Then prove the downgrade works and return to head:

```bash
$ALEMBIC downgrade -1
docker compose exec -T db psql -U postgres -d app -c "\d quizseries"
$ALEMBIC upgrade head
```

Expected: after downgrade, `quizseries` is back with its original constraint names; after
the final upgrade, `competition` is back.

- [ ] **Step 3: Rename the models**

In `backend/app/models.py`, replace the `QuizSeries` block (lines 171-205) with:

```python
# ---------------------------------------------------------------------------
# Competition
# ---------------------------------------------------------------------------

class CompetitionBase(SQLModel):
    name: str = Field(max_length=255)
    description: str | None = Field(default=None)


class CompetitionCreate(CompetitionBase):
    organization_id: uuid.UUID


class CompetitionUpdate(SQLModel):
    name: str | None = Field(default=None, max_length=255)
    description: str | None = None
    organization_id: uuid.UUID | None = None


class Competition(CompetitionBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    organization_id: uuid.UUID = Field(
        foreign_key="organization.id", ondelete="CASCADE"
    )


class CompetitionPublic(CompetitionBase):
    id: uuid.UUID
    organization_id: uuid.UUID
    organization_name: str | None = None


class CompetitionListPublic(SQLModel):
    data: list[CompetitionPublic]
    count: int
```

- [ ] **Step 4: Rename the Quiz foreign key field**

Still in `models.py`, change `series_id` → `competition_id` in `QuizCreate` (line 228),
`QuizUpdate` (line 239), and `QuizPublic` (line 266). In the `Quiz` table class
(lines 247-249), the FK target changes too:

```python
    competition_id: uuid.UUID | None = Field(
        default=None, foreign_key="competition.id", ondelete="SET NULL"
    )
```

- [ ] **Step 5: Rename the player-history and podium schemas**

In `models.py` lines 392-426, rename fields on `PlayerResultWithQuiz`
(`series_id` → `competition_id`, `series_name` → `competition_name`) and replace the two
class definitions:

```python
class PlayerCompetitionGroup(SQLModel):
    competition_id: uuid.UUID | None
    competition_name: str | None
    results: list[PlayerResultWithQuiz]
    total_count: int


class PlayerHistoryGrouped(SQLModel):
    data: list[PlayerCompetitionGroup]
    total_events: int
    wins: int
    podiums: int


class PlayerCompetitionHistory(SQLModel):
    data: list[PlayerResultWithQuiz]
    count: int
    competition_name: str | None = None
```

At lines 594-613, rename the podium schemas:

```python
class CompetitionEventPodium(SQLModel):
    quiz_id: uuid.UUID
    quiz_name: str
    start_date: date
    end_date: date
    finishers: list[PodiumFinisher]
```

and

```python
class CompetitionPodiumPublic(SQLModel):
    events: list[CompetitionEventPodium]
    standings: list[PodiumStanding]
```

- [ ] **Step 6: Rename the crud functions**

In `backend/app/crud.py`, update the imports at lines 25-36 (`PlayerSeriesGroup` →
`PlayerCompetitionGroup`, `QuizSeries` → `Competition`, `QuizSeriesCreate` →
`CompetitionCreate`, `QuizSeriesUpdate` → `CompetitionUpdate`) and replace lines 122-148:

```python
# --- Competition ---


def create_competition(
    *, session: Session, competition_in: CompetitionCreate
) -> Competition:
    competition = Competition.model_validate(competition_in)
    session.add(competition)
    session.commit()
    session.refresh(competition)
    return competition


def update_competition(
    *,
    session: Session,
    db_competition: Competition,
    competition_in: CompetitionUpdate,
) -> Competition:
    update_data = competition_in.model_dump(exclude_unset=True)
    if update_data.get("organization_id") is None:
        update_data.pop("organization_id", None)
    db_competition.sqlmodel_update(update_data)
    session.add(db_competition)
    session.commit()
    session.refresh(db_competition)
    return db_competition


def delete_competition(*, session: Session, db_competition: Competition) -> None:
    session.delete(db_competition)
    session.commit()
```

- [ ] **Step 7: Rename the grouped-history query**

In `crud.py` `get_player_history_grouped` (lines 359-415), the join and the group keys
change. Replace lines 362-369 with:

```python
    stmt = (
        select(QuizResult, Quiz, Competition)
        .join(Quiz, QuizResult.quiz_id == Quiz.id)
        .join(Competition, Quiz.competition_id == Competition.id, isouter=True)
        .where(QuizResult.player_id == player_id)
        .where(Quiz.status == QuizStatus.approved)
        .order_by(col(Quiz.start_date).desc())
    )
```

Rename `series_names` → `competition_names`, the loop variable `series` →
`competition`, `quiz.series_id` → `quiz.competition_id`, and the constructed group:

```python
    data = [
        PlayerCompetitionGroup(
            competition_id=key,
            competition_name=competition_names[key],
            results=groups[key][:5],
            total_count=len(groups[key]),
        )
        for key in ordered_keys
    ]
```

The `PlayerResultWithQuiz(...)` construction inside the loop takes
`competition_id=quiz.competition_id` and
`competition_name=competition.name if competition else None`.

- [ ] **Step 8: Rename the paginated history query**

Replace `get_player_series_history` (lines 418-463) with `get_player_competition_history`,
renaming the `series_id` parameter to `competition_id`, the `series_name` local to
`competition_name`, and the two filter branches:

```python
    if competition_id is None:
        base = base.where(col(Quiz.competition_id).is_(None))
    else:
        base = base.where(Quiz.competition_id == competition_id)
```

and the lookup:

```python
    competition_name: str | None = None
    if competition_id is not None:
        competition = session.get(Competition, competition_id)
        competition_name = competition.name if competition else None
```

The returned `PlayerResultWithQuiz` items take `competition_id=quiz.competition_id` and
`competition_name=competition_name`.

- [ ] **Step 9: Rename the route module**

```bash
git mv backend/app/api/routes/series.py backend/app/api/routes/competitions.py
```

Then in the new file: update the `app.models` import block to
`Competition, CompetitionCreate, CompetitionListPublic, CompetitionPublic, CompetitionUpdate, CompetitionEventPodium, CompetitionPodiumPublic`;
set `router = APIRouter(prefix="/competitions", tags=["competitions"])`; rename
`_series_public` → `_competition_public`; rename the handlers to `read_competitions`,
`read_competition`, `read_competition_podium`, `create_competition`,
`update_competition`, `delete_competition`; rename locals `series` → `competition`,
`series_list` → `competition_list`, `series_in` → `competition_in`; change
`Quiz.series_id == id` → `Quiz.competition_id == id`; change every
`detail="Series not found"` → `detail="Competition not found"`; and update the three
`crud.*` calls to `crud.create_competition`, `crud.update_competition`
(keyword `db_competition=`), and `crud.delete_competition` (keyword `db_competition=`).

The list handler becomes:

```python
@router.get("/", response_model=CompetitionListPublic)
def read_competitions(
    session: SessionDep, skip: int = 0, limit: int = 100
) -> Any:
    count = session.exec(select(func.count()).select_from(Competition)).one()
    competition_list = session.exec(
        select(Competition).offset(skip).limit(limit)
    ).all()
    return CompetitionListPublic(
        data=[_competition_public(c, session) for c in competition_list],
        count=count,
    )
```

- [ ] **Step 10: Wire up the router**

In `backend/app/api/main.py`, change the import at line 10 from `series` to
`competitions`, and line 21 from `api_router.include_router(series.router)` to
`api_router.include_router(competitions.router)`. Keep the import list alphabetised to
match the existing style.

- [ ] **Step 11: Update the players and quizzes routes**

In `backend/app/api/routes/players.py`: import `get_player_competition_history` (line 19)
and `PlayerCompetitionHistory` (line 40), then replace lines 172-192:

```python
@router.get(
    "/{player_id}/competition-history", response_model=PlayerCompetitionHistory
)
def get_player_competition_history_route(
    player_id: uuid.UUID,
    session: SessionDep,
    current_user: OptionalCurrentUser,
    competition_id: uuid.UUID | None = None,
    skip: int = 0,
    limit: int = 50,
) -> PlayerCompetitionHistory:
    player = session.get(Player, player_id)
    is_superuser = current_user is not None and current_user.is_superuser
    if not player or (not player.is_published and not is_superuser):
        raise HTTPException(status_code=404, detail="Player not found")
    data, count, competition_name = get_player_competition_history(
        session=session,
        player_id=player_id,
        competition_id=competition_id,
        skip=skip,
        limit=limit,
    )
    return PlayerCompetitionHistory(
        data=data, count=count, competition_name=competition_name
    )
```

In `backend/app/api/routes/quizzes.py`, rename the `series_id` query parameter (line 64)
to `competition_id` and the filter (lines 70-71):

```python
    if competition_id:
        filters.append(Quiz.competition_id == competition_id)
```

- [ ] **Step 12: Update the test helpers and fixtures**

In `backend/tests/utils/quiz.py`: import `Competition` and `CompetitionCreate`; rename
`create_random_series` → `create_random_competition` (returning `Competition`, calling
`crud.create_competition(session=..., competition_in=CompetitionCreate(...))`); rename
`create_approved_event_in_series` → `create_approved_event_in_competition` with parameter
`competition_id: uuid.UUID | None = None` passed through as `competition_id=competition_id`.

In `backend/tests/conftest.py`, change the two model tuples (lines 36 and 46) so
`QuizSeries` becomes `Competition`, and update the import on line 11. Order matters for
FK constraints — keep `Competition` in the same position the old `QuizSeries` occupied.

- [ ] **Step 13: Rename the backend test module**

```bash
git mv backend/tests/api/routes/test_series.py backend/tests/api/routes/test_competitions.py
```

Apply the mechanical rename inside it, ordered so the compound names resolve first:

```bash
cd backend
sed -i '' \
  -e 's/QuizSeries/Competition/g' \
  -e 's/Series/Competition/g' \
  -e 's/series/competition/g' \
  tests/api/routes/test_competitions.py
```

Then fix the names the naive substitution gets wrong. Search for and correct:
- `clean_competition_data` — correct as-is, no change needed.
- `pre_competition` → `pre_competitions` (it is a set of ids).
- `new_competition_ids` — correct as-is.
- `test_read_competition_public` → `test_read_competitions_public` (lists all).
- `test_read_competition_includes_organization_name` → `test_read_competitions_includes_organization_name` (the list endpoint; its sibling `test_read_competition_item_includes_organization_name` stays singular).
- `crud.create_competition` call sites need keyword `competition_in=`, and `update`/`delete` need `db_competition=`.
- `/api/v1/series/` URLs in the test bodies become `/api/v1/competitions/`.

- [ ] **Step 14: Update the players tests**

```bash
cd backend
sed -i '' \
  -e 's/QuizSeries/Competition/g' \
  -e 's/Series/Competition/g' \
  -e 's/series/competition/g' \
  tests/api/routes/test_players.py
```

Then fix up: `pre_competition` → `pre_competitions`; the endpoint string
`/competition-history` is correct; `test_get_player_history_groups_by_competition` is
correct; `competition_event` and `ungrouped_event` locals are correct. Verify the
`create_approved_event_in_competition(db, competition_id=...)` keyword matches Step 12.

- [ ] **Step 15: Run the backend suite**

Run on the host against the migrated dev database:

```bash
cd backend
/Users/ahancock/dev/quiz-reference-demo/.venv/bin/pytest tests/ -q
```

Expected: PASS, all tests. If collection fails with `ImportError`, a symbol was missed —
grep for it before changing anything else.

Do **not** use `docker compose exec backend bash scripts/tests-start.sh` here: the
container runs the pre-rename baked image, so it would pass without ever executing the
renamed code.

- [ ] **Step 16: Confirm no "series" remains in backend source**

```bash
grep -rni series backend/app backend/tests --include='*.py' \
  | grep -v alembic/versions
```

Expected: no output. (The `alembic/versions` exclusion covers the historical migration
files, which keep their old names by design — including the new migration's own comment
referencing `quizevent_series_id_fkey`.)

- [ ] **Step 17: Commit**

```bash
git add backend/
git commit -m "refactor(backend): rename series to competition

Renames the table quizseries -> competition and quiz.series_id ->
competition_id, with the model, crud, route, and test identifiers to match.
Breaking API change: /api/v1/series/* -> /api/v1/competitions/*."
```

---

### Task 2: Frontend rename — client regen, routes, components, specs

Atomic for the same reason: regenerating the client deletes `SeriesService`, so every
consumer must move in the same commit. Ends with `bun run build` and `bun run lint` green.

**Files:**
- Regenerate: `frontend/src/client/` (`schemas.gen.ts`, `types.gen.ts`, `sdk.gen.ts`)
- Rename: `frontend/src/routes/_public/series.tsx` → `competitions.tsx`
- Rename: `frontend/src/routes/_public/series_.$id.tsx` → `competitions_.$id.tsx`
- Rename: `frontend/src/routes/_layout/admin_.series.tsx` → `admin_.competitions.tsx`
- Rename: `frontend/src/routes/_public/players_.$slug_.series.$seriesId.tsx` → `players_.$slug_.competitions.$competitionId.tsx`
- Rename: `frontend/src/components/Series/SeriesPodium.tsx` → `frontend/src/components/Competitions/CompetitionPodium.tsx`
- Rename: `frontend/src/components/Admin/SeriesDialog.tsx` → `CompetitionDialog.tsx`
- Modify: `frontend/src/components/Common/PublicNav.tsx`, `Sidebar/AppSidebar.tsx`, `Players/PlayerProfile.tsx`, `Upload/types.ts`, `Upload/steps/Step1EventMeta.tsx`, `Upload/steps/Step5Preview.tsx`, `routes/_public/organizations_.$id.tsx`
- Rename: `frontend/tests/series-admin.spec.ts` → `competitions-admin.spec.ts`, `frontend/tests/series-public.spec.ts` → `competitions-public.spec.ts`
- Modify: `frontend/tests/players.spec.ts`, `frontend/tests/footer.spec.ts`, `frontend/tests/date-utils.test.ts`

**Interfaces:**
- Consumes: the API surface from Task 1. After regeneration the client exposes
  `CompetitionsService.readCompetitions({ skip, limit })`,
  `.readCompetition({ id })`, `.readCompetitionPodium({ id })`,
  `.createCompetition({ requestBody })`, `.updateCompetition({ id, requestBody })`,
  `.deleteCompetition({ id })`, and
  `PlayersService.getPlayerCompetitionHistoryRoute({ playerId, competitionId, skip, limit })`.
  Types: `CompetitionPublic`, `CompetitionListPublic`, `CompetitionPodiumPublic`,
  `CompetitionEventPodium`, `PlayerCompetitionHistory`, `PlayerCompetitionGroup`.
- Produces: nothing downstream except the URLs Task 3 exercises — `/competitions`,
  `/competitions/$id`, `/admin/competitions`, `/players/$slug/competitions/$competitionId`.

- [ ] **Step 1: Rebuild the backend image and regenerate the client**

The generator reads the schema from the running backend, so it must be serving the new
routes. The stack runs baked images:

```bash
docker compose up -d --build backend
bash ./scripts/generate-client.sh
```

- [ ] **Step 2: Verify the generated client**

```bash
grep -c "CompetitionsService" frontend/src/client/sdk.gen.ts
grep -rn "SeriesService\|readSeries" frontend/src/client/ | head
```

Expected: a non-zero count for the first, and **no output** for the second. If
`SeriesService` survives, the router `tags=["competitions"]` from Task 1 Step 9 was not
applied, or the backend image was not rebuilt — fix that before continuing.

- [ ] **Step 3: Move the route and component files**

```bash
cd frontend/src
git mv routes/_public/series.tsx routes/_public/competitions.tsx
git mv routes/_public/series_.\$id.tsx routes/_public/competitions_.\$id.tsx
git mv routes/_layout/admin_.series.tsx routes/_layout/admin_.competitions.tsx
git mv routes/_public/players_.\$slug_.series.\$seriesId.tsx \
       routes/_public/players_.\$slug_.competitions.\$competitionId.tsx
mkdir -p components/Competitions
git mv components/Series/SeriesPodium.tsx components/Competitions/CompetitionPodium.tsx
git mv components/Admin/SeriesDialog.tsx components/Admin/CompetitionDialog.tsx
rmdir components/Series
cd ../tests
git mv series-admin.spec.ts competitions-admin.spec.ts
git mv series-public.spec.ts competitions-public.spec.ts
```

- [ ] **Step 4: Apply the mechanical rename across frontend source and tests**

`routeTree.gen.ts` is regenerated, so exclude it:

```bash
cd frontend
find src/routes src/components tests -type f \( -name '*.ts' -o -name '*.tsx' \) \
  ! -name 'routeTree.gen.ts' -print0 \
  | xargs -0 sed -i '' \
      -e 's/QuizSeries/Competition/g' \
      -e 's/Series/Competition/g' \
      -e 's/series/competition/g'
```

- [ ] **Step 5: Fix the plural and generated-name cases the sed got wrong**

The naive substitution produces singular forms where plurals are required, and guesses
the service name wrong. Correct each of these:

| Wrong (after sed) | Correct |
|---|---|
| `CompetitionService` | `CompetitionsService` |
| `readCompetition({ skip` | `readCompetitions({ skip` |
| `readCompetitionItem` | `readCompetition` |
| `allCompetition` | `allCompetitions` |
| `orgCompetition` | `orgCompetitions` |
| `getCompetitionQueryOptions` | `getCompetitionsQueryOptions` (the list one, in `competitions.tsx` and `organizations_.$id.tsx`) |
| `CompetitionPage` | `CompetitionsPage` |
| `AdminCompetition` | `AdminCompetitions` |
| `@/components/Competition/CompetitionPodium` | `@/components/Competitions/CompetitionPodium` (the directory created in Step 3 is plural; sed makes the import singular) |
| `getPlayerCompetitionHistoryRoute` | correct as-is |

Note `competitions_.$id.tsx` has *two* query-option helpers: the detail one stays
`getCompetitionQueryOptions` (singular — fetches one) while the podium one becomes
`getCompetitionPodiumQueryOptions`. In `competitions.tsx` the list helper is
`getCompetitionsQueryOptions`.

Find remaining mistakes with:

```bash
grep -rn "CompetitionService\|allCompetition\b\|orgCompetition\b" src tests
grep -rn "components/Competition/" src tests
```

- [ ] **Step 6: Fix the route path strings**

`createFileRoute` arguments and `Link to=` targets are string literals the sed rewrote to
plausible-but-wrong paths. Set them explicitly:

- `competitions.tsx`: `createFileRoute("/_public/competitions")`, heading `Competitions`, `head` title `Competitions`, empty state `No competitions published yet.`, subtitle `Quiz competitions and tournaments`, and the row `Link to="/competitions/$id"`.
- `competitions_.$id.tsx`: `createFileRoute("/_public/competitions_/$id")`.
- `admin_.competitions.tsx`: `createFileRoute("/_layout/admin_/competitions")`.
- `players_.$slug_.competitions.$competitionId.tsx`: `createFileRoute("/_public/players_/$slug_/competitions/$competitionId")`, and the `Route.useParams()` destructure yields `competitionId`.
- `PlayerProfile.tsx`: `Link to="/players/$slug/competitions/$competitionId"` with `params={{ slug, competitionId: group.competition_id ?? "none" }}`.
- `PublicNav.tsx`: `to={"/competitions" as any}` with link text `Competitions`.
- `AppSidebar.tsx`: `{ icon: List, title: "Competitions", path: "/admin/competitions" }`.

- [ ] **Step 7: Fix user-visible copy**

In `components/Admin/CompetitionDialog.tsx`: dialog title
`{isEdit ? "Edit Competition" : "New Competition"}`; toasts
`isEdit ? "Competition updated" : "Competition created"` and
`isEdit ? "Failed to update competition" : "Failed to create competition"`.

In `components/Upload/steps/Step1EventMeta.tsx`: the field label becomes
`Competition (optional)`.

Confirm the query keys are `["competitions"]` — including the `invalidateQueries` call in
the dialog — and that `Upload/types.ts` uses `competition_id` in both the type and the
initial state object.

- [ ] **Step 8: Regenerate the route tree and type-check**

```bash
cd frontend
bun run build
```

Expected: PASS. The dev server or build regenerates `routeTree.gen.ts` from the filenames.
Type errors here point at a missed rename — read the error, fix the symbol, re-run.

- [ ] **Step 9: Lint**

```bash
cd frontend
bun run lint
```

Expected: PASS (Biome auto-fixes formatting; re-run if it reports fixes applied).

- [ ] **Step 10: Confirm no "series" remains in frontend source**

```bash
grep -rni series frontend/src frontend/tests
```

Expected: no output.

- [ ] **Step 11: Commit**

```bash
git add frontend/
git commit -m "refactor(frontend): rename series to competition

Regenerates the API client against the renamed backend routes and moves
/series -> /competitions, /admin/series -> /admin/competitions, and the
per-player history route."
```

---

### Task 3: Full-stack verification across both database targets

**Files:** none modified. This task only runs and observes.

**Interfaces:**
- Consumes: everything from Tasks 1 and 2.
- Produces: confirmation the rename is complete and both database volumes are migrated.

- [ ] **Step 1: Confirm the dev target is migrated and serving**

```bash
docker compose up -d --build
docker compose exec -T db psql -U postgres -d app -c "SELECT version_num FROM alembic_version;"
curl -s localhost:8000/api/v1/competitions/ | head -c 200
curl -s -o /dev/null -w '%{http_code}\n' localhost:8000/api/v1/series/
```

Expected: `a7b3c9d1e2f4`; a JSON body with `data` and `count`; and `404` for the old path.

- [ ] **Step 2: Migrate the staging target**

Edit the root `.env` and set `DB_TARGET=staging`, then:

```bash
docker compose up -d --build
docker compose logs prestart | tail -30
```

`--build` is required: `prestart` runs from the baked image with no source sync, so a
plain `up -d` would run the *old* image, find no new revision, exit zero, and leave
staging unmigrated while reporting success.

Expected: prestart logs show `Running upgrade c1d2e3f4a5b6 -> a7b3c9d1e2f4`. Confirm:

```bash
docker compose exec -T db psql -U postgres -d app -c "SELECT version_num FROM alembic_version;"
docker compose exec -T db psql -U postgres -d app -c "\d competition"
```

Expected: `a7b3c9d1e2f4`, and the `competition` table present with the curated rows intact
(`SELECT count(*) FROM competition;` should be non-zero on staging).

- [ ] **Step 3: Return to the dev target**

Set `DB_TARGET=dev` in the root `.env` and run `docker compose up -d --build`. Confirm the
backend logs `Database target: dev ...` at startup.

Never run `docker compose down -v` at any point — it destroys both volumes, staging
included.

- [ ] **Step 4: Run the E2E suite**

Stop the Docker frontend first, or it shadows port 5173 and Playwright silently tests a
stale build:

```bash
docker compose stop frontend
cd frontend
bunx playwright test
```

Expected: PASS, including `competitions-admin.spec.ts`, `competitions-public.spec.ts`,
`players.spec.ts`, and `footer.spec.ts`.

- [ ] **Step 5: Final repository-wide check**

```bash
grep -rni series backend/app backend/tests frontend/src frontend/tests \
  | grep -v alembic/versions
```

Expected: no output. Historical `docs/` files and old migration filenames still contain
"series" by design and are not searched here.

- [ ] **Step 6: Restart the frontend container and commit any stragglers**

```bash
docker compose start frontend
git status
```

Expected: a clean tree, or only `frontend/src/routeTree.gen.ts` if the E2E run
regenerated it — in which case commit it:

```bash
git add frontend/src/routeTree.gen.ts
git commit -m "chore(frontend): regenerate route tree after competition rename"
```
