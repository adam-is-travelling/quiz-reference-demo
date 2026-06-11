# Quiz Round Formats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `QuizFormat` entity defining named rounds, store per-round scores on `EventResult`, surface round columns in the results table, and provide an admin page to manage formats.

**Architecture:** `QuizFormat` is a new first-class DB table. `QuizEvent` drops its freeform `format` JSON column in favour of a `format_id` FK. `EventResult` gains 20 nullable float columns (`round_1`…`round_20`) serialised to/from a `round_scores` list in the API. The frontend renders dynamic columns from `format.rounds` and extends the upload wizard for round column mapping.

**Tech Stack:** Python/FastAPI, SQLModel, Alembic, React/TypeScript, TanStack Router/Query, shadcn/ui, `@hey-api/openapi-ts` generated client.

---

## File Map

**Backend — create:**
- `backend/app/api/routes/formats.py`
- `backend/tests/api/routes/test_formats.py`

**Backend — modify:**
- `backend/app/models.py` — add QuizFormat models; update QuizEvent (format_id replaces format JSON); update EventResult (20 round columns); update result public models
- `backend/app/crud.py` — add format CRUD; update `create_event_results` and `update_event_result` for round_scores
- `backend/app/api/routes/events.py` — build nested format on event reads; serialise/deserialise round_scores; validate round_scores on submit
- `backend/app/api/main.py` — register formats router
- `backend/tests/conftest.py` — add QuizFormat to teardown
- `backend/tests/utils/quiz.py` — add `create_random_format`
- `backend/tests/api/routes/test_events.py` — update `test_create_event_as_organizer`; add round_scores tests

**Frontend — create:**
- `frontend/src/routes/_layout/admin_.formats.tsx`
- `frontend/src/components/Admin/FormatDialog.tsx`

**Frontend — modify:**
- `frontend/src/components/Sidebar/AppSidebar.tsx` — add Formats nav item
- `frontend/src/components/Events/EventResultsTable.tsx` — dynamic round columns
- `frontend/src/routes/_public/events_.$id.tsx` — pass format to table
- `frontend/src/routes/_layout/admin_.events_.$id.tsx` — dynamic round columns in admin table
- `frontend/src/components/Events/MetadataEditDialog.tsx` — format dropdown
- `frontend/src/components/Upload/types.ts` — add `selectedFormat`, update `ColumnMapping`, remove old format_* fields from `EventMeta`
- `frontend/src/components/Upload/steps/Step1EventMeta.tsx` — replace format_rounds/questions/categories with format_id picker; store selectedFormat in state
- `frontend/src/components/Upload/steps/Step3ColumnMapping.tsx` — round column mapping selectors
- `frontend/src/components/Upload/steps/Step5Preview.tsx` — include round_scores in submission; remove buildEventMeta format JSON
- `frontend/openapi.json` + `frontend/src/client/` — regenerated

---

## Task 1: Add QuizFormat models to models.py

**Files:**
- Modify: `backend/app/models.py`

- [ ] **Step 1: Add QuizFormat section to models.py**

Insert this block after the `OrganizationsPublic` class (before the QuizSeries section):

```python
# ---------------------------------------------------------------------------
# QuizFormat
# ---------------------------------------------------------------------------

class QuizFormatBase(SQLModel):
    name: str = Field(max_length=255)
    description: str | None = Field(default=None)
    rounds: list[str] = Field(sa_column=Column(JSON, nullable=False))


class QuizFormatCreate(QuizFormatBase):
    pass


class QuizFormatUpdate(SQLModel):
    name: str | None = Field(default=None, max_length=255)
    description: str | None = None
    rounds: list[str] | None = None


class QuizFormat(QuizFormatBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)


class QuizFormatPublic(QuizFormatBase):
    id: uuid.UUID


class QuizFormatsPublic(SQLModel):
    data: list[QuizFormatPublic]
    count: int
```

- [ ] **Step 2: Update QuizEvent models — replace `format` JSON with `format_id`**

In `models.py`, replace the `QuizEventCreate`, `QuizEventUpdate`, `QuizEvent`, and `QuizEventPublic` classes:

```python
class QuizEventCreate(QuizEventBase):
    format_id: uuid.UUID | None = None
    series_id: uuid.UUID | None = None
    organization_id: uuid.UUID | None = None


class QuizEventUpdate(SQLModel):
    name: str | None = Field(default=None, max_length=255)
    start_date: date | None = None
    end_date: date | None = None
    description: str | None = None
    organizer_name: str | None = Field(default=None, max_length=255)
    format_id: uuid.UUID | None = None
    series_id: uuid.UUID | None = None
    organization_id: uuid.UUID | None = None


class QuizEvent(QuizEventBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    status: EventStatus = Field(default=EventStatus.pending)
    submitted_by_id: uuid.UUID = Field(foreign_key="user.id", ondelete="CASCADE")
    series_id: uuid.UUID | None = Field(
        default=None, foreign_key="quizseries.id", ondelete="SET NULL"
    )
    organization_id: uuid.UUID | None = Field(
        default=None, foreign_key="organization.id", ondelete="SET NULL"
    )
    format_id: uuid.UUID | None = Field(
        default=None, foreign_key="quizformat.id", ondelete="SET NULL"
    )
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),
    )


class QuizEventPublic(QuizEventBase):
    id: uuid.UUID
    status: EventStatus
    submitted_by_id: uuid.UUID
    series_id: uuid.UUID | None = None
    organization_id: uuid.UUID | None = None
    format_id: uuid.UUID | None = None
    format: QuizFormatPublic | None = None
    created_at: datetime | None = None
```

- [ ] **Step 3: Update EventResult models — add 20 round columns + round_scores on public models**

Replace `EventResult`, `EventResultCreate`, `EventResultUpdate`, `EventResultPublic`, and `EventResultWithPlayer` in `models.py`:

```python
class EventResultCreate(SQLModel):
    player_id: uuid.UUID
    score: float
    round_scores: list[float | None] | None = None


class EventResultUpdate(SQLModel):
    score: float | None = None
    round_scores: list[float | None] | None = None


class EventResult(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("event_id", "player_id"),)
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    event_id: uuid.UUID = Field(foreign_key="quizevent.id", ondelete="CASCADE")
    player_id: uuid.UUID = Field(foreign_key="player.id", ondelete="CASCADE")
    score: float
    final_rank: int | None = None
    round_1: float | None = None
    round_2: float | None = None
    round_3: float | None = None
    round_4: float | None = None
    round_5: float | None = None
    round_6: float | None = None
    round_7: float | None = None
    round_8: float | None = None
    round_9: float | None = None
    round_10: float | None = None
    round_11: float | None = None
    round_12: float | None = None
    round_13: float | None = None
    round_14: float | None = None
    round_15: float | None = None
    round_16: float | None = None
    round_17: float | None = None
    round_18: float | None = None
    round_19: float | None = None
    round_20: float | None = None


class EventResultPublic(SQLModel):
    id: uuid.UUID
    event_id: uuid.UUID
    player_id: uuid.UUID
    score: float
    final_rank: int | None = None
    round_scores: list[float | None] | None = None


class EventResultsPublic(SQLModel):
    data: list[EventResultPublic]
    count: int


class EventResultWithPlayer(SQLModel):
    id: uuid.UUID
    event_id: uuid.UUID
    player_id: uuid.UUID
    player_display_name: str
    player_slug: str | None = None
    score: float
    final_rank: int | None = None
    round_scores: list[float | None] | None = None


class EventResultsWithPlayersPublic(SQLModel):
    data: list[EventResultWithPlayer]
    count: int
```

