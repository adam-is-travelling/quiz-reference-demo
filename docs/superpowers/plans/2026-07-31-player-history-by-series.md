# Player Competition History Grouped by Series — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group a player's competition history by quiz series on the profile page, showing the 5 most recent results per series with a "See all results" link to a dedicated paginated per-series page.

**Architecture:** The backend `/players/{id}/history` endpoint changes shape from a flat list to a grouped structure (per-series buckets, each capped at 5 results + a total count, plus profile-level aggregates). A new `/players/{id}/series-history` endpoint serves the paginated full list for one series (or the ungrouped "Other" bucket). The frontend renders one section per series and a new `/players/$slug/series/$seriesId` route for the full list.

**Tech Stack:** FastAPI + SQLModel (backend), pytest (backend tests), React + TanStack Router/Query + hey-api generated client (frontend), Playwright (E2E).

## Global Constraints

- Backend history queries filter to `Quiz.status == QuizStatus.approved` (approved results only).
- Auth/visibility on player endpoints: 404 if the player is missing, or unpublished for a non-superuser (`OptionalCurrentUser`).
- Pagination convention is `skip: int = 0` / `limit: int` query params.
- Series groups are ordered by their newest result's `start_date` descending; the ungrouped **"Other"** bucket is always last. (Interim heuristic — see the design's Future considerations; do not hard-code assumptions that block a future explicit ordering.)
- Test cleanup is **non-destructive**: only delete rows the test created (guarded by `test_cleanup_safety.py`). Never issue table-wide deletes.
- The `"none"` string is the URL sentinel for the ungrouped bucket's `seriesId` route param.
- After backend schema changes, regenerate the frontend client via `bash ./scripts/generate-client.sh` (requires the backend stack running).

---

## File Structure

**Backend:**
- `backend/app/models.py` — add `series_id`/`series_name` to `PlayerResultWithQuiz`; add `PlayerSeriesGroup`, `PlayerHistoryGrouped`, `PlayerSeriesHistory`.
- `backend/app/crud.py` — add `get_player_history_grouped`; add `get_player_series_history`. (Leave the old `get_player_history` in place only if still referenced; it is not after Task 1, so remove it.)
- `backend/app/api/routes/players.py` — change the `history` route response; add the `series-history` route.
- `backend/tests/utils/quiz.py` — add `create_approved_event_in_series` helper.
- `backend/tests/api/routes/test_players.py` — update the 3 existing history tests to the grouped shape; add grouped + series-history tests.

**Frontend:**
- `frontend/src/client/` — regenerated (do not hand-edit).
- `frontend/src/components/Players/historyColumns.tsx` — extracted shared columns.
- `frontend/src/components/Players/PlayerProfile.tsx` — render per-series sections + aggregates.
- `frontend/src/routes/_public/players_.$slug.tsx` — update prop type + delete-guard.
- `frontend/src/routes/_public/players_.$slug.series.$seriesId.tsx` — new "see all" page.
- `frontend/tests/players.spec.ts` — add grouped-history + see-all E2E tests.

---

## Task 1: Backend — grouped `/history` endpoint

**Files:**
- Modify: `backend/app/models.py` (`PlayerResultWithQuiz` ~line 392; add new models after `PlayerHistory` ~line 404)
- Modify: `backend/app/crud.py` (`get_player_history` ~line 356)
- Modify: `backend/app/api/routes/players.py` (imports ~lines 12-43; history route ~line 160)
- Modify: `backend/tests/utils/quiz.py` (add helper after `create_approved_event` ~line 94)
- Test: `backend/tests/api/routes/test_players.py`

**Interfaces:**
- Produces (models):
  - `PlayerResultWithQuiz` gains `series_id: uuid.UUID | None`, `series_name: str | None`.
  - `PlayerSeriesGroup(series_id: uuid.UUID | None, series_name: str | None, results: list[PlayerResultWithQuiz], total_count: int)`.
  - `PlayerHistoryGrouped(data: list[PlayerSeriesGroup], total_events: int, wins: int, podiums: int)`.
- Produces (crud): `get_player_history_grouped(*, session: Session, player_id: uuid.UUID) -> PlayerHistoryGrouped`.
- Produces (helper): `create_approved_event_in_series(db, series_id=None, start_date=date(2024,1,1)) -> Quiz`.
- Route `GET /players/{player_id}/history` now returns `PlayerHistoryGrouped`.

- [ ] **Step 1: Add the test helper for series-scoped approved events**

In `backend/tests/utils/quiz.py`, add after `create_approved_event`:

```python
def create_approved_event_in_series(
    db: Session,
    series_id: uuid.UUID | None = None,
    start_date: date = date(2024, 1, 1),
) -> Quiz:
    user = create_random_user(db)
    quiz = crud.create_quiz(
        session=db,
        event_in=QuizCreate(
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

- [ ] **Step 2: Write failing tests for the grouped history shape**

Replace the three existing history tests (`test_get_player_history`, `test_get_player_history_empty`, `test_get_player_history_superuser_sees_unpublished`) so they expect the grouped shape, and add new tests. Add these to `backend/tests/api/routes/test_players.py`. Add `create_approved_event_in_series` and `create_random_series` to the existing `tests.utils.quiz` import block.

```python
def test_get_player_history_empty(client: TestClient, db: Session) -> None:
    player = create_published_player(db)
    r = client.get(f"{settings.API_V1_STR}/players/{player.id}/history")
    assert r.status_code == 200
    body = r.json()
    assert body["data"] == []
    assert body["total_events"] == 0
    assert body["wins"] == 0
    assert body["podiums"] == 0


def test_get_player_history_groups_by_series(client: TestClient, db: Session) -> None:
    player = create_published_player(db)
    series = create_random_series(db)
    event = create_approved_event_in_series(db, series_id=series.id)
    crud.create_quiz_results(
        session=db,
        event_id=event.id,
        results=[QuizResultCreate(player_id=player.id, final_rank=1, score=10.0)],
    )
    r = client.get(f"{settings.API_V1_STR}/players/{player.id}/history")
    assert r.status_code == 200
    body = r.json()
    assert body["total_events"] == 1
    assert body["wins"] == 1
    assert body["podiums"] == 1
    assert len(body["data"]) == 1
    group = body["data"][0]
    assert group["series_id"] == str(series.id)
    assert group["series_name"] == series.name
    assert group["total_count"] == 1
    entry = group["results"][0]
    assert entry["quiz_id"] == str(event.id)
    assert entry["series_id"] == str(series.id)
    assert entry["series_name"] == series.name


def test_get_player_history_ungrouped_bucket(client: TestClient, db: Session) -> None:
    player = create_published_player(db)
    event = create_approved_event_in_series(db, series_id=None)
    crud.create_quiz_results(
        session=db,
        event_id=event.id,
        results=[QuizResultCreate(player_id=player.id, final_rank=5, score=3.0)],
    )
    r = client.get(f"{settings.API_V1_STR}/players/{player.id}/history")
    body = r.json()
    assert len(body["data"]) == 1
    group = body["data"][0]
    assert group["series_id"] is None
    assert group["series_name"] is None
    assert group["total_count"] == 1


def test_get_player_history_caps_group_at_five(client: TestClient, db: Session) -> None:
    from datetime import date as _date

    player = create_published_player(db)
    series = create_random_series(db)
    for i in range(7):
        event = create_approved_event_in_series(
            db, series_id=series.id, start_date=_date(2024, 1, i + 1)
        )
        crud.create_quiz_results(
            session=db,
            event_id=event.id,
            results=[
                QuizResultCreate(player_id=player.id, final_rank=i + 1, score=float(i))
            ],
        )
    r = client.get(f"{settings.API_V1_STR}/players/{player.id}/history")
    group = r.json()["data"][0]
    assert group["total_count"] == 7
    assert len(group["results"]) == 5
    # newest first: Jan 7 down to Jan 3
    dates = [row["start_date"] for row in group["results"]]
    assert dates == sorted(dates, reverse=True)
    assert dates[0] == "2024-01-07"


def test_get_player_history_ungrouped_bucket_ordered_last(
    client: TestClient, db: Session
) -> None:
    from datetime import date as _date

    player = create_published_player(db)
    series = create_random_series(db)
    # series result is OLDER than the ungrouped result
    series_event = create_approved_event_in_series(
        db, series_id=series.id, start_date=_date(2024, 1, 1)
    )
    ungrouped_event = create_approved_event_in_series(
        db, series_id=None, start_date=_date(2024, 6, 1)
    )
    for ev in (series_event, ungrouped_event):
        crud.create_quiz_results(
            session=db,
            event_id=ev.id,
            results=[QuizResultCreate(player_id=player.id, final_rank=1, score=1.0)],
        )
    r = client.get(f"{settings.API_V1_STR}/players/{player.id}/history")
    groups = r.json()["data"]
    assert len(groups) == 2
    # "Other" bucket is last even though its result is more recent
    assert groups[0]["series_id"] == str(series.id)
    assert groups[-1]["series_id"] is None
