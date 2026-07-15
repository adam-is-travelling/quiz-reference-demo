# Player Merge (Admin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins can merge a duplicate player into a canonical one — with a preview of exactly what will move and what will be deleted — plus an append-only audit table and history page.

**Architecture:** Two new superuser-only endpoints (`POST /players/merge/preview`, `POST /players/merge`) backed by pure-ish crud functions and a new `player_merge_audit` table (hand-written Alembic migration), plus `GET /players/merges`. Frontend: a `/admin/players/merge` page (two search pickers → preview → confirm), a `/admin/players/merges` history page, and a "Merge into…" shortcut on player profiles. The generated OpenAPI client is regenerated between backend and frontend work.

**Tech Stack:** FastAPI + SQLModel + Alembic + pytest (backend); React/TypeScript + TanStack Router/Query + shadcn/ui + Playwright (frontend).

**Spec:** `docs/superpowers/specs/2026-07-15-player-merge-design.md`

## Global Constraints

- **Merge semantics (exact):** conflicts (both players have a `QuizResult` in the same quiz) delete the SOURCE's result and keep the target's; remaining source results repoint to the target; countries union (target rows untouched, source-only codes added `is_primary=False`); profile fields copied ONLY where target is blank (`None` or `""`) and only `city`, `club`, `bio`, `photo_url`; `display_name`, `slug`, `is_published` never change; source player deleted; one audit row written — all in ONE transaction (single commit).
- **Route-order trap:** `GET /players/merges` and the merge POST routes MUST be defined in `players.py` ABOVE `GET /players/{player_id}` — otherwise FastAPI tries to parse `"merges"` as a UUID and returns 422.
- Backend commands run from `backend/` with `uv run …`; frontend from `frontend/` with bun. Backend tests: `uv run pytest tests/ -q`. Frontend: `bun run test:unit`, `bun run build`, `bun run lint`.
- Client regeneration: `bash ./scripts/generate-client.sh` from the repo root (exports OpenAPI via `uv run python`, regenerates `frontend/src/client/`, lints).
- Docker: the stack is running. The `frontend` container shadows :5173 with a stale build (stop before Playwright, `docker compose up -d frontend` after) and the `backend` container runs baked code (rebuild before E2E: `docker compose build backend && docker compose up -d backend`). NEVER `docker compose down`, `down -v`, or anything touching volumes.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Backend — audit table, merge crud, routes, tests

**Files:**
- Modify: `backend/app/models.py` (add merge schemas + `PlayerMergeAudit` after the `PlayerHistory` class, ~line 395)
- Create: `backend/app/alembic/versions/e7a1b2c3d4f5_add_player_merge_audit.py`
- Modify: `backend/app/crud.py` (add `preview_merge_players`, `merge_players`, `list_merge_audits`)
- Modify: `backend/app/api/routes/players.py` (three routes, ABOVE `get_player`)
- Test: `backend/tests/api/routes/test_player_merge.py` (new file)

**Interfaces:**
- Consumes: existing `Player`, `PlayerCountry`, `QuizResult`, `Quiz`, `User` models; `CurrentSuperuser` dep; test helpers `create_published_player`, `create_approved_event`, `crud.create_quiz_results`, `create_organizer_user` fixtures `superuser_token_headers`, `normal_user_token_headers`.
- Produces (Tasks 2-5 rely on these exact names): endpoints `POST /api/v1/players/merge/preview` → `MergePlayersPreview`, `POST /api/v1/players/merge` → `PlayerPublic`, `GET /api/v1/players/merges` → `PlayerMergeAuditsPublic`; operation ids `preview_merge_players_route`, `merge_players_route`, `list_player_merges_route` (client methods `PlayersService.previewMergePlayersRoute` / `mergePlayersRoute` / `listPlayerMergesRoute`); schema fields exactly as in the models below.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/api/routes/test_player_merge.py`:

```python
import uuid
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete, select

from app import crud
from app.core.config import settings
from app.models import (
    Player,
    PlayerCountry,
    PlayerCreate,
    PlayerMergeAudit,
    Quiz,
    QuizResult,
    QuizResultCreate,
)
from tests.utils.quiz import create_approved_event, create_published_player


@pytest.fixture(autouse=True)
def clean_merge_data(db: Session) -> Generator[None, None, None]:
    pre_players = {r.id for r in db.exec(select(Player)).all()}
    pre_quizzes = {r.id for r in db.exec(select(Quiz)).all()}
    yield
    db.expire_all()
    db.execute(delete(PlayerMergeAudit))
    new_quiz_ids = {r.id for r in db.exec(select(Quiz)).all()} - pre_quizzes
    if new_quiz_ids:
        db.execute(delete(Quiz).where(col(Quiz.id).in_(new_quiz_ids)))
    new_player_ids = {r.id for r in db.exec(select(Player)).all()} - pre_players
    if new_player_ids:
        db.execute(delete(Player).where(col(Player.id).in_(new_player_ids)))
    db.commit()


def _payload(source: Player, target: Player) -> dict:
    return {
        "source_player_id": str(source.id),
        "target_player_id": str(target.id),
    }


def _make_player(db: Session, *, countries: list[str], **fields) -> Player:
    return crud.create_player(
        session=db,
        player_in=PlayerCreate(
            display_name=fields.pop("display_name", f"P {uuid.uuid4().hex[:8]}"),
            countries=countries,
            **fields,
        ),
    )