Also update `ResolvedResultRow` to carry round_scores:

```python
class ResolvedResultRow(SQLModel):
    player_id: uuid.UUID | None = None
    player_create: PlayerCreate | None = None
    score: float | None = None
    round_scores: list[float | None] | None = None
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/models.py
git commit -m "feat: add QuizFormat models, format_id on QuizEvent, round columns on EventResult"
```

---

## Task 2: Alembic migration

**Files:**
- Create: `backend/app/alembic/versions/<hash>_add_quizformat_round_scores.py` (autogenerated)

- [ ] **Step 1: Generate the migration (run inside the backend container)**

```bash
docker compose exec backend alembic revision --autogenerate -m "add_quizformat_round_scores"
```

Expected: a new file created in `backend/app/alembic/versions/`.

- [ ] **Step 2: Review the generated migration**

Open the generated file and verify it:
- Creates `quizformat` table with `id`, `name`, `description`, `rounds` (JSON)
- Adds `format_id` column to `quizevent` (nullable UUID FK → `quizformat.id`)
- Drops `format` JSON column from `quizevent`
- Adds `round_1`…`round_20` nullable float columns to `eventresult`

- [ ] **Step 3: Apply the migration**

```bash
docker compose exec backend alembic upgrade head
```

Expected output ends with `Running upgrade ... -> <new_rev>, add_quizformat_round_scores`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/alembic/versions/
git commit -m "feat: migration for quizformat table and eventresult round columns"
```

---

## Task 3: QuizFormat CRUD

**Files:**
- Modify: `backend/app/crud.py`

- [ ] **Step 1: Add format CRUD functions to crud.py**

Add this section after the `update_organization` function, before `# --- QuizSeries ---`:

```python
# --- QuizFormat ---


def create_format(*, session: Session, format_in: QuizFormatCreate) -> QuizFormat:
    fmt = QuizFormat.model_validate(format_in)
    session.add(fmt)
    session.commit()
    session.refresh(fmt)
    return fmt


def update_format(
    *, session: Session, db_format: QuizFormat, format_in: QuizFormatUpdate
) -> QuizFormat:
    db_format.sqlmodel_update(format_in.model_dump(exclude_unset=True))
    session.add(db_format)
    session.commit()
    session.refresh(db_format)
    return db_format
```

- [ ] **Step 2: Update the crud.py imports to include the new models**

Add to the import block at the top of `crud.py`:

```python
from app.models import (
    EventResult,
    EventResultCreate,
    EventResultUpdate,   # add this
    EventStatus,
    Organization,
    OrganizationCreate,
    OrganizationUpdate,
    Player,
    PlayerCreate,
    PlayerUpdate,
    QuizEvent,
    QuizEventCreate,
    QuizEventUpdate,
    QuizFormat,           # add this
    QuizFormatCreate,     # add this
    QuizFormatUpdate,     # add this
    QuizSeries,
    QuizSeriesCreate,
    QuizSeriesUpdate,
    User,
    UserCreate,
    UserUpdate,
)
```

- [ ] **Step 3: Update `create_event_results` to handle round_scores**

Replace the `create_event_results` function body with:

```python
def create_event_results(
    *, session: Session, event_id: uuid.UUID, results: list[EventResultCreate]
) -> list[EventResult]:
    db_results = []
    for r in results:
        existing = session.exec(
            select(EventResult)
            .where(EventResult.event_id == event_id)
            .where(EventResult.player_id == r.player_id)
        ).first()
        if existing:
            existing.score = r.score
            _apply_round_scores(existing, r.round_scores or [])
            session.add(existing)
            db_results.append(existing)
        else:
            result = EventResult(
                event_id=event_id,
                player_id=r.player_id,
                score=r.score,
            )
            _apply_round_scores(result, r.round_scores or [])
            session.add(result)
            db_results.append(result)
    session.commit()
    _recompute_ranks(session=session, event_id=event_id)
    for result in db_results:
        session.refresh(result)
    return db_results
```

Add the helper above `create_event_results`:

```python
def _apply_round_scores(result: EventResult, round_scores: list[float | None]) -> None:
    for i in range(1, 21):
        idx = i - 1
        setattr(result, f"round_{i}", round_scores[idx] if idx < len(round_scores) else None)
```

- [ ] **Step 4: Update `update_event_result` to handle round_scores and use correct type**

Replace the `update_event_result` function:

```python
def update_event_result(
    *, session: Session, db_result: EventResult, result_in: EventResultUpdate
) -> EventResult:
    data = result_in.model_dump(exclude_unset=True)
    round_scores = data.pop("round_scores", None)
    db_result.sqlmodel_update(data)
    if round_scores is not None:
        _apply_round_scores(db_result, round_scores)
    session.add(db_result)
    session.commit()
    _recompute_ranks(session=session, event_id=db_result.event_id)
    session.refresh(db_result)
    return db_result
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/crud.py
git commit -m "feat: format CRUD, round_scores helpers in event result CRUD"
```

---

## Task 4: Formats API router

**Files:**
- Create: `backend/app/api/routes/formats.py`
- Modify: `backend/app/api/main.py`

- [ ] **Step 1: Create `backend/app/api/routes/formats.py`**

```python
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import func, select

from app import crud
from app.api.deps import CurrentUser, SessionDep
from app.models import (
    QuizEvent,
    QuizFormat,
    QuizFormatCreate,
    QuizFormatPublic,
    QuizFormatsPublic,
    QuizFormatUpdate,
)

router = APIRouter(prefix="/formats", tags=["formats"])


@router.get("/", response_model=QuizFormatsPublic)
def read_formats(session: SessionDep, skip: int = 0, limit: int = 100) -> Any:
    count = session.exec(select(func.count()).select_from(QuizFormat)).one()
    formats = session.exec(select(QuizFormat).offset(skip).limit(limit)).all()
    return QuizFormatsPublic(data=formats, count=count)


@router.get("/{id}", response_model=QuizFormatPublic)
def read_format(session: SessionDep, id: uuid.UUID) -> Any:
    fmt = session.get(QuizFormat, id)
    if not fmt:
        raise HTTPException(status_code=404, detail="Format not found")
    return fmt


@router.post("/", response_model=QuizFormatPublic)
def create_format(
    *, session: SessionDep, current_user: CurrentUser, format_in: QuizFormatCreate
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    if not format_in.rounds or len(format_in.rounds) > 20:
        raise HTTPException(
            status_code=422, detail="rounds must have 1–20 entries"
        )
    return crud.create_format(session=session, format_in=format_in)


@router.patch("/{id}", response_model=QuizFormatPublic)
def update_format(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    format_in: QuizFormatUpdate,
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    fmt = session.get(QuizFormat, id)
    if not fmt:
        raise HTTPException(status_code=404, detail="Format not found")
    if format_in.rounds is not None and (
        len(format_in.rounds) == 0 or len(format_in.rounds) > 20
    ):
        raise HTTPException(
            status_code=422, detail="rounds must have 1–20 entries"
        )
    return crud.update_format(session=session, db_format=fmt, format_in=format_in)


@router.delete("/{id}")
def delete_format(
    *, session: SessionDep, current_user: CurrentUser, id: uuid.UUID
) -> dict[str, str]:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    fmt = session.get(QuizFormat, id)
    if not fmt:
        raise HTTPException(status_code=404, detail="Format not found")
    in_use = session.exec(
        select(QuizEvent).where(QuizEvent.format_id == id).limit(1)
    ).first()
    if in_use:
        raise HTTPException(
            status_code=409, detail="Format is in use by one or more events"
        )
    session.delete(fmt)
    session.commit()
    return {"message": "Format deleted successfully"}
```