```

Also update `test_get_player_history_superuser_sees_unpublished` (around line 276) to assert the grouped shape instead of the flat list:

```python
def test_get_player_history_superuser_sees_unpublished(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    player = create_random_player(db)  # is_published=False
    r = client.get(
        f"{settings.API_V1_STR}/players/{player.id}/history",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    assert r.json()["data"] == []
```

(If the existing version of that test asserts more, keep the 200 + empty-`data` intent; drop any `len(data["data"])` flat-shape assertions.)

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `cd backend && bash ./scripts/tests-start.sh -x -k "player_history"` (or `docker compose exec backend bash scripts/tests-start.sh -x -k player_history`)
Expected: FAIL — `PlayerHistoryGrouped` / `get_player_history_grouped` don't exist yet, or KeyError on `total_events`.

- [ ] **Step 4: Add the models**

In `backend/app/models.py`, update `PlayerResultWithQuiz` to add the two fields, and add the new models directly after `PlayerHistory`:

```python
class PlayerResultWithQuiz(SQLModel):
    result_id: uuid.UUID
    quiz_id: uuid.UUID
    quiz_name: str
    start_date: date
    end_date: date
    score: float
    final_rank: int | None = None
    country: str | None = None
    series_id: uuid.UUID | None = None
    series_name: str | None = None


class PlayerHistory(SQLModel):
    data: list[PlayerResultWithQuiz]


class PlayerSeriesGroup(SQLModel):
    series_id: uuid.UUID | None
    series_name: str | None
    results: list[PlayerResultWithQuiz]
    total_count: int


class PlayerHistoryGrouped(SQLModel):
    data: list[PlayerSeriesGroup]
    total_events: int
    wins: int
    podiums: int
```

(Keep `PlayerHistory` defined for now; it is removed from the route in Step 6. The `series-history` model is added in Task 2.)

- [ ] **Step 5: Implement `get_player_history_grouped` in crud**

In `backend/app/crud.py`, add after `get_player_history` (and import the new models `PlayerHistoryGrouped`, `PlayerResultWithQuiz`, `PlayerSeriesGroup` in the `from app.models import (...)` block; `QuizSeries` and `QuizStatus` are already imported):

```python
def get_player_history_grouped(
    *, session: Session, player_id: uuid.UUID
) -> PlayerHistoryGrouped:
    stmt = (
        select(QuizResult, Quiz, QuizSeries)
        .join(Quiz, QuizResult.quiz_id == Quiz.id)
        .join(QuizSeries, Quiz.series_id == QuizSeries.id, isouter=True)
        .where(QuizResult.player_id == player_id)
        .where(Quiz.status == QuizStatus.approved)
        .order_by(col(Quiz.start_date).desc())
    )
    rows = session.exec(stmt).all()

    groups: dict[uuid.UUID | None, list[PlayerResultWithQuiz]] = {}
    series_names: dict[uuid.UUID | None, str | None] = {}
    wins = 0
    podiums = 0
    for result, quiz, series in rows:
        key = quiz.series_id
        groups.setdefault(key, []).append(
            PlayerResultWithQuiz(
                result_id=result.id,
                quiz_id=quiz.id,
                quiz_name=quiz.name,
                start_date=quiz.start_date,
                end_date=quiz.end_date,
                score=result.score,
                final_rank=result.final_rank,
                country=result.country,
                series_id=quiz.series_id,
                series_name=series.name if series else None,
            )
        )
        series_names[key] = series.name if series else None
        if result.final_rank == 1:
            wins += 1
        if result.final_rank is not None and result.final_rank <= 3:
            podiums += 1

    # dict preserves insertion order (newest result first per group);
    # the ungrouped (None) bucket is always placed last.
    ordered_keys = [k for k in groups if k is not None]
    if None in groups:
        ordered_keys.append(None)

    data = [
        PlayerSeriesGroup(
            series_id=key,
            series_name=series_names[key],
            results=groups[key][:5],
            total_count=len(groups[key]),
        )
        for key in ordered_keys
    ]
    return PlayerHistoryGrouped(
        data=data, total_events=len(rows), wins=wins, podiums=podiums
    )
```

- [ ] **Step 6: Update the history route**

In `backend/app/api/routes/players.py`: change the import of `get_player_history` to `get_player_history_grouped`, replace `PlayerHistory`/`PlayerResultWithQuiz` usage in this route with `PlayerHistoryGrouped`, and rewrite the route body:

```python
@router.get("/{player_id}/history", response_model=PlayerHistoryGrouped)
def get_player_history_route(
    player_id: uuid.UUID, session: SessionDep, current_user: OptionalCurrentUser
) -> PlayerHistoryGrouped:
    player = session.get(Player, player_id)
    is_superuser = current_user is not None and current_user.is_superuser
    if not player or (not player.is_published and not is_superuser):
        raise HTTPException(status_code=404, detail="Player not found")
    return get_player_history_grouped(session=session, player_id=player_id)
```

Update the imports: add `PlayerHistoryGrouped` and `get_player_history_grouped`; remove `PlayerHistory` and `get_player_history` if no longer used elsewhere in the file (grep to confirm), and remove the now-unused `PlayerResultWithQuiz`/`QuizResult` imports only if nothing else in the file references them. Then delete the old `get_player_history` function from `crud.py` if it has no remaining references (`grep -rn get_player_history backend/`).

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd backend && bash ./scripts/tests-start.sh -x -k "player_history"`
Expected: PASS (all grouped-history tests green).

- [ ] **Step 8: Run linters**

Run: `cd backend && uv run prek run --all-files`
Expected: no errors (fix any ruff findings).

- [ ] **Step 9: Commit**

```bash
git add backend/app/models.py backend/app/crud.py backend/app/api/routes/players.py backend/tests/utils/quiz.py backend/tests/api/routes/test_players.py
git commit -m "feat(backend): group player history by series with per-group cap and aggregates"
```

---

## Task 2: Backend — paginated `series-history` endpoint

**Files:**
- Modify: `backend/app/models.py` (add `PlayerSeriesHistory` near the other player-history models)
- Modify: `backend/app/crud.py` (add `get_player_series_history`)
- Modify: `backend/app/api/routes/players.py` (add route + imports)
- Test: `backend/tests/api/routes/test_players.py`

**Interfaces:**
- Consumes: `create_approved_event_in_series`, `create_random_series` (Task 1); `PlayerResultWithQuiz` (Task 1).
- Produces (model): `PlayerSeriesHistory(data: list[PlayerResultWithQuiz], count: int, series_name: str | None)`.
- Produces (crud): `get_player_series_history(*, session, player_id, series_id: uuid.UUID | None, skip: int, limit: int) -> tuple[list[PlayerResultWithQuiz], int, str | None]`.
- Route `GET /players/{player_id}/series-history?series_id=&skip=&limit=` returns `PlayerSeriesHistory`.

- [ ] **Step 1: Write failing tests for series-history**

Add to `backend/tests/api/routes/test_players.py`:

```python
def test_series_history_paginates_within_series(
    client: TestClient, db: Session
) -> None:
    from datetime import date as _date

    player = create_published_player(db)
    series = create_random_series(db)
    for i in range(7):
        event = create_approved_event_in_series(
            db, series_id=series.id, start_date=_date(2024, 1, i + 1)
        )
        crud.create_quiz_results(
            session=db,
            event_id=event.id,
            results=[QuizResultCreate(player_id=player.id, final_rank=1, score=1.0)],
        )
    r = client.get(
        f"{settings.API_V1_STR}/players/{player.id}/series-history",
        params={"series_id": str(series.id), "skip": 0, "limit": 5},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 7
    assert body["series_name"] == series.name
    assert len(body["data"]) == 5
    assert body["data"][0]["start_date"] == "2024-01-07"  # newest first

    r2 = client.get(
        f"{settings.API_V1_STR}/players/{player.id}/series-history",
        params={"series_id": str(series.id), "skip": 5, "limit": 5},
    )
    assert len(r2.json()["data"]) == 2


def test_series_history_ungrouped_when_no_series_id(
    client: TestClient, db: Session
) -> None:
    player = create_published_player(db)
    series = create_random_series(db)
    grouped = create_approved_event_in_series(db, series_id=series.id)
    ungrouped = create_approved_event_in_series(db, series_id=None)
    for ev in (grouped, ungrouped):
        crud.create_quiz_results(
            session=db,
            event_id=ev.id,
            results=[QuizResultCreate(player_id=player.id, final_rank=1, score=1.0)],
        )
    r = client.get(
        f"{settings.API_V1_STR}/players/{player.id}/series-history"
    )
    body = r.json()
    assert body["count"] == 1
    assert body["series_name"] is None
    assert body["data"][0]["quiz_id"] == str(ungrouped.id)


def test_series_history_unpublished_returns_404(
    client: TestClient, db: Session
) -> None:
    player = create_random_player(db)  # unpublished
    r = client.get(f"{settings.API_V1_STR}/players/{player.id}/series-history")
    assert r.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && bash ./scripts/tests-start.sh -x -k "series_history"`
Expected: FAIL — route/model/crud not defined (404 for unknown path or import error).

- [ ] **Step 3: Add the `PlayerSeriesHistory` model**

In `backend/app/models.py`, after `PlayerHistoryGrouped`:

```python
class PlayerSeriesHistory(SQLModel):
    data: list[PlayerResultWithQuiz]
    count: int
    series_name: str | None = None
```

- [ ] **Step 4: Implement `get_player_series_history` in crud**

In `backend/app/crud.py` (add `PlayerSeriesHistory` to the model imports; `func` is already imported from `sqlalchemy`):

```python
def get_player_series_history(
    *,
    session: Session,
    player_id: uuid.UUID,
    series_id: uuid.UUID | None,
    skip: int,
    limit: int,
) -> tuple[list[PlayerResultWithQuiz], int, str | None]:
    base = (
        select(QuizResult, Quiz)
        .join(Quiz, QuizResult.quiz_id == Quiz.id)
        .where(QuizResult.player_id == player_id)
        .where(Quiz.status == QuizStatus.approved)
    )
    if series_id is None:
        base = base.where(col(Quiz.series_id).is_(None))
    else:
        base = base.where(Quiz.series_id == series_id)

    count = session.exec(
        select(func.count()).select_from(base.subquery())
    ).one()

    rows = session.exec(
        base.order_by(col(Quiz.start_date).desc()).offset(skip).limit(limit)
    ).all()

    series_name: str | None = None
    if series_id is not None:
        series = session.get(QuizSeries, series_id)
        series_name = series.name if series else None

    data = [
        PlayerResultWithQuiz(
            result_id=result.id,
            quiz_id=quiz.id,
            quiz_name=quiz.name,
            start_date=quiz.start_date,
            end_date=quiz.end_date,
            score=result.score,
            final_rank=result.final_rank,
            country=result.country,
            series_id=quiz.series_id,
            series_name=series_name,
        )
        for result, quiz in rows
    ]
    return data, count, series_name
```

- [ ] **Step 5: Add the route**

In `backend/app/api/routes/players.py` (add `PlayerSeriesHistory` + `get_player_series_history` to imports). Add the route **above** the catch-all `GET /{player_id}` route (defined ~line 186) so the literal `series-history` path isn't captured as a `player_id`:

```python
@router.get("/{player_id}/series-history", response_model=PlayerSeriesHistory)
def get_player_series_history_route(
    player_id: uuid.UUID,
    session: SessionDep,
    current_user: OptionalCurrentUser,
    series_id: uuid.UUID | None = None,
    skip: int = 0,
    limit: int = 50,
) -> PlayerSeriesHistory:
    player = session.get(Player, player_id)
    is_superuser = current_user is not None and current_user.is_superuser
    if not player or (not player.is_published and not is_superuser):
        raise HTTPException(status_code=404, detail="Player not found")
    data, count, series_name = get_player_series_history(
        session=session,
        player_id=player_id,
        series_id=series_id,
        skip=skip,
        limit=limit,
    )
    return PlayerSeriesHistory(data=data, count=count, series_name=series_name)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && bash ./scripts/tests-start.sh -x -k "series_history"`
Expected: PASS.

- [ ] **Step 7: Run full backend suite + linters**

Run: `cd backend && bash ./scripts/tests-start.sh && uv run prek run --all-files`
Expected: PASS, no lint errors.

- [ ] **Step 8: Commit**

```bash
git add backend/app/models.py backend/app/crud.py backend/app/api/routes/players.py backend/tests/api/routes/test_players.py
git commit -m "feat(backend): add paginated per-series player history endpoint"
```

---

## Task 3: Regenerate the frontend API client

**Files:**
- Modify: `frontend/openapi.json`, `frontend/src/client/` (generated)

**Interfaces:**
- Consumes: the two backend endpoints from Tasks 1-2.
- Produces: `PlayersService.getPlayerHistoryRoute` now returns `PlayerHistoryGrouped`; new `PlayersService.getPlayerSeriesHistoryRoute({ playerId, seriesId?, skip?, limit? })` returning `PlayerSeriesHistory`; generated types `PlayerHistoryGrouped`, `PlayerSeriesGroup`, `PlayerSeriesHistory`, updated `PlayerResultWithQuiz`.

- [ ] **Step 1: Ensure the backend stack is running with the new code**

Run: `docker compose up -d --build backend` (baked image — rebuild so the new schema is served), then confirm it's healthy: `docker compose logs backend | tail`.

- [ ] **Step 2: Regenerate the client**

Run: `bash ./scripts/generate-client.sh`
Expected: `frontend/openapi.json` and `frontend/src/client/` update; the script lints automatically.

- [ ] **Step 3: Verify the generated shapes**

Run: `grep -rn "PlayerHistoryGrouped\|PlayerSeriesGroup\|PlayerSeriesHistory\|getPlayerSeriesHistoryRoute" frontend/src/client/`
Expected: all four names present.

- [ ] **Step 4: Confirm the type-check now fails at the old call sites (expected)**

Run: `cd frontend && bunx tsc --noEmit`
Expected: errors in `PlayerProfile.tsx` / `players_.$slug.tsx` referencing `history.data` as a flat list. This is the migration to-do list handled in Task 4 — do not fix here.

- [ ] **Step 5: Commit**

```bash
git add frontend/openapi.json frontend/src/client
git commit -m "chore(frontend): regenerate client for grouped player history"
```

---

## Task 4: Frontend — shared columns + grouped profile

**Files:**
- Create: `frontend/src/components/Players/historyColumns.tsx`
- Modify: `frontend/src/components/Players/PlayerProfile.tsx`
- Modify: `frontend/src/routes/_public/players_.$slug.tsx`

**Interfaces:**
- Consumes: `PlayerHistoryGrouped`, `PlayerSeriesGroup`, `PlayerResultWithQuiz` from `@/client`; `DataTable` from `@/components/Common/DataTable`.
- Produces: `historyColumns: ColumnDef<PlayerResultWithQuiz>[]` (default export from the new module); `PlayerProfile` accepting `history: PlayerHistoryGrouped`.

- [ ] **Step 1: Extract shared history columns**

Create `frontend/src/components/Players/historyColumns.tsx` by moving the existing `historyColumns` array out of `PlayerProfile.tsx` verbatim, with its imports:

```tsx
import { Link } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"

import type { PlayerResultWithQuiz } from "@/client"
import { Badge } from "@/components/ui/badge"
import { countryName } from "@/lib/countries"

export const historyColumns: ColumnDef<PlayerResultWithQuiz>[] = [
  {
    accessorKey: "quiz_name",
    header: "Quiz",
    cell: ({ row }) => (
      <Link
        to="/quizzes/$id"
        params={{ id: row.original.quiz_id }}
        className="font-medium hover:underline"
      >
        {row.original.quiz_name}
      </Link>
    ),
  },
  {
    accessorKey: "start_date",
    header: "Date",
    cell: ({ row }) => row.original.start_date,
  },
  {
    accessorKey: "country",
    header: "Country",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {countryName(row.original.country) || "—"}
      </span>
    ),
  },
  {
    accessorKey: "score",
    header: "Score",
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.score}</span>
    ),
  },
  {
    accessorKey: "final_rank",
    header: "Rank",
    cell: ({ row }) => {
      const rank = row.original.final_rank
      if (!rank) return <span className="text-muted-foreground">—</span>
      if (rank === 1) return <Badge>1st</Badge>
      if (rank === 2) return <Badge variant="secondary">2nd</Badge>
      if (rank === 3) return <Badge variant="secondary">3rd</Badge>
      return <span className="text-muted-foreground">{rank}</span>
    },
  },
]
```

- [ ] **Step 2: Rewrite `PlayerProfile.tsx` to render per-series sections**

Replace the file body so it takes `history: PlayerHistoryGrouped`, reads aggregates, and renders one section per group with a "See all" link when `total_count > 5`:

```tsx
import { Link } from "@tanstack/react-router"

import type { PlayerHistoryGrouped, PlayerPublic } from "@/client"
import { historyColumns } from "@/components/Players/historyColumns"
import { DataTable } from "@/components/Common/DataTable"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { countryName } from "@/lib/countries"

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

interface PlayerProfileProps {
  player: PlayerPublic
  history: PlayerHistoryGrouped
}

export function PlayerProfile({ player, history }: PlayerProfileProps) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start gap-5">
        <Avatar className="h-20 w-20">
          {player.photo_url && <AvatarImage src={player.photo_url} />}
          <AvatarFallback className="text-2xl">
            {getInitials(player.display_name)}
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">
            {player.display_name}
          </h1>
          {player.countries && player.countries.length > 0 && (
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
          {player.bio && (
            <p className="text-sm text-muted-foreground mt-1">{player.bio}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Events", value: history.total_events },
          { label: "Wins", value: history.wins },
          { label: "Podiums", value: history.podiums },
        ].map(({ label, value }) => (
          <Card key={label}>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold tabular-nums">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col gap-8">
        <h2 className="text-lg font-semibold">Competition History</h2>
        {history.data.length === 0 ? (
          <p className="text-muted-foreground">No results yet.</p>
        ) : (
          history.data.map((group) => (
            <div
              key={group.series_id ?? "none"}
              className="flex flex-col gap-3"
            >
              <h3 className="text-base font-medium">
                {group.series_name ?? "Other"}
              </h3>
              <DataTable columns={historyColumns} data={group.results} />
              {group.total_count > 5 && (
                <Link
                  to="/players/$slug/series/$seriesId"
                  params={{
                    slug: player.slug ?? "",
                    seriesId: group.series_id ?? "none",
                  }}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  See all {group.total_count} results →
                </Link>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
```

Note: `player.slug` may be typed `string | null` in the client; the `?? ""` keeps types happy. Profiles are always reached by slug, so it is populated in practice.

- [ ] **Step 3: Update the route file's prop type and delete-guard**

In `frontend/src/routes/_public/players_.$slug.tsx`:
- Change the `import type { PlayerHistory, PlayerPublic }` to `import type { PlayerHistoryGrouped, PlayerPublic }`.
- Change `AdminControls`'s `history` prop type from `PlayerHistory` to `PlayerHistoryGrouped`.
- Change the delete-guard condition from `history.data.length === 0` to `history.total_events === 0` (appears once inside `AdminControls`).

- [ ] **Step 4: Type-check and lint**

Run: `cd frontend && bunx tsc --noEmit && bun run lint`
Expected: no errors.

- [ ] **Step 5: Verify visually (optional but recommended)**

With the stack running, open a player profile that has results in a series and confirm sections render. (Reference: memory note — stop the Docker frontend container if running local dev on port 5173.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Players/historyColumns.tsx frontend/src/components/Players/PlayerProfile.tsx frontend/src/routes/_public/players_.$slug.tsx
git commit -m "feat(frontend): group player profile history into per-series sections"
```

---

## Task 5: Frontend — "see all" per-series page

**Files:**
- Create: `frontend/src/routes/_public/players_.$slug.series.$seriesId.tsx`

**Interfaces:**
- Consumes: `PlayersService.getPlayerSeriesHistoryRoute`, `PlayersService.getPlayerBySlugRoute`, `historyColumns`; the `page` search param.
- Produces: route `/players/$slug/series/$seriesId`.

- [ ] **Step 1: Create the route file**

Model server-pagination on `frontend/src/routes/_public/players.tsx` (manual pagination table). Map `seriesId === "none"` to omitting `series_id`.

```tsx
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react"
import { z } from "zod"

import { type PlayerResultWithQuiz, PlayersService } from "@/client"
import { historyColumns } from "@/components/Players/historyColumns"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const PAGE_SIZE = 50

const searchSchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
})

export const Route = createFileRoute("/_public/players_/$slug/series/$seriesId")(
  {
    component: SeriesHistoryPage,
    validateSearch: searchSchema,
    head: () => ({ meta: [{ title: "Series results" }] }),
  },
)

const columns = historyColumns as ColumnDef<PlayerResultWithQuiz>[]

function SeriesHistoryPage() {
  const { slug, seriesId } = Route.useParams()
  const { page } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  const playerQuery = useQuery({
    queryKey: ["players", "slug", slug],
    queryFn: () => PlayersService.getPlayerBySlugRoute({ slug }),
  })
  const player = playerQuery.data

  const historyQuery = useQuery({
    queryKey: ["players", player?.id, "series-history", seriesId, page],
    queryFn: () =>
      PlayersService.getPlayerSeriesHistoryRoute({
        playerId: player!.id,
        seriesId: seriesId === "none" ? undefined : seriesId,
        skip: (page - 1) * PAGE_SIZE,
        limit: PAGE_SIZE,
      }),
    enabled: !!player,
    placeholderData: keepPreviousData,
  })

  const rows = historyQuery.data?.data ?? []
  const totalCount = historyQuery.data?.count ?? 0
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const showPagination = totalCount > PAGE_SIZE
  const seriesLabel =
    seriesId === "none" ? "Other" : (historyQuery.data?.series_name ?? "Series")

  const table = useReactTable({
    data: rows,
    columns,
    pageCount,
    state: { pagination: { pageIndex: page - 1, pageSize: PAGE_SIZE } },
    onPaginationChange: (updater) => {
      const next =
        typeof updater === "function"
          ? updater({ pageIndex: page - 1, pageSize: PAGE_SIZE })
          : updater
      navigate({ search: (prev) => ({ ...prev, page: next.pageIndex + 1 }) })
    },
    manualPagination: true,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        {player && (
          <Link
            to="/players/$slug"
            params={{ slug }}
            className="text-sm text-muted-foreground hover:underline"
          >
            ← {player.display_name}
          </Link>
        )}
        <h1 className="text-2xl font-bold tracking-tight">{seriesLabel}</h1>
        <p className="text-muted-foreground">
          All results {player ? `for ${player.display_name}` : ""} in this series
        </p>
      </div>

      {historyQuery.isPending ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow
                    key={headerGroup.id}
                    className="hover:bg-transparent"
                  >
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id}>
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.length ? (
                  table.getRowModel().rows.map((row) => (
                    <TableRow key={row.id}>
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={columns.length}
                      className="h-32 text-center text-muted-foreground"
                    >
                      No results.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {showPagination && (
            <div className="flex items-center justify-between gap-4 p-4 border-t bg-muted/20">
              <div className="flex items-center gap-x-1 text-sm text-muted-foreground">
                <span>Page</span>
                <span className="font-medium text-foreground">
                  {table.getState().pagination.pageIndex + 1}
                </span>
                <span>of</span>
                <span className="font-medium text-foreground">
                  {table.getPageCount()}
                </span>
              </div>
              <div className="flex items-center gap-x-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => table.setPageIndex(0)}
                  disabled={!table.getCanPreviousPage()}
                >
                  <span className="sr-only">Go to first page</span>
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => table.previousPage()}
                  disabled={!table.getCanPreviousPage()}
                >
                  <span className="sr-only">Go to previous page</span>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => table.nextPage()}
                  disabled={!table.getCanNextPage()}
                >
                  <span className="sr-only">Go to next page</span>
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                  disabled={!table.getCanNextPage()}
                >
                  <span className="sr-only">Go to last page</span>
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Regenerate the route tree + type-check**

Run: `cd frontend && bun run dev` briefly (TanStack regenerates `routeTree.gen.ts`) or `bunx tsr generate`, then `bunx tsc --noEmit && bun run lint`.
Expected: `routeTree.gen.ts` includes the new route; no type/lint errors. Confirm the `Link` in `PlayerProfile.tsx` (`to="/players/$slug/series/$seriesId"`) now type-checks against the generated route.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/routes/_public/players_.\$slug.series.\$seriesId.tsx frontend/src/routeTree.gen.ts
git commit -m "feat(frontend): add paginated see-all page for player results in a series"
```

---

## Task 6: Frontend E2E tests

**Files:**
- Modify: `frontend/tests/players.spec.ts`

**Interfaces:**
- Consumes: `PlayersService.createPlayerRoute`, `updatePlayerRoute`; `SeriesService.createSeriesRoute` (verify exact name in `frontend/src/client`); a quiz-creation + results path. Verify the client method names by grepping `frontend/src/client` before writing (e.g. `grep -rn "createSeries\|createQuiz\|createQuizResults\|approveQuiz" frontend/src/client`).

- [ ] **Step 1: Write the E2E test for grouped sections + see-all navigation**

Add a `test.describe` block to `frontend/tests/players.spec.ts`. Build a published player with a series containing 6 results via the authenticated client (mirroring the existing `beforeAll` auth pattern). Use the exact generated service method names confirmed by the grep above. Skeleton:

```ts
test.describe("Player history grouped by series", () => {
  let slug: string
  let seriesName: string

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()
    // 1. create + publish a player, set a slug
    // 2. create an organization + series (capture seriesName)
    // 3. create 6 approved quizzes in that series, each with a result for the player
    //    (use the confirmed SeriesService/QuizzesService method names)
    // assign `slug` and `seriesName`
  })

  test("profile shows the series section heading", async ({ page }) => {
    await page.goto(`/players/${slug}`)
    await page.waitForLoadState("networkidle")
    await expect(
      page.getByRole("heading", { name: seriesName }),
    ).toBeVisible()
  })

  test("see-all link appears past 5 results and navigates to the full list", async ({
    page,
  }) => {
    await page.goto(`/players/${slug}`)
    await page.waitForLoadState("networkidle")
    const seeAll = page.getByRole("link", { name: /See all 6 results/i })
    await expect(seeAll).toBeVisible()
    await seeAll.click()
    await expect(page).toHaveURL(new RegExp(`/players/${slug}/series/`))
    // full list shows all 6 rows (>5, so more than the profile's cap)
    await expect(page.locator("table tbody tr")).toHaveCount(6)
  })
})
```

Fill the `beforeAll` body with the real client calls once the method names are confirmed (do not leave it as a comment — the plan's grep in the Interfaces block tells you the names). If the codebase lacks a client path to create quizzes+results directly, create them the same way `backend`/upload flow does via the available `QuizzesService`/`UploadService` methods found in `frontend/src/client`.

- [ ] **Step 2: Run the E2E tests**

Ensure the stack is running and the local frontend container is stopped if running Playwright locally (memory note: port 5173 shadowing). Run: `cd frontend && bunx playwright test players.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/tests/players.spec.ts
git commit -m "test(frontend): e2e for grouped history sections and see-all page"
```

---

## Self-Review Notes (author)

- **Spec coverage:** grouping by series (T1), 5-cap + total_count (T1), aggregates for stat cards (T1), "Other" bucket + last-ordering (T1), see-all paginated endpoint (T2), replaced `/history` shape + client regen (T3), profile sections + see-all link + delete-guard fix (T4), see-all page with `"none"` sentinel (T5), backend + E2E tests (T1/T2/T6). All spec sections map to a task.
- **Type consistency:** `PlayerHistoryGrouped`/`PlayerSeriesGroup`/`PlayerSeriesHistory` and `get_player_history_grouped`/`get_player_series_history` are used with identical signatures across tasks. Frontend consumes the codegen'd names `getPlayerHistoryRoute` (now grouped) and `getPlayerSeriesHistoryRoute`.
- **Known verification point:** exact generated frontend client method names for series/quiz creation in Task 6 must be confirmed by grep before writing (the plan instructs this rather than guessing).
