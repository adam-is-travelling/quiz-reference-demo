# Quiz Competition Results — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a quiz competition results platform where authorized organizers submit results for superuser approval, with public event/player pages and a 5-step upload wizard.

**Architecture:** Five new SQLModel entities (Organization → QuizSeries → QuizEvent → EventResult ← Player) added to the existing single-file `models.py`. FastAPI routes follow the one-file-per-domain pattern in `backend/app/api/routes/`. Frontend adds a `_public` pathless layout (no auth required) alongside the existing `_layout`, using TanStack Router file-based routing and TanStack Query.

**Tech Stack:** FastAPI, SQLModel, PostgreSQL, Alembic, pytest; React 19, TanStack Router/Query, shadcn/ui, Tailwind CSS v4, Playwright

---

## File Map

### Backend — new files
- `backend/app/api/routes/organizations.py`
- `backend/app/api/routes/series.py`
- `backend/app/api/routes/players.py`
- `backend/app/api/routes/events.py`
- `backend/tests/api/routes/test_organizations.py`
- `backend/tests/api/routes/test_series.py`
- `backend/tests/api/routes/test_players.py`
- `backend/tests/api/routes/test_events.py`
- `backend/tests/utils/quiz.py`

### Backend — modified files
- `backend/app/models.py` — add 5 new entities + `is_organizer` on User
- `backend/app/crud.py` — add CRUD functions for all new entities
- `backend/app/api/deps.py` — add `OptionalCurrentUser`, `CurrentOrganizer`
- `backend/app/api/main.py` — register 4 new routers
- `backend/tests/conftest.py` — add organizer fixture + cleanup new models
- `backend/tests/utils/user.py` — add `create_organizer_user`

### Frontend — new files
- `frontend/src/routes/_public.tsx`
- `frontend/src/routes/_public/events.tsx`
- `frontend/src/routes/_public/events.$id.tsx`
- `frontend/src/routes/_public/organizations.tsx`
- `frontend/src/routes/_public/organizations.$id.tsx`
- `frontend/src/routes/_public/series.$id.tsx`
- `frontend/src/routes/_public/quizzers.tsx`
- `frontend/src/routes/_public/quizzer.$slug.tsx`
- `frontend/src/routes/_layout/upload.tsx`
- `frontend/src/routes/_layout/admin.events.tsx`
- `frontend/src/routes/_layout/admin.events.$id.tsx`
- `frontend/src/routes/_layout/admin.players.$id.tsx`
- `frontend/src/components/Common/PublicNav.tsx`
- `frontend/src/components/Events/columns.tsx`
- `frontend/src/components/Events/EventResultsTable.tsx`
- `frontend/src/components/Players/PlayerProfile.tsx`
- `frontend/src/components/Upload/UploadWizard.tsx`
- `frontend/src/components/Upload/steps/` (5 step components)

### Frontend — modified files
- `frontend/src/components/Sidebar/AppSidebar.tsx` — add Upload + Review links
- `frontend/src/routeTree.gen.ts` — auto-regenerated

---

## Task 1: Models, Migration, Conftest

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/tests/conftest.py`
- Create: `backend/app/alembic/versions/<hash>_add_quiz_models.py` (auto-generated)

- [ ] **Step 1: Write a failing smoke test**

Create `backend/tests/crud/test_quiz_models.py`:

```python
from sqlmodel import Session, select
from app.models import Organization, OrganizationCreate
from app import crud


def test_create_organization(db: Session) -> None:
    org = crud.create_organization(
        session=db,
        org_in=OrganizationCreate(name="Test Org"),
    )
    assert org.id is not None
    assert org.name == "Test Org"
```

- [ ] **Step 2: Run test, verify it fails**

```bash
cd backend && uv run pytest tests/crud/test_quiz_models.py -v
```

Expected: `ImportError` or `AttributeError` — `crud.create_organization` does not exist yet.

- [ ] **Step 3: Add new models to `backend/app/models.py`**

Add these imports at the top of the file (after existing imports):

```python
import enum
from datetime import date
from sqlalchemy import Column, JSON
```

Add `is_organizer` to `UserBase`:

```python
class UserBase(SQLModel):
    email: EmailStr = Field(unique=True, index=True, max_length=255)
    is_active: bool = True
    is_superuser: bool = False
    is_organizer: bool = False          # ← add this line
    full_name: str | None = Field(default=None, max_length=255)
```

Append all new models after the existing `NewPassword` model:

```python
# ---------------------------------------------------------------------------
# Organization
# ---------------------------------------------------------------------------

class OrganizationBase(SQLModel):
    name: str = Field(max_length=255)
    description: str | None = Field(default=None)
    website: str | None = Field(default=None, max_length=512)
    logo_url: str | None = Field(default=None, max_length=512)


class OrganizationCreate(OrganizationBase):
    pass


class OrganizationUpdate(SQLModel):
    name: str | None = Field(default=None, max_length=255)
    description: str | None = None
    website: str | None = Field(default=None, max_length=512)
    logo_url: str | None = Field(default=None, max_length=512)


class Organization(OrganizationBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)


class OrganizationPublic(OrganizationBase):
    id: uuid.UUID


class OrganizationsPublic(SQLModel):
    data: list[OrganizationPublic]
    count: int


# ---------------------------------------------------------------------------
# QuizSeries
# ---------------------------------------------------------------------------

class QuizSeriesBase(SQLModel):
    name: str = Field(max_length=255)
    description: str | None = Field(default=None)


class QuizSeriesCreate(QuizSeriesBase):
    organization_id: uuid.UUID | None = None


class QuizSeriesUpdate(SQLModel):
    name: str | None = Field(default=None, max_length=255)
    description: str | None = None
    organization_id: uuid.UUID | None = None


class QuizSeries(QuizSeriesBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    organization_id: uuid.UUID | None = Field(
        default=None, foreign_key="organization.id", ondelete="SET NULL"
    )


class QuizSeriesPublic(QuizSeriesBase):
    id: uuid.UUID
    organization_id: uuid.UUID | None = None


class QuizSeriesListPublic(SQLModel):
    data: list[QuizSeriesPublic]
    count: int


# ---------------------------------------------------------------------------
# QuizEvent
# ---------------------------------------------------------------------------

class EventStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"


class QuizEventBase(SQLModel):
    name: str = Field(max_length=255)
    start_date: date
    end_date: date
    description: str | None = Field(default=None)
    organizer_name: str = Field(max_length=255)


class QuizEventCreate(QuizEventBase):
    format: dict | None = None
    series_id: uuid.UUID | None = None
    organization_id: uuid.UUID | None = None


class QuizEventUpdate(SQLModel):
    name: str | None = Field(default=None, max_length=255)
    start_date: date | None = None
    end_date: date | None = None
    description: str | None = None
    organizer_name: str | None = Field(default=None, max_length=255)
    format: dict | None = None
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
    format: dict | None = Field(default=None, sa_column=Column(JSON, nullable=True))
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
    format: dict | None = None
    created_at: datetime | None = None


class QuizEventsPublic(SQLModel):
    data: list[QuizEventPublic]
    count: int


# ---------------------------------------------------------------------------
# Player
# ---------------------------------------------------------------------------

class PlayerBase(SQLModel):
    display_name: str = Field(max_length=255)
    country: str = Field(max_length=100)
    city: str | None = Field(default=None, max_length=255)
    club: str | None = Field(default=None, max_length=255)
    bio: str | None = Field(default=None)
    photo_url: str | None = Field(default=None, max_length=512)


class PlayerCreate(PlayerBase):
    pass


class PlayerUpdate(SQLModel):
    display_name: str | None = Field(default=None, max_length=255)
    country: str | None = Field(default=None, max_length=100)
    city: str | None = Field(default=None, max_length=255)
    club: str | None = Field(default=None, max_length=255)
    bio: str | None = None
    photo_url: str | None = Field(default=None, max_length=512)
    slug: str | None = Field(default=None, max_length=255)


class Player(PlayerBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    slug: str | None = Field(default=None, unique=True, index=True, max_length=255)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),
    )


class PlayerPublic(PlayerBase):
    id: uuid.UUID
    slug: str | None = None
    created_at: datetime | None = None


class PlayersPublic(SQLModel):
    data: list[PlayerPublic]
    count: int


class PlayerSearchResult(SQLModel):
    player: PlayerPublic
    similarity: float


class PlayerSearchResults(SQLModel):
    data: list[PlayerSearchResult]


class PlayerResultWithEvent(SQLModel):
    result_id: uuid.UUID
    event_id: uuid.UUID
    event_name: str
    start_date: date
    end_date: date
    score: float
    tiebreaker_rank: int
    final_rank: int | None = None


class PlayerHistory(SQLModel):
    data: list[PlayerResultWithEvent]


# ---------------------------------------------------------------------------
# EventResult
# ---------------------------------------------------------------------------

class EventResultCreate(SQLModel):
    player_id: uuid.UUID
    score: float
    tiebreaker_rank: int


class EventResultUpdate(SQLModel):
    score: float | None = None
    tiebreaker_rank: int | None = None


class EventResult(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    event_id: uuid.UUID = Field(foreign_key="quizevent.id", ondelete="CASCADE")
    player_id: uuid.UUID = Field(foreign_key="player.id", ondelete="CASCADE")
    score: float
    tiebreaker_rank: int
    final_rank: int | None = None


class EventResultPublic(SQLModel):
    id: uuid.UUID
    event_id: uuid.UUID
    player_id: uuid.UUID
    score: float
    tiebreaker_rank: int
    final_rank: int | None = None


class EventResultsPublic(SQLModel):
    data: list[EventResultPublic]
    count: int


# ---------------------------------------------------------------------------
# Upload flow — parse / submit models
# ---------------------------------------------------------------------------

class ParsedResultRow(SQLModel):
    player_name: str
    country: str
    score: float
    tiebreaker_rank: int


class ParseResultsRequest(SQLModel):
    rows: list[ParsedResultRow]


class ParsedResultWithCandidates(SQLModel):
    row: ParsedResultRow
    candidates: list[PlayerSearchResult]


class ParseResultsResponse(SQLModel):
    results: list[ParsedResultWithCandidates]


class ResolvedResultRow(SQLModel):
    player_id: uuid.UUID | None = None
    player_create: PlayerCreate | None = None
    score: float
    tiebreaker_rank: int


class SubmitResultsRequest(SQLModel):
    results: list[ResolvedResultRow]
```

- [ ] **Step 4: Add CRUD functions to `backend/app/crud.py`**

Append after the existing `create_item` function:

```python
import re
from difflib import SequenceMatcher

from app.models import (
    Organization, OrganizationCreate, OrganizationUpdate,
    QuizSeries, QuizSeriesCreate, QuizSeriesUpdate,
    QuizEvent, QuizEventCreate, QuizEventUpdate, EventStatus,
    Player, PlayerCreate, PlayerUpdate,
    EventResult, EventResultCreate,
)


# --- Organization ---

def create_organization(*, session: Session, org_in: OrganizationCreate) -> Organization:
    org = Organization.model_validate(org_in)
    session.add(org)
    session.commit()
    session.refresh(org)
    return org


def update_organization(
    *, session: Session, db_org: Organization, org_in: OrganizationUpdate
) -> Organization:
    db_org.sqlmodel_update(org_in.model_dump(exclude_unset=True))
    session.add(db_org)
    session.commit()
    session.refresh(db_org)
    return db_org


# --- QuizSeries ---

def create_series(*, session: Session, series_in: QuizSeriesCreate) -> QuizSeries:
    series = QuizSeries.model_validate(series_in)
    session.add(series)
    session.commit()
    session.refresh(series)
    return series


def update_series(
    *, session: Session, db_series: QuizSeries, series_in: QuizSeriesUpdate
) -> QuizSeries:
    db_series.sqlmodel_update(series_in.model_dump(exclude_unset=True))
    session.add(db_series)
    session.commit()
    session.refresh(db_series)
    return db_series


# --- Player ---

def _generate_slug(*, session: Session, display_name: str) -> str:
    base = re.sub(r"[^\w\s-]", "", display_name.lower())
    base = re.sub(r"[\s_]+", "-", base).strip("-")
    slug, counter = base, 2
    while session.exec(select(Player).where(Player.slug == slug)).first():
        slug = f"{base}-{counter}"
        counter += 1
    return slug


def create_player(*, session: Session, player_in: PlayerCreate) -> Player:
    slug = _generate_slug(session=session, display_name=player_in.display_name)
    player = Player.model_validate(player_in, update={"slug": slug})
    session.add(player)
    session.commit()
    session.refresh(player)
    return player


def get_player_by_slug(*, session: Session, slug: str) -> Player | None:
    return session.exec(select(Player).where(Player.slug == slug)).first()


def search_players(
    *, session: Session, q: str, country: str | None = None, limit: int = 5
) -> list[tuple[Player, float]]:
    stmt = select(Player).where(col(Player.display_name).ilike(f"%{q}%"))
    if country:
        stmt = stmt.where(col(Player.country).ilike(f"%{country}%"))
    players = session.exec(stmt).all()
    scored = [
        (p, SequenceMatcher(None, q.lower(), p.display_name.lower()).ratio())
        for p in players
    ]
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:limit]


def update_player(
    *, session: Session, db_player: Player, player_in: PlayerUpdate
) -> Player:
    data = player_in.model_dump(exclude_unset=True)
    if "slug" in data and data["slug"]:
        existing = get_player_by_slug(session=session, slug=data["slug"])
        if existing and existing.id != db_player.id:
            raise ValueError("Slug already in use")
    db_player.sqlmodel_update(data)
    session.add(db_player)
    session.commit()
    session.refresh(db_player)
    return db_player


def get_player_history(
    *, session: Session, player_id: uuid.UUID
) -> list[tuple[EventResult, QuizEvent]]:
    from app.models import EventStatus
    stmt = (
        select(EventResult, QuizEvent)
        .join(QuizEvent, EventResult.event_id == QuizEvent.id)
        .where(EventResult.player_id == player_id)
        .where(QuizEvent.status == EventStatus.approved)
        .order_by(col(QuizEvent.start_date).desc())
    )
    return session.exec(stmt).all()


# --- QuizEvent ---

def create_event(
    *, session: Session, event_in: QuizEventCreate, submitted_by_id: uuid.UUID
) -> QuizEvent:
    event = QuizEvent.model_validate(event_in, update={"submitted_by_id": submitted_by_id})
    session.add(event)
    session.commit()
    session.refresh(event)
    return event