- [ ] **Step 2: Register the formats router in `backend/app/api/main.py`**

```python
from fastapi import APIRouter

from app.api.routes import events, formats, login, organizations, players, private, series, users, utils
from app.core.config import settings

api_router = APIRouter()
api_router.include_router(login.router)
api_router.include_router(users.router)
api_router.include_router(utils.router)
api_router.include_router(organizations.router)
api_router.include_router(formats.router)
api_router.include_router(series.router)
api_router.include_router(players.router)
api_router.include_router(events.router)

if settings.ENVIRONMENT == "local":
    api_router.include_router(private.router)
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/routes/formats.py backend/app/api/main.py
git commit -m "feat: formats CRUD API router"
```

---

## Task 5: Update events router for format_id and round_scores

**Files:**
- Modify: `backend/app/api/routes/events.py`

- [ ] **Step 1: Add round_scores helpers and `_event_public` builder at the top of events.py**

Add these helpers after the imports. Also add `Session` to the sqlmodel import line so it reads: `from sqlmodel import Session, col, func, select`.

```python
def _get_round_scores(result: EventResult, num_rounds: int) -> list[float | None] | None:
    if num_rounds == 0:
        return None
    return [getattr(result, f"round_{i}") for i in range(1, num_rounds + 1)]


def _event_public(event: QuizEvent, session: Session) -> QuizEventPublic:
    fmt = session.get(QuizFormat, event.format_id) if event.format_id else None
    return QuizEventPublic(
        **event.model_dump(exclude={"format_id"}),
        format_id=event.format_id,
        format=QuizFormatPublic.model_validate(fmt) if fmt else None,
    )
```

- [ ] **Step 2: Update the imports in events.py**

Replace the models import block:

```python
from app.models import (
    EventResult,
    EventResultCreate,
    EventResultPublic,
    EventResultsPublic,
    EventResultUpdate,
    EventResultWithPlayer,
    EventResultsWithPlayersPublic,
    EventStatus,
    ParsedResultWithCandidates,
    ParseResultsRequest,
    ParseResultsResponse,
    Player,
    PlayerPublic,
    PlayerSearchResult,
    QuizEvent,
    QuizEventCreate,
    QuizEventPublic,
    QuizEventsPublic,
    QuizEventUpdate,
    QuizFormat,
    QuizFormatPublic,
    SubmitMode,
    SubmitResultsRequest,
)
```

- [ ] **Step 3: Update `read_event` to return nested format**

Replace the `read_event` endpoint:

```python
@router.get("/{id}", response_model=QuizEventPublic)
def read_event(
    session: SessionDep, current_user: OptionalCurrentUser, id: uuid.UUID
) -> Any:
    event = session.get(QuizEvent, id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    is_superuser = current_user is not None and current_user.is_superuser
    if event.status != EventStatus.approved and not is_superuser:
        raise HTTPException(status_code=404, detail="Event not found")
    return _event_public(event, session)
```

- [ ] **Step 4: Update `read_events` list endpoint to include nested format**

Replace the return in `read_events`:

```python
    return QuizEventsPublic(
        data=[_event_public(e, session) for e in events],
        count=count,
    )
```

- [ ] **Step 5: Update `create_event` and `update_event` to return nested format**

```python
@router.post("/", response_model=QuizEventPublic)
def create_event(
    *, session: SessionDep, current_user: CurrentOrganizer, event_in: QuizEventCreate
) -> Any:
    event = crud.create_event(
        session=session, event_in=event_in, submitted_by_id=current_user.id
    )
    return _event_public(event, session)


@router.patch("/{id}", response_model=QuizEventPublic)
def update_event(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    event_in: QuizEventUpdate,
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    event = session.get(QuizEvent, id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    event = crud.update_event(session=session, db_event=event, event_in=event_in)
    return _event_public(event, session)
```

Also update `approve_event`, `reject_event`, and `set_event_pending` to return `_event_public(...)`:

```python
@router.post("/{id}/approve", response_model=QuizEventPublic)
def approve_event(...) -> Any:
    ...
    return _event_public(crud.approve_event(session=session, db_event=event), session)

@router.post("/{id}/reject", response_model=QuizEventPublic)
def reject_event(...) -> Any:
    ...
    return _event_public(crud.reject_event(session=session, db_event=event), session)

@router.post("/{id}/set-pending", response_model=QuizEventPublic)
def set_event_pending(...) -> Any:
    ...
    return _event_public(crud.set_event_pending(session=session, db_event=event), session)
```

- [ ] **Step 6: Update `read_event_results_with_players` to serialise round_scores**

Replace the endpoint body:

```python
@router.get("/{id}/results/with-players", response_model=EventResultsWithPlayersPublic)
def read_event_results_with_players(
    session: SessionDep, current_user: OptionalCurrentUser, id: uuid.UUID
) -> Any:
    event = session.get(QuizEvent, id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    is_superuser = current_user is not None and current_user.is_superuser
    if event.status != EventStatus.approved and not is_superuser:
        raise HTTPException(status_code=404, detail="Event not found")
    fmt = session.get(QuizFormat, event.format_id) if event.format_id else None
    num_rounds = len(fmt.rounds) if fmt else 0
    rows = session.exec(
        select(EventResult, Player)
        .join(Player, EventResult.player_id == Player.id)
        .where(EventResult.event_id == id)
        .order_by(EventResult.final_rank.asc(), EventResult.score.desc())
    ).all()
    data = [
        EventResultWithPlayer(
            id=r.id,
            event_id=r.event_id,
            player_id=r.player_id,
            player_display_name=p.display_name,
            player_slug=p.slug,
            score=r.score,
            final_rank=r.final_rank,
            round_scores=_get_round_scores(r, num_rounds),
        )
        for r, p in rows
    ]
    return EventResultsWithPlayersPublic(data=data, count=len(data))
```

- [ ] **Step 7: Update `submit_results` to validate and store round_scores**

Replace the `submit_results` endpoint body:

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

    fmt = session.get(QuizFormat, event.format_id) if event.format_id else None
    max_rounds = len(fmt.rounds) if fmt else 0

    if request.mode == SubmitMode.replace:
        existing = session.exec(select(EventResult).where(EventResult.event_id == id)).all()
        for r in existing:
            session.delete(r)
        session.flush()

    creates: list[EventResultCreate] = []
    for row in request.results:
        if row.round_scores is not None:
            if max_rounds == 0:
                raise HTTPException(
                    status_code=400,
                    detail="Event has no format assigned; round_scores not accepted",
                )
            if len(row.round_scores) > max_rounds:
                raise HTTPException(
                    status_code=400,
                    detail=f"round_scores length {len(row.round_scores)} exceeds format round count {max_rounds}",
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
            EventResultCreate(
                player_id=player_id,
                score=row.score,
                round_scores=row.round_scores,
            )
        )
    crud.create_event_results(session=session, event_id=id, results=creates)
    all_results = session.exec(
        select(EventResult).where(EventResult.event_id == id)
    ).all()
    fmt_again = session.get(QuizFormat, event.format_id) if event.format_id else None
    num_rounds = len(fmt_again.rounds) if fmt_again else 0
    return EventResultsPublic(
        data=[
            EventResultPublic(
                id=r.id,
                event_id=r.event_id,
                player_id=r.player_id,
                score=r.score,
                final_rank=r.final_rank,
                round_scores=_get_round_scores(r, num_rounds),
            )
            for r in all_results
        ],
        count=len(all_results),
    )
