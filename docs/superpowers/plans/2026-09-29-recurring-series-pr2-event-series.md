# Recurring Series PR 2 (Series Type and Event Series) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every recurring series a type (`quiz` or `event`), let events belong to an event series, and add a public page for each event series that shows its editions, a table of which quiz series were held at each edition, and a medal table.

**Architecture:**
- **Backend:**
  - `RecurringSeries` gains a `type` enum, and `Event` gains a nullable `series_id` FK.
  - A crud helper enforces that quizzes join quiz series and events join event series.
  - `QuizPodium` gains event and series names, so the existing podium endpoint can feed both the "held at" line and the matrix.
- **Frontend:**
  - Pure helpers in `src/lib` (grouping events by series, building the matrix) are unit tested.
  - Pages and admin dialogs consume them.
  - `/competitions` requests quiz series only.

**Tech Stack:** FastAPI + SQLModel + Alembic (Postgres), pytest; React + TanStack Router/Query, `@hey-api/openapi-ts`, Tailwind/shadcn, Playwright, bun test.

**Spec:** `docs/superpowers/specs/2026-09-28-recurring-series-design.md` (section "PR 2: series type and event series"; PR 1 is merged and is the base)

## Global Constraints

- **Series type:**
  - The enum is `RecurringSeriesType` with values `quiz` and `event`, stored in the Postgres enum `recurringseriestype`.
  - The column is NOT NULL with `server_default 'quiz'`.
  - It defaults to `quiz` on create.
- **`event.series_id`:** nullable FK to `recurringseries.id`, `ondelete="SET NULL"`, constraint name `event_series_id_fkey`.
- **Rules:**
  - A quiz's `series_id` must be a `quiz` series, and an event's must be an `event` series. Otherwise the API returns 422.
  - An unknown series returns 404 "Series not found".
  - Changing `type` while any quiz or event links to the series returns 409 with detail exactly `Series has linked quizzes or events`.
  - An empty series may change type freely.
- **Organizations are not enforced** to match across quiz, event and series.
- **Not stored, derived:** "held at" comes from `quiz.series_id` + `quiz.event_id`. Edition year comes from `start_date`.
- **Users still see "Competition":**
  - `/competitions` lists `type=quiz` only.
  - Event series live at `/events/recurring/<slug>`.
  - `/competitions/<event-series-slug>` redirects there.
- **Toggles** in admin dialogs use the segmented control. The active button keeps `bg-primary text-primary-foreground`, which E2E asserts.
- **Where to run backend commands:** on the host from `backend/` with `uv run ...`. The backend container runs a stale baked image.
- **After code changes:** rebuild with `docker compose up -d --build backend` (and `frontend` when you finish).
- **Test data:** tests hit the dev DB. Only delete rows you create. Never run `docker compose down -v`.
- **E2E runs:** one run at a time, with mailcatcher up and the Docker `frontend` container stopped. Never pipe Playwright through `| tail`.
- **Formatting:** don't run `ruff format` repo-wide. The repo isn't format-clean. Use `uv run ruff check --select I --fix <touched files>` and keep diffs to the change.
- **Commit messages** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Unlinking works.** `PATCH` with `series_id: null` on a quiz or an event removes the link, and is never rejected by the type rule. Tests: `test_patch_quiz_clears_series` and `test_patch_event_clears_series` (Task 2).
2. **A same-type PATCH on a linked series succeeds.** Re-saving an event series from the admin dialog sends `type: "event"` unchanged and must not 409. Test: `test_patch_same_type_on_linked_series_is_allowed` (Task 1).
3. **Admin and public competition lists never share a cache entry.** After viewing `/admin/competitions` (all types), a client-side navigation to `/competitions` must not show event series. Test: "admin → public navigation does not leak event series" (Task 7).
4. **An event series with no approved quizzes renders.** It shows its editions and "No quizzes held at these events yet.", not a blank or broken table. Tests: `buildSeriesMatrix` empty case (Task 4) and the E2E empty-series check (Task 7).
5. **Editing an event series without touching Type keeps it an event.** The dialog defaults `type` from the stored series. Test: the E2E admin edit (Task 7).

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `backend/app/alembic/versions/c7d2e9f1a4b6_add_series_type_and_event_series.py` | **Create.** Enum, `recurringseries.type`, `event.series_id` | 1 |
| `backend/app/models.py` | `RecurringSeriesType`, `type` fields, `Event.series_id`, `SeriesTypeError`, event and podium public fields | 1, 2, 3 |
| `backend/app/crud.py` | Type-change guard, `require_series_type`, calls from quiz and event create/update | 1, 2 |
| `backend/app/api/routes/series.py` | `?type=` filter, type-aware podium query | 1, 3 |
| `backend/app/api/routes/events.py` | `?series_id=` filter, series fields, 404/422 mapping | 2 |
| `backend/app/api/routes/quizzes.py` | Series 404/422 mapping | 2 |
| `backend/app/podium.py` | Fill event and series fields on `QuizPodium` | 3 |
| `backend/tests/utils/quiz.py` | `create_random_series(type=...)`, `create_random_event` | 1 |
| `backend/tests/test_recurring_series_schema.py` | Schema assertions | 1 |
| `backend/tests/api/routes/test_series.py` | Type, filter, guard tests | 1 |
| `backend/tests/api/routes/test_series_links.py` | **Create.** Type rule, event series fields and filter, podium fields | 2, 3 |
| `frontend/src/client/*` | Regenerated | 4 |
| `frontend/src/lib/seriesMatrix.ts`, `frontend/src/lib/groupEventsBySeries.ts` | **Create.** Pure helpers | 4 |
| `frontend/tests/series-matrix.test.ts`, `frontend/tests/group-events-by-series.test.ts` | **Create.** Unit tests | 4 |
| `frontend/src/routes/_public/competitions.tsx`, `organizations_.$slug.tsx`, `src/components/Upload/steps/Step1QuizMeta.tsx` | Quiz-only lists with distinct query keys | 4 |
| `frontend/src/test-ids.ts` | New test ids | 6 |
| `frontend/src/components/Admin/CompetitionDialog.tsx`, `src/routes/_layout/admin_.competitions.tsx`, `src/components/Admin/EventDialog.tsx` | Admin type toggle, Type column, series select | 6 |
| `frontend/src/components/Competitions/CompetitionPodium.tsx` | Optional "at <event>" line | 5 |
| `frontend/src/components/Events/SeriesMatrix.tsx` | **Create.** Matrix table | 5 |
| `frontend/src/routes/_public/events_.recurring.$slug.tsx` | **Create.** Event series page | 5 |
| `frontend/src/routes/_public/events.tsx`, `events_.$slug.tsx`, `competitions_.$slug.tsx` | Grouping, "Part of", redirect and "held at" | 5 |
| `frontend/tests/events-recurring.spec.ts` | **Create.** E2E | 7 |
| `frontend/tests/competitions-admin.spec.ts`, `events.spec.ts`, `upload.spec.ts` | E2E additions | 7 |

---

### Task 1: Series type column, list filter and type-change guard

**Files:**
- Create: `backend/app/alembic/versions/c7d2e9f1a4b6_add_series_type_and_event_series.py`
- Modify: `backend/app/models.py` (RecurringSeries section around lines 198–241, and the `Event` table class around line 330)
- Modify: `backend/app/crud.py` (`update_series`, around lines 171–192)
- Modify: `backend/app/api/routes/series.py` (`read_series_list`)
- Modify: `backend/tests/utils/quiz.py`, `backend/tests/test_recurring_series_schema.py`, `backend/tests/api/routes/test_series.py`

**Interfaces:**
- Consumes: the PR 1 head revision, `b4e8f2a6c913`.
- Produces:
  - `app.models.RecurringSeriesType` (`str` enum, members `quiz` and `event`).
  - `RecurringSeriesBase.type: RecurringSeriesType = RecurringSeriesType.quiz` and `RecurringSeriesUpdate.type: RecurringSeriesType | None = None`.
  - `Event.series_id: uuid.UUID | None` (table only; the API fields come in Task 2).
  - `GET /series/?type=quiz|event`.
  - The test helpers `create_random_series(db, organization_id=None, type=RecurringSeriesType.quiz)` and `create_random_event(db, organization_id=None, series_id=None, start_date=date(2026, 6, 12)) -> Event`.

- [ ] **Step 1: Write the failing schema and API tests**

Append to `backend/tests/test_recurring_series_schema.py`:

```python
def test_recurringseries_type_column_defaults_to_quiz(db: Session) -> None:
    columns = {c["name"]: c for c in inspect(db.get_bind()).get_columns("recurringseries")}
    assert "type" in columns
    assert columns["type"]["nullable"] is False
    assert "quiz" in str(columns["type"]["default"])


def test_event_references_series_by_series_id(db: Session) -> None:
    insp = inspect(db.get_bind())
    assert "series_id" in {c["name"] for c in insp.get_columns("event")}
    fks = {fk["name"]: fk for fk in insp.get_foreign_keys("event")}
    fk = fks["event_series_id_fkey"]
    assert fk["referred_table"] == "recurringseries"
    assert fk["constrained_columns"] == ["series_id"]
    assert fk["options"].get("ondelete") == "SET NULL"
```

In `backend/tests/utils/quiz.py`, add `Event`, `EventCreate` and `RecurringSeriesType` to the `app.models` import. Then replace `create_random_series` and add `create_random_event` below it. The helper parameter is named `type` to mirror the API field, so it shadows the builtin inside the helper only.

```python
def create_random_series(
    db: Session,
    organization_id: uuid.UUID | None = None,
    type: RecurringSeriesType = RecurringSeriesType.quiz,
) -> RecurringSeries:
    if organization_id is None:
        organization_id = create_random_organization(db).id
    return crud.create_series(
        session=db,
        series_in=RecurringSeriesCreate(
            name=random_lower_string(), organization_id=organization_id, type=type
        ),
    )


def create_random_event(
    db: Session,
    organization_id: uuid.UUID | None = None,
    series_id: uuid.UUID | None = None,
    start_date: date = date(2026, 6, 12),
) -> Event:
    if organization_id is None:
        organization_id = create_random_organization(db).id
    event = crud.create_event(
        session=db,
        event_in=EventCreate(
            name=random_lower_string(),
            start_date=start_date,
            end_date=start_date,
            is_online=True,
            organization_id=organization_id,
        ),
    )
    # Set directly so the helper works whatever the create API accepts.
    event.series_id = series_id
    db.add(event)
    db.commit()
    db.refresh(event)
    return event
```

Append to `backend/tests/api/routes/test_series.py`. Add `func` to the existing `sqlmodel` import, and add `RecurringSeriesType` and the new helpers to the imports.