def update_event(
    *, session: Session, db_event: QuizEvent, event_in: QuizEventUpdate
) -> QuizEvent:
    db_event.sqlmodel_update(event_in.model_dump(exclude_unset=True))
    session.add(db_event)
    session.commit()
    session.refresh(db_event)
    return db_event


def _recompute_ranks(*, session: Session, event_id: uuid.UUID) -> None:
    results = session.exec(
        select(EventResult)
        .where(EventResult.event_id == event_id)
        .order_by(EventResult.score.desc(), EventResult.tiebreaker_rank.asc())
    ).all()
    for rank, result in enumerate(results, start=1):
        result.final_rank = rank
        session.add(result)
    session.commit()


def approve_event(*, session: Session, db_event: QuizEvent) -> QuizEvent:
    _recompute_ranks(session=session, event_id=db_event.id)
    db_event.status = EventStatus.approved
    session.add(db_event)
    session.commit()
    session.refresh(db_event)
    return db_event


# --- EventResult ---

def create_event_results(
    *, session: Session, event_id: uuid.UUID, results: list[EventResultCreate]
) -> list[EventResult]:
    db_results = []
    for r in results:
        result = EventResult(
            event_id=event_id,
            player_id=r.player_id,
            score=r.score,
            tiebreaker_rank=r.tiebreaker_rank,
        )
        session.add(result)
        db_results.append(result)
    session.commit()
    return db_results


def delete_event_result(*, session: Session, db_result: EventResult) -> None:
    event_id = db_result.event_id
    session.delete(db_result)
    session.commit()
    _recompute_ranks(session=session, event_id=event_id)
```

- [ ] **Step 5: Run the smoke test, verify it passes**

```bash
cd backend && uv run pytest tests/crud/test_quiz_models.py -v
```

Expected: `PASSED` — Organization is created in DB successfully.

- [ ] **Step 6: Generate and apply the Alembic migration**

```bash
docker compose exec backend bash -c "alembic revision --autogenerate -m 'add quiz models and is_organizer'"
docker compose exec backend bash -c "alembic upgrade head"
```

Verify: no errors during `upgrade head`. Inspect the generated file in `backend/app/alembic/versions/` to confirm all 5 new tables and the `is_organizer` column on `user` are present.

- [ ] **Step 7: Update `backend/tests/conftest.py`**

Replace the `db` fixture and add the organizer fixture:

```python
from app.models import EventResult, Item, Player, QuizEvent, QuizSeries, Organization, User

@pytest.fixture(scope="session", autouse=True)
def db() -> Generator[Session, None, None]:
    with Session(engine) as session:
        init_db(session)
        yield session
        session.execute(delete(EventResult))
        session.execute(delete(QuizEvent))
        session.execute(delete(QuizSeries))
        session.execute(delete(Player))
        session.execute(delete(Organization))
        session.execute(delete(Item))
        session.execute(delete(User))
        session.commit()


@pytest.fixture(scope="module")
def organizer_token_headers(client: TestClient, db: Session) -> dict[str, str]:
    from tests.utils.user import create_organizer_user
    return create_organizer_user(client=client, db=db)
```

- [ ] **Step 8: Add `create_organizer_user` to `backend/tests/utils/user.py`**

Append after the existing `authentication_token_from_email` function:

```python
def create_organizer_user(*, client: TestClient, db: Session) -> dict[str, str]:
    email = random_email()
    password = random_lower_string()
    user_in = UserCreate(email=email, password=password, is_organizer=True)
    crud.create_user(session=db, user_create=user_in)
    return user_authentication_headers(client=client, email=email, password=password)
```

- [ ] **Step 9: Create `backend/tests/utils/quiz.py`**

```python
import uuid
from datetime import date

from sqlmodel import Session

from app import crud
from app.models import (
    EventStatus,
    Organization,
    OrganizationCreate,
    Player,
    PlayerCreate,
    QuizEvent,
    QuizEventCreate,
    QuizSeries,
    QuizSeriesCreate,
)
from tests.utils.user import create_random_user
from tests.utils.utils import random_lower_string


def create_random_organization(db: Session) -> Organization:
    return crud.create_organization(
        session=db,
        org_in=OrganizationCreate(name=random_lower_string()),
    )


def create_random_series(
    db: Session, organization_id: uuid.UUID | None = None
) -> QuizSeries:
    return crud.create_series(
        session=db,
        series_in=QuizSeriesCreate(
            name=random_lower_string(), organization_id=organization_id
        ),
    )


def create_random_player(db: Session) -> Player:
    return crud.create_player(
        session=db,
        player_in=PlayerCreate(
            display_name=random_lower_string(), country="Ireland"
        ),
    )


def create_random_event(
    db: Session, submitted_by_id: uuid.UUID | None = None
) -> QuizEvent:
    if submitted_by_id is None:
        user = create_random_user(db)
        submitted_by_id = user.id
    return crud.create_event(
        session=db,
        event_in=QuizEventCreate(
            name=random_lower_string(),
            start_date=date(2024, 1, 1),
            end_date=date(2024, 1, 1),
            organizer_name=random_lower_string(),
        ),
        submitted_by_id=submitted_by_id,
    )


def create_approved_event(db: Session) -> QuizEvent:
    event = create_random_event(db)
    event.status = EventStatus.approved
    db.add(event)
    db.commit()
    db.refresh(event)
    return event
```

- [ ] **Step 10: Run the full test suite to confirm no regressions**

```bash
cd backend && uv run pytest tests/ -v
```

Expected: all existing tests pass.

- [ ] **Step 11: Commit**

```bash
git add backend/app/models.py backend/app/crud.py \
        backend/app/alembic/versions/ \
        backend/tests/conftest.py backend/tests/utils/ \
        backend/tests/crud/test_quiz_models.py
git commit -m "feat: add quiz competition data models and CRUD"
```

---

## Task 2: Auth Dependencies

**Files:**
- Modify: `backend/app/api/deps.py`

- [ ] **Step 1: Add `OptionalCurrentUser` and `CurrentOrganizer` to `backend/app/api/deps.py`**

Add a second `OAuth2PasswordBearer` that doesn't auto-error, plus two new dependencies, after the existing `get_current_active_superuser`:

```python
from fastapi.security import OAuth2PasswordBearer

_optional_oauth2 = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_STR}/login/access-token",
    auto_error=False,
)

OptionalTokenDep = Annotated[str | None, Depends(_optional_oauth2)]


def get_optional_current_user(
    session: SessionDep, token: OptionalTokenDep
) -> User | None:
    if not token:
        return None
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[security.ALGORITHM]
        )
        token_data = TokenPayload(**payload)
    except (InvalidTokenError, ValidationError):
        return None
    user = session.get(User, token_data.sub)
    if not user or not user.is_active:
        return None
    return user


OptionalCurrentUser = Annotated[User | None, Depends(get_optional_current_user)]


def get_current_organizer(current_user: CurrentUser) -> User:
    if not current_user.is_superuser and not current_user.is_organizer:
        raise HTTPException(
            status_code=403, detail="The user doesn't have enough privileges"
        )
    return current_user


CurrentOrganizer = Annotated[User, Depends(get_current_organizer)]
```

- [ ] **Step 2: Run existing tests to confirm no regressions**

```bash
cd backend && uv run pytest tests/ -v
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/deps.py
git commit -m "feat: add optional and organizer auth dependencies"
```

---

## Task 3: Organization Routes

**Files:**
- Create: `backend/app/api/routes/organizations.py`
- Create: `backend/tests/api/routes/test_organizations.py`
- Modify: `backend/app/api/main.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/api/routes/test_organizations.py`:

```python
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from tests.utils.quiz import create_random_organization


def test_read_organizations_public(client: TestClient) -> None:
    response = client.get(f"{settings.API_V1_STR}/organizations/")
    assert response.status_code == 200
    content = response.json()
    assert "data" in content
    assert "count" in content