```

- [ ] **Step 8: Update `update_event_result` endpoint to use `EventResultUpdate`**

```python
@router.patch("/{event_id}/results/{result_id}", response_model=EventResultPublic)
def update_event_result(
    *,
    event_id: uuid.UUID,
    result_id: uuid.UUID,
    result_in: EventResultUpdate,
    session: SessionDep,
    current_user: CurrentSuperuser,
) -> Any:
    db_result = session.get(EventResult, result_id)
    if not db_result or db_result.event_id != event_id:
        raise HTTPException(status_code=404, detail="Event result not found")
    result = crud.update_event_result(session=session, db_result=db_result, result_in=result_in)
    event = session.get(QuizEvent, event_id)
    fmt = session.get(QuizFormat, event.format_id) if event and event.format_id else None
    num_rounds = len(fmt.rounds) if fmt else 0
    return EventResultPublic(
        id=result.id,
        event_id=result.event_id,
        player_id=result.player_id,
        score=result.score,
        final_rank=result.final_rank,
        round_scores=_get_round_scores(result, num_rounds),
    )
```

- [ ] **Step 9: Commit**

```bash
git add backend/app/api/routes/events.py
git commit -m "feat: events router — format_id, nested format, round_scores serialisation"
```

---

## Task 6: Backend tests

**Files:**
- Modify: `backend/tests/conftest.py`
- Modify: `backend/tests/utils/quiz.py`
- Create: `backend/tests/api/routes/test_formats.py`
- Modify: `backend/tests/api/routes/test_events.py`

- [ ] **Step 1: Update conftest.py teardown to include QuizFormat**

In `backend/tests/conftest.py`, update the model list in both the `pre` snapshot and the cleanup loop:

```python
from app.models import EventResult, Organization, Player, QuizEvent, QuizFormat, QuizSeries, User

# snapshot
pre: dict[type, set] = {
    model: {r.id for r in session.exec(select(model)).all()}
    for model in (EventResult, QuizEvent, QuizFormat, QuizSeries, Player, Organization, User)
}

# teardown
for model in (EventResult, QuizEvent, QuizFormat, QuizSeries, Player, Organization, User):
    stmt = delete(model)
    if pre[model]:
        stmt = stmt.where(~col(model.id).in_(pre[model]))
    session.execute(stmt)
```

- [ ] **Step 2: Add `create_random_format` to `tests/utils/quiz.py`**

Add to `backend/tests/utils/quiz.py`:

```python
from app.models import (
    ...
    QuizFormat,
    QuizFormatCreate,
)

def create_random_format(db: Session, num_rounds: int = 3) -> QuizFormat:
    from app import crud
    return crud.create_format(
        session=db,
        format_in=QuizFormatCreate(
            name=random_lower_string(),
            rounds=[f"Round {i+1}" for i in range(num_rounds)],
        ),
    )
```

- [ ] **Step 3: Write failing tests in `test_formats.py`**

Create `backend/tests/api/routes/test_formats.py`:

```python
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete, select

from app.core.config import settings
from app.models import QuizFormat
from tests.utils.quiz import create_random_format


@pytest.fixture(autouse=True)
def clean_format_data(db: Session) -> Generator[None, None, None]:
    pre = {r.id for r in db.exec(select(QuizFormat)).all()}
    yield
    db.expire_all()
    new_ids = {r.id for r in db.exec(select(QuizFormat)).all()} - pre
    if new_ids:
        db.execute(delete(QuizFormat).where(col(QuizFormat.id).in_(new_ids)))
    db.commit()


def test_read_formats_public(client: TestClient) -> None:
    response = client.get(f"{settings.API_V1_STR}/formats/")
    assert response.status_code == 200
    body = response.json()
    assert "data" in body
    assert "count" in body