```python
def test_series_type_defaults_to_quiz(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    org = create_random_organization(db)
    r = client.post(
        f"{settings.API_V1_STR}/series/",
        headers=superuser_token_headers,
        json={"name": "Default Type Series", "organization_id": str(org.id)},
    )
    assert r.status_code == 200
    assert r.json()["type"] == "quiz"


def test_create_event_series(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    org = create_random_organization(db)
    r = client.post(
        f"{settings.API_V1_STR}/series/",
        headers=superuser_token_headers,
        json={"name": "Trivia Nationals", "organization_id": str(org.id), "type": "event"},
    )
    assert r.status_code == 200
    assert r.json()["type"] == "event"


def test_read_series_filters_by_type(client: TestClient, db: Session) -> None:
    quiz_series = create_random_series(db)
    event_series = create_random_series(db, type=RecurringSeriesType.event)
    r = client.get(
        f"{settings.API_V1_STR}/series/", params={"type": "event", "limit": 1000}
    )
    assert r.status_code == 200
    body = r.json()
    ids = {s["id"] for s in body["data"]}
    assert str(event_series.id) in ids
    assert str(quiz_series.id) not in ids
    assert all(s["type"] == "event" for s in body["data"])
    expected = db.exec(
        select(func.count())
        .select_from(RecurringSeries)
        .where(RecurringSeries.type == RecurringSeriesType.event)
    ).one()
    assert body["count"] == expected


def test_read_series_without_type_lists_both(client: TestClient, db: Session) -> None:
    quiz_series = create_random_series(db)
    event_series = create_random_series(db, type=RecurringSeriesType.event)
    r = client.get(f"{settings.API_V1_STR}/series/", params={"limit": 1000})
    ids = {s["id"] for s in r.json()["data"]}
    assert {str(quiz_series.id), str(event_series.id)} <= ids


def test_type_change_blocked_when_a_quiz_links(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    series = create_random_series(db)
    create_approved_quiz_in_series(db, series_id=series.id)
    r = client.patch(
        f"{settings.API_V1_STR}/series/{series.id}",
        headers=superuser_token_headers,
        json={"type": "event"},
    )
    assert r.status_code == 409
    assert r.json()["detail"] == "Series has linked quizzes or events"


def test_type_change_blocked_when_an_event_links(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    series = create_random_series(db, type=RecurringSeriesType.event)
    create_random_event(db, series_id=series.id)
    r = client.patch(
        f"{settings.API_V1_STR}/series/{series.id}",
        headers=superuser_token_headers,
        json={"type": "quiz"},
    )
    assert r.status_code == 409
    assert r.json()["detail"] == "Series has linked quizzes or events"


def test_type_change_allowed_when_empty(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    series = create_random_series(db)
    r = client.patch(
        f"{settings.API_V1_STR}/series/{series.id}",
        headers=superuser_token_headers,
        json={"type": "event"},
    )
    assert r.status_code == 200
    assert r.json()["type"] == "event"


def test_patch_same_type_on_linked_series_is_allowed(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    # The admin dialog always sends the current type; re-saving must not 409.
    series = create_random_series(db, type=RecurringSeriesType.event)
    create_random_event(db, series_id=series.id)
    r = client.patch(
        f"{settings.API_V1_STR}/series/{series.id}",
        headers=superuser_token_headers,
        json={"type": "event", "name": "Renamed Event Series"},
    )
    assert r.status_code == 200
    assert r.json()["name"] == "Renamed Event Series"
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd backend && uv run pytest -q -p no:warnings tests/test_recurring_series_schema.py tests/api/routes/test_series.py`
Expected: collection fails with `ImportError: cannot import name 'RecurringSeriesType'`.

- [ ] **Step 3: Write the migration and apply it**

Create `backend/app/alembic/versions/c7d2e9f1a4b6_add_series_type_and_event_series.py`:

```python
"""add series type and event series

Revision ID: c7d2e9f1a4b6
Revises: b4e8f2a6c913
Create Date: 2026-09-29 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c7d2e9f1a4b6'
down_revision = 'b4e8f2a6c913'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Every existing series is a series of quizzes, so the default backfills it.
    series_type = sa.Enum("quiz", "event", name="recurringseriestype")
    series_type.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "recurringseries",
        sa.Column("type", series_type, nullable=False, server_default="quiz"),
    )

    op.add_column("event", sa.Column("series_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "event_series_id_fkey",
        "event",
        "recurringseries",
        ["series_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("event_series_id_fkey", "event", type_="foreignkey")
    op.drop_column("event", "series_id")
    op.drop_column("recurringseries", "type")
    sa.Enum(name="recurringseriestype").drop(op.get_bind(), checkfirst=True)
```

Confirm `grep DB_TARGET .env` prints `DB_TARGET=dev`, then run `cd backend && uv run alembic upgrade head`.
Expected: `Running upgrade b4e8f2a6c913 -> c7d2e9f1a4b6`.

- [ ] **Step 4: Add the type to the models**

In `backend/app/models.py`, replace the RecurringSeries section header comment and insert the enum above `RecurringSeriesBase`. This also fixes the section comment left over from PR 1.

```python
# ---------------------------------------------------------------------------
# RecurringSeries (shown to users as "Competition")
# ---------------------------------------------------------------------------

class RecurringSeriesType(str, enum.Enum):
    """What a series' editions are: quizzes, or events (gatherings)."""

    quiz = "quiz"
    event = "event"
```

`RecurringSeriesBase`: add `type: RecurringSeriesType = RecurringSeriesType.quiz` after `description`.

`RecurringSeriesUpdate`: add `type: RecurringSeriesType | None = None` after `organization_id`.

`RecurringSeries` table, add after `slug` (the same pattern as `Quiz.participant_mode`):

```python
    type: RecurringSeriesType = Field(
        default=RecurringSeriesType.quiz,
        sa_column=Column(
            SAEnum(RecurringSeriesType, name="recurringseriestype"),
            nullable=False,
            server_default="quiz",
        ),
    )
```

`Event` table class, add after `organization_id`:

```python
    series_id: uuid.UUID | None = Field(
        default=None, foreign_key="recurringseries.id", ondelete="SET NULL"
    )
```

- [ ] **Step 5: Add the type-change guard in crud**

In `backend/app/crud.py`, add a private helper just above `update_series`:

```python
def _series_has_links(*, session: Session, series_id: uuid.UUID) -> bool:
    if session.exec(select(Quiz.id).where(Quiz.series_id == series_id).limit(1)).first():
        return True
    return (
        session.exec(select(Event.id).where(Event.series_id == series_id).limit(1)).first()
        is not None
    )
```

In `update_series`, directly after the existing `slug` pops and before the slug-collision check, add:

```python
    new_type = update_data.get("type")
    if new_type is None:
        update_data.pop("type", None)
    elif new_type != db_series.type and _series_has_links(
        session=session, series_id=db_series.id
    ):
        # A linked series' editions are all of one type; flipping it would
        # leave them breaking the type rule. The route maps ValueError to 409.
        raise ValueError("Series has linked quizzes or events")
```

- [ ] **Step 6: Add the `?type=` filter**

In `backend/app/api/routes/series.py`, add `Query` to the `fastapi` import and `RecurringSeriesType` to the models import. Then replace `read_series_list`:

```python
@router.get("/", response_model=RecurringSeriesListPublic)
def read_series_list(
    session: SessionDep,
    skip: int = 0,
    limit: int = 100,
    series_type: RecurringSeriesType | None = Query(default=None, alias="type"),
) -> Any:
    filters = []
    if series_type is not None:
        filters.append(RecurringSeries.type == series_type)
    count = session.exec(
        select(func.count()).select_from(RecurringSeries).where(*filters)
    ).one()
    series_list = session.exec(
        select(RecurringSeries)
        .where(*filters)
        .order_by(func.lower(RecurringSeries.name), col(RecurringSeries.id))
        .offset(skip)
        .limit(limit)
    ).all()
    return RecurringSeriesListPublic(
        data=[_series_public(s, session) for s in series_list],
        count=count,
    )
```

- [ ] **Step 7: Sort imports and run the task's tests**

Run:
```bash
cd backend
uv run ruff check --select I --fix app/models.py app/crud.py app/api/routes/series.py tests/utils/quiz.py tests/api/routes/test_series.py tests/test_recurring_series_schema.py
uv run pytest -q -p no:warnings tests/test_recurring_series_schema.py tests/api/routes/test_series.py
```
Expected: all pass, including the 8 new API tests and 2 new schema tests.

- [ ] **Step 8: Run the whole backend suite and round-trip the migration**

```bash
cd backend
uv run pytest -q -p no:warnings
uv run alembic downgrade -1 && uv run alembic upgrade head
```
Expected:
- **pytest:** everything passes except the 2 `test_countries.py` failures that already fail on `main` (`test_pending_and_rejected_quizzes_are_excluded`, `test_member_row_country_is_overridden_by_the_national_team`).
- **Migration:** both commands log a clean `c7d2e9f1a4b6` downgrade and upgrade.

- [ ] **Step 9: Commit**

```bash
git add backend
git commit -m "feat(backend): give recurring series a quiz/event type

Adds recurringseries.type (default quiz) and event.series_id, a ?type=
filter on GET /series, and a 409 when changing the type of a series that
already has quizzes or events.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Type rule for quizzes and events; event series fields and filter

**Files:**
- Modify: `backend/app/models.py` (Event section: add `SeriesTypeError`, and `series_id` on `EventCreate`/`EventUpdate`/`EventPublic`)
- Modify: `backend/app/crud.py` (`require_series_type`; `create_quiz`, `update_quiz`, `create_event`, `update_event`)
- Modify: `backend/app/api/routes/quizzes.py` (`create_quiz`, `update_quiz`)
- Modify: `backend/app/api/routes/events.py` (`_event_public`, `read_events`, `create_event`, `update_event`)
- Create: `backend/tests/api/routes/test_series_links.py`

**Interfaces:**
- Consumes: `RecurringSeriesType`, `Event.series_id`, `create_random_series(type=...)` and `create_random_event(...)` from Task 1.
- Produces:
  - `app.models.SeriesTypeError(ValueError)`.
  - `crud.require_series_type(*, session: Session, series_id: uuid.UUID | None, expected: RecurringSeriesType) -> None`.
  - `EventCreate.series_id` and `EventUpdate.series_id` (`uuid.UUID | None = None`).
  - `EventPublic.series_id`, `series_name` and `series_slug` (all optional).
  - `GET /events/?series_id=<uuid>`.
  - Error messages, exactly: `"A quiz can only join a quiz series"` and `"An event can only join an event series"`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/api/routes/test_series_links.py`:

```python
import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.models import RecurringSeriesType
from tests.utils.quiz import (
    create_random_event,
    create_random_organization,
    create_random_quiz,
    create_random_series,
)

API = settings.API_V1_STR


def _quiz_payload(**overrides) -> dict:
    payload = {"name": "Link Test Quiz", "start_date": "2026-08-07", "end_date": "2026-08-07"}
    payload.update(overrides)
    return payload


def _event_payload(org_id, **overrides) -> dict:
    payload = {
        "name": "Link Test Event",
        "start_date": "2026-08-07",
        "end_date": "2026-08-09",
        "is_online": True,
        "organization_id": str(org_id),
    }
    payload.update(overrides)
    return payload


# --- quizzes -----------------------------------------------------------------


def test_quiz_joins_a_quiz_series(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    series = create_random_series(db)
    r = client.post(
        f"{API}/quizzes/",
        headers=superuser_token_headers,
        json=_quiz_payload(series_id=str(series.id)),
    )
    assert r.status_code == 200
    assert r.json()["series_id"] == str(series.id)


def test_quiz_cannot_join_an_event_series(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    series = create_random_series(db, type=RecurringSeriesType.event)
    r = client.post(
        f"{API}/quizzes/",
        headers=superuser_token_headers,
        json=_quiz_payload(series_id=str(series.id)),
    )
    assert r.status_code == 422
    assert r.json()["detail"] == "A quiz can only join a quiz series"


def test_quiz_with_unknown_series_is_404(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.post(
        f"{API}/quizzes/",
        headers=superuser_token_headers,
        json=_quiz_payload(series_id=str(uuid.uuid4())),
    )
    assert r.status_code == 404
    assert r.json()["detail"] == "Series not found"


def test_patch_quiz_into_an_event_series_is_422(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    quiz = create_random_quiz(db)
    series = create_random_series(db, type=RecurringSeriesType.event)
    r = client.patch(
        f"{API}/quizzes/{quiz.id}",
        headers=superuser_token_headers,
        json={"series_id": str(series.id)},
    )
    assert r.status_code == 422
    assert r.json()["detail"] == "A quiz can only join a quiz series"


def test_patch_quiz_clears_series(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    series = create_random_series(db)
    quiz = create_random_quiz(db)
    quiz.series_id = series.id
    db.add(quiz)
    db.commit()
    r = client.patch(
        f"{API}/quizzes/{quiz.id}",
        headers=superuser_token_headers,
        json={"series_id": None},
    )
    assert r.status_code == 200
    assert r.json()["series_id"] is None


# --- events ------------------------------------------------------------------


def test_event_joins_an_event_series(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    series = create_random_series(db, type=RecurringSeriesType.event)
    r = client.post(
        f"{API}/events/",
        headers=superuser_token_headers,
        json=_event_payload(series.organization_id, series_id=str(series.id)),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["series_id"] == str(series.id)
    assert body["series_name"] == series.name
    assert body["series_slug"] == series.slug


def test_event_cannot_join_a_quiz_series(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    series = create_random_series(db)
    r = client.post(
        f"{API}/events/",
        headers=superuser_token_headers,
        json=_event_payload(series.organization_id, series_id=str(series.id)),
    )
    assert r.status_code == 422
    assert r.json()["detail"] == "An event can only join an event series"


def test_event_with_unknown_series_is_404(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    org = create_random_organization(db)
    r = client.post(
        f"{API}/events/",
        headers=superuser_token_headers,
        json=_event_payload(org.id, series_id=str(uuid.uuid4())),
    )
    assert r.status_code == 404
    assert r.json()["detail"] == "Series not found"


def test_patch_event_into_a_quiz_series_is_422(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    event = create_random_event(db)
    series = create_random_series(db)
    r = client.patch(
        f"{API}/events/{event.id}",
        headers=superuser_token_headers,
        json={"series_id": str(series.id)},
    )
    assert r.status_code == 422
    assert r.json()["detail"] == "An event can only join an event series"


def test_patch_event_clears_series(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    series = create_random_series(db, type=RecurringSeriesType.event)
    event = create_random_event(db, series_id=series.id)
    r = client.patch(
        f"{API}/events/{event.id}",
        headers=superuser_token_headers,
        json={"series_id": None},
    )
    assert r.status_code == 200
    assert r.json()["series_id"] is None
    assert r.json()["series_name"] is None


def test_event_without_series_has_null_series_fields(
    client: TestClient, db: Session
) -> None:
    event = create_random_event(db)
    body = client.get(f"{API}/events/{event.id}").json()
    assert body["series_id"] is None
    assert body["series_name"] is None
    assert body["series_slug"] is None


def test_read_events_filters_by_series_id(client: TestClient, db: Session) -> None:
    series = create_random_series(db, type=RecurringSeriesType.event)
    in_series = create_random_event(db, series_id=series.id)
    create_random_event(db)
    r = client.get(f"{API}/events/", params={"series_id": str(series.id)})
    assert r.status_code == 200
    body = r.json()
    assert [e["id"] for e in body["data"]] == [str(in_series.id)]
    assert body["count"] == 1
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd backend && uv run pytest -q -p no:warnings tests/api/routes/test_series_links.py`
Expected: most tests fail. For example, `test_quiz_cannot_join_an_event_series` gets 200 instead of 422, `test_event_joins_an_event_series` fails with a `KeyError: 'series_name'`, and `test_quiz_with_unknown_series_is_404` gets a 500 or IntegrityError. `test_quiz_joins_a_quiz_series` and `test_patch_quiz_clears_series` may already pass, because they exercise existing behaviour and pin it.

- [ ] **Step 3: Add the model fields and the error type**

In `backend/app/models.py`, directly below `class EventValidationError`:

```python
class SeriesTypeError(ValueError):
    """Raised when a quiz or event is linked to a series of the other type.

    Distinct from the plain ValueError that signals a slug collision, so the
    route layer can map it to 422 rather than 409.
    """
```

- **`EventCreate`:** add `series_id: uuid.UUID | None = None` after `organization_id`.
- **`EventUpdate`:** add `series_id: uuid.UUID | None = None` after `organization_id`.
- **`EventPublic`:** add these after `organization_slug`:

```python
    series_id: uuid.UUID | None = None
    series_name: str | None = None
    series_slug: str | None = None
```

- [ ] **Step 4: Add the crud helper and call it**

In `backend/app/crud.py`, import `RecurringSeriesType` and `SeriesTypeError` from `app.models`. Then add, directly below `delete_series`:

```python
_SERIES_TYPE_MESSAGES = {
    RecurringSeriesType.quiz: "A quiz can only join a quiz series",
    RecurringSeriesType.event: "An event can only join an event series",
}


def require_series_type(
    *,
    session: Session,
    series_id: uuid.UUID | None,
    expected: RecurringSeriesType,
) -> None:
    """Raise SeriesTypeError if `series_id` names a series of the other type.

    None (no link, or clearing one) always passes. A missing series also
    passes here: existence is the route's 404, checked before this runs.
    """
    if series_id is None:
        return
    series = session.get(RecurringSeries, series_id)
    if series is not None and series.type != expected:
        raise SeriesTypeError(_SERIES_TYPE_MESSAGES[expected])
```

Call it in four places:
- `create_quiz`: as the first statement, `require_series_type(session=session, series_id=quiz_in.series_id, expected=RecurringSeriesType.quiz)`.
- `update_quiz`: after `data = quiz_in.model_dump(exclude_unset=True)`, `require_series_type(session=session, series_id=data.get("series_id"), expected=RecurringSeriesType.quiz)`.
- `create_event`: as the first statement, `require_series_type(session=session, series_id=event_in.series_id, expected=RecurringSeriesType.event)`.
- `update_event`: after the `organization_id` pops, `require_series_type(session=session, series_id=update_data.get("series_id"), expected=RecurringSeriesType.event)`. Don't pop `series_id` when it is None: an explicit null is how a link is cleared.

- [ ] **Step 5: Map the errors in the quiz routes**

In `backend/app/api/routes/quizzes.py`, add `RecurringSeries` and `SeriesTypeError` to the models import.

`create_quiz` body:

```python
    if quiz_in.event_id is not None and not session.get(Event, quiz_in.event_id):
        raise HTTPException(status_code=404, detail="Event not found")
    if quiz_in.series_id is not None and not session.get(
        RecurringSeries, quiz_in.series_id
    ):
        raise HTTPException(status_code=404, detail="Series not found")
    try:
        quiz = crud.create_quiz(
            session=session, quiz_in=quiz_in, submitted_by_id=current_user.id
        )
    except SeriesTypeError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return _quiz_public(quiz, session)
```

`update_quiz`: after the event 404 check, add the same `series_id` 404 check against `quiz_in.series_id`. Then change the `try` to:

```python
    try:
        updated = crud.update_quiz(session=session, db_quiz=quiz, quiz_in=quiz_in)
    except SeriesTypeError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
```

- [ ] **Step 6: Update the events routes**

In `backend/app/api/routes/events.py`, add `uuid` to the imports and `RecurringSeries` and `SeriesTypeError` to the models import.

Replace `_event_public`:

```python
def _event_public(event: Event, session: Session) -> EventPublic:
    org = session.get(Organization, event.organization_id)
    series = session.get(RecurringSeries, event.series_id) if event.series_id else None
    quiz_count = session.exec(
        select(func.count())
        .select_from(Quiz)
        .where(Quiz.event_id == event.id, Quiz.status == QuizStatus.approved)
    ).one()
    return EventPublic(
        **event.model_dump(),
        organization_name=org.name if org else None,
        organization_slug=org.slug if org else None,
        series_name=series.name if series else None,
        series_slug=series.slug if series else None,
        quiz_count=quiz_count,
    )
```

Replace `read_events`:

```python
@router.get("/", response_model=EventListPublic)
def read_events(
    session: SessionDep,
    skip: int = 0,
    limit: int = 100,
    series_id: uuid.UUID | None = None,
) -> Any:
    filters = []
    if series_id is not None:
        filters.append(Event.series_id == series_id)
    count = session.exec(select(func.count()).select_from(Event).where(*filters)).one()
    events = session.exec(
        select(Event)
        .where(*filters)
        .order_by(col(Event.start_date).desc())
        .offset(skip)
        .limit(limit)
    ).all()
    return EventListPublic(
        data=[_event_public(e, session) for e in events], count=count
    )
```

`create_event`: after the organization 404 check, add:

```python
    if event_in.series_id is not None and not session.get(
        RecurringSeries, event_in.series_id
    ):
        raise HTTPException(status_code=404, detail="Series not found")
    try:
        event = crud.create_event(session=session, event_in=event_in)
    except SeriesTypeError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return _event_public(event, session)
```
(This replaces the existing two-line create-and-return.)

`update_event`: after the organization 404 check, add the same `series_id` 404 check against `event_in.series_id`, and add `except SeriesTypeError as e: raise HTTPException(status_code=422, detail=str(e))` as the **first** `except` in the existing `try`.

- [ ] **Step 7: Run the task's tests**

```bash
cd backend
uv run ruff check --select I --fix app/models.py app/crud.py app/api/routes/quizzes.py app/api/routes/events.py tests/api/routes/test_series_links.py
uv run pytest -q -p no:warnings tests/api/routes/test_series_links.py tests/api/routes/test_events.py tests/api/routes/test_quizzes.py
```
Expected: all pass.

- [ ] **Step 8: Run the whole suite and commit**

Run: `cd backend && uv run pytest -q -p no:warnings`
Expected: everything passes except the same 2 `test_countries.py` failures that already fail on `main`.

```bash
git add backend
git commit -m "feat(backend): quizzes join quiz series, events join event series

A link to a series of the other type is a 422, an unknown series a 404.
Events carry series_id/name/slug and GET /events filters by series_id.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Podium event and series fields; event-series podium

**Files:**
- Modify: `backend/app/models.py` (`QuizPodium`, around line 914)
- Modify: `backend/app/podium.py`
- Modify: `backend/app/api/routes/series.py` (`read_series_podium`)
- Test: `backend/tests/api/routes/test_series_links.py` (append)

**Interfaces:**
- Consumes: `Event.series_id` and `RecurringSeriesType` (Task 1), and `create_random_event` (Task 1).
- Produces: `QuizPodium.event_name`, `event_slug`, `series_name` and `series_slug` (`str | None = None`). `GET /series/{id}/podium` for an event series covers approved quizzes across every edition, earliest first.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/api/routes/test_series_links.py`. Add `from datetime import date`, `from app import crud`, `QuizResultCreate`, `QuizStatus` and `ResultParticipantCreate` from `app.models`, and `create_random_player` from `tests.utils.quiz` to its imports.