def test_create_organization_as_superuser(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    data = {"name": "Test Org", "description": "A test org"}
    response = client.post(
        f"{settings.API_V1_STR}/organizations/",
        headers=superuser_token_headers,
        json=data,
    )
    assert response.status_code == 200
    content = response.json()
    assert content["name"] == "Test Org"
    assert "id" in content


def test_create_organization_as_organizer_forbidden(
    client: TestClient, organizer_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/organizations/",
        headers=organizer_token_headers,
        json={"name": "Should Fail"},
    )
    assert response.status_code == 403


def test_read_organization_by_id(
    client: TestClient, db: Session
) -> None:
    org = create_random_organization(db)
    response = client.get(f"{settings.API_V1_STR}/organizations/{org.id}")
    assert response.status_code == 200
    assert response.json()["id"] == str(org.id)


def test_read_organization_not_found(client: TestClient) -> None:
    import uuid
    response = client.get(f"{settings.API_V1_STR}/organizations/{uuid.uuid4()}")
    assert response.status_code == 404


def test_update_organization(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    org = create_random_organization(db)
    response = client.patch(
        f"{settings.API_V1_STR}/organizations/{org.id}",
        headers=superuser_token_headers,
        json={"name": "Updated Name"},
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Updated Name"
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
cd backend && uv run pytest tests/api/routes/test_organizations.py -v
```

Expected: `404 Not Found` on all routes — router not registered yet.

- [ ] **Step 3: Create `backend/app/api/routes/organizations.py`**

```python
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import func, select

from app.api.deps import CurrentUser, SessionDep
from app import crud
from app.models import (
    Organization,
    OrganizationCreate,
    OrganizationPublic,
    OrganizationsPublic,
    OrganizationUpdate,
)

router = APIRouter(prefix="/organizations", tags=["organizations"])


@router.get("/", response_model=OrganizationsPublic)
def read_organizations(
    session: SessionDep, skip: int = 0, limit: int = 100
) -> Any:
    count = session.exec(select(func.count()).select_from(Organization)).one()
    orgs = session.exec(select(Organization).offset(skip).limit(limit)).all()
    return OrganizationsPublic(data=orgs, count=count)


@router.get("/{id}", response_model=OrganizationPublic)
def read_organization(session: SessionDep, id: uuid.UUID) -> Any:
    org = session.get(Organization, id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org


@router.post("/", response_model=OrganizationPublic)
def create_organization(
    *, session: SessionDep, current_user: CurrentUser, org_in: OrganizationCreate
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return crud.create_organization(session=session, org_in=org_in)


@router.patch("/{id}", response_model=OrganizationPublic)
def update_organization(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    org_in: OrganizationUpdate,
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    org = session.get(Organization, id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    return crud.update_organization(session=session, db_org=org, org_in=org_in)
```

- [ ] **Step 4: Register the router in `backend/app/api/main.py`**

```python
from app.api.routes import items, login, organizations, private, series, users, utils

api_router = APIRouter()
api_router.include_router(login.router)
api_router.include_router(users.router)
api_router.include_router(utils.router)
api_router.include_router(items.router)
api_router.include_router(organizations.router)
# series, players, events routers added in later tasks

if settings.ENVIRONMENT == "local":
    api_router.include_router(private.router)
```

- [ ] **Step 5: Run tests, verify they pass**

```bash
cd backend && uv run pytest tests/api/routes/test_organizations.py -v
```

Expected: all 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/routes/organizations.py \
        backend/app/api/main.py \
        backend/tests/api/routes/test_organizations.py
git commit -m "feat: add organization routes"
```

---

## Task 4: QuizSeries Routes

**Files:**
- Create: `backend/app/api/routes/series.py`
- Create: `backend/tests/api/routes/test_series.py`
- Modify: `backend/app/api/main.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/api/routes/test_series.py`:

```python
import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from tests.utils.quiz import create_random_organization, create_random_series


def test_read_series_public(client: TestClient) -> None:
    response = client.get(f"{settings.API_V1_STR}/series/")
    assert response.status_code == 200
    content = response.json()
    assert "data" in content
    assert "count" in content


def test_create_series_as_superuser(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    data = {"name": "World Quizzing Championships"}
    response = client.post(
        f"{settings.API_V1_STR}/series/",
        headers=superuser_token_headers,
        json=data,
    )
    assert response.status_code == 200
    content = response.json()
    assert content["name"] == "World Quizzing Championships"
    assert content["organization_id"] is None


def test_create_series_with_organization(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    org = create_random_organization(db)
    response = client.post(
        f"{settings.API_V1_STR}/series/",
        headers=superuser_token_headers,
        json={"name": "IQA League", "organization_id": str(org.id)},
    )
    assert response.status_code == 200
    assert response.json()["organization_id"] == str(org.id)


def test_create_series_forbidden_for_organizer(
    client: TestClient, organizer_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/series/",
        headers=organizer_token_headers,
        json={"name": "Should Fail"},
    )
    assert response.status_code == 403


def test_read_series_by_id(client: TestClient, db: Session) -> None:
    series = create_random_series(db)
    response = client.get(f"{settings.API_V1_STR}/series/{series.id}")
    assert response.status_code == 200
    assert response.json()["id"] == str(series.id)


def test_read_series_not_found(client: TestClient) -> None:
    response = client.get(f"{settings.API_V1_STR}/series/{uuid.uuid4()}")
    assert response.status_code == 404


def test_update_series(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    series = create_random_series(db)
    response = client.patch(
        f"{settings.API_V1_STR}/series/{series.id}",
        headers=superuser_token_headers,
        json={"name": "Updated Series"},
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Updated Series"
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
cd backend && uv run pytest tests/api/routes/test_series.py -v
```

Expected: `404` on all routes — router not registered yet.

- [ ] **Step 3: Create `backend/app/api/routes/series.py`**

```python
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import func, select

from app.api.deps import CurrentUser, SessionDep
from app import crud
from app.models import (
    QuizSeries,
    QuizSeriesCreate,
    QuizSeriesListPublic,
    QuizSeriesPublic,
    QuizSeriesUpdate,
)

router = APIRouter(prefix="/series", tags=["series"])


@router.get("/", response_model=QuizSeriesListPublic)
def read_series(
    session: SessionDep, skip: int = 0, limit: int = 100
) -> Any:
    count = session.exec(select(func.count()).select_from(QuizSeries)).one()
    series_list = session.exec(select(QuizSeries).offset(skip).limit(limit)).all()
    return QuizSeriesListPublic(data=series_list, count=count)


@router.get("/{id}", response_model=QuizSeriesPublic)
def read_series_item(session: SessionDep, id: uuid.UUID) -> Any:
    series = session.get(QuizSeries, id)
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    return series


@router.post("/", response_model=QuizSeriesPublic)
def create_series(
    *, session: SessionDep, current_user: CurrentUser, series_in: QuizSeriesCreate
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return crud.create_series(session=session, series_in=series_in)


@router.patch("/{id}", response_model=QuizSeriesPublic)
def update_series(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    series_in: QuizSeriesUpdate,
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    series = session.get(QuizSeries, id)
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    return crud.update_series(session=session, db_series=series, series_in=series_in)
```

- [ ] **Step 4: Register the router in `backend/app/api/main.py`**

```python
from app.api.routes import items, login, organizations, private, series, users, utils

api_router = APIRouter()
api_router.include_router(login.router)
api_router.include_router(users.router)
api_router.include_router(utils.router)
api_router.include_router(items.router)
api_router.include_router(organizations.router)
api_router.include_router(series.router)
# players, events added in later tasks
```

- [ ] **Step 5: Run tests, verify they pass**

```bash
cd backend && uv run pytest tests/api/routes/test_series.py -v
```

Expected: all 7 tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/routes/series.py \
        backend/app/api/main.py \
        backend/tests/api/routes/test_series.py
git commit -m "feat: add series routes"
```

---

## Task 5: Player Routes

**Files:**
- Create: `backend/app/api/routes/players.py`
- Create: `backend/tests/api/routes/test_players.py`
- Modify: `backend/app/api/main.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/api/routes/test_players.py`:

```python
import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app import crud
from app.models import EventResult, EventResultCreate
from tests.utils.quiz import (
    create_approved_event,
    create_random_player,
)


def test_read_players_public(client: TestClient) -> None:
    response = client.get(f"{settings.API_V1_STR}/players/")
    assert response.status_code == 200
    assert "data" in response.json()


def test_create_player_as_organizer(
    client: TestClient, organizer_token_headers: dict[str, str]
) -> None:
    data = {"display_name": "Evan Lynch", "country": "Ireland"}
    response = client.post(
        f"{settings.API_V1_STR}/players/",
        headers=organizer_token_headers,
        json=data,
    )
    assert response.status_code == 200
    content = response.json()
    assert content["display_name"] == "Evan Lynch"
    assert content["slug"] == "evan-lynch"


def test_create_player_unauthenticated_forbidden(client: TestClient) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/players/",
        json={"display_name": "Ghost User", "country": "Ireland"},
    )
    assert response.status_code == 401


def test_slug_auto_generated(
    client: TestClient, organizer_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/players/",
        headers=organizer_token_headers,
        json={"display_name": "Hari Paraswamaren", "country": "India"},
    )
    assert response.json()["slug"] == "hari-paraswamaren"


def test_slug_collision_gets_suffix(
    client: TestClient, organizer_token_headers: dict[str, str]
) -> None:
    client.post(
        f"{settings.API_V1_STR}/players/",
        headers=organizer_token_headers,
        json={"display_name": "Collision Player", "country": "Ireland"},
    )
    response = client.post(
        f"{settings.API_V1_STR}/players/",
        headers=organizer_token_headers,
        json={"display_name": "Collision Player", "country": "USA"},
    )
    assert response.json()["slug"] == "collision-player-2"


def test_read_player_by_id(client: TestClient, db: Session) -> None:
    player = create_random_player(db)
    response = client.get(f"{settings.API_V1_STR}/players/{player.id}")
    assert response.status_code == 200
    assert response.json()["id"] == str(player.id)


def test_read_player_by_slug(client: TestClient, db: Session) -> None:
    player = create_random_player(db)
    response = client.get(f"{settings.API_V1_STR}/players/by-slug/{player.slug}")
    assert response.status_code == 200
    assert response.json()["slug"] == player.slug


def test_read_player_by_slug_not_found(client: TestClient) -> None:
    response = client.get(f"{settings.API_V1_STR}/players/by-slug/no-such-player")
    assert response.status_code == 404


def test_search_players(
    client: TestClient, organizer_token_headers: dict[str, str]
) -> None:
    client.post(
        f"{settings.API_V1_STR}/players/",
        headers=organizer_token_headers,
        json={"display_name": "Searchable Quinn", "country": "Ireland"},
    )
    response = client.get(
        f"{settings.API_V1_STR}/players/search",
        params={"q": "Searchable Quinn"},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert len(data) >= 1
    assert data[0]["player"]["display_name"] == "Searchable Quinn"
    assert data[0]["similarity"] > 0.8


def test_update_player_slug_as_superuser(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    player = create_random_player(db)
    response = client.patch(
        f"{settings.API_V1_STR}/players/{player.id}",
        headers=superuser_token_headers,
        json={"slug": "custom-slug"},
    )
    assert response.status_code == 200
    assert response.json()["slug"] == "custom-slug"


def test_update_player_slug_as_organizer_forbidden(
    client: TestClient,
    organizer_token_headers: dict[str, str],
    db: Session,
) -> None:
    player = create_random_player(db)
    response = client.patch(
        f"{settings.API_V1_STR}/players/{player.id}",
        headers=organizer_token_headers,
        json={"slug": "sneaky-slug"},
    )
    assert response.status_code == 403


def test_player_history_shows_approved_events_only(
    client: TestClient,
    db: Session,
) -> None:
    player = create_random_player(db)
    approved_event = create_approved_event(db)
    pending_event = create_random_player(db)  # just need a pending event

    # Add result to approved event
    result = EventResult(
        event_id=approved_event.id,
        player_id=player.id,
        score=42.0,
        tiebreaker_rank=1,
        final_rank=1,
    )
    db.add(result)
    db.commit()

    response = client.get(f"{settings.API_V1_STR}/players/{player.id}/history")
    assert response.status_code == 200
    history = response.json()["data"]
    assert len(history) == 1
    assert history[0]["score"] == 42.0
    assert history[0]["event_name"] == approved_event.name
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
cd backend && uv run pytest tests/api/routes/test_players.py -v
```

Expected: `404` — router not registered yet.

- [ ] **Step 3: Create `backend/app/api/routes/players.py`**

```python
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import col, func, select

from app.api.deps import CurrentUser, CurrentOrganizer, OptionalCurrentUser, SessionDep
from app import crud
from app.models import (
    Player,
    PlayerCreate,
    PlayerHistory,
    PlayerPublic,
    PlayerResultWithEvent,
    PlayersPublic,
    PlayerSearchResult,
    PlayerSearchResults,
    PlayerUpdate,
)

router = APIRouter(prefix="/players", tags=["players"])


@router.get("/", response_model=PlayersPublic)
def read_players(
    session: SessionDep, skip: int = 0, limit: int = 100
) -> Any:
    count = session.exec(select(func.count()).select_from(Player)).one()
    players = session.exec(select(Player).offset(skip).limit(limit)).all()
    return PlayersPublic(data=players, count=count)


@router.get("/search", response_model=PlayerSearchResults)
def search_players(
    session: SessionDep, q: str, country: str | None = None
) -> Any:
    scored = crud.search_players(session=session, q=q, country=country)
    return PlayerSearchResults(
        data=[
            PlayerSearchResult(
                player=PlayerPublic.model_validate(p), similarity=s
            )
            for p, s in scored
        ]
    )


@router.get("/by-slug/{slug}", response_model=PlayerPublic)
def read_player_by_slug(session: SessionDep, slug: str) -> Any:
    player = crud.get_player_by_slug(session=session, slug=slug)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    return player


@router.get("/{id}/history", response_model=PlayerHistory)
def read_player_history(session: SessionDep, id: uuid.UUID) -> Any:
    player = session.get(Player, id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    rows = crud.get_player_history(session=session, player_id=id)
    data = [
        PlayerResultWithEvent(
            result_id=r.id,
            event_id=e.id,
            event_name=e.name,
            start_date=e.start_date,
            end_date=e.end_date,
            score=r.score,
            tiebreaker_rank=r.tiebreaker_rank,
            final_rank=r.final_rank,
        )
        for r, e in rows
    ]
    return PlayerHistory(data=data)


@router.get("/{id}", response_model=PlayerPublic)
def read_player(session: SessionDep, id: uuid.UUID) -> Any:
    player = session.get(Player, id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    return player


@router.post("/", response_model=PlayerPublic)
def create_player(
    *, session: SessionDep, current_user: CurrentOrganizer, player_in: PlayerCreate
) -> Any:
    return crud.create_player(session=session, player_in=player_in)


@router.patch("/{id}", response_model=PlayerPublic)
def update_player(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    player_in: PlayerUpdate,
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    player = session.get(Player, id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    try:
        return crud.update_player(session=session, db_player=player, player_in=player_in)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
```

Note: `/search` and `/by-slug/{slug}` must be declared **before** `/{id}` to avoid FastAPI treating `search` and `by-slug` as UUID path parameters.

- [ ] **Step 4: Register the router in `backend/app/api/main.py`**

```python
from app.api.routes import items, login, organizations, players, private, series, users, utils

api_router = APIRouter()
api_router.include_router(login.router)
api_router.include_router(users.router)
api_router.include_router(utils.router)
api_router.include_router(items.router)
api_router.include_router(organizations.router)
api_router.include_router(series.router)
api_router.include_router(players.router)
# events added in Task 6
```

- [ ] **Step 5: Run tests, verify they pass**

```bash
cd backend && uv run pytest tests/api/routes/test_players.py -v
```

Expected: all 13 tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/routes/players.py \
        backend/app/api/main.py \
        backend/tests/api/routes/test_players.py
git commit -m "feat: add player routes with slug generation and history"
```

---

## Task 6: Event Routes and Results

**Files:**
- Create: `backend/app/api/routes/events.py`
- Create: `backend/tests/api/routes/test_events.py`
- Modify: `backend/app/api/main.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/api/routes/test_events.py`:

```python
import uuid
from datetime import date

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app import crud
from app.models import EventResult, EventStatus
from tests.utils.quiz import (
    create_approved_event,
    create_random_event,
    create_random_player,
)


def test_read_events_public_sees_only_approved(
    client: TestClient, db: Session
) -> None:
    create_random_event(db)          # pending — should not appear
    create_approved_event(db)        # approved — should appear
    response = client.get(f"{settings.API_V1_STR}/events/")
    assert response.status_code == 200
    data = response.json()["data"]
    assert all(e["status"] == "approved" for e in data)


def test_superuser_can_filter_pending(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    create_random_event(db)
    response = client.get(
        f"{settings.API_V1_STR}/events/",
        headers=superuser_token_headers,
        params={"status": "pending"},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert all(e["status"] == "pending" for e in data)


def test_create_event_as_organizer(
    client: TestClient, organizer_token_headers: dict[str, str]
) -> None:
    data = {
        "name": "Irish Quiz Championships 2025",
        "start_date": "2025-03-01",
        "end_date": "2025-03-02",
        "organizer_name": "Quiz Ireland",
        "description": "Annual Irish quiz",
        "format": {"questions": 240, "rounds": 8, "categories": ["Science", "History"]},
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
    assert content["format"]["rounds"] == 8


def test_create_event_unauthenticated_forbidden(client: TestClient) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/events/",
        json={
            "name": "Ghost Event",
            "start_date": "2025-01-01",
            "end_date": "2025-01-01",
            "organizer_name": "Nobody",
        },
    )
    assert response.status_code == 401


def test_read_pending_event_as_public_returns_404(
    client: TestClient, db: Session
) -> None:
    event = create_random_event(db)
    response = client.get(f"{settings.API_V1_STR}/events/{event.id}")
    assert response.status_code == 404


def test_read_approved_event_as_public(client: TestClient, db: Session) -> None:
    event = create_approved_event(db)
    response = client.get(f"{settings.API_V1_STR}/events/{event.id}")
    assert response.status_code == 200
    assert response.json()["id"] == str(event.id)


def test_approve_event_as_superuser(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    event = create_random_event(db)
    response = client.post(
        f"{settings.API_V1_STR}/events/{event.id}/approve",
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    assert response.json()["status"] == "approved"


def test_approve_event_as_organizer_forbidden(
    client: TestClient,
    organizer_token_headers: dict[str, str],
    db: Session,
) -> None:
    event = create_random_event(db)
    response = client.post(
        f"{settings.API_V1_STR}/events/{event.id}/approve",
        headers=organizer_token_headers,
    )
    assert response.status_code == 403


def test_patch_event_as_superuser(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    event = create_approved_event(db)
    response = client.patch(
        f"{settings.API_V1_STR}/events/{event.id}",
        headers=superuser_token_headers,
        json={"name": "Corrected Name"},
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Corrected Name"


def test_final_rank_computed_on_approval(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    event = create_random_event(db)
    player_a = create_random_player(db)
    player_b = create_random_player(db)
    player_c = create_random_player(db)

    for player, score, tb in [
        (player_a, 30.0, 1),
        (player_b, 50.0, 1),
        (player_c, 50.0, 2),
    ]:
        db.add(EventResult(
            event_id=event.id, player_id=player.id,
            score=score, tiebreaker_rank=tb,
        ))
    db.commit()

    client.post(
        f"{settings.API_V1_STR}/events/{event.id}/approve",
        headers=superuser_token_headers,
    )

    response = client.get(f"{settings.API_V1_STR}/events/{event.id}/results")
    results = response.json()["data"]
    ranked = {r["player_id"]: r["final_rank"] for r in results}
    assert ranked[str(player_b.id)] == 1
    assert ranked[str(player_c.id)] == 2
    assert ranked[str(player_a.id)] == 3


def test_delete_result_recomputes_ranks(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    event = create_random_event(db)
    player_a = create_random_player(db)
    player_b = create_random_player(db)

    result_a = EventResult(event_id=event.id, player_id=player_a.id, score=50.0, tiebreaker_rank=1)
    result_b = EventResult(event_id=event.id, player_id=player_b.id, score=40.0, tiebreaker_rank=1)
    db.add(result_a)
    db.add(result_b)
    db.commit()
    db.refresh(result_a)

    crud.approve_event(session=db, db_event=event)

    client.delete(
        f"{settings.API_V1_STR}/events/{event.id}/results/{result_a.id}",
        headers=superuser_token_headers,
    )

    response = client.get(f"{settings.API_V1_STR}/events/{event.id}/results")
    results = response.json()["data"]
    assert len(results) == 1
    assert results[0]["final_rank"] == 1


def test_parse_results(
    client: TestClient,
    organizer_token_headers: dict[str, str],
    db: Session,
) -> None:
    create_random_player(db)  # ensure at least one player exists
    event = create_random_event(db)
    response = client.post(
        f"{settings.API_V1_STR}/events/{event.id}/results/parse",
        headers=organizer_token_headers,
        json={"rows": [{"player_name": "Test Player", "country": "Ireland", "score": 42.0, "tiebreaker_rank": 1}]},
    )
    assert response.status_code == 200
    content = response.json()
    assert len(content["results"]) == 1
    assert "candidates" in content["results"][0]


def test_submit_results_with_existing_player(
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
                {"player_id": str(player.id), "score": 42.0, "tiebreaker_rank": 1}
            ]
        },
    )
    assert response.status_code == 200
    assert response.json()["count"] == 1


def test_submit_results_creates_new_player(
    client: TestClient,
    organizer_token_headers: dict[str, str],
    db: Session,
) -> None:
    event = create_random_event(db)
    response = client.post(
        f"{settings.API_V1_STR}/events/{event.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "player_create": {"display_name": "Brand New Player", "country": "USA"},
                    "score": 55.0,
                    "tiebreaker_rank": 1,
                }
            ]
        },
    )
    assert response.status_code == 200
    assert response.json()["count"] == 1
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
cd backend && uv run pytest tests/api/routes/test_events.py -v
```

Expected: `404` — router not registered yet.

- [ ] **Step 3: Create `backend/app/api/routes/events.py`**

```python
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import col, func, select

from app.api.deps import CurrentOrganizer, CurrentUser, OptionalCurrentUser, SessionDep
from app import crud
from app.models import (
    EventResult,
    EventResultCreate,
    EventResultPublic,
    EventResultsPublic,
    EventResultUpdate,
    EventStatus,
    ParseResultsRequest,
    ParseResultsResponse,
    ParsedResultWithCandidates,
    PlayerCreate,
    PlayerPublic,
    PlayerSearchResult,
    QuizEvent,
    QuizEventCreate,
    QuizEventPublic,
    QuizEventsPublic,
    QuizEventUpdate,
    ResolvedResultRow,
    SubmitResultsRequest,
)

router = APIRouter(prefix="/events", tags=["events"])


@router.get("/", response_model=QuizEventsPublic)
def read_events(
    session: SessionDep,
    current_user: OptionalCurrentUser,
    skip: int = 0,
    limit: int = 100,
    status: EventStatus | None = None,
) -> Any:
    is_superuser = current_user is not None and current_user.is_superuser
    effective_status = status if (is_superuser and status) else EventStatus.approved
    count = session.exec(
        select(func.count())
        .select_from(QuizEvent)
        .where(QuizEvent.status == effective_status)
    ).one()
    events = session.exec(
        select(QuizEvent)
        .where(QuizEvent.status == effective_status)
        .order_by(col(QuizEvent.start_date).desc())
        .offset(skip)
        .limit(limit)
    ).all()
    return QuizEventsPublic(data=events, count=count)


@router.get("/{id}", response_model=QuizEventPublic)
def read_event(
    session: SessionDep, current_user: OptionalCurrentUser, id: uuid.UUID
) -> Any:
    event = session.get(QuizEvent, id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    is_superuser = current_user is not None and current_user.is_superuser
    if event.status == EventStatus.pending and not is_superuser:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


@router.post("/", response_model=QuizEventPublic)
def create_event(
    *, session: SessionDep, current_user: CurrentOrganizer, event_in: QuizEventCreate
) -> Any:
    return crud.create_event(
        session=session, event_in=event_in, submitted_by_id=current_user.id
    )


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
    return crud.update_event(session=session, db_event=event, event_in=event_in)


@router.post("/{id}/approve", response_model=QuizEventPublic)
def approve_event(
    *, session: SessionDep, current_user: CurrentUser, id: uuid.UUID
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    event = session.get(QuizEvent, id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.status == EventStatus.approved:
        raise HTTPException(status_code=400, detail="Event already approved")
    return crud.approve_event(session=session, db_event=event)


@router.get("/{id}/results", response_model=EventResultsPublic)
def read_event_results(
    session: SessionDep, current_user: OptionalCurrentUser, id: uuid.UUID
) -> Any:
    event = session.get(QuizEvent, id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    is_superuser = current_user is not None and current_user.is_superuser
    if event.status == EventStatus.pending and not is_superuser:
        raise HTTPException(status_code=404, detail="Event not found")
    results = session.exec(
        select(EventResult)
        .where(EventResult.event_id == id)
        .order_by(EventResult.final_rank.asc(), EventResult.score.desc())
    ).all()
    return EventResultsPublic(data=results, count=len(results))


@router.post("/{id}/results/parse", response_model=ParseResultsResponse)
def parse_results(
    *,
    session: SessionDep,
    current_user: CurrentOrganizer,
    id: uuid.UUID,
    request: ParseResultsRequest,
) -> Any:
    if not session.get(QuizEvent, id):
        raise HTTPException(status_code=404, detail="Event not found")
    results = []
    for row in request.rows:
        scored = crud.search_players(session=session, q=row.player_name, country=row.country)
        candidates = [
            PlayerSearchResult(
                player=PlayerPublic.model_validate(p), similarity=s
            )
            for p, s in scored
        ]
        results.append(ParsedResultWithCandidates(row=row, candidates=candidates))
    return ParseResultsResponse(results=results)


@router.post("/{id}/results", response_model=EventResultsPublic)
def submit_results(
    *,
    session: SessionDep,
    current_user: CurrentOrganizer,
    id: uuid.UUID,
    request: SubmitResultsRequest,
) -> Any:
    event = session.get(QuizEvent, id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    # Clear any existing results to allow resubmission
    existing = session.exec(
        select(EventResult).where(EventResult.event_id == id)
    ).all()
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


@router.delete("/{id}/results/{result_id}")
def delete_event_result(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    result_id: uuid.UUID,
) -> dict[str, str]:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    result = session.get(EventResult, result_id)
    if not result or result.event_id != id:
        raise HTTPException(status_code=404, detail="Result not found")
    crud.delete_event_result(session=session, db_result=result)
    return {"message": "Result deleted successfully"}
```

- [ ] **Step 4: Register the router in `backend/app/api/main.py`**

```python
from app.api.routes import events, items, login, organizations, players, private, series, users, utils

api_router = APIRouter()
api_router.include_router(login.router)
api_router.include_router(users.router)
api_router.include_router(utils.router)
api_router.include_router(items.router)
api_router.include_router(organizations.router)
api_router.include_router(series.router)
api_router.include_router(players.router)
api_router.include_router(events.router)

if settings.ENVIRONMENT == "local":
    api_router.include_router(private.router)
```

- [ ] **Step 5: Run tests, verify they pass**

```bash
cd backend && uv run pytest tests/api/routes/test_events.py -v
```

Expected: all 14 tests pass.

- [ ] **Step 6: Run the full backend test suite**

```bash
cd backend && uv run pytest tests/ -v
```

Expected: all tests across all files pass.

- [ ] **Step 7: Commit**

```bash
git add backend/app/api/routes/events.py \
        backend/app/api/main.py \
        backend/tests/api/routes/test_events.py
git commit -m "feat: add event and results routes"
```

---

## Task 7: Enrich Results Endpoint + Regenerate Frontend Client

The event detail page needs player names alongside scores. Add a joined endpoint before regenerating the client so the generated types include it.

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/app/api/routes/events.py`

- [ ] **Step 1: Add `EventResultWithPlayer` models to `backend/app/models.py`**

Append after `EventResultsPublic`:

```python
class EventResultWithPlayer(SQLModel):
    id: uuid.UUID
    event_id: uuid.UUID
    player_id: uuid.UUID
    player_display_name: str
    player_slug: str | None = None
    score: float
    tiebreaker_rank: int
    final_rank: int | None = None


class EventResultsWithPlayersPublic(SQLModel):
    data: list[EventResultWithPlayer]
    count: int
```

- [ ] **Step 2: Add the joined endpoint to `backend/app/api/routes/events.py`**

Add these imports at the top of `events.py` (alongside existing model imports):

```python
from app.models import (
    # ... existing imports ...
    EventResultWithPlayer,
    EventResultsWithPlayersPublic,
    Player,
)
```

Add the endpoint after `read_event_results`:

```python
@router.get("/{id}/results/with-players", response_model=EventResultsWithPlayersPublic)
def read_event_results_with_players(
    session: SessionDep, current_user: OptionalCurrentUser, id: uuid.UUID
) -> Any:
    event = session.get(QuizEvent, id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    is_superuser = current_user is not None and current_user.is_superuser
    if event.status == EventStatus.pending and not is_superuser:
        raise HTTPException(status_code=404, detail="Event not found")
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
            tiebreaker_rank=r.tiebreaker_rank,
            final_rank=r.final_rank,
        )
        for r, p in rows
    ]
    return EventResultsWithPlayersPublic(data=data, count=len(data))
```

- [ ] **Step 3: Run the full backend test suite to confirm no regressions**

```bash
cd backend && uv run pytest tests/ -v
```

Expected: all tests pass.

- [ ] **Step 4: Commit the backend changes**

```bash
git add backend/app/models.py backend/app/api/routes/events.py
git commit -m "feat: add enriched event results endpoint with player names"
```

- [ ] **Step 5: Regenerate the frontend client**

The Docker stack must be running (`docker compose watch`). From the project root:

```bash
bash ./scripts/generate-client.sh
```

This exports the OpenAPI schema from the running backend, writes it to `frontend/openapi.json`, regenerates `frontend/src/client/`, and runs Biome lint.

Verify the following new service methods exist in `frontend/src/client/`:
- `EventsService.readEvents`
- `EventsService.readEvent`
- `EventsService.readEventResultsWithPlayers`
- `EventsService.parseResults`
- `EventsService.submitResults`
- `EventsService.approveEvent`
- `PlayersService.readPlayers`
- `PlayersService.readPlayerBySlug`
- `PlayersService.searchPlayers`
- `PlayersService.readPlayerHistory`
- `OrganizationsService.readOrganizations`
- `SeriesService.readSeries`

- [ ] **Step 6: Commit the generated client**

```bash
git add frontend/src/client/ frontend/openapi.json
git commit -m "chore: regenerate frontend client with quiz routes"
```

---

## Task 8: Public Layout and Navigation

All public-facing pages (events, players, orgs) live under a `_public` pathless layout. The `_` prefix means it contributes no URL segment — `_public/events.tsx` maps to `/events`.

**Files:**
- Create: `frontend/src/routes/_public.tsx`
- Create: `frontend/src/components/Common/PublicNav.tsx`

- [ ] **Step 1: Create `frontend/src/components/Common/PublicNav.tsx`**

```tsx
import { Link } from "@tanstack/react-router"

import { Logo } from "@/components/Common/Logo"
import { Button } from "@/components/ui/button"
import { isLoggedIn } from "@/hooks/useAuth"

export function PublicNav() {
  return (
    <nav className="border-b bg-background">
      <div className="container mx-auto max-w-7xl px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link to="/events">
            <Logo />
          </Link>
          <Link
            to="/events"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Events
          </Link>
          <Link
            to="/organizations"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Organizations
          </Link>
          <Link
            to="/quizzers"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Quizzers
          </Link>
        </div>
        <Button asChild variant="outline" size="sm">
          {isLoggedIn() ? (
            <Link to="/">Dashboard</Link>
          ) : (
            <Link to="/login">Log In</Link>
          )}
        </Button>
      </div>
    </nav>
  )
}
```

- [ ] **Step 2: Create `frontend/src/routes/_public.tsx`**

```tsx
import { createFileRoute, Outlet } from "@tanstack/react-router"

import { Footer } from "@/components/Common/Footer"
import { PublicNav } from "@/components/Common/PublicNav"

export const Route = createFileRoute("/_public")({
  component: PublicLayout,
})

function PublicLayout() {
  return (
    <div className="min-h-screen flex flex-col">
      <PublicNav />
      <main className="flex-1 container mx-auto max-w-7xl px-4 py-8">
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}
```

- [ ] **Step 3: Create the `_public` route directory**

```bash
mkdir -p frontend/src/routes/_public
```

- [ ] **Step 4: Start the dev server to regenerate `routeTree.gen.ts`**

```bash
cd frontend && bun run dev
```

TanStack Router's Vite plugin detects the new `_public.tsx` layout and updates `routeTree.gen.ts` automatically. Leave the server running for subsequent tasks.

- [ ] **Step 5: Verify the layout renders**

Open `http://localhost:5173/events` — you should see the `PublicNav` and `Footer` with a loading or empty state in the middle (the `/events` route doesn't exist yet, so a 404 is expected).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/routes/_public.tsx \
        frontend/src/components/Common/PublicNav.tsx \
        frontend/src/routeTree.gen.ts
git commit -m "feat: add public layout and navigation"
```

---

## Task 9: Events Pages

**Files:**
- Create: `frontend/src/routes/_public/events.tsx`
- Create: `frontend/src/routes/_public/events.$id.tsx`
- Create: `frontend/src/components/Events/columns.tsx`
- Create: `frontend/src/components/Events/EventResultsTable.tsx`

- [ ] **Step 1: Create event list columns `frontend/src/components/Events/columns.tsx`**

```tsx
import type { ColumnDef } from "@tanstack/react-table"
import { Link } from "@tanstack/react-router"

import type { QuizEventPublic } from "@/client"

export const eventColumns: ColumnDef<QuizEventPublic>[] = [
  {
    accessorKey: "name",
    header: "Event",
    cell: ({ row }) => (
      <Link
        to="/events/$id"
        params={{ id: row.original.id }}
        className="font-medium hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: "start_date",
    header: "Date",
    cell: ({ row }) => {
      const { start_date, end_date } = row.original
      return start_date === end_date
        ? start_date
        : `${start_date} – ${end_date}`
    },
  },
  {
    accessorKey: "organizer_name",
    header: "Organiser",
  },
]
```

- [ ] **Step 2: Create `frontend/src/routes/_public/events.tsx`**

```tsx
import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { CalendarDays } from "lucide-react"
import { Suspense } from "react"

import { EventsService } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { eventColumns } from "@/components/Events/columns"

function getEventsQueryOptions() {
  return {
    queryFn: () => EventsService.readEvents({ skip: 0, limit: 100 }),
    queryKey: ["events"],
  }
}

export const Route = createFileRoute("/_public/events")({
  component: EventsPage,
  head: () => ({ meta: [{ title: "Events" }] }),
})

function EventsContent() {
  const { data: events } = useSuspenseQuery(getEventsQueryOptions())

  if (events.data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-16">
        <div className="rounded-full bg-muted p-4 mb-4">
          <CalendarDays className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">No events yet</h3>
        <p className="text-muted-foreground">
          Published results will appear here.
        </p>
      </div>
    )
  }

  return <DataTable columns={eventColumns} data={events.data} />
}

function EventsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Events</h1>
        <p className="text-muted-foreground">
          Browse published quiz competition results
        </p>
      </div>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <EventsContent />
      </Suspense>
    </div>
  )
}
```

- [ ] **Step 3: Create the results table component `frontend/src/components/Events/EventResultsTable.tsx`**

```tsx
import { Link } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"

import type { EventResultWithPlayer } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { Badge } from "@/components/ui/badge"

const columns: ColumnDef<EventResultWithPlayer>[] = [
  {
    accessorKey: "final_rank",
    header: "Rank",
    cell: ({ row }) => {
      const rank = row.original.final_rank
      if (rank === 1) return <Badge variant="default">🥇 1st</Badge>
      if (rank === 2) return <Badge variant="secondary">🥈 2nd</Badge>
      if (rank === 3) return <Badge variant="secondary">🥉 3rd</Badge>
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
          to="/quizzer/$slug"
          params={{ slug: player_slug }}
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
    header: "Score",
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.score}</span>
    ),
  },
]

export function EventResultsTable({ data }: { data: EventResultWithPlayer[] }) {
  return <DataTable columns={columns} data={data} />
}
```

- [ ] **Step 4: Create `frontend/src/routes/_public/events.$id.tsx`**

```tsx
import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link, notFound } from "@tanstack/react-router"
import { Suspense } from "react"

import { EventsService } from "@/client"
import { EventResultsTable } from "@/components/Events/EventResultsTable"

function getEventQueryOptions(id: string) {
  return {
    queryFn: () => EventsService.readEvent({ id }),
    queryKey: ["events", id],
  }
}

function getEventResultsQueryOptions(id: string) {
  return {
    queryFn: () => EventsService.readEventResultsWithPlayers({ id }),
    queryKey: ["events", id, "results"],
  }
}

export const Route = createFileRoute("/_public/events/$id")({
  component: EventDetailPage,
  head: () => ({ meta: [{ title: "Event" }] }),
  loader: async ({ context, params }) => {
    const event = await context.queryClient
      .ensureQueryData(getEventQueryOptions(params.id))
      .catch(() => { throw notFound() })
    return { title: event.name }
  },
})

function EventMeta({ id }: { id: string }) {
  const { data: event } = useSuspenseQuery(getEventQueryOptions(id))
  const fmt = event.format as
    | { questions?: number; rounds?: number; categories?: string[] }
    | null

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{event.name}</h1>
        <p className="text-muted-foreground">
          {event.start_date === event.end_date
            ? event.start_date
            : `${event.start_date} – ${event.end_date}`}
          {" · "}
          Organised by {event.organizer_name}
        </p>
      </div>
      {event.description && (
        <p className="text-sm text-muted-foreground">{event.description}</p>
      )}
      {fmt && (
        <div className="flex gap-4 text-sm text-muted-foreground">
          {fmt.rounds && <span>{fmt.rounds} rounds</span>}
          {fmt.questions && <span>{fmt.questions} questions</span>}
          {fmt.categories?.length ? (
            <span>{fmt.categories.join(", ")}</span>
          ) : null}
        </div>
      )}
    </div>
  )
}

function EventResults({ id }: { id: string }) {
  const { data } = useSuspenseQuery(getEventResultsQueryOptions(id))

  if (data.data.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center">
        No results published yet.
      </p>
    )
  }

  return <EventResultsTable data={data.data} />
}

function EventDetailPage() {
  const { id } = Route.useParams()

  return (
    <div className="flex flex-col gap-8">
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <EventMeta id={id} />
      </Suspense>
      <div>
        <h2 className="text-lg font-semibold mb-4">Results</h2>
        <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
          <EventResults id={id} />
        </Suspense>
      </div>
    </div>
  )
}
```

Note: the `loader` uses `context.queryClient`. Ensure `RouterContext` in `frontend/src/main.tsx` includes `queryClient`. Check the existing setup — if it's already configured (which the template does), no changes are needed.

- [ ] **Step 5: Verify in browser**

Navigate to `http://localhost:5173/events`:
- Public nav with Events / Organizations / Quizzers links visible
- Empty state shown (no approved events in local DB yet)

Navigate to `http://localhost:5173/events/<any-uuid>`:
- Should show a 404 / not-found page (expected, no events yet)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/routes/_public/ \
        frontend/src/components/Events/ \
        frontend/src/routeTree.gen.ts
git commit -m "feat: add public events list and detail pages"
```

---

## Task 10: Organizations and Series Pages

The series detail page needs events filtered by `series_id`. Add that backend filter first, then regenerate the client, then build the pages.

**Files:**
- Modify: `backend/app/api/routes/events.py`
- Create: `frontend/src/routes/_public/organizations.tsx`
- Create: `frontend/src/routes/_public/organizations.$id.tsx`
- Create: `frontend/src/routes/_public/series.$id.tsx`

- [ ] **Step 1: Add `series_id` filter to the events list endpoint**

In `backend/app/api/routes/events.py`, update `read_events` to accept an optional `series_id`:

```python
@router.get("/", response_model=QuizEventsPublic)
def read_events(
    session: SessionDep,
    current_user: OptionalCurrentUser,
    skip: int = 0,
    limit: int = 100,
    status: EventStatus | None = None,
    series_id: uuid.UUID | None = None,
) -> Any:
    is_superuser = current_user is not None and current_user.is_superuser
    effective_status = status if (is_superuser and status) else EventStatus.approved

    filters = [QuizEvent.status == effective_status]
    if series_id:
        filters.append(QuizEvent.series_id == series_id)

    count = session.exec(
        select(func.count()).select_from(QuizEvent).where(*filters)
    ).one()
    events = session.exec(
        select(QuizEvent)
        .where(*filters)
        .order_by(col(QuizEvent.start_date).desc())
        .offset(skip)
        .limit(limit)
    ).all()
    return QuizEventsPublic(data=events, count=count)
```

- [ ] **Step 2: Run backend tests to confirm no regressions**

```bash
cd backend && uv run pytest tests/api/routes/test_events.py -v
```

Expected: all tests pass (the new param is optional, existing tests unaffected).

- [ ] **Step 3: Regenerate the frontend client**

```bash
bash ./scripts/generate-client.sh
git add frontend/src/client/ frontend/openapi.json
git commit -m "feat: add series_id filter to events endpoint + regen client"
```

- [ ] **Step 4: Create `frontend/src/routes/_public/organizations.tsx`**

```tsx
import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Building2 } from "lucide-react"
import { Suspense } from "react"

import { OrganizationsService } from "@/client"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

function getOrgsQueryOptions() {
  return {
    queryFn: () => OrganizationsService.readOrganizations({ skip: 0, limit: 100 }),
    queryKey: ["organizations"],
  }
}

export const Route = createFileRoute("/_public/organizations")({
  component: OrganizationsPage,
  head: () => ({ meta: [{ title: "Organizations" }] }),
})

function OrgsContent() {
  const { data: orgs } = useSuspenseQuery(getOrgsQueryOptions())

  if (orgs.data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-16">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Building2 className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">No organizations yet</h3>
      </div>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {orgs.data.map((org) => (
        <Link key={org.id} to="/organizations/$id" params={{ id: org.id }}>
          <Card className="hover:border-foreground/20 transition-colors">
            <CardHeader>
              <CardTitle className="text-base">{org.name}</CardTitle>
              {org.description && (
                <CardDescription className="line-clamp-2">
                  {org.description}
                </CardDescription>
              )}
            </CardHeader>
          </Card>
        </Link>
      ))}
    </div>
  )
}

function OrganizationsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Organizations</h1>
        <p className="text-muted-foreground">Quiz governing bodies and associations</p>
      </div>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <OrgsContent />
      </Suspense>
    </div>
  )
}
```

- [ ] **Step 5: Create `frontend/src/routes/_public/organizations.$id.tsx`**

```tsx
import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link, notFound } from "@tanstack/react-router"
import { Suspense } from "react"

import { OrganizationsService, SeriesService } from "@/client"

function getOrgQueryOptions(id: string) {
  return {
    queryFn: () => OrganizationsService.readOrganization({ id }),
    queryKey: ["organizations", id],
  }
}

function getSeriesQueryOptions() {
  return {
    queryFn: () => SeriesService.readSeries({ skip: 0, limit: 100 }),
    queryKey: ["series"],
  }
}

export const Route = createFileRoute("/_public/organizations/$id")({
  component: OrgDetailPage,
  loader: async ({ context, params }) => {
    await context.queryClient
      .ensureQueryData(getOrgQueryOptions(params.id))
      .catch(() => { throw notFound() })
  },
})

function OrgDetail({ id }: { id: string }) {
  const { data: org } = useSuspenseQuery(getOrgQueryOptions(id))
  const { data: allSeries } = useSuspenseQuery(getSeriesQueryOptions())
  const orgSeries = allSeries.data.filter((s) => s.organization_id === id)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{org.name}</h1>
        {org.website && (
          <a
            href={org.website}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-muted-foreground hover:underline"
          >
            {org.website}
          </a>
        )}
        {org.description && (
          <p className="mt-2 text-muted-foreground">{org.description}</p>
        )}
      </div>

      {orgSeries.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Competition Series</h2>
          <ul className="flex flex-col gap-2">
            {orgSeries.map((s) => (
              <li key={s.id}>
                <Link
                  to="/series/$id"
                  params={{ id: s.id }}
                  className="text-sm font-medium hover:underline"
                >
                  {s.name}
                </Link>
                {s.description && (
                  <p className="text-xs text-muted-foreground">{s.description}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function OrgDetailPage() {
  const { id } = Route.useParams()
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
      <OrgDetail id={id} />
    </Suspense>
  )
}
```

- [ ] **Step 6: Create `frontend/src/routes/_public/series.$id.tsx`**

```tsx
import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link, notFound } from "@tanstack/react-router"
import { Suspense } from "react"

import { EventsService, SeriesService } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { eventColumns } from "@/components/Events/columns"

function getSeriesQueryOptions(id: string) {
  return {
    queryFn: () => SeriesService.readSeriesItem({ id }),
    queryKey: ["series", id],
  }
}

function getSeriesEventsQueryOptions(id: string) {
  return {
    queryFn: () => EventsService.readEvents({ seriesId: id, skip: 0, limit: 100 }),
    queryKey: ["events", { seriesId: id }],
  }
}

export const Route = createFileRoute("/_public/series/$id")({
  component: SeriesDetailPage,
  loader: async ({ context, params }) => {
    await context.queryClient
      .ensureQueryData(getSeriesQueryOptions(params.id))
      .catch(() => { throw notFound() })
  },
})

function SeriesDetail({ id }: { id: string }) {
  const { data: series } = useSuspenseQuery(getSeriesQueryOptions(id))
  const { data: events } = useSuspenseQuery(getSeriesEventsQueryOptions(id))

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{series.name}</h1>
        {series.description && (
          <p className="text-muted-foreground">{series.description}</p>
        )}
      </div>
      <div>
        <h2 className="text-lg font-semibold mb-4">Events</h2>
        {events.data.length === 0 ? (
          <p className="text-muted-foreground">No events published yet.</p>
        ) : (
          <DataTable columns={eventColumns} data={events.data} />
        )}
      </div>
    </div>
  )
}

function SeriesDetailPage() {
  const { id } = Route.useParams()
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
      <SeriesDetail id={id} />
    </Suspense>
  )
}
```

- [ ] **Step 7: Verify in browser**

Navigate to `http://localhost:5173/organizations` — shows empty state or org cards.
Navigate to `http://localhost:5173/organizations/<uuid>` — shows org detail with any linked series.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/routes/_public/organizations.tsx \
        frontend/src/routes/_public/organizations.\$id.tsx \
        frontend/src/routes/_public/series.\$id.tsx \
        frontend/src/routeTree.gen.ts
git commit -m "feat: add organizations and series pages"
```

---

## Task 11: Player Directory and Profile Page

**Files:**
- Create: `frontend/src/routes/_public/quizzers.tsx`
- Create: `frontend/src/routes/_public/quizzer.$slug.tsx`
- Create: `frontend/src/components/Players/PlayerProfile.tsx`

- [ ] **Step 1: Create `frontend/src/routes/_public/quizzers.tsx`**

```tsx
import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Users } from "lucide-react"
import { Suspense } from "react"

import { PlayersService } from "@/client"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

function getPlayersQueryOptions() {
  return {
    queryFn: () => PlayersService.readPlayers({ skip: 0, limit: 200 }),
    queryKey: ["players"],
  }
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

export const Route = createFileRoute("/_public/quizzers")({
  component: QuizzersPage,
  head: () => ({ meta: [{ title: "Quizzers" }] }),
})

function QuizzersContent() {
  const { data: players } = useSuspenseQuery(getPlayersQueryOptions())

  if (players.data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-16">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Users className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">No quizzers yet</h3>
      </div>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {players.data.map((player) => (
        <Link
          key={player.id}
          to={player.slug ? "/quizzer/$slug" : "/quizzers"}
          params={player.slug ? { slug: player.slug } : {}}
          className="flex items-center gap-3 p-3 rounded-lg border hover:border-foreground/20 transition-colors"
        >
          <Avatar className="h-9 w-9">
            {player.photo_url && <AvatarImage src={player.photo_url} />}
            <AvatarFallback className="text-xs">
              {getInitials(player.display_name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="font-medium text-sm truncate">{player.display_name}</p>
            <p className="text-xs text-muted-foreground truncate">
              {[player.country, player.club].filter(Boolean).join(" · ")}
            </p>
          </div>
        </Link>
      ))}
    </div>
  )
}

function QuizzersPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Quizzers</h1>
        <p className="text-muted-foreground">Player profiles and competition history</p>
      </div>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <QuizzersContent />
      </Suspense>
    </div>
  )
}
```

- [ ] **Step 2: Create `frontend/src/components/Players/PlayerProfile.tsx`**

```tsx
import { Link } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"

import type { PlayerHistory, PlayerPublic } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

const historyColumns: ColumnDef<PlayerHistory["data"][number]>[] = [
  {
    accessorKey: "event_name",
    header: "Event",
    cell: ({ row }) => (
      <Link
        to="/events/$id"
        params={{ id: row.original.event_id }}
        className="font-medium hover:underline"
      >
        {row.original.event_name}
      </Link>
    ),
  },
  {
    accessorKey: "start_date",
    header: "Date",
    cell: ({ row }) => row.original.start_date,
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
      if (rank === 1) return <Badge>🥇 1st</Badge>
      if (rank === 2) return <Badge variant="secondary">🥈 2nd</Badge>
      if (rank === 3) return <Badge variant="secondary">🥉 3rd</Badge>
      return <span className="text-muted-foreground">{rank}</span>
    },
  },
]

interface PlayerProfileProps {
  player: PlayerPublic
  history: PlayerHistory
}

export function PlayerProfile({ player, history }: PlayerProfileProps) {
  const wins = history.data.filter((h) => h.final_rank === 1).length
  const podiums = history.data.filter(
    (h) => h.final_rank !== null && h.final_rank <= 3,
  ).length
  const totalEvents = history.data.length

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
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
          <p className="text-muted-foreground">
            {[player.country, player.city, player.club]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {player.bio && (
            <p className="text-sm text-muted-foreground mt-1">{player.bio}</p>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Events", value: totalEvents },
          { label: "Wins", value: wins },
          { label: "Podiums", value: podiums },
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

      {/* Competition history */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Competition History</h2>
        {history.data.length === 0 ? (
          <p className="text-muted-foreground">No results yet.</p>
        ) : (
          <DataTable columns={historyColumns} data={history.data} />
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create `frontend/src/routes/_public/quizzer.$slug.tsx`**

```tsx
import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, notFound } from "@tanstack/react-router"
import { Suspense } from "react"

import { PlayersService } from "@/client"
import { PlayerProfile } from "@/components/Players/PlayerProfile"

function getPlayerQueryOptions(slug: string) {
  return {
    queryFn: () => PlayersService.readPlayerBySlug({ slug }),
    queryKey: ["players", "slug", slug],
  }
}

function getPlayerHistoryQueryOptions(id: string) {
  return {
    queryFn: () => PlayersService.readPlayerHistory({ id }),
    queryKey: ["players", id, "history"],
  }
}

export const Route = createFileRoute("/_public/quizzer/$slug")({
  component: QuizzerPage,
  loader: async ({ context, params }) => {
    const player = await context.queryClient
      .ensureQueryData(getPlayerQueryOptions(params.slug))
      .catch(() => { throw notFound() })
    return { title: player.display_name }
  },
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData?.title ?? "Quizzer" }],
  }),
})

function QuizzerContent({ slug }: { slug: string }) {
  const { data: player } = useSuspenseQuery(getPlayerQueryOptions(slug))
  const { data: history } = useSuspenseQuery(
    getPlayerHistoryQueryOptions(player.id),
  )

  return <PlayerProfile player={player} history={history} />
}

function QuizzerPage() {
  const { slug } = Route.useParams()
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
      <QuizzerContent slug={slug} />
    </Suspense>
  )
}
```

- [ ] **Step 4: Verify in browser**

Navigate to `http://localhost:5173/quizzers` — shows player grid or empty state.

To test a profile: create a player via the API (`POST /api/v1/players/` with a superuser token), then navigate to `http://localhost:5173/quizzer/<their-slug>` and verify the profile renders with the initials avatar and empty history.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/routes/_public/quizzers.tsx \
        frontend/src/routes/_public/quizzer.\$slug.tsx \
        frontend/src/components/Players/ \
        frontend/src/routeTree.gen.ts
git commit -m "feat: add player directory and profile pages"
```

---

## Task 12: Upload Wizard

Five-step wizard at `/upload`, accessible to organizers and superusers. State flows top-down through a single parent component using `useState`.

**Files:**
- Create: `frontend/src/routes/_layout/upload.tsx`
- Create: `frontend/src/components/Upload/UploadWizard.tsx`
- Create: `frontend/src/components/Upload/steps/Step1EventMeta.tsx`
- Create: `frontend/src/components/Upload/steps/Step2CsvInput.tsx`
- Create: `frontend/src/components/Upload/steps/Step3ColumnMapping.tsx`
- Create: `frontend/src/components/Upload/steps/Step4Disambiguation.tsx`
- Create: `frontend/src/components/Upload/steps/Step5Preview.tsx`

- [ ] **Step 1: Create the route `frontend/src/routes/_layout/upload.tsx`**

```tsx
import { createFileRoute, redirect } from "@tanstack/react-router"

import { UsersService } from "@/client"
import { UploadWizard } from "@/components/Upload/UploadWizard"

export const Route = createFileRoute("/_layout/upload")({
  component: UploadPage,
  beforeLoad: async () => {
    const user = await UsersService.readUserMe()
    if (!user.is_superuser && !user.is_organizer) {
      throw redirect({ to: "/" })
    }
  },
  head: () => ({ meta: [{ title: "Upload Results" }] }),
})

function UploadPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Upload Results</h1>
        <p className="text-muted-foreground">
          Submit quiz competition results for review
        </p>
      </div>
      <UploadWizard />
    </div>
  )
}
```

- [ ] **Step 2: Define the shared wizard types**

Create `frontend/src/components/Upload/types.ts`:

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
  step: 1 | 2 | 3 | 4 | 5
  eventMeta: EventMeta
  rawCsv: string
  parsedRows: string[][]
  columnMapping: ColumnMapping
  parsedResults: ParsedResultWithCandidates[]
  resolutions: Resolution[]
  eventId: string | null
}

export const INITIAL_STATE: WizardState = {
  step: 1,
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

- [ ] **Step 3: Create `frontend/src/components/Upload/UploadWizard.tsx`**

```tsx
import { useState } from "react"

import { INITIAL_STATE, type WizardState } from "./types"
import { Step1EventMeta } from "./steps/Step1EventMeta"
import { Step2CsvInput } from "./steps/Step2CsvInput"
import { Step3ColumnMapping } from "./steps/Step3ColumnMapping"
import { Step4Disambiguation } from "./steps/Step4Disambiguation"
import { Step5Preview } from "./steps/Step5Preview"

const STEP_LABELS = [
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
      {/* Step indicator */}
      <ol className="flex gap-2">
        {STEP_LABELS.map((label, i) => {
          const n = i + 1
          const active = n === state.step
          const done = n < state.step
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
                {done ? "✓" : n}
              </span>
              <span className="hidden sm:inline">{label}</span>
            </li>
          )
        })}
      </ol>

      {/* Active step */}
      {state.step === 1 && <Step1EventMeta state={state} update={update} />}
      {state.step === 2 && <Step2CsvInput state={state} update={update} />}
      {state.step === 3 && <Step3ColumnMapping state={state} update={update} />}
      {state.step === 4 && <Step4Disambiguation state={state} update={update} />}
      {state.step === 5 && <Step5Preview state={state} update={update} />}
    </div>
  )
}
```

- [ ] **Step 4: Create `frontend/src/components/Upload/steps/Step1EventMeta.tsx`**

```tsx
import { useQuery } from "@tanstack/react-query"
import { useForm } from "react-hook-form"

import { OrganizationsService, SeriesService } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { EventMeta, WizardState } from "../types"

interface Props {
  state: WizardState
  update: (patch: Partial<WizardState>) => void
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

  const { register, handleSubmit, setValue, watch } = useForm<EventMeta>({
    defaultValues: state.eventMeta,
  })

  const onSubmit = (data: EventMeta) => {
    update({ eventMeta: data, step: 2 })
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 max-w-xl">
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
        <Textarea id="description" rows={3} {...register("description")} />
      </div>

      <div className="grid gap-1.5">
        <Label>Series (optional)</Label>
        <Select onValueChange={(v) => setValue("series_id", v)}>
          <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
          <SelectContent>
            {seriesList?.data.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-1.5">
        <Label>Organization (optional)</Label>
        <Select onValueChange={(v) => setValue("organization_id", v)}>
          <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
          <SelectContent>
            {orgs?.data.map((o) => (
              <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
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

      <Button type="submit" className="self-start">Next →</Button>
    </form>
  )
}
```

- [ ] **Step 5: Create `frontend/src/components/Upload/steps/Step2CsvInput.tsx`**

```tsx
import { useRef } from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
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

export function Step2CsvInput({ state, update }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      update({ rawCsv: text })
      if (textareaRef.current) textareaRef.current.value = text
    }
    reader.readAsText(file)
  }

  const handleNext = () => {
    const raw = textareaRef.current?.value ?? state.rawCsv
    const parsedRows = parseCsv(raw)
    if (parsedRows.length === 0) return
    update({ rawCsv: raw, parsedRows, step: 3 })
  }

  return (
    <div className="flex flex-col gap-4 max-w-xl">
      <div className="grid gap-1.5">
        <Label htmlFor="csv-file">Upload CSV or TSV file</Label>
        <input
          id="csv-file"
          type="file"
          accept=".csv,.tsv,.txt"
          onChange={handleFile}
          className="text-sm"
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="csv-paste">Or paste data directly</Label>
        <Textarea
          id="csv-paste"
          ref={textareaRef}
          defaultValue={state.rawCsv}
          rows={12}
          placeholder={"Name,Country,Score,Tiebreaker\nEvan Lynch,Ireland,42,1\n…"}
          className="font-mono text-xs"
        />
      </div>

      <div className="flex gap-3">
        <Button variant="outline" onClick={() => update({ step: 1 })}>← Back</Button>
        <Button onClick={handleNext}>Next →</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Create `frontend/src/components/Upload/steps/Step3ColumnMapping.tsx`**

```tsx
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { ColumnMapping, WizardState } from "../types"

interface Props {
  state: WizardState
  update: (patch: Partial<WizardState>) => void
}

const REQUIRED_FIELDS: Array<{ key: keyof ColumnMapping; label: string }> = [
  { key: "player_name", label: "Player name" },
  { key: "country", label: "Country" },
  { key: "score", label: "Score" },
  { key: "tiebreaker_rank", label: "Tiebreaker rank" },
]

export function Step3ColumnMapping({ state, update }: Props) {
  const [mapping, setMapping] = useState<ColumnMapping>(state.columnMapping)
  const header = state.parsedRows[0] ?? []
  const preview = state.parsedRows.slice(1, 4)

  const handleNext = () => {
    update({ columnMapping: mapping, step: 4 })
  }

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      <div className="grid gap-4">
        {REQUIRED_FIELDS.map(({ key, label }) => (
          <div key={key} className="grid gap-1.5">
            <Label>{label} column *</Label>
            <Select
              value={String(mapping[key])}
              onValueChange={(v) => setMapping((m) => ({ ...m, [key]: Number(v) }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
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
      </div>

      {preview.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-2">Preview (first 3 rows)</p>
          <div className="overflow-x-auto rounded border text-xs font-mono">
            <table className="w-full">
              <thead className="bg-muted">
                <tr>
                  {["Player", "Country", "Score", "Tiebreaker"].map((h) => (
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
                    <td className="px-2 py-1">{row[mapping.tiebreaker_rank]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <Button variant="outline" onClick={() => update({ step: 2 })}>← Back</Button>
        <Button onClick={handleNext}>Next →</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Create `frontend/src/components/Upload/steps/Step4Disambiguation.tsx`**

```tsx
import { useMutation } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import { EventsService, PlayersService } from "@/client"
import type { ParsedResultWithCandidates } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { Resolution, WizardState } from "../types"

interface Props {
  state: WizardState
  update: (patch: Partial<WizardState>) => void
}

function RowDisambiguator({
  row,
  resolution,
  onChange,
}: {
  row: ParsedResultWithCandidates
  resolution: Resolution
  onChange: (r: Resolution) => void
}) {
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState(row.row.player_name)
  const [newCountry, setNewCountry] = useState(row.row.country)

  const selectExisting = (id: string) => {
    setCreating(false)
    onChange({ player_id: id, player_create: null })
  }

  const selectNew = () => {
    setCreating(true)
    onChange({ player_id: null, player_create: { display_name: newName, country: newCountry } })
  }

  return (
    <div className="border rounded-lg p-4 flex flex-col gap-3">
      <p className="text-sm font-medium">
        {row.row.player_name} · {row.row.country} · Score: {row.row.score}
      </p>

      <div className="flex flex-col gap-2">
        {row.candidates.map((c) => (
          <label
            key={c.player.id}
            className="flex items-center gap-3 cursor-pointer"
          >
            <input
              type="radio"
              name={`row-${row.row.player_name}`}
              checked={resolution.player_id === c.player.id}
              onChange={() => selectExisting(c.player.id)}
            />
            <span className="text-sm">
              {c.player.display_name}{" "}
              <span className="text-muted-foreground">
                ({c.player.country}
                {c.player.city ? `, ${c.player.city}` : ""}) —{" "}
                {Math.round(c.similarity * 100)}% match
              </span>
            </span>
          </label>
        ))}
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="radio"
            name={`row-${row.row.player_name}`}
            checked={creating}
            onChange={selectNew}
          />
          <span className="text-sm font-medium">Create new player</span>
        </label>
      </div>

      {creating && (
        <div className="flex gap-3 ml-6">
          <div className="grid gap-1">
            <Label className="text-xs">Name</Label>
            <Input
              className="h-7 text-xs"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value)
                onChange({ player_id: null, player_create: { display_name: e.target.value, country: newCountry } })
              }}
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Country</Label>
            <Input
              className="h-7 text-xs"
              value={newCountry}
              onChange={(e) => {
                setNewCountry(e.target.value)
                onChange({ player_id: null, player_create: { display_name: newName, country: e.target.value } })
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export function Step4Disambiguation({ state, update }: Props) {
  const [resolutions, setResolutions] = useState<Resolution[]>(state.resolutions)
  const [parsedResults, setParsedResults] = useState<ParsedResultWithCandidates[]>(
    state.parsedResults,
  )
  const [loading, setLoading] = useState(state.parsedResults.length === 0)

  const parseRows = state.parsedRows.slice(1).map((row) => ({
    player_name: row[state.columnMapping.player_name] ?? "",
    country: row[state.columnMapping.country] ?? "",
    score: parseFloat(row[state.columnMapping.score] ?? "0"),
    tiebreaker_rank: parseInt(row[state.columnMapping.tiebreaker_rank] ?? "1"),
  }))

  useEffect(() => {
    if (state.parsedResults.length > 0 || !state.eventId) return
    setLoading(true)
    EventsService.parseResults({
      id: state.eventId,
      requestBody: { rows: parseRows },
    }).then((resp) => {
      setParsedResults(resp.results)
      setResolutions(
        resp.results.map((r) => ({
          player_id: r.candidates[0]?.player.id ?? null,
          player_create: r.candidates.length === 0
            ? { display_name: r.row.player_name, country: r.row.country }
            : null,
        })),
      )
      setLoading(false)
    })
  }, [])

  const allResolved = resolutions.every(
    (r) => r.player_id !== null || r.player_create !== null,
  )

  const handleNext = () => {
    update({ parsedResults, resolutions, step: 5 })
  }

  if (loading) return <p className="text-muted-foreground">Matching players…</p>

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Confirm or correct each player match. Select "Create new player" for anyone not yet in the system.
      </p>
      <div className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto pr-1">
        {parsedResults.map((row, i) => (
          <RowDisambiguator
            key={i}
            row={row}
            resolution={resolutions[i] ?? { player_id: null, player_create: null }}
            onChange={(r) => setResolutions((prev) => {
              const next = [...prev]
              next[i] = r
              return next
            })}
          />
        ))}
      </div>
      <div className="flex gap-3">
        <Button variant="outline" onClick={() => update({ step: 3 })}>← Back</Button>
        <Button onClick={handleNext} disabled={!allResolved}>Next →</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 8: Create `frontend/src/components/Upload/steps/Step5Preview.tsx`**

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"

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
          rounds: parseInt(meta.format_rounds || "0"),
          questions: parseInt(meta.format_questions || "0"),
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
  const { showSuccessToast } = useCustomToast()

  const parseRows = state.parsedRows.slice(1).map((row) => ({
    player_name: row[state.columnMapping.player_name] ?? "",
    country: row[state.columnMapping.country] ?? "",
    score: parseFloat(row[state.columnMapping.score] ?? "0"),
    tiebreaker_rank: parseInt(row[state.columnMapping.tiebreaker_rank] ?? "1"),
  }))

  const submitMutation = useMutation({
    mutationFn: async () => {
      const event = await EventsService.createEvent({
        requestBody: buildEventMeta(state.eventMeta),
      })
      const results = state.resolutions.map((r, i) => ({
        player_id: r.player_id ?? undefined,
        player_create: r.player_create ?? undefined,
        score: parseRows[i]?.score ?? 0,
        tiebreaker_rank: parseRows[i]?.tiebreaker_rank ?? 1,
      }))
      await EventsService.submitResults({
        id: event.id,
        requestBody: { results },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] })
      showSuccessToast("Results submitted for review.")
      navigate({ to: "/" })
    },
  })

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      <div className="rounded-lg border p-4 flex flex-col gap-2 text-sm">
        <p><span className="font-medium">Event:</span> {state.eventMeta.name}</p>
        <p><span className="font-medium">Dates:</span> {state.eventMeta.start_date} – {state.eventMeta.end_date}</p>
        <p><span className="font-medium">Organiser:</span> {state.eventMeta.organizer_name}</p>
        <p><span className="font-medium">Results:</span> {state.resolutions.length} entries</p>
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
              const name = r.player_create?.display_name ?? state.parsedResults[i]?.row.player_name ?? "—"
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

      <div className="flex gap-3">
        <Button variant="outline" onClick={() => update({ step: 4 })}>← Back</Button>
        <Button
          onClick={() => submitMutation.mutate()}
          disabled={submitMutation.isPending}
        >
          {submitMutation.isPending ? "Submitting…" : "Submit for review"}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 9: Fix the event creation flow in Step4**

Step 4 needs an `eventId` to call `parseResults`. Update the wizard so Step 3 → Step 4 creates the event first, passing the ID forward. In `UploadWizard.tsx`, update the `Step3ColumnMapping` call to pass an `onNext` that creates the event before advancing:

The simplest approach: create the event in `Step5Preview`'s submit handler (as already written above), and in `Step4Disambiguation` call `parseResults` without an event ID — pass `null` as the event ID and handle parsing locally instead. Update `Step4Disambiguation`'s `useEffect` to call the parse endpoint using a temporary event or just skip the API call if no `eventId`:

Replace the `useEffect` block in `Step4Disambiguation.tsx` with:

```tsx
useEffect(() => {
  if (parsedResults.length > 0) return
  // Call parse endpoint only if an event already exists; otherwise pre-fill from CSV
  if (!state.eventId) {
    const preloaded = parseRows.map((row) => ({
      row,
      candidates: [] as typeof parsedResults[0]["candidates"],
    }))
    setParsedResults(preloaded)
    setResolutions(preloaded.map(() => ({ player_id: null, player_create: null })))
    setLoading(false)
    return
  }
  EventsService.parseResults({
    id: state.eventId,
    requestBody: { rows: parseRows },
  }).then((resp) => {
    setParsedResults(resp.results)
    setResolutions(
      resp.results.map((r) => ({
        player_id: r.candidates[0]?.player.id ?? null,
        player_create: r.candidates.length === 0
          ? { display_name: r.row.player_name, country: r.row.country }
          : null,
      })),
    )
    setLoading(false)
  })
}, [])
```

Add a player search to the `RowDisambiguator` component so organizers can search manually even without pre-loaded candidates:

```tsx
// At the top of RowDisambiguator, add a search call when candidates are empty
const [searchQuery, setSearchQuery] = useState(row.row.player_name)
const { data: searchResults } = useQuery({
  queryFn: () => PlayersService.searchPlayers({ q: searchQuery, country: row.row.country }),
  queryKey: ["players", "search", searchQuery, row.row.country],
  enabled: row.candidates.length === 0,
})
const candidates = row.candidates.length > 0 ? row.candidates : (searchResults?.data ?? [])
```

Update the `RowDisambiguator`'s `candidates` variable reference to use `candidates` from above instead of `row.candidates` directly.

- [ ] **Step 10: Verify in browser**

Log in as an organizer, navigate to `http://localhost:5173/upload`.

Walk through the wizard:
1. Fill in event metadata → Next
2. Paste a 3-row CSV (`Name,Country,Score,Tiebreaker\nEvan Lynch,Ireland,42,1\n…`) → Next
3. Confirm column mapping → Next
4. Disambiguation shows rows; select/create players → Next
5. Preview shows 3 rows; click Submit → redirected to dashboard with toast

- [ ] **Step 11: Commit**

```bash
git add frontend/src/routes/_layout/upload.tsx \
        frontend/src/components/Upload/ \
        frontend/src/routeTree.gen.ts
git commit -m "feat: add 5-step upload wizard for organizers"
```

---

## Task 13: Admin Event Review Pages

**Files:**
- Modify: `backend/app/models.py` — add `EventResultUpdate`
- Modify: `backend/app/api/routes/events.py` — add `PATCH /{event_id}/results/{result_id}`
- Modify: `backend/tests/api/routes/test_events.py` — add test for result update
- Create: `frontend/src/routes/_layout/admin.events.tsx`
- Create: `frontend/src/routes/_layout/admin.events.$id.tsx`

- [ ] **Step 1: Write failing test for PATCH result endpoint**

Append to `backend/tests/api/routes/test_events.py`:

```python
def test_update_event_result_superuser(
    client: TestClient, superuser_token_headers: dict, db: Session
) -> None:
    org = create_random_organization(db)
    player = create_random_player(db)
    event = create_approved_event(db, org_id=org.id)
    result = EventResult(
        event_id=event.id,
        player_id=player.id,
        score=30.0,
        tiebreaker_rank=1,
        final_rank=1,
    )
    db.add(result)
    db.commit()
    db.refresh(result)

    response = client.patch(
        f"/api/v1/events/{event.id}/results/{result.id}",
        json={"score": 55.0},
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["score"] == 55.0


def test_update_event_result_forbidden_for_organizer(
    client: TestClient, organizer_token_headers: dict, db: Session
) -> None:
    org = create_random_organization(db)
    player = create_random_player(db)
    event = create_approved_event(db, org_id=org.id)
    result = EventResult(
        event_id=event.id, player_id=player.id, score=30.0, tiebreaker_rank=1, final_rank=1
    )
    db.add(result)
    db.commit()
    db.refresh(result)

    response = client.patch(
        f"/api/v1/events/{event.id}/results/{result.id}",
        json={"score": 55.0},
        headers=organizer_token_headers,
    )
    assert response.status_code == 403
```

- [ ] **Step 2: Run test, verify it fails**

```bash
cd backend && uv run pytest tests/api/routes/test_events.py::test_update_event_result_superuser -v
```

Expected: FAIL with `405 Method Not Allowed` or `404`.

- [ ] **Step 3: Add `EventResultUpdate` to `backend/app/models.py`**

Append after `EventResultCreate` (before `EventResultPublic`):

```python
class EventResultUpdate(SQLModel):
    score: float | None = None
    tiebreaker_rank: int | None = None
```

- [ ] **Step 4: Add PATCH endpoint to `backend/app/api/routes/events.py`**

Add this import at the top with the existing imports:

```python
from app.models import (
    ...
    EventResultUpdate,
    ...
)
```

Add this route after the `delete_event_result` route:

```python
@router.patch("/{event_id}/results/{result_id}", response_model=EventResultPublic)
def update_event_result(
    event_id: uuid.UUID,
    result_id: uuid.UUID,
    result_in: EventResultUpdate,
    session: SessionDep,
    current_user: CurrentSuperuser,
) -> EventResult:
    db_result = session.get(EventResult, result_id)
    if not db_result or db_result.event_id != event_id:
        raise HTTPException(status_code=404, detail="Event result not found")
    result_data = result_in.model_dump(exclude_unset=True)
    db_result.sqlmodel_update(result_data)
    session.add(db_result)
    session.commit()
    crud._recompute_ranks(session=session, event_id=event_id)
    session.refresh(db_result)
    return db_result
```

- [ ] **Step 5: Run tests, verify they pass**

```bash
cd backend && uv run pytest tests/api/routes/test_events.py -v
```

Expected: all event tests PASS including the two new ones.

- [ ] **Step 6: Regenerate client**

```bash
./scripts/generate-client.sh
```

Expected: `frontend/src/client/` updated with `updateEventResult` method on `EventsService`.

- [ ] **Step 7: Create `frontend/src/routes/_layout/admin.events.tsx`**

```tsx
import { useSuspenseQuery } from "@tanstack/react-query"
import {
  createFileRoute,
  Link as RouterLink,
  redirect,
} from "@tanstack/react-router"
import { Suspense } from "react"
import { EventsService, type EventPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const Route = createFileRoute("/_layout/admin/events")({
  component: AdminEvents,
  beforeLoad: async () => {
    const { UsersService } = await import("@/client")
    const user = await UsersService.readUserMe()
    if (!user.is_superuser) {
      throw redirect({ to: "/" })
    }
  },
  head: () => ({
    meta: [{ title: "Event Review - Admin" }],
  }),
})

function EventRow({ event }: { event: EventPublic }) {
  const dateRange =
    event.start_date === event.end_date
      ? event.start_date
      : `${event.start_date} – ${event.end_date}`

  return (
    <TableRow>
      <TableCell className="font-medium">
        <RouterLink
          to="/admin/events/$id"
          params={{ id: event.id }}
          className="hover:underline"
        >
          {event.name}
        </RouterLink>
      </TableCell>
      <TableCell>{dateRange}</TableCell>
      <TableCell>{event.organizer_name}</TableCell>
      <TableCell>
        <Badge variant={event.status === "pending" ? "destructive" : "default"}>
          {event.status}
        </Badge>
      </TableCell>
      <TableCell>
        <Button variant="outline" size="sm" asChild>
          <RouterLink to="/admin/events/$id" params={{ id: event.id }}>
            Review
          </RouterLink>
        </Button>
      </TableCell>
    </TableRow>
  )
}

function EventsTableContent({ status }: { status?: "pending" | "approved" }) {
  const { data } = useSuspenseQuery({
    queryKey: ["admin", "events", status ?? "all"],
    queryFn: () => EventsService.readEvents({ status }),
  })
  const events = data.data

  if (events.length === 0) {
    return (
      <p className="text-muted-foreground text-sm py-4">
        {status === "pending" ? "No events pending review." : "No events yet."}
      </p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>Organizer</TableHead>
          <TableHead>Status</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((event) => (
          <EventRow key={event.id} event={event} />
        ))}
      </TableBody>
    </Table>
  )
}

function AdminEvents() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Event Review</h1>
        <p className="text-muted-foreground">
          Approve submitted events and manage results.
        </p>
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-3">Pending Review</h2>
        <Suspense fallback={<Skeleton className="h-24 w-full" />}>
          <EventsTableContent status="pending" />
        </Suspense>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">All Events</h2>
        <Suspense fallback={<Skeleton className="h-24 w-full" />}>
          <EventsTableContent />
        </Suspense>
      </section>
    </div>
  )
}
```

- [ ] **Step 8: Create `frontend/src/routes/_layout/admin.events.$id.tsx`**

```tsx
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import {
  createFileRoute,
  Link as RouterLink,
  redirect,
  useNavigate,
} from "@tanstack/react-router"
import { Pencil, Trash2 } from "lucide-react"
import { Suspense, useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { EventsService, type EventPublic, type EventResultWithPlayer } from "@/client"
import { Badge } from "@/components/ui/badge"
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
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"

export const Route = createFileRoute("/_layout/admin/events/$id")({
  component: AdminEventDetail,
  beforeLoad: async () => {
    const { UsersService } = await import("@/client")
    const user = await UsersService.readUserMe()
    if (!user.is_superuser) {
      throw redirect({ to: "/" })
    }
  },
  head: () => ({
    meta: [{ title: "Event Review - Admin" }],
  }),
})

function MetadataEditDialog({ event }: { event: EventPublic }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const { register, handleSubmit } = useForm({
    defaultValues: {
      name: event.name,
      start_date: event.start_date,
      end_date: event.end_date,
      organizer_name: event.organizer_name,
      description: event.description ?? "",
    },
  })

  const mutation = useMutation({
    mutationFn: (data: object) =>
      EventsService.updateEvent({ id: event.id, requestBody: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "event", event.id] })
      queryClient.invalidateQueries({ queryKey: ["admin", "events"] })
      toast.success("Event updated")
      setOpen(false)
    },
    onError: () => toast.error("Failed to update event"),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
          onSubmit={handleSubmit((data) => mutation.mutate(data))}
          className="flex flex-col gap-4 pt-2"
        >
          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input {...register("name")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Start Date</Label>
              <Input type="date" {...register("start_date")} />
            </div>
            <div className="grid gap-1.5">
              <Label>End Date</Label>
              <Input type="date" {...register("end_date")} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Organizer Name</Label>
            <Input {...register("organizer_name")} />
          </div>
          <div className="grid gap-1.5">
            <Label>Description</Label>
            <Textarea rows={3} {...register("description")} />
          </div>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ResultRow({
  result,
  eventId,
}: {
  result: EventResultWithPlayer
  eventId: string
}) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [score, setScore] = useState(String(result.score))
  const [tiebreaker, setTiebreaker] = useState(String(result.tiebreaker_rank))

  const updateMutation = useMutation({
    mutationFn: () =>
      EventsService.updateEventResult({
        eventId,
        resultId: result.id,
        requestBody: {
          score: Number(score),
          tiebreaker_rank: Number(tiebreaker),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "event", eventId, "results"] })
      toast.success("Result updated")
      setEditing(false)
    },
    onError: () => toast.error("Failed to update result"),
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      EventsService.deleteEventResult({ id: eventId, resultId: result.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "event", eventId, "results"] })
      toast.success("Result removed")
    },
    onError: () => toast.error("Failed to remove result"),
  })

  return (
    <TableRow>
      <TableCell>{result.final_rank ?? "—"}</TableCell>
      <TableCell>
        {result.player_slug ? (
          <RouterLink
            to="/quizzer/$slug"
            params={{ slug: result.player_slug }}
            className="hover:underline"
          >
            {result.player_display_name}
          </RouterLink>
        ) : (
          result.player_display_name
        )}
      </TableCell>
      <TableCell>
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
      </TableCell>
      <TableCell>
        {editing ? (
          <Input
            type="number"
            value={tiebreaker}
            onChange={(e) => setTiebreaker(e.target.value)}
            className="w-20"
          />
        ) : (
          result.tiebreaker_rank
        )}
      </TableCell>
      <TableCell className="flex items-center gap-2">
        {editing ? (
          <>
            <Button
              size="sm"
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending}
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-3 w-3" />
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </>
        )}
      </TableCell>
    </TableRow>
  )
}

function ResultsTable({ eventId }: { eventId: string }) {
  const { data } = useSuspenseQuery({
    queryKey: ["admin", "event", eventId, "results"],
    queryFn: () => EventsService.readEventResultsWithPlayers({ id: eventId }),
  })

  if (data.results.length === 0) {
    return <p className="text-muted-foreground text-sm">No results submitted.</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Rank</TableHead>
          <TableHead>Player</TableHead>
          <TableHead>Score</TableHead>
          <TableHead>Tiebreaker</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.results.map((result) => (
          <ResultRow key={result.id} result={result} eventId={eventId} />
        ))}
      </TableBody>
    </Table>
  )
}

function EventDetailContent({ id }: { id: string }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const { data: event } = useSuspenseQuery({
    queryKey: ["admin", "event", id],
    queryFn: () => EventsService.readEvent({ id }),
  })

  const approveMutation = useMutation({
    mutationFn: () => EventsService.approveEvent({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "event", id] })
      queryClient.invalidateQueries({ queryKey: ["admin", "events"] })
      toast.success("Event approved and published")
    },
    onError: () => toast.error("Approval failed"),
  })

  const dateRange =
    event.start_date === event.end_date
      ? event.start_date
      : `${event.start_date} – ${event.end_date}`

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold tracking-tight">{event.name}</h1>
            <Badge
              variant={event.status === "pending" ? "destructive" : "default"}
            >
              {event.status}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            {dateRange} · {event.organizer_name}
          </p>
        </div>
        <div className="flex gap-2">
          {event.status === "pending" && (
            <Button
              onClick={() => approveMutation.mutate()}
              disabled={approveMutation.isPending}
            >
              {approveMutation.isPending ? "Approving…" : "Approve"}
            </Button>
          )}
          <MetadataEditDialog event={event} />
        </div>
      </div>

      {event.description && (
        <p className="text-sm text-muted-foreground">{event.description}</p>
      )}

      <section>
        <h2 className="text-lg font-semibold mb-3">Results</h2>
        <Suspense fallback={<Skeleton className="h-40 w-full" />}>
          <ResultsTable eventId={id} />
        </Suspense>
      </section>
    </div>
  )
}

function AdminEventDetail() {
  const { id } = Route.useParams()

  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <EventDetailContent id={id} />
    </Suspense>
  )
}
```

- [ ] **Step 9: Verify in browser**

Log in as superuser, navigate to `http://localhost:5173/admin/events`.

Check:
- Pending events appear under "Pending Review"
- Clicking "Review" navigates to `/admin/events/$id`
- On the detail page, "Approve" button is visible for pending events; clicking it refreshes the badge to "approved"
- "Edit Metadata" dialog opens a form; changing name saves and refreshes the header
- Result rows show Edit / Delete buttons; editing a score saves and updates the rank
- Deleting a result removes it from the table

- [ ] **Step 10: Commit**

```bash
git add backend/app/models.py \
        backend/app/api/routes/events.py \
        backend/tests/api/routes/test_events.py \
        frontend/src/routes/_layout/admin.events.tsx \
        frontend/src/routes/_layout/admin.events.\$id.tsx \
        frontend/src/client/ \
        frontend/src/routeTree.gen.ts
git commit -m "feat: add admin event review pages with approve, edit, delete result"
```

---

## Task 14: Admin Player Edit Page

**Files:**
- Create: `frontend/src/routes/_layout/admin.players.$id.tsx`

- [ ] **Step 1: Create `frontend/src/routes/_layout/admin.players.$id.tsx`**

```tsx
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { Suspense } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { PlayersService } from "@/client"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"

export const Route = createFileRoute("/_layout/admin/players/$id")({
  component: AdminPlayerEdit,
  beforeLoad: async () => {
    const { UsersService } = await import("@/client")
    const user = await UsersService.readUserMe()
    if (!user.is_superuser) {
      throw redirect({ to: "/" })
    }
  },
  head: () => ({
    meta: [{ title: "Edit Player - Admin" }],
  }),
})

function getInitials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

function PlayerEditForm({ id }: { id: string }) {
  const queryClient = useQueryClient()

  const { data: player } = useSuspenseQuery({
    queryKey: ["admin", "player", id],
    queryFn: () => PlayersService.readPlayer({ id }),
  })

  const { register, handleSubmit } = useForm({
    defaultValues: {
      slug: player.slug ?? "",
      bio: player.bio ?? "",
      photo_url: player.photo_url ?? "",
    },
  })

  const mutation = useMutation({
    mutationFn: (data: object) =>
      PlayersService.updatePlayer({ id, requestBody: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "player", id] })
      queryClient.invalidateQueries({ queryKey: ["players"] })
      toast.success("Player updated")
    },
    onError: () => toast.error("Failed to update player"),
  })

  return (
    <div className="flex flex-col gap-6 max-w-lg">
      <div className="flex items-center gap-4">
        <Avatar className="h-16 w-16 text-lg">
          <AvatarImage src={player.photo_url ?? undefined} alt={player.display_name} />
          <AvatarFallback>{getInitials(player.display_name)}</AvatarFallback>
        </Avatar>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {player.display_name}
          </h1>
          <p className="text-muted-foreground text-sm">
            {[player.country, player.city, player.club]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>

      <form
        onSubmit={handleSubmit((data) => mutation.mutate(data))}
        className="flex flex-col gap-4"
      >
        <div className="grid gap-1.5">
          <Label>URL Slug</Label>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm">/quizzer/</span>
            <Input
              {...register("slug")}
              placeholder="evan-lynch"
              className="font-mono"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Used in the player&apos;s public URL. Auto-generated on creation;
            change only to correct errors.
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label>Photo URL</Label>
          <Input
            {...register("photo_url")}
            placeholder="https://example.com/photo.jpg"
            type="url"
          />
        </div>

        <div className="grid gap-1.5">
          <Label>Bio</Label>
          <Textarea rows={4} {...register("bio")} placeholder="Player bio…" />
        </div>

        <Button type="submit" disabled={mutation.isPending} className="self-start">
          {mutation.isPending ? "Saving…" : "Save Changes"}
        </Button>
      </form>
    </div>
  )
}

function AdminPlayerEdit() {
  const { id } = Route.useParams()

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Edit Player</h1>
        <p className="text-muted-foreground">
          Update player profile details visible to the public.
        </p>
      </div>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <PlayerEditForm id={id} />
      </Suspense>
    </div>
  )
}
```

- [ ] **Step 2: Verify in browser**

Log in as superuser. Navigate to `http://localhost:5173/admin/players/<uuid-of-any-player>`.

Check:
- Avatar shows player initials if no photo_url is set
- Slug field is pre-filled with current slug; changing it and saving updates the URL at `/quizzer/<new-slug>`
- Bio and photo_url fields save correctly; a valid photo_url replaces the initials avatar on the public profile

- [ ] **Step 3: Commit**

```bash
git add frontend/src/routes/_layout/admin.players.\$id.tsx \
        frontend/src/routeTree.gen.ts
git commit -m "feat: add admin player edit page for slug, bio, photo"
```

---

## Task 15: Sidebar Navigation Updates

**Files:**
- Modify: `frontend/src/components/Sidebar/AppSidebar.tsx`

- [ ] **Step 1: Update `frontend/src/components/Sidebar/AppSidebar.tsx`**

Replace the entire file:

```tsx
import {
  Briefcase,
  ClipboardCheck,
  ClipboardList,
  Home,
  Users,
} from "lucide-react"

import { SidebarAppearance } from "@/components/Common/Appearance"
import { Logo } from "@/components/Common/Logo"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar"
import useAuth from "@/hooks/useAuth"
import { type Item, Main } from "./Main"
import { User } from "./User"

const baseItems: Item[] = [
  { icon: Home, title: "Dashboard", path: "/" },
  { icon: Briefcase, title: "Items", path: "/items" },
]

export function AppSidebar() {
  const { user: currentUser } = useAuth()

  const items: Item[] = [...baseItems]

  if (currentUser?.is_superuser || currentUser?.is_organizer) {
    items.push({ icon: ClipboardList, title: "Upload Results", path: "/upload" })
  }

  if (currentUser?.is_superuser) {
    items.push(
      { icon: ClipboardCheck, title: "Review Events", path: "/admin/events" },
      { icon: Users, title: "Admin", path: "/admin" },
    )
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-4 py-6 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:items-center">
        <Logo variant="responsive" />
      </SidebarHeader>
      <SidebarContent>
        <Main items={items} />
      </SidebarContent>
      <SidebarFooter>
        <SidebarAppearance />
        <User user={currentUser} />
      </SidebarFooter>
    </Sidebar>
  )
}

export default AppSidebar
```

Note: `is_organizer` must exist on the `UserPublic` type returned by `readUserMe`. If the client generation from Task 8 happened after the `is_organizer` field was added to `UserBase`, this will be present. If TypeScript complains, check that `frontend/src/client/types.gen.ts` includes `is_organizer: boolean` on `UserPublic`.

- [ ] **Step 2: Verify in browser**

Open three sessions:
1. **Regular user**: Sidebar shows Dashboard + Items only
2. **Organizer**: Sidebar shows Dashboard + Items + Upload Results
3. **Superuser**: Sidebar shows Dashboard + Items + Upload Results + Review Events + Admin

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Sidebar/AppSidebar.tsx
git commit -m "feat: add upload and review nav items for organizer/superuser roles"
```

---

## Self-Review

### Spec coverage check

| Spec requirement | Task |
|---|---|
| Organization / QuizSeries / QuizEvent / Player / EventResult models | Task 1 |
| `is_organizer` on User | Task 1 |
| Player slug auto-generated, superuser-editable | Tasks 2, 14 |
| CRUD functions (create, search, fuzzy match, rank recompute) | Task 2 |
| `OptionalCurrentUser`, `CurrentOrganizer` deps | Task 3 |
| Organizations + Series routes (public GET, superuser POST/PATCH) | Tasks 4, 5 |
| Players routes (search, by-slug, history, create, edit) | Task 6 |
| Events routes (list, detail, parse, submit, approve, delete result) | Task 7 |
| Update individual result scores | Task 13 |
| Alembic migration + client regeneration | Task 8 |
| Public layout (`_public.tsx`) with `PublicNav` | Task 9 |
| Events list `/events` and detail `/events/$id` | Task 9 |
| Organizations directory `/organizations` and org detail | Task 10 |
| Series detail `/series/$id` | Task 10 |
| Player directory `/quizzers` | Task 11 |
| Player profile `/quizzer/$slug` with career stats | Task 11 |
| 5-step upload wizard `/upload` | Task 12 |
| Admin event review queue `/admin/events` | Task 13 |
| Admin event detail `/admin/events/$id` (approve, edit, delete result) | Task 13 |
| Admin player edit `/admin/players/$id` (slug, bio, photo) | Task 14 |
| Sidebar: Upload for organizers, Review for superusers | Task 15 |

All spec requirements covered.

### Placeholder scan

No TBD, TODO, or "similar to Task N" references found. Every step has concrete code or commands.

### Type consistency check

- `EventResultWithPlayer` used in Tasks 9, 13 — consistent (defined in Task 7 backend, regenerated in Task 8)
- `EventResultUpdate` defined in Task 13 Step 3, used in Task 13 Step 4 endpoint
- `WizardState` defined in `types.ts` (Task 12), used in `UploadWizard.tsx` (Task 12) — consistent
- `CurrentOrganizer` defined in Task 3 deps, used in Tasks 6 (players POST) and 7 (events POST) — consistent
- `_recompute_ranks` defined in Task 2, called in Tasks 7 and 13 — consistent