def test_create_format_as_superuser(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    data = {"name": "UK Format", "rounds": ["General", "Music", "Picture"]}
    response = client.post(
        f"{settings.API_V1_STR}/formats/",
        headers=superuser_token_headers,
        json=data,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "UK Format"
    assert body["rounds"] == ["General", "Music", "Picture"]
    assert "id" in body


def test_create_format_unauthenticated_rejected(client: TestClient) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/formats/",
        json={"name": "Test", "rounds": ["R1"]},
    )
    assert response.status_code == 401


def test_create_format_too_many_rounds(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/formats/",
        headers=superuser_token_headers,
        json={"name": "Too Many", "rounds": [f"R{i}" for i in range(21)]},
    )
    assert response.status_code == 422


def test_read_format_by_id(client: TestClient, db: Session) -> None:
    fmt = create_random_format(db)
    response = client.get(f"{settings.API_V1_STR}/formats/{fmt.id}")
    assert response.status_code == 200
    assert response.json()["id"] == str(fmt.id)


def test_read_format_not_found(client: TestClient) -> None:
    import uuid
    response = client.get(f"{settings.API_V1_STR}/formats/{uuid.uuid4()}")
    assert response.status_code == 404


def test_update_format(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    fmt = create_random_format(db)
    response = client.patch(
        f"{settings.API_V1_STR}/formats/{fmt.id}",
        headers=superuser_token_headers,
        json={"name": "Updated Name"},
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Updated Name"


def test_delete_format(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    fmt = create_random_format(db)
    response = client.delete(
        f"{settings.API_V1_STR}/formats/{fmt.id}",
        headers=superuser_token_headers,
    )
    assert response.status_code == 200


def test_delete_format_blocked_when_in_use(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    from tests.utils.quiz import create_random_event
    from app.models import QuizEvent
    fmt = create_random_format(db)
    event = create_random_event(db)
    event.format_id = fmt.id
    db.add(event)
    db.commit()
    response = client.delete(
        f"{settings.API_V1_STR}/formats/{fmt.id}",
        headers=superuser_token_headers,
    )
    assert response.status_code == 409
```

- [ ] **Step 4: Run format tests and confirm they pass**

```bash
docker compose exec backend bash scripts/tests-start.sh tests/api/routes/test_formats.py -v
```

Expected: all tests pass.

- [ ] **Step 5: Update `test_create_event_as_organizer` in test_events.py**

The old test sends `"format": {"questions": 240, ...}` which no longer exists. Update it to use `format_id: null` (or omit format entirely), and remove the assertion on `content["format"]["rounds"]`:

```python
def test_create_event_as_organizer(
    client: TestClient, organizer_token_headers: dict[str, str]
) -> None:
    data = {
        "name": "Irish Quiz Championships 2025",
        "start_date": "2025-03-01",
        "end_date": "2025-03-02",
        "organizer_name": "Quiz Ireland",
        "description": "Annual Irish quiz",
    }
    response = client.post(
        f"{settings.API_V1_STR}/events/",
        headers=organizer_token_headers,
        json=data,
    )
    assert response.status_code == 200
    content = response.json()
    assert content["name"] == "Irish Quiz Championships 2025"
    assert content["status"] == "pending"
    assert content["format"] is None
```

- [ ] **Step 6: Add round_scores tests to test_events.py**

Add these test functions to `test_events.py`:

```python
def test_event_returns_nested_format(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    from tests.utils.quiz import create_random_format
    fmt = create_random_format(db, num_rounds=3)
    event = create_approved_event(db)
    event.format_id = fmt.id
    db.add(event)
    db.commit()
    response = client.get(f"{settings.API_V1_STR}/events/{event.id}")
    assert response.status_code == 200
    body = response.json()
    assert body["format_id"] == str(fmt.id)
    assert body["format"]["rounds"] == ["Round 1", "Round 2", "Round 3"]


def test_submit_and_retrieve_round_scores(
    client: TestClient,
    organizer_token_headers: dict[str, str],
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    from tests.utils.quiz import create_random_format
    fmt = create_random_format(db, num_rounds=3)
    event = create_random_event(db)
    event.format_id = fmt.id
    db.add(event)
    db.commit()
    player = create_random_player(db)

    response = client.post(
        f"{settings.API_V1_STR}/events/{event.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "player_id": str(player.id),
                    "score": 27.0,
                    "round_scores": [10.0, 9.0, 8.0],
                }
            ],
            "mode": "replace",
        },
    )
    assert response.status_code == 200

    # approve event so public endpoint returns it
    client.post(
        f"{settings.API_V1_STR}/events/{event.id}/approve",
        headers=superuser_token_headers,
    )

    resp = client.get(f"{settings.API_V1_STR}/events/{event.id}/results/with-players")
    assert resp.status_code == 200
    result = resp.json()["data"][0]
    assert result["round_scores"] == [10.0, 9.0, 8.0]
    assert result["score"] == 27.0


def test_round_scores_rejected_without_format(
    client: TestClient,
    organizer_token_headers: dict[str, str],
    db: Session,
) -> None:
    event = create_random_event(db)
    player = create_random_player(db)
    response = client.post(
        f"{settings.API_V1_STR}/events/{event.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "player_id": str(player.id),
                    "score": 10.0,
                    "round_scores": [5.0, 5.0],
                }
            ],
            "mode": "replace",
        },
    )
    assert response.status_code == 400
```

- [ ] **Step 7: Run all event tests**

```bash
docker compose exec backend bash scripts/tests-start.sh tests/api/routes/test_events.py -v
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add backend/tests/
git commit -m "test: formats API and round_scores on event results"
```

---

## Task 7: Regenerate frontend client

- [ ] **Step 1: Ensure the backend stack is running**

```bash
docker compose watch
```

Wait until the backend is healthy (check `docker compose logs backend`).

- [ ] **Step 2: Regenerate the OpenAPI client**

From the project root:

```bash
bash ./scripts/generate-client.sh
```

Expected: `frontend/openapi.json` and `frontend/src/client/` are updated with `QuizFormat`, `QuizFormatPublic`, `QuizFormatsPublic`, `QuizFormatCreate`, `QuizFormatUpdate`, `round_scores` on result models, `format_id`/`format` on event models, and a `FormatsService`.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && bun run build
```

Expected: no type errors. Fix any that appear (typically around the removed `format: dict` field or old `EventMeta` fields).

- [ ] **Step 4: Commit**

```bash
git add frontend/openapi.json frontend/src/client/
git commit -m "feat: regenerate frontend client with formats and round_scores"
```

---

## Task 8: Admin formats page

**Files:**
- Create: `frontend/src/components/Admin/FormatDialog.tsx`
- Create: `frontend/src/routes/_layout/admin_.formats.tsx`
- Modify: `frontend/src/components/Sidebar/AppSidebar.tsx`

- [ ] **Step 1: Create `frontend/src/components/Admin/FormatDialog.tsx`**

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Plus, X } from "lucide-react"
import { useState } from "react"
import type { QuizFormatPublic } from "@/client"
import { FormatsService } from "@/client"
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

interface Props {
  format?: QuizFormatPublic
  trigger: React.ReactNode
  onSuccess?: () => void
}

export function FormatDialog({ format, trigger, onSuccess }: Props) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(format?.name ?? "")
  const [description, setDescription] = useState(format?.description ?? "")
  const [rounds, setRounds] = useState<string[]>(format?.rounds ?? [""])

  const reset = () => {
    setName(format?.name ?? "")
    setDescription(format?.description ?? "")
    setRounds(format?.rounds ?? [""])
  }

  const mutation = useMutation({
    mutationFn: () =>
      format
        ? FormatsService.updateFormat({
            id: format.id,
            requestBody: { name, description: description || null, rounds },
          })
        : FormatsService.createFormat({
            requestBody: { name, description: description || null, rounds },
          }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["formats"] })
      showSuccessToast(format ? "Format updated" : "Format created")
      setOpen(false)
      onSuccess?.()
    },
    onError: () => showErrorToast("Failed to save format"),
  })

  const addRound = () => {
    if (rounds.length < 20) setRounds((r) => [...r, ""])
  }

  const removeRound = (i: number) =>
    setRounds((r) => r.filter((_, idx) => idx !== i))

  const updateRound = (i: number, value: string) =>
    setRounds((r) => r.map((v, idx) => (idx === i ? value : v)))

  const isValid = name.trim().length > 0 && rounds.every((r) => r.trim().length > 0)

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (v) reset()
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{format ? "Edit Format" : "New Format"}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 pt-2">
          <div className="grid gap-1.5">
            <Label>Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Description</Label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <div className="grid gap-2">
            <Label>Rounds ({rounds.length}/20)</Label>
            {rounds.map((round, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-5">{i + 1}.</span>
                <Input
                  value={round}
                  onChange={(e) => updateRound(i, e.target.value)}
                  placeholder={`Round ${i + 1} name`}
                  className="flex-1"
                />
                {rounds.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeRound(i)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            {rounds.length < 20 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addRound}
                className="self-start"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add round
              </Button>
            )}
          </div>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !isValid}
          >
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Create `frontend/src/routes/_layout/admin_.formats.tsx`**

```tsx
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { Suspense, useState } from "react"
import type { QuizFormatPublic } from "@/client"
import { FormatsService } from "@/client"
import { FormatDialog } from "@/components/Admin/FormatDialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import useCustomToast from "@/hooks/useCustomToast"

export const Route = createFileRoute("/_layout/admin_/formats")({
  component: AdminFormatsPage,
  beforeLoad: async () => {
    const { UsersService } = await import("@/client")
    const user = await UsersService.readUserMe()
    if (!user.is_superuser) throw redirect({ to: "/" })
  },
  head: () => ({ meta: [{ title: "Formats - Admin" }] }),
})

function DeleteFormatDialog({
  format,
  onDeleted,
}: {
  format: QuizFormatPublic
  onDeleted: () => void
}) {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const mutation = useMutation({
    mutationFn: () => FormatsService.deleteFormat({ id: format.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["formats"] })
      showSuccessToast("Format deleted")
      setOpen(false)
      onDeleted()
    },
    onError: (err: any) => {
      const detail = err?.body?.detail ?? "Failed to delete format"
      showErrorToast(detail)
    },
  })

  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
        <Trash2 className="h-3 w-3" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete "{format.name}"?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This cannot be undone. Deletion is blocked if any event uses this format.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function FormatsList() {
  const { data, refetch } = useSuspenseQuery({
    queryKey: ["formats"],
    queryFn: () => FormatsService.readFormats({ skip: 0, limit: 100 }),
  })

  if (data.data.length === 0) {
    return <p className="text-muted-foreground text-sm">No formats yet.</p>
  }

  return (
    <div className="rounded-md border">
      <table className="w-full">
        <thead className="bg-muted">
          <tr>
            <th className="py-3 px-4 text-left text-sm font-medium">Name</th>
            <th className="py-3 px-4 text-left text-sm font-medium">Description</th>
            <th className="py-3 px-4 text-left text-sm font-medium">Rounds</th>
            <th className="py-3 px-4" />
          </tr>
        </thead>
        <tbody>
          {data.data.map((fmt) => (
            <tr key={fmt.id} className="border-t">
              <td className="py-3 px-4 font-medium">{fmt.name}</td>
              <td className="py-3 px-4 text-muted-foreground text-sm">
                {fmt.description ?? "—"}
              </td>
              <td className="py-3 px-4 text-sm">{fmt.rounds.length}</td>
              <td className="py-3 px-4">
                <div className="flex items-center gap-2 justify-end">
                  <FormatDialog
                    format={fmt}
                    trigger={
                      <Button variant="outline" size="sm">
                        <Pencil className="h-3 w-3" />
                      </Button>
                    }
                  />
                  <DeleteFormatDialog format={fmt} onDeleted={refetch} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AdminFormatsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Formats</h1>
        <FormatDialog
          trigger={
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              New Format
            </Button>
          }
        />
      </div>
      <Suspense fallback={<div className="animate-pulse h-40 rounded bg-muted" />}>
        <FormatsList />
      </Suspense>
    </div>
  )
}
```

- [ ] **Step 3: Add "Formats" to the sidebar**

In `frontend/src/components/Sidebar/AppSidebar.tsx`, add `LayoutList` to the imports and insert the Formats item:

```tsx
import { ClipboardCheck, ClipboardList, Home, LayoutList, Users } from "lucide-react"

// Inside AppSidebar, after the "Review Events" push:
if (currentUser?.is_superuser) {
  items.push(
    { icon: ClipboardCheck, title: "Review Events", path: "/admin/events" },
    { icon: LayoutList, title: "Formats", path: "/admin/formats" },
    { icon: Users, title: "Admin", path: "/admin" },
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Admin/FormatDialog.tsx \
        frontend/src/routes/_layout/admin_.formats.tsx \
        frontend/src/components/Sidebar/AppSidebar.tsx
git commit -m "feat: admin formats page — list, create, edit, delete"
```

---

## Task 9: Format dropdown in MetadataEditDialog

**Files:**
- Modify: `frontend/src/components/Events/MetadataEditDialog.tsx`

- [ ] **Step 1: Add format dropdown to MetadataEditDialog**

Replace `MetadataEditDialog` with the version below (adds a Format dropdown, removes the old `format` field, stores `format_id`):

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Pencil } from "lucide-react"
import { useState } from "react"
import { useForm } from "react-hook-form"
import type { QuizEventPublic, QuizEventUpdate } from "@/client"
import { EventsService, FormatsService, OrganizationsService } from "@/client"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import useCustomToast from "@/hooks/useCustomToast"