```python
# --- podium ------------------------------------------------------------------


def _held_quiz(
    db: Session,
    *,
    series_id: uuid.UUID | None,
    event_id: uuid.UUID | None,
    start: date,
    winner_id: uuid.UUID | None = None,
    approved: bool = True,
    qualifier: bool = False,
):
    quiz = create_random_quiz(db)
    quiz.series_id = series_id
    quiz.event_id = event_id
    quiz.start_date = start
    quiz.end_date = start
    quiz.is_qualifier = qualifier
    quiz.status = QuizStatus.approved if approved else QuizStatus.pending
    db.add(quiz)
    db.commit()
    db.refresh(quiz)
    if winner_id is not None:
        crud.create_quiz_results(
            session=db,
            quiz_id=quiz.id,
            results=[
                QuizResultCreate(
                    participants=[ResultParticipantCreate(player_id=winner_id)],
                    final_rank=1,
                    score=100,
                )
            ],
        )
    return quiz


def test_quiz_podium_carries_event_and_series(client: TestClient, db: Session) -> None:
    series = create_random_series(db)
    event = create_random_event(db)
    _held_quiz(db, series_id=series.id, event_id=event.id, start=date(2026, 8, 7))
    body = client.get(f"{API}/series/{series.id}/podium").json()
    quiz = body["quizzes"][0]
    assert quiz["event_name"] == event.name
    assert quiz["event_slug"] == event.slug
    assert quiz["series_name"] == series.name
    assert quiz["series_slug"] == series.slug


def test_quiz_podium_event_fields_null_without_event(
    client: TestClient, db: Session
) -> None:
    series = create_random_series(db)
    _held_quiz(db, series_id=series.id, event_id=None, start=date(2026, 8, 7))
    quiz = client.get(f"{API}/series/{series.id}/podium").json()["quizzes"][0]
    assert quiz["event_name"] is None
    assert quiz["event_slug"] is None
    assert quiz["series_slug"] == series.slug


def test_event_series_podium_spans_editions(client: TestClient, db: Session) -> None:
    event_series = create_random_series(db, type=RecurringSeriesType.event)
    quiz_series = create_random_series(db)
    e2025 = create_random_event(db, series_id=event_series.id, start_date=date(2025, 8, 1))
    e2026 = create_random_event(db, series_id=event_series.id, start_date=date(2026, 8, 7))
    unrelated = create_random_event(db)
    p1, p2, p3 = (create_random_player(db) for _ in range(3))

    a = _held_quiz(db, series_id=quiz_series.id, event_id=e2025.id, start=date(2025, 8, 1), winner_id=p1.id)
    q = _held_quiz(db, series_id=None, event_id=e2025.id, start=date(2025, 8, 2), winner_id=p3.id, qualifier=True)
    b = _held_quiz(db, series_id=quiz_series.id, event_id=e2026.id, start=date(2026, 8, 7), winner_id=p1.id)
    c = _held_quiz(db, series_id=None, event_id=e2026.id, start=date(2026, 8, 8), winner_id=p2.id)
    _held_quiz(db, series_id=None, event_id=e2026.id, start=date(2026, 8, 9), approved=False)
    _held_quiz(db, series_id=None, event_id=unrelated.id, start=date(2026, 8, 7))

    body = client.get(f"{API}/series/{event_series.slug}/podium").json()

    assert [x["quiz_id"] for x in body["quizzes"]] == [str(a.id), str(q.id), str(b.id), str(c.id)]
    medals = {s["player_id"]: (s["gold"], s["silver"], s["bronze"]) for s in body["standings"]}
    assert medals == {str(p1.id): (2, 0, 0), str(p2.id): (1, 0, 0)}


def test_empty_event_series_podium_is_empty(client: TestClient, db: Session) -> None:
    event_series = create_random_series(db, type=RecurringSeriesType.event)
    create_random_event(db, series_id=event_series.id)
    body = client.get(f"{API}/series/{event_series.id}/podium").json()
    assert body == {"quizzes": [], "standings": []}
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd backend && uv run pytest -q -p no:warnings tests/api/routes/test_series_links.py -k podium`
Expected:
- The first two fail with `KeyError: 'event_name'`.
- `test_event_series_podium_spans_editions` fails because the list comes back empty: today the podium query matches `quiz.series_id` only.
- `test_empty_event_series_podium_is_empty` may already pass, which pins the empty case.

- [ ] **Step 3: Add the fields and fill them**

In `backend/app/models.py`, add these to `QuizPodium` after `is_qualifier`:

```python
    event_name: str | None = None
    event_slug: str | None = None
    series_name: str | None = None
    series_slug: str | None = None
```

In `backend/app/podium.py`, add `Event` and `RecurringSeries` to the models import. Inside the `for quiz in quizzes:` loop, before `quiz_podiums.append(...)`, add:

```python
        # session.get is identity-mapped, so repeat lookups within one podium
        # (every quiz at the same edition) cost no extra query.
        event = session.get(Event, quiz.event_id) if quiz.event_id else None
        series = session.get(RecurringSeries, quiz.series_id) if quiz.series_id else None
```

Then pass these into `QuizPodium(...)`:

```python
                event_name=event.name if event else None,
                event_slug=event.slug if event else None,
                series_name=series.name if series else None,
                series_slug=series.slug if series else None,
```

In the `build_podium` docstring, extend the second sentence: `... the series route passes a series' approved quizzes (for an event series, those held at any of its editions), the event route passes an event's.`

- [ ] **Step 4: Make the series podium type-aware**

In `backend/app/api/routes/series.py`, add `Event` to the models import. Then replace the `quizzes = ...` statement in `read_series_podium`:

```python
    if series.type == RecurringSeriesType.event:
        # An event series' quizzes are the ones held at any of its editions.
        edition_quizzes = select(Quiz).join(Event, Quiz.event_id == Event.id).where(
            Event.series_id == series.id
        )
    else:
        edition_quizzes = select(Quiz).where(Quiz.series_id == series.id)
    quizzes = session.exec(
        edition_quizzes.where(Quiz.status == QuizStatus.approved)
        # Series history reads as a chronology: earliest quiz first.
        .order_by(col(Quiz.start_date).asc())
    ).all()
```

- [ ] **Step 5: Run the tests, the suite and commit**

```bash
cd backend
uv run ruff check --select I --fix app/models.py app/podium.py app/api/routes/series.py tests/api/routes/test_series_links.py
uv run pytest -q -p no:warnings tests/api/routes/test_series_links.py tests/api/routes/test_series.py tests/api/routes/test_events.py
uv run pytest -q -p no:warnings
```
Expected: the first run passes in full. The full suite passes except the 2 `test_countries.py` failures that already fail on `main`.

```bash
git add backend
git commit -m "feat(backend): podium names each quiz's event and series; event-series podium

QuizPodium carries event_name/slug and series_name/slug. An event series'
podium covers the approved quizzes held at every edition.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Client, pure helpers, and quiz-only competition lists

**Files:**
- Regenerate: `frontend/src/client/*`
- Create: `frontend/src/lib/seriesMatrix.ts`, `frontend/src/lib/groupEventsBySeries.ts`
- Create: `frontend/tests/series-matrix.test.ts`, `frontend/tests/group-events-by-series.test.ts`
- Modify: `frontend/src/routes/_public/competitions.tsx`, `frontend/src/routes/_public/organizations_.$slug.tsx`, `frontend/src/components/Upload/steps/Step1QuizMeta.tsx`

**Interfaces:**
- Consumes: the Tasks 1–3 API. The generated client exposes:
  - `SeriesService.readSeriesList({ type?, skip?, limit? })`;
  - `RecurringSeriesPublic.type: RecurringSeriesType` (`"quiz" | "event"`);
  - `EventsService.readEvents({ seriesId?, skip?, limit? })`;
  - `EventPublic.series_id`, `series_name` and `series_slug`;
  - the `QuizPodium` `event_*` and `series_*` fields.
- Produces:
  - `buildSeriesMatrix(editions: EventPublic[], quizzes: QuizPodium[]): SeriesMatrix`, with the types `SeriesMatrix { columns: MatrixColumn[]; rows: MatrixRow[] }`, `MatrixColumn { eventId, eventSlug, eventName, year: number }` and `MatrixRow { key, label, seriesSlug: string | null, cells: QuizPodium[][] }`, plus `OTHER_QUIZZES_KEY = "__other__"`.
  - `groupEventsBySeries(events: EventPublic[]): EventListItem[]`, where `EventListItem = { kind: "series"; seriesId; seriesName; seriesSlug; events: EventPublic[] } | { kind: "event"; event: EventPublic }`.
  - `competitionListQueryKey(type?: "quiz" | "event")`, which returns `["competitions", "list", type ?? "all"]`, exported from `src/lib/seriesMatrix.ts`.

- [ ] **Step 1: Regenerate the client**

Run from the repo root: `bash ./scripts/generate-client.sh`
Verify: `grep -n "seriesId\|type: data.type" frontend/src/client/sdk.gen.ts` shows `series_id: data.seriesId` and `type: data.type`, and `grep -n "export type RecurringSeriesType" frontend/src/client/types.gen.ts` prints one line.

- [ ] **Step 2: Write the failing unit tests**

Create `frontend/tests/series-matrix.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import type { EventPublic, QuizPodium } from "../src/client"
import {
  buildSeriesMatrix,
  competitionListQueryKey,
  OTHER_QUIZZES_KEY,
} from "../src/lib/seriesMatrix"

function edition(slug: string, startDate: string): EventPublic {
  return {
    id: `id-${slug}`,
    slug,
    name: slug,
    start_date: startDate,
    end_date: startDate,
    organization_id: "org",
  }
}

function quiz(
  id: string,
  eventSlug: string | null,
  seriesSlug: string | null,
): QuizPodium {
  return {
    quiz_id: id,
    quiz_name: id,
    quiz_slug: id,
    start_date: "2026-01-01",
    end_date: "2026-01-01",
    finishers: [],
    event_name: eventSlug,
    event_slug: eventSlug,
    series_name: seriesSlug ? `Series ${seriesSlug}` : null,
    series_slug: seriesSlug,
  }
}

describe("buildSeriesMatrix", () => {
  test("orders columns by edition date and reads the year", () => {
    const m = buildSeriesMatrix(
      [edition("tn-2026", "2026-08-07"), edition("tn-2025", "2025-08-01")],
      [],
    )
    expect(m.columns.map((c) => [c.eventSlug, c.year])).toEqual([
      ["tn-2025", 2025],
      ["tn-2026", 2026],
    ])
  })

  test("one row per quiz series in first-appearance order, then Other quizzes", () => {
    const m = buildSeriesMatrix(
      [edition("tn-2025", "2025-08-01"), edition("tn-2026", "2026-08-07")],
      [
        quiz("ind-25", "tn-2025", "ind"),
        quiz("pub-25", "tn-2025", null),
        quiz("pairs-26", "tn-2026", "pairs"),
        quiz("ind-26", "tn-2026", "ind"),
      ],
    )
    expect(m.rows.map((r) => r.key)).toEqual(["ind", "pairs", OTHER_QUIZZES_KEY])
    expect(m.rows[0].label).toBe("Series ind")
    expect(m.rows[0].seriesSlug).toBe("ind")
    expect(m.rows[0].cells.map((c) => c.map((q) => q.quiz_id))).toEqual([
      ["ind-25"],
      ["ind-26"],
    ])
    expect(m.rows[1].cells.map((c) => c.length)).toEqual([0, 1])
    expect(m.rows[2].label).toBe("Other quizzes")
    expect(m.rows[2].seriesSlug).toBeNull()
  })

  test("keeps several quizzes of one series held at one edition in one cell", () => {
    const m = buildSeriesMatrix(
      [edition("tn-2026", "2026-08-07")],
      [quiz("heat", "tn-2026", "ind"), quiz("final", "tn-2026", "ind")],
    )
    expect(m.rows[0].cells[0].map((q) => q.quiz_id)).toEqual(["heat", "final"])
  })

  test("skips a quiz whose event is not among the editions", () => {
    const m = buildSeriesMatrix(
      [edition("tn-2026", "2026-08-07")],
      [quiz("elsewhere", "other-event", "ind")],
    )
    expect(m.rows).toEqual([])
  })

  test("editions without quizzes give columns and no rows", () => {
    const m = buildSeriesMatrix([edition("tn-2026", "2026-08-07")], [])
    expect(m.columns).toHaveLength(1)
    expect(m.rows).toEqual([])
  })
})

describe("competitionListQueryKey", () => {
  test("never collides with a competition detail key", () => {
    // Detail pages use ["competitions", slug]; a slug of "quiz" must not
    // read the list cache.
    expect(competitionListQueryKey("quiz")).toEqual(["competitions", "list", "quiz"])
    expect(competitionListQueryKey()).toEqual(["competitions", "list", "all"])
  })
})
```

Create `frontend/tests/group-events-by-series.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import type { EventPublic } from "../src/client"
import { groupEventsBySeries } from "../src/lib/groupEventsBySeries"

function event(name: string, series: string | null): EventPublic {
  return {
    id: `id-${name}`,
    slug: name,
    name,
    start_date: "2026-01-01",
    end_date: "2026-01-01",
    organization_id: "org",
    series_id: series ? `sid-${series}` : null,
    series_name: series ? `Series ${series}` : null,
    series_slug: series,
  }
}

describe("groupEventsBySeries", () => {
  test("groups a series' events where its first (newest) event appears", () => {
    const items = groupEventsBySeries([
      event("tn-2026", "tn"),
      event("solo", null),
      event("tn-2025", "tn"),
    ])
    expect(items.map((i) => i.kind)).toEqual(["series", "event"])
    const group = items[0]
    if (group.kind !== "series") throw new Error("expected a series group")
    expect(group.seriesName).toBe("Series tn")
    expect(group.seriesSlug).toBe("tn")
    expect(group.events.map((e) => e.slug)).toEqual(["tn-2026", "tn-2025"])
  })

  test("events without a series stay as single rows in API order", () => {
    const items = groupEventsBySeries([event("a", null), event("b", null)])
    expect(items).toEqual([
      { kind: "event", event: event("a", null) },
      { kind: "event", event: event("b", null) },
    ])
  })

  test("empty input gives no items", () => {
    expect(groupEventsBySeries([])).toEqual([])
  })
})
```

- [ ] **Step 3: Run them and confirm they fail**

Run: `cd frontend && bun test tests/series-matrix.test.ts tests/group-events-by-series.test.ts`
Expected: both files fail with `Cannot find module '../src/lib/seriesMatrix'` or `'../src/lib/groupEventsBySeries'`.

- [ ] **Step 4: Implement the helpers**

Create `frontend/src/lib/seriesMatrix.ts`:

```ts
import type { EventPublic, QuizPodium } from "@/client"

export const OTHER_QUIZZES_KEY = "__other__"

export interface MatrixColumn {
  eventId: string
  eventSlug: string
  eventName: string
  year: number
}

export interface MatrixRow {
  key: string
  label: string
  /** null for the "Other quizzes" row of one-off quizzes. */
  seriesSlug: string | null
  /** One entry per column; each holds the quizzes of this row held there. */
  cells: QuizPodium[][]
}