def test_merge_moves_results_and_deletes_source(
    client: TestClient, db: Session, superuser_token_headers: dict
) -> None:
    source = create_published_player(db)
    target = create_published_player(db)
    quiz = create_approved_event(db)
    crud.create_quiz_results(
        session=db,
        event_id=quiz.id,
        results=[QuizResultCreate(player_id=source.id, final_rank=2, score=50.0)],
    )
    r = client.post(
        f"{settings.API_V1_STR}/players/merge",
        json=_payload(source, target),
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    assert r.json()["id"] == str(target.id)
    db.expire_all()
    moved = db.exec(
        select(QuizResult).where(col(QuizResult.player_id) == target.id)
    ).all()
    assert len(moved) == 1
    assert moved[0].quiz_id == quiz.id
    assert db.get(Player, source.id) is None


def test_merge_conflict_keeps_target_result(
    client: TestClient, db: Session, superuser_token_headers: dict
) -> None:
    source = create_published_player(db)
    target = create_published_player(db)
    conflict_quiz = create_approved_event(db)
    other_quiz = create_approved_event(db)
    crud.create_quiz_results(
        session=db,
        event_id=conflict_quiz.id,
        results=[
            QuizResultCreate(player_id=source.id, final_rank=5, score=10.0),
            QuizResultCreate(player_id=target.id, final_rank=1, score=99.0),
        ],
    )
    crud.create_quiz_results(
        session=db,
        event_id=other_quiz.id,
        results=[QuizResultCreate(player_id=source.id, final_rank=3, score=42.0)],
    )
    r = client.post(
        f"{settings.API_V1_STR}/players/merge",
        json=_payload(source, target),
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    db.expire_all()
    target_results = db.exec(
        select(QuizResult).where(col(QuizResult.player_id) == target.id)
    ).all()
    by_quiz = {res.quiz_id: res for res in target_results}
    assert set(by_quiz) == {conflict_quiz.id, other_quiz.id}
    assert by_quiz[conflict_quiz.id].score == 99.0  # target's kept
    assert by_quiz[other_quiz.id].score == 42.0  # source's moved
    assert db.get(Player, source.id) is None


def test_merge_unions_countries_and_fills_blanks(
    client: TestClient, db: Session, superuser_token_headers: dict
) -> None:
    source = _make_player(
        db, countries=["IE", "DE"], city="Dublin", club="Quiz Club", bio="A bio"
    )
    target = _make_player(db, countries=["FR"], club="Existing Club")
    r = client.post(
        f"{settings.API_V1_STR}/players/merge",
        json=_payload(source, target),
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["city"] == "Dublin"  # blank -> filled
    assert body["club"] == "Existing Club"  # non-blank -> untouched
    assert body["bio"] == "A bio"
    db.expire_all()
    links = db.exec(
        select(PlayerCountry).where(col(PlayerCountry.player_id) == target.id)
    ).all()
    by_code = {pc.code: pc for pc in links}
    assert set(by_code) == {"FR", "IE", "DE"}
    assert by_code["FR"].is_primary is True  # target primary unchanged
    assert by_code["IE"].is_primary is False
    assert by_code["DE"].is_primary is False


def test_merge_never_changes_name_slug_published(
    client: TestClient, db: Session, superuser_token_headers: dict
) -> None:
    source = create_published_player(db)
    target = _make_player(db, countries=[], display_name="Keep Me")
    r = client.post(
        f"{settings.API_V1_STR}/players/merge",
        json=_payload(source, target),
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["display_name"] == "Keep Me"
    assert body["is_published"] is False  # target's own value, source was published


def test_preview_reports_and_changes_nothing(
    client: TestClient, db: Session, superuser_token_headers: dict
) -> None:
    source = _make_player(db, countries=["IE"], bio="Source bio")
    target = _make_player(db, countries=["FR"])
    conflict_quiz = create_approved_event(db)
    other_quiz = create_approved_event(db)
    crud.create_quiz_results(
        session=db,
        event_id=conflict_quiz.id,
        results=[
            QuizResultCreate(player_id=source.id, final_rank=2, score=20.0),
            QuizResultCreate(player_id=target.id, final_rank=1, score=80.0),
        ],
    )
    crud.create_quiz_results(
        session=db,
        event_id=other_quiz.id,
        results=[QuizResultCreate(player_id=source.id, final_rank=1, score=70.0)],
    )
    r = client.post(
        f"{settings.API_V1_STR}/players/merge/preview",
        json=_payload(source, target),
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["moved_results_count"] == 1
    assert len(body["conflicts"]) == 1
    conflict = body["conflicts"][0]
    assert conflict["quiz_id"] == str(conflict_quiz.id)
    assert conflict["quiz_name"] == conflict_quiz.name
    assert conflict["source_score"] == 20.0
    assert conflict["target_score"] == 80.0
    assert body["filled_fields"] == ["bio"]
    assert body["added_countries"] == ["IE"]
    # read-only: nothing changed
    db.expire_all()
    assert db.get(Player, source.id) is not None
    assert (
        len(db.exec(select(QuizResult).where(col(QuizResult.player_id) == source.id)).all())
        == 2
    )
    assert db.exec(select(PlayerMergeAudit)).first() is None


def test_merge_writes_audit_row(
    client: TestClient, db: Session, superuser_token_headers: dict
) -> None:
    source = create_published_player(db)
    target = create_published_player(db)
    quiz = create_approved_event(db)
    crud.create_quiz_results(
        session=db,
        event_id=quiz.id,
        results=[QuizResultCreate(player_id=source.id, final_rank=1, score=1.0)],
    )
    source_name, source_slug, source_id = (
        source.display_name,
        source.slug,
        source.id,
    )
    r = client.post(
        f"{settings.API_V1_STR}/players/merge",
        json=_payload(source, target),
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    db.expire_all()
    audits = db.exec(select(PlayerMergeAudit)).all()
    assert len(audits) == 1
    audit = audits[0]
    assert audit.source_player_id == source_id
    assert audit.source_display_name == source_name
    assert audit.source_slug == source_slug
    assert audit.target_player_id == target.id
    assert audit.target_display_name == target.display_name
    assert audit.moved_results_count == 1
    assert audit.deleted_conflicts_count == 0
    assert audit.performed_by_email == settings.FIRST_SUPERUSER


def test_list_merges_newest_first_superuser_only(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict,
    normal_user_token_headers: dict,
) -> None:
    a = create_published_player(db)
    b = create_published_player(db)
    c = create_published_player(db)
    client.post(
        f"{settings.API_V1_STR}/players/merge",
        json=_payload(a, c),
        headers=superuser_token_headers,
    )
    client.post(
        f"{settings.API_V1_STR}/players/merge",
        json=_payload(b, c),
        headers=superuser_token_headers,
    )
    r = client.get(
        f"{settings.API_V1_STR}/players/merges", headers=superuser_token_headers
    )
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 2
    assert body["data"][0]["source_player_id"] == str(b.id)  # newest first
    assert body["data"][1]["source_player_id"] == str(a.id)
    r403 = client.get(
        f"{settings.API_V1_STR}/players/merges", headers=normal_user_token_headers
    )
    assert r403.status_code == 403


def test_merge_requires_superuser(
    client: TestClient, db: Session, normal_user_token_headers: dict
) -> None:
    source = create_published_player(db)
    target = create_published_player(db)
    for path in ("/players/merge", "/players/merge/preview"):
        r = client.post(
            f"{settings.API_V1_STR}{path}",
            json=_payload(source, target),
            headers=normal_user_token_headers,
        )
        assert r.status_code == 403


def test_merge_validation_errors(
    client: TestClient, db: Session, superuser_token_headers: dict
) -> None:
    player = create_published_player(db)
    r_same = client.post(
        f"{settings.API_V1_STR}/players/merge",
        json=_payload(player, player),
        headers=superuser_token_headers,
    )
    assert r_same.status_code == 400
    r_missing = client.post(
        f"{settings.API_V1_STR}/players/merge",
        json={
            "source_player_id": str(uuid.uuid4()),
            "target_player_id": str(player.id),
        },
        headers=superuser_token_headers,
    )
    assert r_missing.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `backend/`): `uv run pytest tests/api/routes/test_player_merge.py -q`
Expected: FAIL — `ImportError: cannot import name 'PlayerMergeAudit'`.

- [ ] **Step 3: Add models**

In `backend/app/models.py`, after the `PlayerHistory` class (before the `# QuizResult` section divider), add (all imports — `uuid`, `date`, `datetime`, `DateTime`, `Field`, `SQLModel`, `get_datetime_utc` — already exist in the file):

```python
# ---------------------------------------------------------------------------
# Player merge
# ---------------------------------------------------------------------------


class MergePlayersRequest(SQLModel):
    source_player_id: uuid.UUID
    target_player_id: uuid.UUID


class MergeConflict(SQLModel):
    quiz_id: uuid.UUID
    quiz_name: str
    start_date: date
    source_score: float
    source_rank: int | None
    target_score: float
    target_rank: int | None


class MergePlayersPreview(SQLModel):
    moved_results_count: int
    conflicts: list[MergeConflict]
    filled_fields: list[str]
    added_countries: list[str]


class PlayerMergeAudit(SQLModel, table=True):
    __tablename__ = "player_merge_audit"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    merged_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),
    )
    performed_by_id: uuid.UUID | None = Field(
        default=None, foreign_key="user.id", nullable=True, ondelete="SET NULL"
    )
    performed_by_email: str = Field(max_length=255)
    source_player_id: uuid.UUID
    source_display_name: str = Field(max_length=255)
    source_slug: str | None = Field(default=None, max_length=255)
    target_player_id: uuid.UUID
    target_display_name: str = Field(max_length=255)
    moved_results_count: int
    deleted_conflicts_count: int


class PlayerMergeAuditPublic(SQLModel):
    id: uuid.UUID
    merged_at: datetime | None
    performed_by_email: str
    source_player_id: uuid.UUID
    source_display_name: str
    source_slug: str | None
    target_player_id: uuid.UUID
    target_display_name: str
    moved_results_count: int
    deleted_conflicts_count: int


class PlayerMergeAuditsPublic(SQLModel):
    data: list[PlayerMergeAuditPublic]
    count: int
```

- [ ] **Step 4: Write and apply the migration**

Create `backend/app/alembic/versions/e7a1b2c3d4f5_add_player_merge_audit.py` (current head is `d3e8f1a2b4c6` — verify with `uv run alembic heads` before writing; if it differs, use the actual head as `down_revision`). Before writing, open one recent migration (e.g. `d7d5076c786b_country_varchar3_nullable.py`) and mirror its import style for UUID/string column types; the template below uses the conventions current alembic autogenerate emits for this project:

```python
"""add player_merge_audit

Revision ID: e7a1b2c3d4f5
Revises: d3e8f1a2b4c6
Create Date: 2026-07-15
"""
import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

revision = "e7a1b2c3d4f5"
down_revision = "d3e8f1a2b4c6"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "player_merge_audit",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("merged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("performed_by_id", sa.Uuid(), nullable=True),
        sa.Column(
            "performed_by_email",
            sqlmodel.sql.sqltypes.AutoString(length=255),
            nullable=False,
        ),
        sa.Column("source_player_id", sa.Uuid(), nullable=False),
        sa.Column(
            "source_display_name",
            sqlmodel.sql.sqltypes.AutoString(length=255),
            nullable=False,
        ),
        sa.Column(
            "source_slug", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=True
        ),
        sa.Column("target_player_id", sa.Uuid(), nullable=False),
        sa.Column(
            "target_display_name",
            sqlmodel.sql.sqltypes.AutoString(length=255),
            nullable=False,
        ),
        sa.Column("moved_results_count", sa.Integer(), nullable=False),
        sa.Column("deleted_conflicts_count", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["performed_by_id"], ["user.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade():
    op.drop_table("player_merge_audit")
```

Apply it (from `backend/`, against the running dev DB):
```bash
uv run alembic upgrade head
```
Expected: `Running upgrade d3e8f1a2b4c6 -> e7a1b2c3d4f5`.

- [ ] **Step 5: Add crud functions**

In `backend/app/crud.py`, add to the imports from `app.models`: `MergeConflict`, `MergePlayersPreview`, `PlayerMergeAudit`, `Quiz` and `User` (if not present — `User` is). Then add after `delete_player`:

```python
_MERGE_FILL_FIELDS = ("city", "club", "bio", "photo_url")


def _is_blank(value: str | None) -> bool:
    return value is None or value == ""


def _merge_conflicts(
    *, session: Session, source_id: uuid.UUID, target_id: uuid.UUID
) -> list[tuple[QuizResult, QuizResult, Quiz]]:
    """(source_result, target_result, quiz) for quizzes where both players have results."""
    source_rows = session.exec(
        select(QuizResult, Quiz)
        .join(Quiz, col(QuizResult.quiz_id) == col(Quiz.id))
        .where(col(QuizResult.player_id) == source_id)
    ).all()
    conflicts = []
    for source_result, quiz in source_rows:
        target_result = session.exec(
            select(QuizResult)
            .where(col(QuizResult.quiz_id) == quiz.id)
            .where(col(QuizResult.player_id) == target_id)
        ).first()
        if target_result is not None:
            conflicts.append((source_result, target_result, quiz))
    return conflicts


def _player_country_rows(
    *, session: Session, player_id: uuid.UUID
) -> list[PlayerCountry]:
    return list(
        session.exec(
            select(PlayerCountry).where(col(PlayerCountry.player_id) == player_id)
        ).all()
    )


def preview_merge_players(
    *, session: Session, source: Player, target: Player
) -> MergePlayersPreview:
    conflicts = _merge_conflicts(
        session=session, source_id=source.id, target_id=target.id
    )
    source_result_count = session.exec(
        select(func.count())
        .select_from(QuizResult)
        .where(col(QuizResult.player_id) == source.id)
    ).one()
    filled_fields = [
        f
        for f in _MERGE_FILL_FIELDS
        if _is_blank(getattr(target, f)) and not _is_blank(getattr(source, f))
    ]
    target_codes = {
        pc.code for pc in _player_country_rows(session=session, player_id=target.id)
    }
    added_countries = [
        pc.code
        for pc in _player_country_rows(session=session, player_id=source.id)
        if pc.code not in target_codes
    ]
    return MergePlayersPreview(
        moved_results_count=source_result_count - len(conflicts),
        conflicts=[
            MergeConflict(
                quiz_id=quiz.id,
                quiz_name=quiz.name,
                start_date=quiz.start_date,
                source_score=s.score,
                source_rank=s.final_rank,
                target_score=t.score,
                target_rank=t.final_rank,
            )
            for s, t, quiz in conflicts
        ],
        filled_fields=filled_fields,
        added_countries=added_countries,
    )


def merge_players(
    *, session: Session, source: Player, target: Player, performed_by: User
) -> Player:
    preview = preview_merge_players(session=session, source=source, target=target)
    conflict_quiz_ids = {c.quiz_id for c in preview.conflicts}
    for result in session.exec(
        select(QuizResult).where(col(QuizResult.player_id) == source.id)
    ).all():
        if result.quiz_id in conflict_quiz_ids:
            session.delete(result)
        else:
            result.player_id = target.id
            session.add(result)
    target_codes = {
        pc.code for pc in _player_country_rows(session=session, player_id=target.id)
    }
    for pc in _player_country_rows(session=session, player_id=source.id):
        if pc.code not in target_codes:
            session.add(
                PlayerCountry(player_id=target.id, code=pc.code, is_primary=False)
            )
    for field in preview.filled_fields:
        setattr(target, field, getattr(source, field))
    session.add(target)
    session.add(
        PlayerMergeAudit(
            performed_by_id=performed_by.id,
            performed_by_email=performed_by.email,
            source_player_id=source.id,
            source_display_name=source.display_name,
            source_slug=source.slug,
            target_player_id=target.id,
            target_display_name=target.display_name,
            moved_results_count=preview.moved_results_count,
            deleted_conflicts_count=len(preview.conflicts),
        )
    )
    session.delete(source)
    session.commit()
    session.refresh(target)
    return target


def list_merge_audits(
    *, session: Session, skip: int = 0, limit: int = 100
) -> tuple[list[PlayerMergeAudit], int]:
    count = session.exec(
        select(func.count()).select_from(PlayerMergeAudit)
    ).one()
    audits = session.exec(
        select(PlayerMergeAudit)
        .order_by(col(PlayerMergeAudit.merged_at).desc())
        .offset(skip)
        .limit(limit)
    ).all()
    return list(audits), count
```

- [ ] **Step 6: Add routes**

In `backend/app/api/routes/players.py`: extend the `app.crud` import with `list_merge_audits`, `merge_players`, `preview_merge_players`, and the `app.models` import with `MergePlayersRequest`, `MergePlayersPreview`, `PlayerMergeAuditPublic`, `PlayerMergeAuditsPublic`. Then insert the following block **immediately after the `search_players_batch_route` function and before `get_player_by_slug_route`** (must precede any `/{player_id}` route — see Global Constraints):

```python
@router.get("/merges", response_model=PlayerMergeAuditsPublic)
def list_player_merges_route(
    session: SessionDep,
    _current_user: CurrentSuperuser,
    skip: int = 0,
    limit: int = 100,
) -> PlayerMergeAuditsPublic:
    audits, count = list_merge_audits(session=session, skip=skip, limit=limit)
    return PlayerMergeAuditsPublic(
        data=[PlayerMergeAuditPublic.model_validate(a) for a in audits],
        count=count,
    )


def _load_merge_players(
    session: SessionDep, request: MergePlayersRequest
) -> tuple[Player, Player]:
    if request.source_player_id == request.target_player_id:
        raise HTTPException(
            status_code=400, detail="Cannot merge a player into itself"
        )
    source = session.get(Player, request.source_player_id)
    target = session.get(Player, request.target_player_id)
    if not source or not target:
        raise HTTPException(status_code=404, detail="Player not found")
    return source, target


@router.post("/merge/preview", response_model=MergePlayersPreview)
def preview_merge_players_route(
    request: MergePlayersRequest,
    session: SessionDep,
    _current_user: CurrentSuperuser,
) -> MergePlayersPreview:
    source, target = _load_merge_players(session, request)
    return preview_merge_players(session=session, source=source, target=target)


@router.post("/merge", response_model=PlayerPublic)
def merge_players_route(
    request: MergePlayersRequest,
    session: SessionDep,
    current_user: CurrentSuperuser,
) -> PlayerPublic:
    source, target = _load_merge_players(session, request)
    merged = merge_players(
        session=session, source=source, target=target, performed_by=current_user
    )
    return build_player_public(session=session, player=merged)
```

- [ ] **Step 7: Run the new tests, then the full backend suite**

Run: `uv run pytest tests/api/routes/test_player_merge.py -v`
Expected: all 9 PASS.
Then: `uv run pytest tests/ -q`
Expected: full suite passes (was 211 before this feature; now +9).

- [ ] **Step 8: Lint and commit**

```bash
uv run prek run --all-files
git add app/models.py app/crud.py app/api/routes/players.py app/alembic/versions/e7a1b2c3d4f5_add_player_merge_audit.py tests/api/routes/test_player_merge.py
git commit -m "feat(backend): player merge with preview and audit trail

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Regenerate the frontend API client

**Files:**
- Modify (generated): `frontend/openapi.json`, `frontend/src/client/*`

**Interfaces:**
- Consumes: Task 1's endpoints.
- Produces: `PlayersService.previewMergePlayersRoute({ requestBody })`, `PlayersService.mergePlayersRoute({ requestBody })`, `PlayersService.listPlayerMergesRoute({ skip, limit })` and types `MergePlayersRequest`, `MergePlayersPreview`, `MergeConflict`, `PlayerMergeAuditPublic`, `PlayerMergeAuditsPublic` in `frontend/src/client/`.

- [ ] **Step 1: Regenerate**

From the repo root:
```bash
bash ./scripts/generate-client.sh
```
Expected: script exits 0; `git status` shows changes only under `frontend/openapi.json` and `frontend/src/client/`.

- [ ] **Step 2: Verify the new methods exist and the frontend still builds**

```bash
grep -n "mergePlayersRoute\|previewMergePlayersRoute\|listPlayerMergesRoute" frontend/src/client/sdk.gen.ts
cd frontend && bun run build && bun run lint
```
Expected: three matches; build and lint clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/openapi.json frontend/src/client
git commit -m "chore(frontend): regenerate client for player merge endpoints

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Merge page + profile shortcut

**Files:**
- Create: `frontend/src/routes/_layout/admin_.players.merge.tsx`
- Modify: `frontend/src/routes/_public/players_.$slug.tsx` (AdminControls)

**Interfaces:**
- Consumes: Task 2's client methods/types; existing `useCustomToast`, `handleError`, shadcn `Button`/`Input`/`Dialog`, `countryName` from `@/lib/countries`.
- Produces: route `/admin/players/merge` accepting optional search params `source` and `target` (player UUIDs, pre-fill the pickers). Task 4 adds a link from this page to the history page; Task 5's E2E drives this page.

- [ ] **Step 1: Create the merge page**

Create `frontend/src/routes/_layout/admin_.players.merge.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router"
import { ArrowRight } from "lucide-react"
import { useEffect, useState } from "react"
import type { PlayerPublic } from "@/client"
import { PlayersService } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import useCustomToast from "@/hooks/useCustomToast"
import { countryName } from "@/lib/countries"
import { handleError } from "@/utils"

type MergeSearch = {
  source?: string
  target?: string
}

export const Route = createFileRoute("/_layout/admin_/players/merge")({
  component: AdminPlayerMerge,
  validateSearch: (search: Record<string, unknown>): MergeSearch => ({
    source: typeof search.source === "string" ? search.source : undefined,
    target: typeof search.target === "string" ? search.target : undefined,
  }),
  beforeLoad: async () => {
    const { UsersService } = await import("@/client")
    const user = await UsersService.readUserMe()
    if (!user.is_superuser) {
      throw redirect({ to: "/" })
    }
  },
  head: () => ({
    meta: [{ title: "Merge Players - Admin" }],
  }),
})

function PlayerSummary({ player }: { player: PlayerPublic }) {
  return (
    <div className="flex flex-col">
      <span className="font-medium">{player.display_name}</span>
      <span className="text-xs text-muted-foreground">
        {[
          player.countries?.map((c) => countryName(c)).join(", "),
          player.city,
          player.club,
        ]
          .filter(Boolean)
          .join(" · ") || "No profile details"}
      </span>
    </div>
  )
}

function PlayerSearchPicker({
  label,
  hint,
  value,
  onSelect,
  excludeId,
}: {
  label: string
  hint: string
  value: PlayerPublic | null
  onSelect: (p: PlayerPublic | null) => void
  excludeId?: string
}) {
  const [query, setQuery] = useState("")
  const [debounced, setDebounced] = useState("")

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300)
    return () => clearTimeout(t)
  }, [query])

  const { data } = useQuery({
    queryKey: ["players", "search", debounced],
    queryFn: () => PlayersService.searchPlayersRoute({ q: debounced, limit: 8 }),
    enabled: !value && debounced.length > 0,
  })

  const results = (data?.data ?? []).filter(
    (r) => r.player.id !== excludeId,
  )

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-4 flex-1 min-w-64">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {value ? (
        <div className="flex items-center justify-between gap-2">
          <PlayerSummary player={value} />
          <Button variant="outline" size="sm" onClick={() => onSelect(null)}>
            Change
          </Button>
        </div>
      ) : (
        <>
          <Input
            placeholder="Search players…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={`${label} player search`}
          />
          <div className="flex flex-col gap-1">
            {results.map((r) => (
              <button
                key={r.player.id}
                type="button"
                onClick={() => onSelect(r.player)}
                className="rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <PlayerSummary player={r.player} />
              </button>
            ))}
            {debounced.length > 0 && results.length === 0 && (
              <p className="text-xs text-muted-foreground px-2 py-1">
                No players found
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function usePrefillPlayer(
  id: string | undefined,
  current: PlayerPublic | null,
  set: (p: PlayerPublic) => void,
) {
  const { data } = useQuery({
    queryKey: ["players", "prefill", id],
    queryFn: () => PlayersService.getPlayer({ playerId: id! }),
    enabled: !!id && !current,
  })
  useEffect(() => {
    if (data) set(data)
  }, [data, set])
}

function AdminPlayerMerge() {
  const searchParams = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const [source, setSource] = useState<PlayerPublic | null>(null)
  const [target, setTarget] = useState<PlayerPublic | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  usePrefillPlayer(searchParams.source, source, setSource)
  usePrefillPlayer(searchParams.target, target, setTarget)

  const bothSelected = source !== null && target !== null

  const previewQuery = useQuery({
    queryKey: ["players", "merge-preview", source?.id, target?.id],
    queryFn: () =>
      PlayersService.previewMergePlayersRoute({
        requestBody: {
          source_player_id: source!.id,
          target_player_id: target!.id,
        },
      }),
    enabled: bothSelected,
  })

  const mergeMutation = useMutation({
    mutationFn: () =>
      PlayersService.mergePlayersRoute({
        requestBody: {
          source_player_id: source!.id,
          target_player_id: target!.id,
        },
      }),
    onSuccess: (merged) => {
      setConfirmOpen(false)
      queryClient.invalidateQueries({ queryKey: ["players"] })
      showSuccessToast(
        `Merged ${source?.display_name} into ${merged.display_name}`,
      )
      if (merged.slug) {
        navigate({ to: "/players/$slug", params: { slug: merged.slug } })
      } else {
        setSource(null)
        setTarget(null)
      }
    },
    onError: handleError.bind(showErrorToast),
  })

  const preview = previewQuery.data

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Merge Players</h1>
        <p className="text-muted-foreground">
          Move all quiz results from a duplicate player onto the canonical
          one, then delete the duplicate.
        </p>
      </div>

      <div className="flex flex-wrap items-stretch gap-3">
        <PlayerSearchPicker
          label="Source (will be deleted)"
          hint="The duplicate record"
          value={source}
          onSelect={setSource}
          excludeId={target?.id}
        />
        <div className="flex items-center">
          <ArrowRight className="h-5 w-5 text-muted-foreground" />
        </div>
        <PlayerSearchPicker
          label="Target (will be kept)"
          hint="The canonical record"
          value={target}
          onSelect={setTarget}
          excludeId={source?.id}
        />
      </div>

      {bothSelected && preview && (
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border p-4 text-sm flex flex-col gap-1">
            <p>
              <span className="font-medium">{preview.moved_results_count}</span>{" "}
              quiz result{preview.moved_results_count === 1 ? "" : "s"} will
              move to {target.display_name}.
            </p>
            {preview.added_countries.length > 0 && (
              <p>
                Countries added:{" "}
                {preview.added_countries
                  .map((c) => countryName(c))
                  .join(", ")}
              </p>
            )}
            {preview.filled_fields.length > 0 && (
              <p>
                Blank fields filled from source:{" "}
                {preview.filled_fields.join(", ")}
              </p>
            )}
          </div>

          {preview.conflicts.length > 0 && (
            <div className="rounded-lg border border-destructive p-4 text-sm flex flex-col gap-2">
              <p className="font-medium text-destructive">
                {preview.conflicts.length} conflicting result
                {preview.conflicts.length === 1 ? "" : "s"} will be permanently
                deleted
              </p>
              <p className="text-muted-foreground">
                Both players have a result in these quizzes. The target&apos;s
                result is kept; the source&apos;s is deleted.
              </p>
              <ul className="flex flex-col gap-1">
                {preview.conflicts.map((c) => (
                  <li key={c.quiz_id}>
                    <span className="font-medium">{c.quiz_name}</span>{" "}
                    <span className="text-muted-foreground">
                      ({c.start_date}) — deleting source score {c.source_score}
                      , keeping target score {c.target_score}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Button
            className="self-start"
            variant={preview.conflicts.length > 0 ? "destructive" : "default"}
            onClick={() => setConfirmOpen(true)}
          >
            Merge players
          </Button>
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge players?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {source?.display_name}
            </span>{" "}
            will be deleted and its results moved to{" "}
            <span className="font-medium text-foreground">
              {target?.display_name}
            </span>
            .
            {preview && preview.conflicts.length > 0 && (
              <>
                {" "}
                {preview.conflicts.length} conflicting source result
                {preview.conflicts.length === 1 ? "" : "s"} will be permanently
                deleted.
              </>
            )}{" "}
            This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <LoadingButton
              variant="destructive"
              loading={mergeMutation.isPending}
              onClick={() => mergeMutation.mutate()}
            >
              Merge
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

- [ ] **Step 2: Add the profile shortcut**

In `frontend/src/routes/_public/players_.$slug.tsx`:

Add imports:
```tsx
import { Link } from "@tanstack/react-router"
import { GitMerge } from "lucide-react"
```
(`Link` joins the existing `@tanstack/react-router` import; `GitMerge` joins the existing lucide import.)

In `AdminControls`, immediately after `<EditPlayerDialog player={player} />`, add:

```tsx
      <Button variant="outline" size="sm" asChild>
        <Link to="/admin/players/merge" search={{ source: player.id }}>
          <GitMerge className="h-4 w-4 mr-1" />
          Merge into…
        </Link>
      </Button>
```

- [ ] **Step 3: Verify**

Run (from `frontend/`): `bun run build && bun run lint`
Expected: clean (the route tree regenerates during the vite build step).

- [ ] **Step 4: Commit**

```bash
git add src/routes/_layout/admin_.players.merge.tsx src/routes/_public/players_.\$slug.tsx src/routeTree.gen.ts
git commit -m "feat(frontend): admin merge players page with preview and profile shortcut

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Merge history page + cross-links

**Files:**
- Create: `frontend/src/routes/_layout/admin_.players.merges.tsx`
- Modify: `frontend/src/routes/_layout/admin_.players.merge.tsx` (add "View merge history" link)

**Interfaces:**
- Consumes: `PlayersService.listPlayerMergesRoute({ skip, limit })` → `PlayerMergeAuditsPublic` from Task 2; the merge page from Task 3.
- Produces: route `/admin/players/merges`.

- [ ] **Step 1: Create the history page**

Create `frontend/src/routes/_layout/admin_.players.merges.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, redirect } from "@tanstack/react-router"
import { useState } from "react"
import { PlayersService } from "@/client"
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

export const Route = createFileRoute("/_layout/admin_/players/merges")({
  component: AdminPlayerMerges,
  beforeLoad: async () => {
    const { UsersService } = await import("@/client")
    const user = await UsersService.readUserMe()
    if (!user.is_superuser) {
      throw redirect({ to: "/" })
    }
  },
  head: () => ({
    meta: [{ title: "Merge History - Admin" }],
  }),
})

function formatMergedAt(value: string | null | undefined): string {
  if (!value) return "—"
  return new Date(value).toLocaleString()
}

function AdminPlayerMerges() {
  const [page, setPage] = useState(0)

  const { data, isPending } = useQuery({
    queryKey: ["players", "merges", page],
    queryFn: () =>
      PlayersService.listPlayerMergesRoute({
        skip: page * PAGE_SIZE,
        limit: PAGE_SIZE,
      }),
  })

  const total = data?.count ?? 0
  const hasNext = (page + 1) * PAGE_SIZE < total

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Merge History</h1>
          <p className="text-muted-foreground">
            Audit log of player merges ({total} total)
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/admin/players/merge">New merge</Link>
        </Button>
      </div>

      {isPending ? (
        <div className="animate-pulse h-40 w-full rounded bg-muted" />
      ) : total === 0 ? (
        <p className="text-sm text-muted-foreground">No merges recorded yet.</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Performed by</TableHead>
                <TableHead>Source (deleted)</TableHead>
                <TableHead>Target (kept)</TableHead>
                <TableHead className="text-right">Results moved</TableHead>
                <TableHead className="text-right">Results deleted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.data ?? []).map((audit) => (
                <TableRow key={audit.id}>
                  <TableCell>{formatMergedAt(audit.merged_at)}</TableCell>
                  <TableCell>{audit.performed_by_email}</TableCell>
                  <TableCell>
                    {audit.source_display_name}
                    {audit.source_slug && (
                      <span className="text-muted-foreground text-xs">
                        {" "}
                        (/{audit.source_slug})
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{audit.target_display_name}</TableCell>
                  <TableCell className="text-right">
                    {audit.moved_results_count}
                  </TableCell>
                  <TableCell className="text-right">
                    {audit.deleted_conflicts_count}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {(page > 0 || hasNext) && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!hasNext}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Link from the merge page**

In `frontend/src/routes/_layout/admin_.players.merge.tsx`, add `Link` to the `@tanstack/react-router` import, and change the page header block to include the link:

```tsx
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Merge Players</h1>
          <p className="text-muted-foreground">
            Move all quiz results from a duplicate player onto the canonical
            one, then delete the duplicate.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/admin/players/merges">View merge history</Link>
        </Button>
      </div>
```

- [ ] **Step 3: Verify**

Run (from `frontend/`): `bun run build && bun run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/routes/_layout/admin_.players.merges.tsx src/routes/_layout/admin_.players.merge.tsx src/routeTree.gen.ts
git commit -m "feat(frontend): player merge history page

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: E2E tests

**Files:**
- Create: `frontend/tests/player-merge.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-4; existing E2E conventions from `frontend/tests/players.spec.ts` (authenticate helper) and `frontend/tests/admin.spec.ts` (`QuizzesService.createQuiz` + `submitResults` recipe, lines ~235-256).

- [ ] **Step 1: Rebuild backend and clear the stale frontend**

The backend container runs baked code and must serve the new endpoints:

```bash
docker compose build backend && docker compose up -d backend
docker compose stop frontend
```
Wait for `docker compose ps backend` to show healthy. (Playwright starts its own `bun run dev` on :5173. NEVER `docker compose down` or touch volumes.)

- [ ] **Step 2: Write the E2E spec**

Create `frontend/tests/player-merge.spec.ts`:

```ts
import crypto from "node:crypto"
import { expect, test } from "@playwright/test"
import { OpenAPI, PlayersService, QuizzesService } from "../src/client"
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

test.describe("Player merge (superuser)", () => {
  test.describe.configure({ mode: "serial" })

  const runId = crypto.randomUUID().slice(0, 8)
  const sourceName = `Merge Source ${runId}`
  const targetName = `Merge Target ${runId}`
  let sourceId: string
  let sourceSlug: string
  let targetId: string
  let targetSlug: string
  let quizIds: string[] = []

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()

    const source = await PlayersService.createPlayerRoute({
      requestBody: { display_name: sourceName },
    })
    sourceId = source.id
    sourceSlug = (
      await PlayersService.updatePlayerRoute({
        playerId: sourceId,
        requestBody: { slug: `merge-source-${runId}` },
      })
    ).slug!

    const target = await PlayersService.createPlayerRoute({
      requestBody: { display_name: targetName },
    })
    targetId = target.id
    targetSlug = (
      await PlayersService.updatePlayerRoute({
        playerId: targetId,
        requestBody: { slug: `merge-target-${runId}` },
      })
    ).slug!

    // Quiz where only the source has a result (will move)
    const movedQuiz = await QuizzesService.createQuiz({
      requestBody: {
        name: `Merge Moved Quiz ${runId}`,
        start_date: "2026-01-01",
        end_date: "2026-01-01",
      },
    })
    await QuizzesService.submitResults({
      id: movedQuiz.id,
      requestBody: {
        results: [{ player_id: sourceId, final_rank: 1, score: 60 }],
      },
    })

    // Quiz where BOTH have results (conflict: source's will be deleted)
    const conflictQuiz = await QuizzesService.createQuiz({
      requestBody: {
        name: `Merge Conflict Quiz ${runId}`,
        start_date: "2026-02-01",
        end_date: "2026-02-01",
      },
    })
    await QuizzesService.submitResults({
      id: conflictQuiz.id,
      requestBody: {
        results: [
          { player_id: sourceId, final_rank: 2, score: 10 },
          { player_id: targetId, final_rank: 1, score: 90 },
        ],
      },
    })
    quizIds = [movedQuiz.id, conflictQuiz.id]
  })

  test.afterAll(async () => {
    for (const id of quizIds) {
      await QuizzesService.deleteQuiz({ id }).catch(() => {})
    }
    await PlayersService.deletePlayerRoute({ playerId: targetId }).catch(
      () => {},
    )
  })

  test("profile shortcut opens merge page with source pre-filled", async ({
    page,
  }) => {
    await page.goto(`/players/${sourceSlug}`)
    await page.getByRole("link", { name: /merge into/i }).click()
    await expect(page).toHaveURL(new RegExp(`/admin/players/merge\\?.*${sourceId}`))
    await expect(page.getByText(sourceName)).toBeVisible()
  })

  test("preview shows move count and conflict warning, merge completes", async ({
    page,
  }) => {
    await page.goto(`/admin/players/merge?source=${sourceId}`)
    await expect(page.getByText(sourceName)).toBeVisible()

    // Pick the target in the target picker
    await page
      .getByLabel("Target (will be kept) player search")
      .fill(targetName)
    await page.getByRole("button", { name: new RegExp(targetName) }).click()

    // Preview: 1 result moves, 1 conflict deleted
    await expect(page.getByText(/1 quiz result will move/)).toBeVisible()
    await expect(
      page.getByText(/1 conflicting result will be permanently deleted/),
    ).toBeVisible()
    await expect(page.getByText(`Merge Conflict Quiz ${runId}`)).toBeVisible()

    await page.getByRole("button", { name: "Merge players" }).click()
    await page.getByRole("button", { name: "Merge", exact: true }).click()

    // Redirected to the merged target profile
    await expect(page).toHaveURL(`/players/${targetSlug}`)
    await expect(
      page.getByRole("heading", { name: targetName }),
    ).toBeVisible()
  })

  test("source profile is gone after merge", async ({ page }) => {
    await page.goto(`/players/${sourceSlug}`)
    await expect(
      page.getByRole("heading", { name: sourceName }),
    ).not.toBeVisible()
  })

  test("merge history page lists the merge", async ({ page }) => {
    await page.goto("/admin/players/merges")
    await expect(
      page.getByRole("heading", { name: "Merge History" }),
    ).toBeVisible()
    await expect(page.getByRole("cell", { name: new RegExp(sourceName) })).toBeVisible()
    await expect(page.getByRole("cell", { name: targetName })).toBeVisible()
  })
})
```

Note: if `submitResults`'s request type doesn't accept `player_id` directly (check the generated type `QuizzesSubmitResultsData` in `frontend/src/client/`), consult `frontend/tests/admin.spec.ts:244-256` for the exact accepted shape and adapt the two `submitResults` calls — the requirement is: source has a result in quiz 1; both have results in quiz 2 with the target scoring 90 and source 10.

- [ ] **Step 3: Run the new spec, then the full suite**

From `frontend/` (frontend container already stopped in Step 1):
```bash
bunx playwright test tests/player-merge.spec.ts --config playwright.config.cts
```
Expected: 4 passed.
```bash
bunx playwright test --config playwright.config.cts
```
Expected: full suite passes (2 known pre-existing skips), no new failures.
Then restore the container:
```bash
docker compose up -d frontend
```

- [ ] **Step 4: Lint check and commit**

```bash
bun run lint
git add tests/player-merge.spec.ts
git commit -m "test(frontend): E2E coverage for player merge flow

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