export function MetadataEditDialog({ event }: { event: QuizEventPublic }) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [open, setOpen] = useState(false)
  const [isMultiDay, setIsMultiDay] = useState(event.start_date !== event.end_date)
  const [selectedOrgId, setSelectedOrgId] = useState<string>(
    event.organization_id ?? "__none__",
  )
  const [selectedFormatId, setSelectedFormatId] = useState<string>(
    event.format_id ?? "__none__",
  )

  const { data: orgs } = useQuery({
    queryFn: () => OrganizationsService.readOrganizations({ skip: 0, limit: 100 }),
    queryKey: ["organizations"],
  })
  const { data: formats } = useQuery({
    queryFn: () => FormatsService.readFormats({ skip: 0, limit: 100 }),
    queryKey: ["formats"],
  })

  const { register, handleSubmit, reset, setValue } = useForm({
    defaultValues: {
      name: event.name,
      start_date: event.start_date,
      end_date: event.end_date,
      organization_id: event.organization_id ?? "",
      organizer_name: event.organizer_name ?? "",
      description: event.description ?? "",
    },
    shouldUnregister: true,
  })

  const handleOrgChange = (v: string) => {
    setSelectedOrgId(v)
    if (v === "__none__") {
      setValue("organization_id", "")
      setValue("organizer_name", "")
    } else {
      const org = orgs?.data.find((o) => o.id === v)
      setValue("organization_id", v)
      setValue("organizer_name", org?.name ?? "")
    }
  }

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
          setSelectedOrgId(event.organization_id ?? "__none__")
          setSelectedFormatId(event.format_id ?? "__none__")
          reset({
            name: event.name,
            start_date: event.start_date,
            end_date: event.end_date,
            organization_id: event.organization_id ?? "",
            organizer_name: event.organizer_name ?? "",
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
              organization_id: data.organization_id || null,
              organizer_name: data.organizer_name || null,
              format_id: selectedFormatId === "__none__" ? null : selectedFormatId,
            } as QuizEventUpdate),
          )}
          className="flex flex-col gap-4 pt-2"
        >
          <input type="hidden" {...register("organization_id")} />
          <input type="hidden" {...register("organizer_name")} />
          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input {...register("name", { required: true })} />
          </div>
          <div className="grid gap-1.5">
            <Label>{isMultiDay ? "Start Date" : "Date"}</Label>
            <Input type="date" {...register("start_date", { required: true })} />
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
              <Input type="date" {...register("end_date", { required: isMultiDay })} />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label>Organization</Label>
            <Select value={selectedOrgId} onValueChange={handleOrgChange}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No Organization</SelectItem>
                {orgs?.data.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Format</Label>
            <Select value={selectedFormatId} onValueChange={setSelectedFormatId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No Format</SelectItem>
                {formats?.data.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name} ({f.rounds.length} rounds)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/Events/MetadataEditDialog.tsx
git commit -m "feat: format dropdown in event metadata dialog"
```

---

## Task 10: Dynamic round columns in EventResultsTable

**Files:**
- Modify: `frontend/src/components/Events/EventResultsTable.tsx`
- Modify: `frontend/src/routes/_public/events_.$id.tsx`
- Modify: `frontend/src/routes/_layout/admin_.events_.$id.tsx`

- [ ] **Step 1: Update `EventResultsTable` to accept format and render round columns**

Replace `frontend/src/components/Events/EventResultsTable.tsx`:

```tsx
import { Link } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"

import type { EventResultWithPlayer, QuizFormatPublic } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { Badge } from "@/components/ui/badge"

export function EventResultsTable({
  data,
  format,
}: {
  data: EventResultWithPlayer[]
  format: QuizFormatPublic | null | undefined
}) {
  const columns: ColumnDef<EventResultWithPlayer>[] = [
    {
      accessorKey: "final_rank",
      header: "Rank",
      cell: ({ row }) => {
        const rank = row.original.final_rank
        if (rank === 1) return <Badge variant="default">1st</Badge>
        if (rank === 2) return <Badge variant="secondary">2nd</Badge>
        if (rank === 3) return <Badge variant="secondary">3rd</Badge>
        return <span className="text-muted-foreground">{rank}</span>
      },
    },
    {
      accessorKey: "player_display_name",
      header: "Player",
      cell: ({ row }) => {
        const { player_slug, player_display_name } = row.original
        return player_slug ? (
          <Link
            to={"/quizzer/$slug" as any}
            params={{ slug: player_slug } as any}
            className="font-medium hover:underline"
          >
            {player_display_name}
          </Link>
        ) : (
          <span className="font-medium">{player_display_name}</span>
        )
      },
    },
    {
      accessorKey: "score",
      header: "Total",
      cell: ({ row }) => (
        <span className="tabular-nums">{row.original.score}</span>
      ),
    },
    ...(format?.rounds ?? []).map((roundName, i) => ({
      id: `round_${i + 1}`,
      header: roundName,
      cell: ({ row }: { row: any }) => {
        const score = row.original.round_scores?.[i]
        return score != null ? (
          <span className="tabular-nums">{score}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )
      },
    })),
  ]

  return <DataTable columns={columns} data={data} />
}
```

- [ ] **Step 2: Pass format to `EventResultsTable` in the public event page**

In `frontend/src/routes/_public/events_.$id.tsx`, update `EventResults` to receive and pass the format:

```tsx
function EventResults({ id, format }: { id: string; format: QuizFormatPublic | null | undefined }) {
  const { data } = useSuspenseQuery(getEventResultsQueryOptions(id))

  if (data.data.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center">
        No results published yet.
      </p>
    )
  }

  return <EventResultsTable data={data.data} format={format} />
}
```

Update `EventMeta` to pass `event.format` down, and update `EventDetailPage` to thread it:

```tsx
function EventMeta({ id }: { id: string }) {
  const { data: event } = useSuspenseQuery(getEventQueryOptions(id))
  const { user } = useAuth()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{event.name}</h1>
          <p className="text-muted-foreground">
            {event.start_date === event.end_date
              ? event.start_date
              : `${event.start_date} – ${event.end_date}`}
            {event.organizer_name && ` · Organised by ${event.organizer_name}`}
          </p>
        </div>
        {user?.is_superuser && <AdminControls event={event} />}
      </div>
      {event.description && (
        <p className="text-sm text-muted-foreground">{event.description}</p>
      )}
      {event.format && (
        <p className="text-sm text-muted-foreground">
          {event.format.rounds.length} rounds
          {event.format.name ? ` · ${event.format.name}` : ""}
        </p>
      )}
    </div>
  )
}