export interface SeriesMatrix {
  columns: MatrixColumn[]
  rows: MatrixRow[]
}

/**
 * The "held here" table on an event series page: a column per edition
 * (earliest first), a row per quiz series seen at any edition (in the order
 * they first appear in `quizzes`, which the API sends earliest first), and a
 * final "Other quizzes" row for one-off quizzes. A quiz whose event is not
 * one of `editions` is skipped rather than guessed at.
 */
export function buildSeriesMatrix(
  editions: EventPublic[],
  quizzes: QuizPodium[],
): SeriesMatrix {
  const columns: MatrixColumn[] = [...editions]
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .map((e) => ({
      eventId: e.id,
      eventSlug: e.slug,
      eventName: e.name,
      year: Number(e.start_date.slice(0, 4)),
    }))
  const columnIndex = new Map(columns.map((c, i) => [c.eventSlug, i]))
  const newRow = (
    key: string,
    label: string,
    seriesSlug: string | null,
  ): MatrixRow => ({ key, label, seriesSlug, cells: columns.map(() => []) })

  const seriesRows = new Map<string, MatrixRow>()
  let otherRow: MatrixRow | null = null

  for (const quiz of quizzes) {
    const column = quiz.event_slug ? columnIndex.get(quiz.event_slug) : undefined
    if (column === undefined) continue
    let row: MatrixRow
    if (quiz.series_slug) {
      row =
        seriesRows.get(quiz.series_slug) ??
        newRow(quiz.series_slug, quiz.series_name ?? quiz.series_slug, quiz.series_slug)
      seriesRows.set(quiz.series_slug, row)
    } else {
      otherRow ??= newRow(OTHER_QUIZZES_KEY, "Other quizzes", null)
      row = otherRow
    }
    row.cells[column].push(quiz)
  }

  const rows = [...seriesRows.values()]
  if (otherRow) rows.push(otherRow)
  return { columns, rows }
}

/**
 * Query key for a competition (series) list. Kept apart from the detail keys
 * (["competitions", slug]) and split by type, so the admin list of every type
 * and the public quiz-only list never share a cache entry.
 */
export function competitionListQueryKey(type?: "quiz" | "event") {
  return ["competitions", "list", type ?? "all"] as const
}
```

Create `frontend/src/lib/groupEventsBySeries.ts`:

```ts
import type { EventPublic } from "@/client"

export type EventListItem =
  | {
      kind: "series"
      seriesId: string
      seriesName: string
      seriesSlug: string
      events: EventPublic[]
    }
  | { kind: "event"; event: EventPublic }

/**
 * Groups a recurring event's editions under one entry, placed where its
 * first event appears. The API lists events newest first, so a series sits
 * at its latest edition. Events without a series stay as single entries.
 */
export function groupEventsBySeries(events: EventPublic[]): EventListItem[] {
  const items: EventListItem[] = []
  const groups = new Map<string, Extract<EventListItem, { kind: "series" }>>()
  for (const event of events) {
    if (!event.series_id || !event.series_slug) {
      items.push({ kind: "event", event })
      continue
    }
    let group = groups.get(event.series_id)
    if (!group) {
      group = {
        kind: "series",
        seriesId: event.series_id,
        seriesName: event.series_name ?? event.series_slug,
        seriesSlug: event.series_slug,
        events: [],
      }
      groups.set(event.series_id, group)
      items.push(group)
    }
    group.events.push(event)
  }
  return items
}
```

- [ ] **Step 5: Run the unit tests**

Run: `cd frontend && bun test tests/series-matrix.test.ts tests/group-events-by-series.test.ts`
Expected: all pass.

- [ ] **Step 6: Make the competition lists quiz-only with distinct keys**

These three lists are "Competitions" shown to users, so they request `type: "quiz"`.

`src/routes/_public/competitions.tsx`, `getCompetitionsQueryOptions`:
```ts
    queryFn: () =>
      SeriesService.readSeriesList({ type: "quiz", skip: 0, limit: 100 }),
    queryKey: competitionListQueryKey("quiz"),
```

`src/routes/_public/organizations_.$slug.tsx`, `getCompetitionsQueryOptions`: the same two lines.

`src/components/Upload/steps/Step1QuizMeta.tsx`, the `competitionList` query: the same two lines.

In each file, add `import { competitionListQueryKey } from "@/lib/seriesMatrix"`. The existing `invalidateQueries({ queryKey: ["competitions"] })` calls are prefix matches, so they still cover these keys.

- [ ] **Step 7: Build, lint, run the unit suite and commit**

```bash
cd frontend
bun run build
bun run lint
bun run test:unit
```
Expected: the build succeeds, lint is clean, and all unit tests pass (the previous 253 plus the new ones).

```bash
git add frontend/src frontend/tests/series-matrix.test.ts frontend/tests/group-events-by-series.test.ts
git commit -m "feat(frontend): series matrix and event grouping helpers; quiz-only competition lists

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Public pages: event series page, grouping, "Part of", redirect, "held at"

**Files:**
- Create: `frontend/src/routes/_public/events_.recurring.$slug.tsx`
- Create: `frontend/src/components/Events/SeriesMatrix.tsx`
- Modify: `frontend/src/components/Competitions/CompetitionPodium.tsx`
- Modify: `frontend/src/routes/_public/events.tsx`, `frontend/src/routes/_public/events_.$slug.tsx`, `frontend/src/routes/_public/competitions_.$slug.tsx`

**Interfaces:**
- Consumes: `buildSeriesMatrix`, `SeriesMatrix`, `OTHER_QUIZZES_KEY` and `groupEventsBySeries` (Task 4). The E2E selectors used in Task 7 are listed below. This task comes before the admin task (6) because the admin table links to the route created here.
- Produces:
  - the route `/events/recurring/$slug`;
  - the test ids `series-editions`, `series-matrix` and `series-matrix-row-<key>`, with `<key>` being the series slug or `__other__`;
  - the empty-matrix text `"No quizzes held at these events yet."`;
  - the not-found text `"Recurring event not found."`;
  - the "held at" text `at <event name>` (a link);
  - the "Part of" text `Part of <series name>` (a link);
  - the prop `CompetitionPodium({ podium, quizActions?, showEvent? })`.

- [ ] **Step 1: Create the event series route with its page**

Create `frontend/src/routes/_public/events_.recurring.$slug.tsx`:

```tsx
import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Suspense } from "react"

import { EventsService, SeriesService } from "@/client"
import { CompetitionPodium } from "@/components/Competitions/CompetitionPodium"
import { EventLocation } from "@/components/Events/EventLocation"
import { SeriesMatrix } from "@/components/Events/SeriesMatrix"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { buildSeriesMatrix } from "@/lib/seriesMatrix"

export const Route = createFileRoute("/_public/events_/recurring/$slug")({
  component: EventSeriesPage,
  errorComponent: NotFound,
})

function NotFound() {
  return <p className="text-muted-foreground">Recurring event not found.</p>
}

function EventSeriesDetail({ slug }: { slug: string }) {
  const { data: series } = useSuspenseQuery({
    queryKey: ["series", slug],
    queryFn: () => SeriesService.readSeries({ id: slug }),
  })
  const { data: editions } = useSuspenseQuery({
    queryKey: ["events", "series", series.id],
    queryFn: () =>
      EventsService.readEvents({ seriesId: series.id, skip: 0, limit: 100 }),
  })
  const { data: podium } = useSuspenseQuery({
    queryKey: ["series", slug, "podium"],
    queryFn: () => SeriesService.readSeriesPodium({ id: slug }),
  })

  if (series.type !== "event") return <NotFound />

  const ordered = [...editions.data].sort((a, b) =>
    a.start_date.localeCompare(b.start_date),
  )
  const matrix = buildSeriesMatrix(editions.data, podium.quizzes)

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{series.name}</h1>
        {series.description && (
          <p className="text-muted-foreground">{series.description}</p>
        )}
        {series.organization_slug && series.organization_name && (
          <p className="text-sm text-muted-foreground mt-1">
            Organised by{" "}
            <Link
              to="/organizations/$slug"
              params={{ slug: series.organization_slug }}
              className="hover:underline text-foreground"
            >
              {series.organization_name}
            </Link>
          </p>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4">Editions</h2>
        {ordered.length === 0 ? (
          <p className="text-muted-foreground">No editions yet.</p>
        ) : (
          <div
            className="rounded-md border overflow-x-auto"
            data-testid="series-editions"
          >
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Year</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">Quizzes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ordered.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="tabular-nums">
                      {event.start_date.slice(0, 4)}
                    </TableCell>
                    <TableCell>
                      <Link
                        to="/events/$slug"
                        params={{ slug: event.slug }}
                        className="font-medium hover:underline"
                      >
                        {event.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <EventLocation
                        event={{ ...event, is_online: Boolean(event.is_online) }}
                      />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {event.quiz_count}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4">Held here</h2>
        <SeriesMatrix matrix={matrix} />
      </div>

      <div data-testid="podium-standings">
        <h2 className="text-lg font-semibold mb-4">Podium standings</h2>
        <CompetitionPodium podium={podium} standingsOnly />
      </div>
    </div>
  )
}

function EventSeriesPage() {
  const { slug } = Route.useParams()
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
      <EventSeriesDetail slug={slug} />
    </Suspense>
  )
}
```

- [ ] **Step 2: Create the matrix component**

Create `frontend/src/components/Events/SeriesMatrix.tsx`:

```tsx
import { Link } from "@tanstack/react-router"

import type { QuizPodium } from "@/client"
import { PlayerLinks } from "@/components/Common/PlayerLinks"
import { QualifierSuffix } from "@/components/Quizzes/QualifierSuffix"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { SeriesMatrix as SeriesMatrixData } from "@/lib/seriesMatrix"

function HeldQuiz({ quiz }: { quiz: QuizPodium }) {
  const winners = quiz.finishers.filter((f) => f.place === 1)
  return (
    <div className="flex flex-col">
      {quiz.quiz_slug ? (
        <Link
          to="/quizzes/$slug"
          params={{ slug: quiz.quiz_slug }}
          className="text-xs text-muted-foreground hover:underline"
        >
          {quiz.quiz_name}
          {quiz.is_qualifier && <QualifierSuffix />}
        </Link>
      ) : (
        <span className="text-xs text-muted-foreground">
          {quiz.quiz_name}
          {quiz.is_qualifier && <QualifierSuffix />}
        </span>
      )}
      {winners.length === 0 ? (
        <span className="text-muted-foreground">No result yet</span>
      ) : (
        winners.map((f) =>
          f.team_name ? (
            <span key={f.team_name} className="font-medium">
              {f.team_name}
            </span>
          ) : (
            <PlayerLinks
              key={(f.participants ?? []).map((p) => p.player_id).join("-")}
              players={f.participants ?? []}
            />
          ),
        )
      )}
    </div>
  )
}

export function SeriesMatrix({ matrix }: { matrix: SeriesMatrixData }) {
  if (matrix.rows.length === 0) {
    return (
      <p className="text-muted-foreground">
        No quizzes held at these events yet.
      </p>
    )
  }
  return (
    <div className="rounded-md border overflow-x-auto" data-testid="series-matrix">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Quiz</TableHead>
            {matrix.columns.map((c) => (
              <TableHead key={c.eventId}>
                <Link
                  to="/events/$slug"
                  params={{ slug: c.eventSlug }}
                  className="hover:underline"
                  title={c.eventName}
                >
                  {c.year}
                </Link>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {matrix.rows.map((row) => (
            <TableRow key={row.key} data-testid={`series-matrix-row-${row.key}`}>
              <TableCell className="font-medium whitespace-nowrap align-top">
                {row.seriesSlug ? (
                  <Link
                    to="/competitions/$slug"
                    params={{ slug: row.seriesSlug }}
                    className="hover:underline"
                  >
                    {row.label}
                  </Link>
                ) : (
                  row.label
                )}
              </TableCell>
              {row.cells.map((quizzes, i) => (
                <TableCell key={matrix.columns[i].eventId} className="align-top">
                  {quizzes.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {quizzes.map((q) => (
                        <HeldQuiz key={q.quiz_id} quiz={q} />
                      ))}
                    </div>
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
```

The spec asks for a "Qualifier" tag. This reuses the site's existing `QualifierSuffix` ("(Qualification)") so that every surface names qualifiers the same way. Record it as `Ruling: qualifier tag reuses QualifierSuffix`.

- [ ] **Step 3: Extend `CompetitionPodium` with `showEvent` and `standingsOnly`**

Changes to `frontend/src/components/Competitions/CompetitionPodium.tsx`:

- **`buildPodiumQuizColumns`:** takes a second parameter, `showEvent = false`. In the Quiz column's cell, after the qualifier suffix, add:

```tsx
          {showEvent && row.original.event_slug && (
            <span className="block text-xs text-muted-foreground">
              at{" "}
              <Link
                to="/events/$slug"
                params={{ slug: row.original.event_slug }}
                className="hover:underline"
              >
                {row.original.event_name}
              </Link>
            </span>
          )}
```

- **`CompetitionPodium` props:** gain `showEvent?: boolean` (documented as "Show 'at <event>' under each quiz; for series pages, redundant on an event page") and `standingsOnly?: boolean` (documented as "Render only the standings table; the caller shows the quizzes its own way").
- **Rendering:**
  - When `standingsOnly` is set, return `<PodiumStandingsTable standings={podium.standings} />`. The caller supplies the heading and the `podium-standings` wrapper.
  - Otherwise, build the columns with `buildPodiumQuizColumns(quizActions, showEvent)` and render as today.

- [ ] **Step 4: Competition page: redirect event series, show "held at"**

Changes to `frontend/src/routes/_public/competitions_.$slug.tsx`:

- Add `Navigate` to the `@tanstack/react-router` import.
- In `CompetitionDetail`, directly after the two `useSuspenseQuery` calls and the `useAuth`/`canUpload` lines, add:

```tsx
  // Event series live under /events/recurring; old or guessed links land there.
  if (competition.type === "event") {
    return <Navigate to="/events/recurring/$slug" params={{ slug }} replace />
  }
```

- Change `<CompetitionPodium podium={podium} />` to `<CompetitionPodium podium={podium} showEvent />`.

- [ ] **Step 5: Event page: "Part of" link**

In `frontend/src/routes/_public/events_.$slug.tsx`, directly after the closing `</div>` of the title row (the `flex items-start justify-between` div), insert:

```tsx
        {event.series_slug && event.series_name && (
          <p className="text-sm text-muted-foreground mt-1">
            Part of{" "}
            <Link
              to="/events/recurring/$slug"
              params={{ slug: event.series_slug }}
              className="hover:underline text-foreground"
            >
              {event.series_name}
            </Link>
          </p>
        )}
```

- [ ] **Step 6: Events list: group under series**

Changes to `frontend/src/routes/_public/events.tsx`:

- **Row component:** extract the body of the existing `<tr>` into `function EventRow({ event, indent = false }: { event: EventPublic; indent?: boolean })`. The name `<td>` takes `className={indent ? "py-3 px-4 pl-8" : "py-3 px-4"}`.
- **Imports:** add `import type { EventPublic } from "@/client"` and `import { groupEventsBySeries } from "@/lib/groupEventsBySeries"`.
- **Table body:** replace `data.data.map(...)` with:

```tsx
          {groupEventsBySeries(data.data).map((item) =>
            item.kind === "event" ? (
              <EventRow key={item.event.id} event={item.event} />
            ) : (
              <Fragment key={item.seriesId}>
                <tr className="border-b bg-muted/40">
                  <td colSpan={5} className="py-2 px-4 text-sm font-semibold">
                    <Link
                      to="/events/recurring/$slug"
                      params={{ slug: item.seriesSlug }}
                      className="hover:underline"
                    >
                      {item.seriesName}
                    </Link>
                  </td>
                </tr>
                {item.events.map((event) => (
                  <EventRow key={event.id} event={event} indent />
                ))}
              </Fragment>
            ),
          )}
```

Add `Fragment` to the `react` import.

- [ ] **Step 7: Build, lint, unit tests and commit**

```bash
cd frontend
bun run build
bun run lint
bun run test:unit
grep -n "events_/recurring" src/routeTree.gen.ts | head -3
```
Expected: the build succeeds and regenerates `routeTree.gen.ts` with the new route (the grep prints it), lint is clean, and the unit tests pass.

```bash
git add frontend/src
git commit -m "feat(frontend): recurring event pages, events grouped by series, held-at links

Adds /events/recurring/<slug> (editions, held-here matrix, medal table),
groups /events by series, links an event to its series, and redirects
/competitions/<event-series> there.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Admin: type toggle, Type column, event series select

**Files:**
- Modify: `frontend/src/test-ids.ts`
- Modify: `frontend/src/components/Admin/CompetitionDialog.tsx`
- Modify: `frontend/src/routes/_layout/admin_.competitions.tsx`
- Modify: `frontend/src/components/Admin/EventDialog.tsx`

**Interfaces:**
- Consumes: `competitionListQueryKey` (Task 4), the generated `RecurringSeriesType`, and the `/events/recurring/$slug` route (Task 5).
- Produces:
  - the test ids `Labels.seriesTypeQuiz` (`"series-type-quiz"`), `Labels.seriesTypeEvent` (`"series-type-event"`) and `Labels.eventSeriesSelect` (`"event-series-select"`);
  - the exported constant `SERIES_HAS_LINKS_DETAIL = "Series has linked quizzes or events"` in `CompetitionDialog.tsx`;
  - the toast text `"This competition already has quizzes or events, so its type can't change"`.

- [ ] **Step 1: Add the test ids**

In `frontend/src/test-ids.ts`, add these to `Labels`:
```ts
  seriesTypeQuiz: "series-type-quiz",
  seriesTypeEvent: "series-type-event",
  eventSeriesSelect: "event-series-select",
```

- [ ] **Step 2: Add the Type toggle to `CompetitionDialog`**

Changes to `frontend/src/components/Admin/CompetitionDialog.tsx`:

- **Imports:** add `import { Labels } from "@/test-ids"`.
- **`schema`:** add `type: z.enum(["quiz", "event"]),`.
- **`defaultValues`:** add `type: competition?.type ?? "quiz",`.
- **`useForm` destructuring:** add `setValue` and `watch`, then add `const seriesType = watch("type")`.
- **Module scope, above the component:**

```ts
export const SERIES_HAS_LINKS_DETAIL = "Series has linked quizzes or events"

