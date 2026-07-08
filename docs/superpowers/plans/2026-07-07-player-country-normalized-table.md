# Normalize Player Countries Into a Join Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `Player.countries` (a Postgres `json` column, filtered by loading every row into Python) with a normalized `PlayerCountry` join table, and make country search run entirely in SQL, so it scales to thousands of players and supports future country-centric analytics.

**Architecture:** One atomic backend change — model, migration, CRUD, and route wiring all land together because they are mutually breaking: the schema change removes `Player.countries` as an attribute entirely, so `search_players` and every player-serializing route must be updated in the same commit or the API returns 500s. A new `build_players_public`/`build_player_public` pair in `crud.py` (following the codebase's existing `_quiz_public`/`_series_public` convention — no ORM `Relationship()`, an explicit batched query instead) replaces the automatic `Player` → `PlayerPublic` conversion FastAPI was doing via the JSON column.

**Tech Stack:** FastAPI + SQLModel + Alembic + pytest (backend only — no frontend changes; the API contract is unchanged).

**Spec:** `docs/superpowers/specs/2026-07-07-player-country-normalized-table-design.md`

## Global Constraints

- Branch: work happens on `search-by-country` (already checked out).
- `PlayerCountry`: composite PK `(player_id, code)`, FK `player_id → player.id` with `ondelete="CASCADE"`, `is_primary: bool`, plus a separate `code` index (`ix_player_country_code`) for search + future analytics.
- Primary country = index 0 of the input `countries` list; the rest have no ordering guarantee beyond "sorted by code" when serialized.
- `countries` is removed from `PlayerBase` (mirrors `organization_name` not being on `QuizSeriesBase`) and declared directly on `PlayerCreate` and `PlayerPublic`. `PlayerUpdate.countries` is unchanged (already declared independently).
- No `SQLModel Relationship()` — follow the existing `_quiz_public`/`_series_public` pattern: an explicit helper takes `(session, ...)`, queries the related table, and builds the `*Public` model by hand.
- `update_player`: `countries` omitted from the PATCH payload OR explicitly `null` both mean "leave existing country rows untouched" (consistent with how the prior `organization_id: null` no-op was handled for series). An explicit `countries: []` clears all countries.
- `search_players`'s country filter and (for country-only search) its ordering/`LIMIT` all run in SQL — no Python-side loading of the full player table.
- Backend tests/alembic run from the host (`cd backend && uv run ...`) with `docker compose up -d db` running; `.env` points Postgres at localhost:5432.
- The backend Docker image does not bind-mount source; run `docker compose up -d --build backend` after backend changes, before any live/API verification.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Backend — join table, migration, CRUD, and route wiring

**Files:**
- Modify: `backend/app/models.py` (`PlayerBase` ~line 290-301, `PlayerCreate` ~line 304-305, `Player` ~line 331-340, `PlayerPublic` ~line 344-348; add `PlayerCountry` above `PlayerBase`)
- Modify: `backend/app/crud.py` (imports ~line 1-34; `create_player` line 163-169; `search_players` line 188-232; `update_player` line 235-247; add `build_players_public`/`build_player_public`)
- Modify: `backend/app/api/routes/players.py` (imports; `search_players_route`, `get_player_by_slug_route`, `get_player`, `list_players`, `create_player_route`, `update_player_route`)
- Modify: `backend/app/api/routes/quizzes.py` (imports line ~15-20; `parse_results` line 245-256)
- Create: `backend/app/alembic/versions/d3e8f1a2b4c6_normalize_player_countries.py`
- Modify: `backend/tests/test_countries.py` (imports line 5; `test_player_base_rejects_invalid_country`, `test_player_base_accepts_valid_iso_code`, `test_player_base_accepts_home_nation`, `test_player_base_accepts_empty_countries`, lines 86-102)
- Modify: `backend/tests/unit/test_player_model.py` (imports line 6; `test_player_base_rejects_duplicate_countries`, lines 53-55)
- Modify: `backend/tests/api/routes/test_players.py` (append new tests)

**Interfaces:**
- Consumes: existing `Player`, `PlayerCreate`, `PlayerUpdate`, `PlayerPublic`, `_resolve_country_codes`, `_normalize` (all pre-existing in this codebase from earlier work).
- Produces: `PlayerCountry(SQLModel, table=True)` with `player_id: uuid.UUID`, `code: str`, `is_primary: bool`; `crud.build_players_public(*, session: Session, players: list[Player]) -> list[PlayerPublic]`; `crud.build_player_public(*, session: Session, player: Player) -> PlayerPublic`. No later task depends on these beyond Task 2/3's verification.

- [ ] **Step 1: Ensure environment**

```bash
docker compose up -d db
cd backend && uv sync
```

- [ ] **Step 2: Migrate the `PlayerBase`-constructing validation tests to `PlayerCreate`**

These tests currently construct `PlayerBase(display_name=..., countries=[...])` directly to exercise the country validator. Since `countries` is moving off `PlayerBase` in this task, they must construct `PlayerCreate` instead — same validator function, different class.

In `backend/tests/test_countries.py`, change the import on line 5:

```python
from app.models import PlayerCreate, PlayerUpdate
```

Replace lines 86-102 (the four `PlayerBase(...)` tests):

```python
def test_player_base_rejects_invalid_country() -> None:
    with pytest.raises(ValidationError):
        PlayerCreate(display_name="Test", countries=["Narnia"])


def test_player_base_accepts_valid_iso_code() -> None:
    p = PlayerCreate(display_name="Test", countries=["IE"])
    assert p.countries == ["IE"]


def test_player_base_accepts_home_nation() -> None:
    p = PlayerCreate(display_name="Test", countries=["ENG"])
    assert p.countries == ["ENG"]


def test_player_base_accepts_empty_countries() -> None:
    p = PlayerCreate(display_name="Test", countries=[])
    assert p.countries == []
```

In `backend/tests/unit/test_player_model.py`, change the import on line 6:

```python
from app.models import PlayerCreate, PlayerUpdate, QuizResultCreate
```

Replace lines 53-55 (`test_player_base_rejects_duplicate_countries`):

```python
def test_player_base_rejects_duplicate_countries() -> None:
    with pytest.raises(ValidationError):
        PlayerCreate(display_name="Test", countries=["IE", "IE"])
```

- [ ] **Step 3: Run the full test_countries.py and test_player_model.py to confirm this refactor alone is still green**

```bash
cd backend && uv run pytest tests/test_countries.py tests/unit/test_player_model.py -v
```

Expected: all PASS (this is a pure test-code refactor against the *current*, unmodified model — `PlayerCreate` already inherits `countries` from `PlayerBase` today, so behavior is unchanged at this point).

- [ ] **Step 4: Add new failing tests for the join-table behavior**

Append to `backend/tests/api/routes/test_players.py` (uses the file's existing `crud`, `PlayerCreate`, `client`, `settings`, `db` fixtures already imported at the top):

```python
def test_create_player_countries_round_trip_primary_first(
    client: TestClient, db: Session
) -> None:
    headers = create_organizer_user(client=client, db=db)
    payload = {"display_name": "Round Tripper", "countries": ["GB", "IE"]}
    r = client.post(f"{settings.API_V1_STR}/players/", json=payload, headers=headers)
    assert r.status_code == 200
    assert r.json()["countries"] == ["GB", "IE"]


def test_update_player_countries_replaces_and_reprimaries(
    client: TestClient, db: Session, superuser_token_headers: dict
) -> None:
    player = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name="Replaceable", countries=["IE"]),
    )
    r = client.patch(
        f"{settings.API_V1_STR}/players/{player.id}",
        json={"countries": ["FR", "DE"]},
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    assert r.json()["countries"] == ["FR", "DE"]


def test_update_player_omitted_countries_leaves_existing_untouched(
    client: TestClient, db: Session, superuser_token_headers: dict
) -> None:
    player = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name="Untouched", countries=["IE", "GB"]),
    )
    r = client.patch(
        f"{settings.API_V1_STR}/players/{player.id}",
        json={"bio": "just updating bio"},
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    assert r.json()["countries"] == ["IE", "GB"]


def test_search_by_country_only_orders_alphabetically(
    client: TestClient, db: Session
) -> None:
    zebra = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name="Zebra Orderplayer", countries=["IE"]),
    )
    zebra.is_published = True
    apple = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name="Apple Orderplayer", countries=["IE"]),
    )
    apple.is_published = True
    db.add(zebra)
    db.add(apple)
    db.commit()

    r = client.get(
        f"{settings.API_V1_STR}/players/search", params={"country": "ireland"}
    )
    assert r.status_code == 200
    names = [
        item["player"]["display_name"]
        for item in r.json()["data"]
        if item["player"]["id"] in {str(zebra.id), str(apple.id)}
    ]
    assert names == ["Apple Orderplayer", "Zebra Orderplayer"]
```

- [ ] **Step 5: Run the new tests to verify they fail**

```bash
cd backend && uv run pytest tests/api/routes/test_players.py -k "round_trip or reprimaries or untouched or orders_alphabetically" -v
```

Expected: FAIL. `test_create_player_countries_round_trip_primary_first` and the others will error (500 or assertion failure) because `Player` still has a real `countries` JSON column today (order isn't guaranteed to be `["GB", "IE"]` post-round-trip since JSON columns don't enforce anything about the *shape* of this test failing) — the important thing is these tests exercise behavior (ordering guarantees, replace-on-update semantics) not yet locked in by any implementation. Confirm they do NOT already pass.

- [ ] **Step 6: Add the `PlayerCountry` table and move `countries` off `PlayerBase`**

In `backend/app/models.py`, add this new class immediately before `class PlayerBase(SQLModel):` (currently ~line 290):

```python
class PlayerCountry(SQLModel, table=True):
    __tablename__ = "player_country"
    player_id: uuid.UUID = Field(
        foreign_key="player.id", primary_key=True, ondelete="CASCADE"
    )
    code: str = Field(max_length=3, primary_key=True)
    is_primary: bool = Field(default=False)
```

Replace `PlayerBase` (remove `countries` and its validator):

```python
class PlayerBase(SQLModel):
    display_name: str = Field(max_length=255)
    city: str | None = Field(default=None, max_length=255)
    club: str | None = Field(default=None, max_length=255)
    bio: str | None = Field(default=None)
    photo_url: str | None = Field(default=None, max_length=512)
```

Replace `PlayerCreate` (add `countries` + validator directly):

```python
class PlayerCreate(PlayerBase):
    countries: list[str] = Field(default_factory=list)

    @field_validator("countries")
    @classmethod
    def validate_countries(cls, v: list[str]) -> list[str]:
        return _validate_country_codes(v)
```

Replace the `Player` table class (drop the `countries` column entirely):

```python
class Player(PlayerBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    slug: str | None = Field(default=None, unique=True, index=True, max_length=255)
    is_published: bool = Field(default=False)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),
    )
```

Replace `PlayerPublic` (add `countries` directly, since it no longer comes from `PlayerBase`):

```python
class PlayerPublic(PlayerBase):
    id: uuid.UUID
    slug: str | None = None
    is_published: bool = False
    created_at: datetime | None = None
    countries: list[str] = Field(default_factory=list)
```

Do not touch `PlayerUpdate` — its `countries: list[str] | None` field and validator are already declared independently and are correct as-is.

The `Column`/`JSON` import from `sqlalchemy` at the top of `models.py` (`from sqlalchemy import JSON, Column, DateTime, UniqueConstraint`) may now be partially unused — check after this step whether `JSON`/`Column` are still referenced elsewhere in the file (they are used by other models such as `QuizFormat.rounds`), so leave the import line as-is; only remove names that become fully unused.

- [ ] **Step 7: Write the migration**

Create `backend/app/alembic/versions/d3e8f1a2b4c6_normalize_player_countries.py`:

```python
"""normalize player countries into a join table

Revision ID: d3e8f1a2b4c6
Revises: c9d4e5f6a7b8
Create Date: 2026-07-07

"""
import json

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = 'd3e8f1a2b4c6'
down_revision = 'c9d4e5f6a7b8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'player_country',
        sa.Column('player_id', sa.Uuid(), nullable=False),
        sa.Column('code', sa.String(length=3), nullable=False),
        sa.Column('is_primary', sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(['player_id'], ['player.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('player_id', 'code'),
    )
    op.create_index(
        'ix_player_country_code', 'player_country', ['code'], unique=False
    )

    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, countries FROM player")).fetchall()
    for row in rows:
        raw = row.countries
        codes = json.loads(raw) if isinstance(raw, str) else (raw or [])
        for index, code in enumerate(codes):
            conn.execute(
                sa.text(
                    "INSERT INTO player_country (player_id, code, is_primary) "
                    "VALUES (:player_id, :code, :is_primary)"
                ),
                {
                    "player_id": str(row.id),
                    "code": code,
                    "is_primary": index == 0,
                },
            )

    op.drop_column('player', 'countries')


def downgrade() -> None:
    op.add_column(
        'player',
        sa.Column('countries', sa.JSON(), nullable=False, server_default='[]'),
    )

    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT player_id, code, is_primary FROM player_country")
    ).fetchall()
    by_player: dict[str, list[tuple[str, bool]]] = {}
    for row in rows:
        by_player.setdefault(str(row.player_id), []).append((row.code, row.is_primary))
    for player_id, links in by_player.items():
        primary = [code for code, is_primary in links if is_primary]
        rest = sorted(code for code, is_primary in links if not is_primary)
        conn.execute(
            sa.text("UPDATE player SET countries = CAST(:c AS JSON) WHERE id = :id"),
            {"c": json.dumps(primary + rest), "id": player_id},
        )

    op.alter_column('player', 'countries', server_default=None)
    op.drop_index('ix_player_country_code', table_name='player_country')
    op.drop_table('player_country')
```

- [ ] **Step 8: Apply the migration**

```bash
cd backend && uv run alembic upgrade head && uv run alembic current
```

Expected: `Running upgrade c9d4e5f6a7b8 -> d3e8f1a2b4c6` and `current` prints `d3e8f1a2b4c6 (head)`.

- [ ] **Step 9: Rewrite `create_player`, `search_players`, `update_player`, and add `build_players_public`/`build_player_public` in `crud.py`**

Update the imports at the top of `backend/app/crud.py`: add `delete` to the `sqlmodel` import and `PlayerCountry` to the `app.models` import:

```python
from sqlmodel import Session, col, delete, select
```

```python
from app.models import (
    Organization,
    OrganizationCreate,
    OrganizationUpdate,
    Player,
    PlayerCountry,
    PlayerCreate,
    PlayerPublic,
    PlayerUpdate,
    Quiz,
    QuizCreate,
    QuizFormat,
    QuizFormatCreate,
    QuizFormatUpdate,
    QuizResult,
    QuizResultCreate,
    QuizSeries,
    QuizSeriesCreate,
    QuizSeriesUpdate,
    QuizStatus,
    QuizUpdate,
    User,
    UserCreate,
    UserUpdate,
)
```

Replace `create_player` (currently lines 163-169):

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

Replace `search_players` (currently lines 188-232) — the country filter moves into SQL, and the country-only path orders/limits in SQL:

```python
def search_players(
    *,
    session: Session,
    q: str = "",
    country: str | None = None,
    limit: int = 5,
    published_only: bool = False,
) -> list[tuple[Player, float]]:
    name_query = (q or "").strip()
    country_text = (country or "").strip()
    if not name_query and not country_text:
        return []

    q_norm = _normalize(q or "")
    stmt = select(Player)
    if name_query:
        stmt = stmt.where(
            or_(
                col(Player.display_name).ilike(f"%{q}%"),
                col(Player.display_name).ilike(f"%{q_norm}%"),
            )
        )
    if published_only:
        stmt = stmt.where(Player.is_published == True)  # noqa: E712

    if country_text:
        codes = _resolve_country_codes(country_text)
        if not codes:
            return []
        stmt = stmt.where(
            col(Player.id).in_(
                select(PlayerCountry.player_id).where(
                    col(PlayerCountry.code).in_(codes)
                )
            )
        )

    if name_query:
        players = list(session.exec(stmt).all())
        scored = [
            (p, SequenceMatcher(None, q_norm, _normalize(p.display_name)).ratio())
            for p in players
        ]
        scored.sort(key=lambda x: x[1], reverse=True)
    else:
        stmt = stmt.order_by(func.lower(Player.display_name)).limit(limit)
        players = list(session.exec(stmt).all())
        scored = [(p, 0.0) for p in players]

    return scored[:limit]
```

Replace `update_player` (currently lines 235-247):

```python
def update_player(
    *, session: Session, db_player: Player, player_in: PlayerUpdate
) -> Player:
    data = player_in.model_dump(exclude_unset=True)
    new_countries = data.pop("countries", None)
    if "slug" in data and data["slug"] is not None:
        existing = get_player_by_slug(session=session, slug=data["slug"])
        if existing and existing.id != db_player.id:
            raise ValueError("Slug already in use")
    db_player.sqlmodel_update(data)
    session.add(db_player)

    if new_countries is not None:
        session.exec(
            delete(PlayerCountry).where(col(PlayerCountry.player_id) == db_player.id)
        )
        for index, code in enumerate(new_countries):
            session.add(
                PlayerCountry(
                    player_id=db_player.id, code=code, is_primary=(index == 0)
                )
            )

    session.commit()
    session.refresh(db_player)
    return db_player
```

Add these two new functions immediately after `update_player` (before `get_player_history`):

```python
def build_players_public(
    *, session: Session, players: list[Player]
) -> list[PlayerPublic]:
    if not players:
        return []
    ids = [p.id for p in players]
    links = session.exec(
        select(PlayerCountry).where(col(PlayerCountry.player_id).in_(ids))
    ).all()
    by_player: dict[uuid.UUID, list[PlayerCountry]] = {}
    for link in links:
        by_player.setdefault(link.player_id, []).append(link)

    def _countries(player_id: uuid.UUID) -> list[str]:
        player_links = by_player.get(player_id, [])
        primary = [pc.code for pc in player_links if pc.is_primary]
        rest = sorted(pc.code for pc in player_links if not pc.is_primary)
        return primary + rest

    return [
        PlayerPublic(**p.model_dump(), countries=_countries(p.id)) for p in players
    ]


def build_player_public(*, session: Session, player: Player) -> PlayerPublic:
    return build_players_public(session=session, players=[player])[0]
```

- [ ] **Step 10: Wire the new helpers into `players.py` routes**

In `backend/app/api/routes/players.py`, update the `from app.crud import (...)` block to add the two new functions:

```python
from app.crud import (
    build_player_public,
    build_players_public,
    create_player,
    delete_player,
    get_player_by_slug,
    get_player_history,
    search_players,
    update_player,
)
```

Replace `search_players_route` (currently lines 36-57):

```python
@router.get("/search", response_model=PlayerSearchResults)
def search_players_route(
    session: SessionDep,
    current_user: OptionalCurrentUser,
    q: str = "",
    country: str | None = None,
    limit: int = 5,
) -> PlayerSearchResults:
    published_only = current_user is None
    results = search_players(
        session=session,
        q=q,
        country=country,
        limit=limit,
        published_only=published_only,
    )
    players_public = build_players_public(
        session=session, players=[p for p, _ in results]
    )
    return PlayerSearchResults(
        data=[
            PlayerSearchResult(player=pub, similarity=score)
            for pub, (_, score) in zip(players_public, results)
        ]
    )
```

Replace `get_player_by_slug_route` (currently lines 60-68), specifically its return statement:

```python
@router.get("/by-slug/{slug}", response_model=PlayerPublic)
def get_player_by_slug_route(
    slug: str, session: SessionDep, current_user: OptionalCurrentUser
) -> PlayerPublic:
    player = get_player_by_slug(session=session, slug=slug)
    is_superuser = current_user is not None and current_user.is_superuser
    if not player or (not player.is_published and not is_superuser):
        raise HTTPException(status_code=404, detail="Player not found")
    return build_player_public(session=session, player=player)
```

Replace `get_player` (currently lines 97-105):

```python
@router.get("/{player_id}", response_model=PlayerPublic)
def get_player(
    player_id: uuid.UUID, session: SessionDep, current_user: OptionalCurrentUser
) -> PlayerPublic:
    player = session.get(Player, player_id)
    is_superuser = current_user is not None and current_user.is_superuser
    if not player or (not player.is_published and not is_superuser):
        raise HTTPException(status_code=404, detail="Player not found")
    return build_player_public(session=session, player=player)
```

Replace `list_players` (currently lines 108-118):

```python
@router.get("/", response_model=PlayersPublic)
def list_players(
    session: SessionDep,
    skip: int = 0,
    limit: int = 100,
) -> PlayersPublic:
    count_stmt = select(func.count()).select_from(Player).where(Player.is_published == True)  # noqa: E712
    list_stmt = select(Player).where(Player.is_published == True)  # noqa: E712
    count = session.exec(count_stmt).one()
    players = session.exec(list_stmt.offset(skip).limit(limit)).all()
    return PlayersPublic(
        data=build_players_public(session=session, players=list(players)),
        count=count,
    )
```

Replace `create_player_route` (currently lines 121-127):

```python
@router.post("/", response_model=PlayerPublic)
def create_player_route(
    player_in: PlayerCreate,
    session: SessionDep,
    _current_user: CurrentOrganizer,
) -> PlayerPublic:
    player = create_player(session=session, player_in=player_in)
    return build_player_public(session=session, player=player)
```

Replace `update_player_route` (currently lines 130-143):

```python
@router.patch("/{player_id}", response_model=PlayerPublic)
def update_player_route(
    player_id: uuid.UUID,
    player_in: PlayerUpdate,
    session: SessionDep,
    _current_user: CurrentSuperuser,
) -> PlayerPublic:
    player = session.get(Player, player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    try:
        updated = update_player(session=session, db_player=player, player_in=player_in)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return build_player_public(session=session, player=updated)
```

`get_player_history_route` and `delete_player_route` are unchanged.

- [ ] **Step 11: Wire the new helper into `quizzes.py`'s `parse_results`**

In `backend/app/api/routes/quizzes.py`, `PlayerPublic` is currently imported (line ~20) and used only inside `parse_results`. Since it's no longer constructed directly there, remove `PlayerPublic` from the `from app.models import (...)` block.

Replace the body of `parse_results` (currently lines 245-256):

```python
    results = []
    for row in request.rows:
        scored = crud.search_players(
            session=session, q=row.player_name, country=row.country
        )
        players_public = crud.build_players_public(
            session=session, players=[p for p, _ in scored]
        )
        candidates = [
            PlayerSearchResult(player=pub, similarity=score)
            for pub, (_, score) in zip(players_public, scored)
        ]
        results.append(ParsedResultWithCandidates(row=row, candidates=candidates))
    return ParseResultsResponse(results=results)
```

(`crud` is already imported as a module in `quizzes.py` via `from app import crud`, so `crud.build_players_public` needs no new import.)

- [ ] **Step 12: Run the full players and countries test files to verify GREEN**

```bash
cd backend && uv run pytest tests/api/routes/test_players.py tests/test_countries.py tests/unit/test_player_model.py -v
```

Expected: all PASS, including the four new tests from Step 4/5.

- [ ] **Step 13: Run the quizzes test file (covers `parse_results`) and the full backend suite**

```bash
cd backend && uv run pytest tests/api/routes/test_quizzes.py -v
cd backend && bash scripts/test.sh
```

Expected: all PASS.

- [ ] **Step 14: Rebuild the running backend container**

```bash
docker compose up -d --build backend
```

Verify: `curl -s "http://localhost:8000/api/v1/players/search?country=ireland" -o /dev/null -w "%{http_code}\n"` prints `200`.

- [ ] **Step 15: Commit**

```bash
git add backend/app/models.py backend/app/crud.py backend/app/api/routes/players.py backend/app/api/routes/quizzes.py backend/app/alembic/versions/d3e8f1a2b4c6_normalize_player_countries.py backend/tests/test_countries.py backend/tests/unit/test_player_model.py backend/tests/api/routes/test_players.py
git commit -m "feat(backend): normalize player countries into a join table with DB-side search

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Regenerate the frontend OpenAPI client (verification)

**Files:**
- Modify (generated, only if the schema actually changed): `frontend/src/client/types.gen.ts`, `frontend/src/client/schemas.gen.ts`

**Interfaces:**
- Consumes: Task 1's route contract. Per the spec, `PlayerPublic.countries` and `PlayerCreate.countries` keep the same `list[str]` JSON shape, so no diff is expected — this task is a verification step, not expected to produce a real change.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Regenerate**

From the project root (backend container must be running with Task 1's changes):

```bash
bash ./scripts/generate-client.sh
```

Expected: exits 0.

- [ ] **Step 2: Check whether anything actually changed**

```bash
git status --porcelain frontend/src/client/
```

Expected: most likely empty (no diff) — the API contract for `PlayerPublic`/`PlayerCreate` is unchanged in shape. If there IS a diff, read it (`git diff frontend/src/client/`) before proceeding — it should only be field-ordering noise from the schema regeneration, not a semantic change to `countries`. If it looks like more than that, stop and report rather than committing blindly.

- [ ] **Step 3: Commit only if there is a diff**

```bash
git status --porcelain frontend/src/client/
```

If non-empty:

```bash
git add frontend/src/client/
git commit -m "chore(client): regenerate OpenAPI client after player countries normalization

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

If empty, skip — no commit needed for this task.

---

### Task 3: Final verification

**Files:** none new — fixes only if something fails.

- [ ] **Step 1: Full backend suite**

```bash
cd backend && bash scripts/test.sh
```

Expected: all PASS.

- [ ] **Step 2: Live smoke checks against the running backend**

```bash
curl -s "http://localhost:8000/api/v1/players/search?country=ireland" -w "\nHTTP %{http_code}\n"
curl -s "http://localhost:8000/api/v1/players/search?country=zzzznotacountry" -w "\nHTTP %{http_code}\n"
curl -s "http://localhost:8000/api/v1/players/" -w "\nHTTP %{http_code}\n"
```

Expected: all HTTP 200, well-formed JSON with a `data` array. The `/players/` response's items each have a `countries` field (a list, possibly empty).

- [ ] **Step 3: Frontend build (regression check — no frontend files changed, confirm the client still type-checks against existing usage)**

```bash
cd frontend && bun run build && bun run lint
```

Expected: both exit 0.

- [ ] **Step 4: Players Playwright spec (regression)**

```bash
cd frontend && bunx playwright test tests/players.spec.ts
```

Expected: PASS, or any failures reproduce identically on the pre-feature base commit (verify via a disposable worktree before treating as pre-existing, same method used in prior verification tasks on this branch).

- [ ] **Step 5: Commit any straggler fixes**

Only if Steps 1-4 changed files (e.g. a lint autofix on a file this feature touched — do NOT reformat unrelated files):

```bash
git add -A && git commit -m "chore: fixes from final verification of player countries normalization

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