function EventDetailPage() {
  const { id } = Route.useParams()
  const { data: event } = useSuspenseQuery(getEventQueryOptions(id))

  return (
    <div className="flex flex-col gap-8">
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <EventMeta id={id} />
      </Suspense>
      <div>
        <h2 className="text-lg font-semibold mb-4">Results</h2>
        <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
          <EventResults id={id} format={event?.format} />
        </Suspense>
      </div>
    </div>
  )
}
```

Add the import for `QuizFormatPublic` at the top of the file.

- [ ] **Step 3: Add dynamic round columns to the admin event page**

In `frontend/src/routes/_layout/admin_.events_.$id.tsx`, update `ResultsTable` to accept and render round columns. Add these imports:

```tsx
import type { QuizFormatPublic } from "@/client"
```

Update `ResultsTable`:

```tsx
function ResultsTable({ eventId, format }: { eventId: string; format: QuizFormatPublic | null | undefined }) {
  const { data } = useSuspenseQuery({
    queryKey: ["admin", "event", eventId, "results"],
    queryFn: () => EventsService.readEventResultsWithPlayers({ id: eventId }),
  })

  if (data.data.length === 0) {
    return <p className="text-muted-foreground text-sm">No results submitted.</p>
  }

  return (
    <div className="rounded-md border">
      <table className="w-full">
        <thead className="bg-muted">
          <tr>
            <th className="py-3 px-4 text-left text-sm font-medium">Rank</th>
            <th className="py-3 px-4 text-left text-sm font-medium">Player</th>
            <th className="py-3 px-4 text-left text-sm font-medium">Total</th>
            {(format?.rounds ?? []).map((roundName) => (
              <th key={roundName} className="py-3 px-4 text-left text-sm font-medium">
                {roundName}
              </th>
            ))}
            <th className="py-3 px-4" />
          </tr>
        </thead>
        <tbody>
          {data.data.map((result) => (
            <ResultRow
              key={result.id}
              result={result}
              eventId={eventId}
              numRounds={format?.rounds.length ?? 0}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

Update `ResultRow` to show round scores (read-only) after the Total column:

```tsx
function ResultRow({
  result,
  eventId,
  numRounds,
}: {
  result: EventResultWithPlayer
  eventId: string
  numRounds: number
}) {
  // ... existing state and mutations unchanged ...

  return (
    <tr className="border-b">
      <td className="py-3 px-4">{result.final_rank ?? "—"}</td>
      <td className="py-3 px-4">
        {/* player link — unchanged */}
      </td>
      <td className="py-3 px-4">
        {editing ? (
          <Input
            type="number"
            step="0.01"
            value={score}
            onChange={(e) => setScore(e.target.value)}
            className="w-24"
          />
        ) : (
          result.score
        )}
      </td>
      {Array.from({ length: numRounds }, (_, i) => (
        <td key={i} className="py-3 px-4 tabular-nums text-sm">
          {result.round_scores?.[i] ?? "—"}
        </td>
      ))}
      <td className="py-3 px-4">
        {/* existing edit/delete buttons — unchanged */}
      </td>
    </tr>
  )
}
```

Update `EventDetailContent` to pass `event.format` to `ResultsTable`:

```tsx
<ResultsTable eventId={id} format={event.format} />
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Events/EventResultsTable.tsx \
        frontend/src/routes/_public/events_.$id.tsx \
        frontend/src/routes/_layout/admin_.events_.$id.tsx
git commit -m "feat: dynamic round columns in results tables"
```

---

## Task 11: Upload wizard — format picker, round column mapping, submission

**Files:**
- Modify: `frontend/src/components/Upload/types.ts`
- Modify: `frontend/src/components/Upload/steps/Step1EventMeta.tsx`
- Modify: `frontend/src/components/Upload/steps/Step3ColumnMapping.tsx`
- Modify: `frontend/src/components/Upload/steps/Step5Preview.tsx`

- [ ] **Step 1: Update `types.ts`**

Replace the full file:

```ts
import type { ParsedResultWithCandidates, PlayerCreate, QuizFormatPublic } from "@/client"

export function today(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export type EventMeta = {
  name: string
  start_date: string
  end_date: string
  organizer_name: string | null
  description: string
  series_id: string
  organization_id: string
  format_id: string
}

export function emptyEventMeta(): EventMeta {
  const t = today()
  return {
    name: "",
    start_date: t,
    end_date: t,
    organizer_name: null,
    description: "",
    series_id: "",
    organization_id: "",
    format_id: "",
  }
}

export type ColumnMapping = {
  player_name: number
  country: number
  score: number
  rounds: (number | null)[]
}

export type Resolution = {
  player_id: string | null
  player_create: PlayerCreate | null
  autoResolved?: boolean
}

export type WizardState = {
  step: 0 | 1 | 2 | 3 | 4 | 5
  eventMode: "new" | "existing"
  existingEventId: string | null
  existingEventName: string | null
  selectedFormat: QuizFormatPublic | null
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
  selectedFormat: null,
  submitMode: "append",
  eventMeta: emptyEventMeta(),
  rawCsv: "",
  parsedRows: [],
  columnMapping: { player_name: 0, country: 1, score: 2, rounds: [] },
  parsedResults: [],
  resolutions: [],
  eventId: null,
}
```

- [ ] **Step 2: Update Step1EventMeta — replace format_* fields with format_id picker**

In `Step1EventMeta.tsx`:

1. Add a `FormatsService` import alongside the existing service imports.
2. Add a `useQuery` for formats:
   ```tsx
   const { data: formats } = useQuery({
     queryFn: () => FormatsService.readFormats({ skip: 0, limit: 100 }),
     queryKey: ["formats"],
   })
   ```
3. Replace the three format input fields (`format_rounds`, `format_questions`, `format_categories`) with a single Format dropdown:
   ```tsx
   <div className="grid gap-1.5">
     <Label>Format (optional)</Label>
     <Select
       onValueChange={(v) => {
         setValue("format_id", v === "__none__" ? "" : v)
         const fmt = formats?.data.find((f) => f.id === v) ?? null
         update({ selectedFormat: fmt })
       }}
     >
       <SelectTrigger>
         <SelectValue placeholder="No format" />
       </SelectTrigger>
       <SelectContent>
         <SelectItem value="__none__">No format</SelectItem>
         {formats?.data.map((f) => (
           <SelectItem key={f.id} value={f.id}>
             {f.name} ({f.rounds.length} rounds)
           </SelectItem>
         ))}
       </SelectContent>
     </Select>
   </div>
   ```
4. Update `onSubmit` to clear `selectedFormat` when format is not set:
   ```tsx
   const onSubmit = (data: EventMeta) => {
     const payload = { ...data, end_date: isMultiDay ? data.end_date : data.start_date }
     const fmt = formats?.data.find((f) => f.id === data.format_id) ?? null
     update({ eventMeta: payload, selectedFormat: fmt, step: 2 })
   }
   ```
5. Update `ExistingEventPicker` to also capture the format when selecting an existing event. Change the `onChange` prop type to include format and update the call site:
   ```tsx
   // picker onChange handler in Step1EventMeta:
   onChange={(id, name, fmt) =>
     update({ existingEventId: id, existingEventName: name, selectedFormat: fmt })
   }
   ```
   Inside `ExistingEventPicker`:
   ```tsx
   onChange: (id: string, name: string, format: QuizFormatPublic | null) => void
   // ...
   onChange(event.id, event.name, (event as any).format ?? null)
   ```

- [ ] **Step 3: Update Step3ColumnMapping — round column selectors**

Replace `frontend/src/components/Upload/steps/Step3ColumnMapping.tsx`:

```tsx
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ColumnMapping, WizardState } from "../types"

interface Props {
  state: WizardState
  update: (patch: Partial<WizardState>) => void
}

const REQUIRED_FIELDS: Array<{ key: keyof Omit<ColumnMapping, "rounds">; label: string }> = [
  { key: "player_name", label: "Player name" },
  { key: "country", label: "Country" },
  { key: "score", label: "Score" },
]

const UNSET = "__unset__"

export function Step3ColumnMapping({ state, update }: Props) {
  const [mapping, setMapping] = useState<ColumnMapping>(state.columnMapping)
  const header = state.parsedRows[0] ?? []
  const preview = state.parsedRows.slice(1, 4)
  const rounds = state.selectedFormat?.rounds ?? []

  const handleNext = () => {
    update({ columnMapping: mapping, step: 4 })
  }

  const setRoundCol = (roundIdx: number, colValue: string) => {
    const colIdx = colValue === UNSET ? null : Number(colValue)
    setMapping((m) => {
      const next = [...m.rounds]
      next[roundIdx] = colIdx
      return { ...m, rounds: next }
    })
  }

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      <div className="grid gap-4">
        {REQUIRED_FIELDS.map(({ key, label }) => (
          <div key={key} className="grid gap-1.5">
            <Label>{label} column *</Label>
            <Select
              value={String(mapping[key])}
              onValueChange={(v) =>
                setMapping((m) => ({ ...m, [key]: Number(v) }))
              }
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {header.map((col, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {col || `Column ${i + 1}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}

        {rounds.length > 0 && (
          <>
            <p className="text-sm font-medium text-muted-foreground">
              Round columns (optional — unmapped rounds will be blank)
            </p>
            {rounds.map((roundName, i) => (
              <div key={i} className="grid gap-1.5">
                <Label>{roundName}</Label>
                <Select
                  value={mapping.rounds[i] != null ? String(mapping.rounds[i]) : UNSET}
                  onValueChange={(v) => setRoundCol(i, v)}
                >
                  <SelectTrigger><SelectValue placeholder="Not mapped" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNSET}>Not mapped</SelectItem>
                    {header.map((col, ci) => (
                      <SelectItem key={ci} value={String(ci)}>
                        {col || `Column ${ci + 1}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </>
        )}
      </div>

      {preview.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-2">Preview (first 3 rows)</p>
          <div className="overflow-x-auto rounded border text-xs font-mono">
            <table className="w-full">
              <thead className="bg-muted">
                <tr>
                  {["Player", "Country", "Score", ...rounds].map((h) => (
                    <th key={h} className="px-2 py-1 text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-2 py-1">{row[mapping.player_name]}</td>
                    <td className="px-2 py-1">{row[mapping.country]}</td>
                    <td className="px-2 py-1">{row[mapping.score]}</td>
                    {rounds.map((_, ri) => (
                      <td key={ri} className="px-2 py-1">
                        {mapping.rounds[ri] != null
                          ? row[mapping.rounds[ri]!]
                          : "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <Button variant="outline" onClick={() => update({ step: 2 })}>
          ← Back
        </Button>
        <Button onClick={handleNext}>Next →</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Update Step5Preview — include round_scores in submission, update buildEventMeta**

In `Step5Preview.tsx`, replace `buildEventMeta`:

```ts
function buildEventMeta(meta: WizardState["eventMeta"]) {
  return {
    name: meta.name,
    start_date: meta.start_date,
    end_date: meta.end_date,
    organizer_name: meta.organizer_name || undefined,
    description: meta.description || undefined,
    series_id: meta.series_id || undefined,
    organization_id: meta.organization_id || undefined,
    format_id: meta.format_id || undefined,
  }
}
```

Replace the `submitMutation.mutationFn` results-building to include round_scores:

```ts
const rawRows = state.parsedRows.slice(1)
const numRounds = state.selectedFormat?.rounds.length ?? 0

const results = state.resolutions.map((r, i) => {
  const rawRow = rawRows[i] ?? []
  const roundScores =
    numRounds > 0
      ? state.columnMapping.rounds.slice(0, numRounds).map((colIdx) =>
          colIdx != null
            ? parseFloat(rawRow[colIdx] ?? "") || null
            : null,
        )
      : undefined
  return {
    player_id: r.player_id ?? undefined,
    player_create: r.player_create ?? undefined,
    score: parseFloat(rawRow[state.columnMapping.score] ?? "0"),
    round_scores: roundScores,
  }
})
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Upload/
git commit -m "feat: upload wizard — format picker, round column mapping, round_scores submission"
```

---

## Task 12: Final verification

- [ ] **Step 1: Run full backend test suite**

```bash
docker compose exec backend bash scripts/tests-start.sh -v
```

Expected: all tests pass.

- [ ] **Step 2: Run frontend type check**

```bash
cd frontend && bun run build
```

Expected: no type errors.

- [ ] **Step 3: Smoke test the feature in the browser**

```bash
docker compose watch
```

1. Log in as superuser → Admin → Formats → create a format with 3 rounds
2. Admin → Review Events → pick an event → Edit Metadata → assign the format → save
3. Public events page → open that event → verify round columns appear in results table (all `—` if no round scores yet)
4. Upload → existing event with that format → paste a CSV with round columns → Step 3 shows round dropdowns → map them → submit
5. Open the event page again → verify round scores appear in the correct columns

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: quiz round formats — complete implementation"
```