const SERIES_TYPES = [
  ["quiz", "Quiz", Labels.seriesTypeQuiz],
  ["event", "Event", Labels.seriesTypeEvent],
] as const
```

- **Both `requestBody`s** (create and update): add `type: data.type,`.
- **`onError`:** replace the body with:

```ts
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.status === 409) {
        const detail = (error.body as { detail?: string })?.detail
        if (detail === SERIES_HAS_LINKS_DETAIL) {
          showErrorToast(
            "This competition already has quizzes or events, so its type can't change",
          )
          return
        }
        setError("slug", {
          type: "server",
          message: detail || "Slug is already in use",
        })
        return
      }
      showErrorToast(
        isEdit
          ? "Failed to update competition"
          : "Failed to create competition",
      )
    },
```

- **The form:** directly after the Description block, insert the segmented control:

```tsx
          <div className="grid gap-1.5">
            <Label>Type</Label>
            <div className="flex w-fit rounded-md border overflow-hidden">
              {SERIES_TYPES.map(([value, label, testId]) => (
                <button
                  key={value}
                  type="button"
                  data-testid={testId}
                  aria-pressed={seriesType === value}
                  onClick={() => setValue("type", value)}
                  className={`px-4 py-1.5 text-sm ${seriesType === value ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {seriesType === "event"
                ? "Recurs as events, like a yearly national championship weekend."
                : "Recurs as a single quiz, like a yearly world championship."}
            </p>
          </div>
```

- [ ] **Step 3: Admin competitions table: Type column, per-type link and upload action**

Changes to `frontend/src/routes/_layout/admin_.competitions.tsx`:

- **`CompetitionTableContent` query:**
  ```ts
      queryKey: competitionListQueryKey(),
      queryFn: () => SeriesService.readSeriesList({ skip: 0, limit: 100 }),
  ```
  Also add `import { competitionListQueryKey } from "@/lib/seriesMatrix"`.
- **Header:** add `<th className="py-3 px-4 text-left text-sm font-medium">Type</th>` after "Name".
- **`CompetitionRow`:**
  - Replace the name `<Link>` with a per-type link:
    ```tsx
        {competition.type === "event" ? (
          <Link
            to="/events/recurring/$slug"
            params={{ slug: competition.slug }}
            className="hover:underline"
          >
            {competition.name}
          </Link>
        ) : (
          <Link
            to="/competitions/$slug"
            params={{ slug: competition.slug }}
            className="hover:underline"
          >
            {competition.name}
          </Link>
        )}
    ```
  - Add a Type cell after the name cell:
    ```tsx
      <td className="py-3 px-4 text-muted-foreground">
        {competition.type === "event" ? "Event" : "Quiz"}
      </td>
    ```
  - Render the "Upload a result" `<Button asChild>` only when `competition.type === "quiz"`, because a quiz can't join an event series.

The `/events/recurring/$slug` route already exists from Task 5, so this typed `Link` builds.

- [ ] **Step 4: Add the Recurring series select to `EventDialog`**

Changes to `frontend/src/components/Admin/EventDialog.tsx`:

- **Imports:** add `SeriesService` to the `@/client` import, and add `import { competitionListQueryKey } from "@/lib/seriesMatrix"` and `import { Labels } from "@/test-ids"`.
- **`fields`:** add `series_id: z.string().optional(),`.
- **`defaultValues`:** add `series_id: event?.series_id ?? "",`.
- **Queries:** below the `orgs` query, add:

```ts
  const { data: eventSeries } = useQuery({
    queryKey: competitionListQueryKey("event"),
    queryFn: () =>
      SeriesService.readSeriesList({ type: "event", skip: 0, limit: 100 }),
  })
```

- **Both `requestBody`s:** add `series_id: data.series_id || null,`.
- **The form:** after the Organization block, insert:

```tsx
          <div className="grid gap-1.5">
            <Label>Recurring series</Label>
            <select
              {...register("series_id")}
              data-testid={Labels.eventSeriesSelect}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">— none (a one-off event) —</option>
              {eventSeries?.data.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
```

- [ ] **Step 5: Build, lint, unit tests and commit**

```bash
cd frontend
bun run build
bun run lint
bun run test:unit
```
Expected: all succeed.

```bash
git add frontend/src
git commit -m "feat(frontend): admin sets a competition's type and an event's recurring series

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: E2E coverage and the full suite

**Files:**
- Create: `frontend/tests/events-recurring.spec.ts`
- Modify: `frontend/tests/competitions-admin.spec.ts`, `frontend/tests/events.spec.ts`, `frontend/tests/upload.spec.ts`

**Interfaces:**
- Consumes: everything above. The fixtures are built through the generated client (`SeriesService`, `EventsService`, `QuizzesService`, `PlayersService`, `OrganizationsService`).

- [ ] **Step 1: Write the recurring-events spec**

Create `frontend/tests/events-recurring.spec.ts`:

```ts
import { expect, test } from "@playwright/test"
import {
  EventsService,
  OpenAPI,
  OrganizationsService,
  PlayersService,
  QuizzesService,
  SeriesService,
} from "../src/client"
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

test.describe("Recurring events", () => {
  const runId = Date.now()
  const orgName = `Recurring Org ${runId}`
  const eventSeriesName = `Trivia Nationals ${runId}`
  const emptySeriesName = `Empty Recurring ${runId}`
  const quizSeriesName = `TN Individual ${runId}`
  const edition2025 = `Trivia Nationals 2025 ${runId}`
  const edition2026 = `Trivia Nationals 2026 ${runId}`
  const winnerA = `Recurring Winner A ${runId}`
  const winnerB = `Recurring Winner B ${runId}`
  const oneOffName = `TN Pub Quiz ${runId}`

  let orgId = ""
  let eventSeriesSlug = ""
  let emptySeriesSlug = ""
  let quizSeriesSlug = ""
  let edition2026Slug = ""
  const seriesIds: string[] = []
  const eventIds: string[] = []
  const quizIds: string[] = []
  const playerIds: string[] = []

  async function heldQuiz(
    name: string,
    date: string,
    eventId: string,
    seriesId: string | null,
    winnerId: string,
  ) {
    const quiz = await QuizzesService.createQuiz({
      requestBody: {
        name,
        start_date: date,
        end_date: date,
        organization_id: orgId,
        event_id: eventId,
        series_id: seriesId,
      },
    })
    quizIds.push(quiz.id)
    await QuizzesService.submitResults({
      id: quiz.id,
      requestBody: {
        results: [
          { participants: [{ player_id: winnerId }], final_rank: 1, score: 90 },
        ],
      },
    })
    await QuizzesService.approveQuiz({ id: quiz.id })
  }

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()

    orgId = (
      await OrganizationsService.createOrganization({
        requestBody: { name: orgName },
      })
    ).id

    const eventSeries = await SeriesService.createSeries({
      requestBody: { name: eventSeriesName, organization_id: orgId, type: "event" },
    })
    const emptySeries = await SeriesService.createSeries({
      requestBody: { name: emptySeriesName, organization_id: orgId, type: "event" },
    })
    const quizSeries = await SeriesService.createSeries({
      requestBody: { name: quizSeriesName, organization_id: orgId },
    })
    seriesIds.push(eventSeries.id, emptySeries.id, quizSeries.id)
    eventSeriesSlug = eventSeries.slug
    emptySeriesSlug = emptySeries.slug
    quizSeriesSlug = quizSeries.slug

    const e2025 = await EventsService.createEvent({
      requestBody: {
        name: edition2025,
        start_date: "2025-08-01",
        end_date: "2025-08-03",
        is_online: true,
        organization_id: orgId,
        series_id: eventSeries.id,
      },
    })
    const e2026 = await EventsService.createEvent({
      requestBody: {
        name: edition2026,
        start_date: "2026-08-07",
        end_date: "2026-08-09",
        is_online: true,
        organization_id: orgId,
        series_id: eventSeries.id,
      },
    })
    const emptyEdition = await EventsService.createEvent({
      requestBody: {
        name: `Empty Edition ${runId}`,
        start_date: "2026-05-01",
        end_date: "2026-05-01",
        is_online: true,
        organization_id: orgId,
        series_id: emptySeries.id,
      },
    })
    eventIds.push(e2025.id, e2026.id, emptyEdition.id)
    edition2026Slug = e2026.slug

    for (const name of [winnerA, winnerB]) {
      const p = await PlayersService.createPlayerRoute({
        requestBody: { display_name: name },
      })
      playerIds.push(p.id)
    }

    await heldQuiz(`TN Individual 2025 ${runId}`, "2025-08-01", e2025.id, quizSeries.id, playerIds[0])
    await heldQuiz(`TN Individual 2026 ${runId}`, "2026-08-07", e2026.id, quizSeries.id, playerIds[0])
    await heldQuiz(oneOffName, "2026-08-08", e2026.id, null, playerIds[1])
  })

  test.afterAll(async () => {
    for (const id of quizIds) await QuizzesService.deleteQuiz({ id }).catch(() => {})
    for (const id of eventIds) await EventsService.deleteEvent({ id }).catch(() => {})
    for (const id of seriesIds) await SeriesService.deleteSeries({ id }).catch(() => {})
    for (const id of playerIds)
      await PlayersService.deletePlayerRoute({ playerId: id }).catch(() => {})
    if (orgId)
      await OrganizationsService.deleteOrganization({ id: orgId }).catch(() => {})
  })

  test("the series page lists editions, the held-here matrix and medals", async ({
    page,
  }) => {
    await page.goto(`/events/recurring/${eventSeriesSlug}`)
    await expect(page.getByRole("heading", { name: eventSeriesName })).toBeVisible()

    const editions = page.getByTestId("series-editions")
    await expect(editions.getByRole("link", { name: edition2025 })).toBeVisible()
    await expect(editions.getByRole("link", { name: edition2026 })).toBeVisible()

    const seriesRow = page.getByTestId(`series-matrix-row-${quizSeriesSlug}`)
    await expect(seriesRow.getByRole("link", { name: quizSeriesName })).toBeVisible()
    await expect(seriesRow.getByRole("cell")).toHaveCount(3)
    await expect(seriesRow.getByRole("cell").nth(1)).toContainText(winnerA)
    await expect(seriesRow.getByRole("cell").nth(2)).toContainText(winnerA)

    const otherRow = page.getByTestId("series-matrix-row-__other__")
    await expect(otherRow.getByRole("cell").first()).toHaveText("Other quizzes")
    await expect(otherRow.getByRole("cell").nth(1)).toHaveText("—")
    await expect(otherRow.getByRole("cell").nth(2)).toContainText(oneOffName)
    await expect(otherRow.getByRole("cell").nth(2)).toContainText(winnerB)

    const standings = page.getByTestId("podium-standings")
    await expect(standings.getByRole("row").filter({ hasText: winnerA })).toContainText("2")
    await expect(standings.getByRole("row").filter({ hasText: winnerB })).toContainText("1")
  })

  test("an event series with no quizzes still shows its editions", async ({
    page,
  }) => {
    await page.goto(`/events/recurring/${emptySeriesSlug}`)
    await expect(page.getByRole("heading", { name: emptySeriesName })).toBeVisible()
    await expect(page.getByText("No quizzes held at these events yet.")).toBeVisible()
    await expect(
      page.getByTestId("series-editions").getByRole("link", { name: `Empty Edition ${runId}` }),
    ).toBeVisible()
  })

  test("an edition links back to its series", async ({ page }) => {
    await page.goto(`/events/${edition2026Slug}`)
    await page.getByRole("link", { name: eventSeriesName }).click()
    await expect(page).toHaveURL(new RegExp(`/events/recurring/${eventSeriesSlug}$`))
  })

  test("a quiz series page says where each quiz was held", async ({ page }) => {
    await page.goto(`/competitions/${quizSeriesSlug}`)
    await expect(page.getByRole("link", { name: edition2025 })).toBeVisible()
    await expect(page.getByRole("link", { name: edition2026 })).toBeVisible()
  })

  test("/competitions/<event series> redirects to the recurring event page", async ({
    page,
  }) => {
    await page.goto(`/competitions/${eventSeriesSlug}`)
    await expect(page).toHaveURL(new RegExp(`/events/recurring/${eventSeriesSlug}$`))
    await expect(page.getByRole("heading", { name: eventSeriesName })).toBeVisible()
  })

  test("/events groups editions under their series", async ({ page }) => {
    await page.goto("/events")
    const header = page.getByRole("row").filter({ hasText: eventSeriesName })
    await expect(header.getByRole("link", { name: eventSeriesName })).toBeVisible()
  })

  test("admin → public navigation does not leak event series", async ({ page }) => {
    // The admin list holds every type; /competitions must not reuse that cache.
    await page.goto("/admin/competitions")
    await expect(page.getByRole("row").filter({ hasText: eventSeriesName })).toBeVisible()
    await page.getByRole("row").filter({ hasText: quizSeriesName })
      .getByRole("link", { name: quizSeriesName }).click()
    await expect(page).toHaveURL(new RegExp(`/competitions/${quizSeriesSlug}$`))
    await page.getByRole("link", { name: "Competitions", exact: true }).first().click()
    await expect(page).toHaveURL(/\/competitions$/)
    await expect(page.getByRole("link", { name: quizSeriesName })).toBeVisible()
    await expect(page.getByRole("link", { name: eventSeriesName })).toHaveCount(0)
  })
})
```

The last test clicks a "Competitions" nav link. On `/competitions/<slug>` that's the public nav. If the public layout also renders another link with that exact name, `.first()` picks the nav one because the header comes first in DOM order. If the page doesn't navigate, check `src/components/Common/PublicNav.tsx` for the link's text, and adjust only the locator.

- [ ] **Step 2: Add the admin spec cases**

Append inside the `"Admin Competitions page"` describe in `frontend/tests/competitions-admin.spec.ts`. Add `Labels` from `../src/test-ids`, and `SeriesService` and `QuizzesService` from `../src/client`, to the imports if they're missing.

```ts
  test("create an event-type competition; editing keeps its type", async ({
    page,
  }) => {
    const name = `Recurring Admin ${Date.now()}`
    await page.goto("/admin/competitions")
    await page.getByRole("button", { name: "New Competition" }).click()
    await page.locator('input[name="name"]').fill(name)
    await page.locator('select[name="organization_id"]').selectOption(orgId)
    await page.getByTestId(Labels.seriesTypeEvent).click()
    await expect(page.getByTestId(Labels.seriesTypeEvent)).toHaveClass(/bg-primary/)
    await page.getByRole("button", { name: "Create" }).click()
    await expect(page.getByText("Competition created")).toBeVisible()

    const row = page.getByRole("row").filter({ hasText: name })
    await expect(row.getByRole("cell").nth(1)).toHaveText("Event")
    await expect(row.getByRole("link", { name })).toHaveAttribute(
      "href",
      /\/events\/recurring\//,
    )
    await expect(
      row.getByRole("link", { name: `Upload a result in ${name}` }),
    ).toHaveCount(0)

    // Edit without touching Type: it must stay an event.
    await row.getByRole("button", { name: `Edit ${name}` }).click()
    await expect(page.getByTestId(Labels.seriesTypeEvent)).toHaveClass(/bg-primary/)
    await page.locator('input[name="name"]').fill(`${name} renamed`)
    await page.getByRole("button", { name: "Save" }).click()
    await expect(page.getByText("Competition updated")).toBeVisible()
    const renamed = page.getByRole("row").filter({ hasText: `${name} renamed` })
    await expect(renamed.getByRole("cell").nth(1)).toHaveText("Event")

    await renamed.getByRole("button", { name: `Delete ${name} renamed` }).click()
    await page.getByRole("button", { name: "Delete" }).click()
    await expect(page.getByText("Competition deleted")).toBeVisible()
  })

  test("changing the type of a competition with quizzes shows an error", async ({
    page,
  }) => {
    const name = `Linked Type ${Date.now()}`
    const series = await SeriesService.createSeries({
      requestBody: { name, organization_id: orgId },
    })
    const quiz = await QuizzesService.createQuiz({
      requestBody: {
        name: `${name} quiz`,
        start_date: "2026-01-01",
        end_date: "2026-01-01",
        series_id: series.id,
      },
    })
    try {
      await page.goto("/admin/competitions")
      const row = page.getByRole("row").filter({ hasText: name })
      await row.getByRole("button", { name: `Edit ${name}` }).click()
      await page.getByTestId(Labels.seriesTypeEvent).click()
      await page.getByRole("button", { name: "Save" }).click()
      await expect(
        page.getByText(
          "This competition already has quizzes or events, so its type can't change",
        ),
      ).toBeVisible()
    } finally {
      await QuizzesService.deleteQuiz({ id: quiz.id }).catch(() => {})
      await SeriesService.deleteSeries({ id: series.id }).catch(() => {})
    }
  })
```

Column index note: the row's cells are Name(0), Type(1), Description(2), Organization(3) and Actions(4), which matches the Task 6 header order.

- [ ] **Step 3: Add the event dialog case**

Append to `frontend/tests/events.spec.ts`, as a new top-level `describe` at the end of the file. Add `SeriesService` to its client import, and `Labels` if it's missing.

```ts
test.describe("Admin event dialog — recurring series", () => {
  const runId = Date.now()
  const seriesName = `Dialog Series ${runId}`
  const eventName = `Dialog Edition ${runId}`
  let orgId = ""
  let seriesId = ""
  let eventId = ""

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()
    orgId = (
      await OrganizationsService.createOrganization({
        requestBody: { name: `Dialog Org ${runId}` },
      })
    ).id
    seriesId = (
      await SeriesService.createSeries({
        requestBody: { name: seriesName, organization_id: orgId, type: "event" },
      })
    ).id
    eventId = (
      await EventsService.createEvent({
        requestBody: {
          name: eventName,
          start_date: "2026-09-01",
          end_date: "2026-09-01",
          is_online: true,
          organization_id: orgId,
        },
      })
    ).id
  })

  test.afterAll(async () => {
    if (eventId) await EventsService.deleteEvent({ id: eventId }).catch(() => {})
    if (seriesId) await SeriesService.deleteSeries({ id: seriesId }).catch(() => {})
    if (orgId)
      await OrganizationsService.deleteOrganization({ id: orgId }).catch(() => {})
  })

  test("assigning a recurring series groups the event under it on /events", async ({
    page,
  }) => {
    await page.goto("/admin/events")
    const row = page.getByRole("row").filter({ hasText: eventName })
    await row.getByRole("button").first().click()
    await page.getByTestId(Labels.eventSeriesSelect).selectOption(seriesId)
    await page.getByRole("button", { name: "Save" }).click()
    await expect(page.getByText("Event updated")).toBeVisible()

    const saved = await EventsService.readEvent({ id: eventId })
    expect(saved.series_id).toBe(seriesId)

    await page.goto("/events")
    await expect(
      page.getByRole("row").filter({ hasText: seriesName }).getByRole("link", { name: seriesName }),
    ).toBeVisible()
  })
})
```

- [ ] **Step 4: Add the upload dropdown case**

In `frontend/tests/upload.spec.ts`, inside the `"Upload wizard — organization and competition survive a revisit"` describe:
- Add `let eventSeriesId: string` and `const eventSeriesName = \`Org Revisit Event Series ${runId}\``.
- In `beforeAll`, after the competition is created, add:

```ts
    eventSeriesId = (
      await SeriesService.createSeries({
        requestBody: { name: eventSeriesName, organization_id: orgId, type: "event" },
      })
    ).id
```

- In `afterAll`, add `if (eventSeriesId) await SeriesService.deleteSeries({ id: eventSeriesId }).catch(() => {})`.
- In the test, immediately after `await page.getByTestId(Labels.uploadCompetitionSelect).click()`, and before clicking the competition option, add:

```ts
    await expect(page.getByRole("option", { name: competitionName })).toBeVisible()
    await expect(page.getByRole("option", { name: eventSeriesName })).toHaveCount(0)
```

- [ ] **Step 5: Lint the specs**

Run: `cd frontend && bun run lint`
Expected: clean.

- [ ] **Step 6: Rebuild the backend and prepare the stack**

```bash
cd /Users/ahancock/dev/quiz-reference-demo
grep DB_TARGET .env                          # must be DB_TARGET=dev
docker compose up -d --build backend         # prestart runs c7d2e9f1a4b6 (already applied: no-op)
curl -s --retry 15 --retry-connrefused --retry-all-errors --retry-delay 2 -o /dev/null -w "%{http_code}\n" "localhost:8000/api/v1/series/?type=event"
docker compose stop frontend
docker compose up -d mailcatcher
```
Expected: `DB_TARGET=dev` and `200`.

- [ ] **Step 7: Run the full E2E suite once**

Run: `cd frontend && bunx playwright test --config playwright.config.cts --reporter=line`
Expected: all tests pass, apart from the 2 declared `test.skip` specs. Nothing else may run Playwright at the same time. If a test fails, rerun that single spec to tell a flaky failure from a real one before changing code.

- [ ] **Step 8: Restore the Docker frontend and commit**

```bash
cd /Users/ahancock/dev/quiz-reference-demo
docker compose up -d --build frontend
git add frontend/tests
git commit -m "test(e2e): recurring event pages, admin type toggle, series select, quiz-only dropdown

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Final checks and PR

**Files:** none changed.

- [ ] **Step 1: Hand-check the pages**

Against the rebuilt stack (http://localhost:5173), check:
- **`/admin/competitions`:** create an event-type competition "Trivia Nationals" and assign two events to it through `/admin/events`.
- **`/events`:** those events are grouped under "Trivia Nationals".
- **`/events/recurring/<slug>`:** the editions, matrix and medals render and read sensibly at phone width. The matrix scrolls sideways inside its box, and the page doesn't scroll horizontally.
- **`/competitions`:** Trivia Nationals is absent.

Clean up what you created.

- [ ] **Step 2: Final checks**

```bash
cd backend && uv run pytest -q -p no:warnings; cd ..
git status
git log --oneline main..HEAD
```
Expected:
- the backend passes except the 2 `test_countries.py` failures that already fail on `main`;
- the tree is clean;
- 7 feature/test commits plus this plan.

- [ ] **Step 3: Push and open the PR (confirm with the user first)**

`gh` isn't installed on this machine. Push, then give the user the compare URL and a PR description to paste:

```bash
git push -u origin refactor-recurring-events-part-ii
```

Compare URL: `https://github.com/adam-is-travelling/quiz-reference-demo/compare/main...refactor-recurring-events-part-ii?expand=1`

The PR description should cover:
- what was added: series type, events in a series, the event series page, grouping, "held at", the redirect, and the admin controls;
- the rules: 422 for the wrong type, 404 for an unknown series, 409 for a type change when linked;
- the migration `c7d2e9f1a4b6`;
- test results;
- the deploy note: rebuild backend and frontend together.

End it with the Claude Code attribution line.
