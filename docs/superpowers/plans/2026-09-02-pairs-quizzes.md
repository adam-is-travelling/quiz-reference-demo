# Pairs Quizzes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a quiz declare that its results are contested in pairs, record two quizzers per result, and give both of them full credit in history, podiums and stats.

**Architecture:** Participant mode becomes an enum on `Quiz`. Result participants move out of `QuizResult` into a `quiz_result_player` join table keyed by slot. The move uses **expand / migrate / contract**: Task 2 adds the join table and backfills it while `QuizResult.player_id` and `QuizResult.country` stay in place, Tasks 3–8 dual-write and move each reader across one at a time, and Task 9 finally drops the old columns. Every task therefore leaves the application working and independently shippable — no task depends on a later one to stop the app being broken.

**Tech Stack:** FastAPI + SQLModel + Alembic + PostgreSQL (backend, pytest); React + TypeScript + TanStack Router/Query (frontend, `bun test` unit tests and Playwright E2E).

**Spec:** `docs/superpowers/specs/2026-09-02-pairs-quizzes-design.md` — read it before starting. The plan argues from the spec; where they disagree, the spec wins and you should stop and flag it.

## Global Constraints

- **Branch:** work on `add-pairs-quizzes`, already checked out with the spec committed. Never commit to `main`.
- **Backend commands run on the host, not in Docker.** The backend container serves a baked image with no source mount, so `docker compose exec backend pytest` runs stale code. Use the repo-root venv: `cd backend && ../.venv/bin/python -m pytest ...`.
- **Tests delete only rows they create.** Never write a bare `delete(Model)` without `.where(...)` — `backend/tests/test_cleanup_safety.py` fails the build if you do.
- **Never run `docker compose down -v`** (wipes all volumes including the staging DB).
- **Never run two Playwright suites concurrently** — they share the dev DB and superuser and produce fake failures.
- **Alembic head is `bbf23bc9abe0`.** The first new migration's `down_revision` is `'bbf23bc9abe0'`; each subsequent migration chains from the previous one in this plan.
- **After any backend schema or response-model change, regenerate the client:** `bash ./scripts/generate-client.sh` from the repo root, with the stack running.
- **Participant slots are 1-based.** `slot=1` is the first quizzer, `slot=2` the second. Slot is an ordering key, never a ranking.
- **Enum values are the exact lowercase strings** `"individual"` and `"pairs"`.
- **Separator rules, verbatim:** split on `\s*&\s*` and on `\s+and\s+` (case-insensitive). The whitespace around `and` is mandatory — it is what keeps "Alexander" and "Sandy" intact.

---

### Task 1: `Quiz.participant_mode`

Adds the enum and its column. Nothing about results changes yet.

**Files:**
- Modify: `backend/app/models.py` (Quiz section, around line 352)
- Create: `backend/app/alembic/versions/f1a2b3c4d5e6_add_quiz_participant_mode.py`
- Test: `backend/tests/api/routes/test_quizzes.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `QuizParticipantMode` enum (`individual`, `pairs`); `Quiz.participant_mode`, `QuizCreate.participant_mode`, `QuizUpdate.participant_mode`, `QuizPublic.participant_mode`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/api/routes/test_quizzes.py`:

```python
def test_create_quiz_defaults_to_individual(
    client: TestClient, organizer_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/",
        headers=organizer_token_headers,
        json={
            "name": random_lower_string(),
            "start_date": "2024-01-01",
            "end_date": "2024-01-01",
        },
    )
    assert response.status_code == 200
    assert response.json()["participant_mode"] == "individual"


def test_create_quiz_accepts_pairs(
    client: TestClient, organizer_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/",
        headers=organizer_token_headers,
        json={
            "name": random_lower_string(),
            "start_date": "2024-01-01",
            "end_date": "2024-01-01",
            "participant_mode": "pairs",
        },
    )
    assert response.status_code == 200
    assert response.json()["participant_mode"] == "pairs"


def test_create_quiz_rejects_unknown_participant_mode(
    client: TestClient, organizer_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/",
        headers=organizer_token_headers,
        json={
            "name": random_lower_string(),
            "start_date": "2024-01-01",
            "end_date": "2024-01-01",
            "participant_mode": "trios",
        },
    )
    assert response.status_code == 422
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && ../.venv/bin/python -m pytest tests/api/routes/test_quizzes.py -k participant_mode -v
```

Expected: FAIL — the response has no `participant_mode` key, and `"trios"` is accepted.

- [ ] **Step 3: Add the enum and fields**

In `backend/app/models.py`, next to `class QuizStatus`:

```python
class QuizParticipantMode(str, enum.Enum):
    individual = "individual"
    pairs = "pairs"
```

Add to `QuizBase` (so it flows into `QuizCreate` and `QuizPublic` automatically):

```python
    participant_mode: QuizParticipantMode = QuizParticipantMode.individual
```

Add to `QuizUpdate`:

```python
    participant_mode: QuizParticipantMode | None = None
```

Add to `Quiz` (the `table=True` class), so the DB column carries a server default for existing rows:

```python
    participant_mode: QuizParticipantMode = Field(
        default=QuizParticipantMode.individual,
        sa_column=Column(
            SAEnum(QuizParticipantMode, name="quizparticipantmode"),
            nullable=False,
            server_default="individual",
        ),
    )
```

Add `Enum as SAEnum` to the existing `from sqlalchemy import ...` line at the top of the file.

- [ ] **Step 4: Write the migration**

Create `backend/app/alembic/versions/f1a2b3c4d5e6_add_quiz_participant_mode.py`:

```python
"""add quiz participant_mode

Revision ID: f1a2b3c4d5e6
Revises: bbf23bc9abe0
"""

import sqlalchemy as sa
from alembic import op

revision = "f1a2b3c4d5e6"
down_revision = "bbf23bc9abe0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    participant_mode = sa.Enum(
        "individual", "pairs", name="quizparticipantmode"
    )
    participant_mode.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "quiz",
        sa.Column(
            "participant_mode",
            participant_mode,
            nullable=False,
            server_default="individual",
        ),
    )


def downgrade() -> None:
    op.drop_column("quiz", "participant_mode")
    sa.Enum(name="quizparticipantmode").drop(op.get_bind(), checkfirst=True)
```

- [ ] **Step 5: Apply the migration**

```bash
cd backend && ../.venv/bin/python -m alembic upgrade head
```

Expected: runs clean, no error.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd backend && ../.venv/bin/python -m pytest tests/api/routes/test_quizzes.py -v
```

Expected: PASS, including the three new tests and every pre-existing quiz test.

- [ ] **Step 7: Commit**

```bash
git add backend/app/models.py backend/app/alembic/versions/f1a2b3c4d5e6_add_quiz_participant_mode.py backend/tests/api/routes/test_quizzes.py
git commit -m "feat(backend): add participant_mode to Quiz"
```

---

### Task 2: `quiz_result_player` table and backfill

Adds the join table and fills it from existing results. `QuizResult.player_id` and `QuizResult.country` stay exactly as they are — nothing reads the new table yet.

**Files:**
- Modify: `backend/app/models.py` (QuizResult section, around line 679)
- Modify: `backend/tests/conftest.py` (teardown model tuple)
- Create: `backend/app/alembic/versions/b2c3d4e5f6a7_add_quiz_result_player.py`
- Test: `backend/tests/crud/test_quiz_result_player.py`

**Interfaces:**
- Consumes: Task 1's `QuizParticipantMode`.
- Produces: `QuizResultPlayer(quiz_result_id, slot, quiz_id, player_id, country)` with `UNIQUE (quiz_id, player_id)`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/crud/test_quiz_result_player.py`:

```python
import uuid
from collections.abc import Generator

import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, delete, select

from app.models import Player, Quiz, QuizResult, QuizResultPlayer
from tests.utils.quiz import create_approved_quiz, create_random_player


@pytest.fixture(autouse=True)
def clean_data(db: Session) -> Generator[None, None, None]:
    pre_quizzes = {r.id for r in db.exec(select(Quiz)).all()}
    pre_players = {r.id for r in db.exec(select(Player)).all()}
    yield
    db.rollback()
    db.expire_all()
    new_quiz_ids = {r.id for r in db.exec(select(Quiz)).all()} - pre_quizzes
    if new_quiz_ids:
        db.execute(delete(Quiz).where(col(Quiz.id).in_(new_quiz_ids)))
    new_player_ids = {r.id for r in db.exec(select(Player)).all()} - pre_players
    if new_player_ids:
        db.execute(delete(Player).where(col(Player.id).in_(new_player_ids)))
    db.commit()


def _result(db: Session, quiz: Quiz, player: Player) -> QuizResult:
    result = QuizResult(
        quiz_id=quiz.id, player_id=player.id, score=10.0, final_rank=1
    )
    db.add(result)
    db.commit()
    db.refresh(result)
    return result


def test_two_participants_share_one_result(db: Session) -> None:
    quiz = create_approved_quiz(db)
    alice, bob = create_random_player(db), create_random_player(db)
    result = _result(db, quiz, alice)
    db.add(
        QuizResultPlayer(
            quiz_result_id=result.id, slot=1, quiz_id=quiz.id, player_id=alice.id
        )
    )
    db.add(
        QuizResultPlayer(
            quiz_result_id=result.id, slot=2, quiz_id=quiz.id, player_id=bob.id
        )
    )
    db.commit()

    rows = db.exec(
        select(QuizResultPlayer)
        .where(QuizResultPlayer.quiz_result_id == result.id)
        .order_by(col(QuizResultPlayer.slot))
    ).all()
    assert [r.slot for r in rows] == [1, 2]
    assert [r.player_id for r in rows] == [alice.id, bob.id]


def test_country_is_per_participant_and_nullable(db: Session) -> None:
    quiz = create_approved_quiz(db)
    alice, bob = create_random_player(db), create_random_player(db)
    result = _result(db, quiz, alice)
    db.add(
        QuizResultPlayer(
            quiz_result_id=result.id,
            slot=1,
            quiz_id=quiz.id,
            player_id=alice.id,
            country="IE",
        )
    )
    db.add(
        QuizResultPlayer(
            quiz_result_id=result.id, slot=2, quiz_id=quiz.id, player_id=bob.id
        )
    )
    db.commit()
    rows = db.exec(
        select(QuizResultPlayer)
        .where(QuizResultPlayer.quiz_result_id == result.id)
        .order_by(col(QuizResultPlayer.slot))
    ).all()
    assert [r.country for r in rows] == ["IE", None]


def test_same_player_cannot_fill_both_slots_of_one_pair(db: Session) -> None:
    quiz = create_approved_quiz(db)
    alice = create_random_player(db)
    result = _result(db, quiz, alice)
    db.add(
        QuizResultPlayer(
            quiz_result_id=result.id, slot=1, quiz_id=quiz.id, player_id=alice.id
        )
    )
    db.add(
        QuizResultPlayer(
            quiz_result_id=result.id, slot=2, quiz_id=quiz.id, player_id=alice.id
        )
    )
    with pytest.raises(IntegrityError):
        db.commit()


def test_player_cannot_appear_in_two_results_of_one_quiz(db: Session) -> None:
    quiz = create_approved_quiz(db)
    alice, bob = create_random_player(db), create_random_player(db)
    first = _result(db, quiz, alice)
    second = _result(db, quiz, bob)
    db.add(
        QuizResultPlayer(
            quiz_result_id=first.id, slot=1, quiz_id=quiz.id, player_id=alice.id
        )
    )
    db.commit()
    db.add(
        QuizResultPlayer(
            quiz_result_id=second.id, slot=1, quiz_id=quiz.id, player_id=alice.id
        )
    )
    with pytest.raises(IntegrityError):
        db.commit()


def test_participants_are_deleted_with_their_result(db: Session) -> None:
    quiz = create_approved_quiz(db)
    alice = create_random_player(db)
    result = _result(db, quiz, alice)
    result_id = result.id
    db.add(
        QuizResultPlayer(
            quiz_result_id=result_id, slot=1, quiz_id=quiz.id, player_id=alice.id
        )
    )
    db.commit()
    db.delete(result)
    db.commit()
    remaining = db.exec(
        select(QuizResultPlayer).where(
            QuizResultPlayer.quiz_result_id == result_id
        )
    ).all()
    assert remaining == []
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && ../.venv/bin/python -m pytest tests/crud/test_quiz_result_player.py -v
```

Expected: FAIL with `ImportError: cannot import name 'QuizResultPlayer'`.

- [ ] **Step 3: Add the model**

In `backend/app/models.py`, immediately after the `QuizResult` table class:

```python
class QuizResultPlayer(SQLModel, table=True):
    __tablename__ = "quiz_result_player"
    __table_args__ = (UniqueConstraint("quiz_id", "player_id"),)

    quiz_result_id: uuid.UUID = Field(
        foreign_key="quizresult.id", primary_key=True, ondelete="CASCADE"
    )
    slot: int = Field(primary_key=True)
    quiz_id: uuid.UUID = Field(
        foreign_key="quiz.id", index=True, ondelete="CASCADE"
    )
    player_id: uuid.UUID = Field(
        foreign_key="player.id", index=True, ondelete="CASCADE"
    )
    country: str | None = Field(default=None, max_length=3)
```

`quiz_id` is denormalized from the parent result solely so the "a player appears at most once per quiz" rule is a single-table `UNIQUE` the database can enforce. It is always derived from the parent — never accepted from the API.

- [ ] **Step 4: Document the test-teardown decision**

`backend/tests/conftest.py` snapshots and deletes rows by `model.id`. `QuizResultPlayer`
has a composite primary key and therefore no `id` attribute, so it cannot join those
tuples. It does not need to: its rows cascade-delete with their parent `QuizResult`,
which is already in the teardown list.

Leave both tuples unchanged and add this comment directly above the `pre` snapshot so
the omission is not later read as an oversight:

```python
        # QuizResultPlayer is intentionally absent from these tuples: it has a
        # composite PK (no `id` to snapshot), and its rows cascade-delete with
        # their parent QuizResult, which is listed below.
```

- [ ] **Step 5: Write the migration with backfill**

Create `backend/app/alembic/versions/b2c3d4e5f6a7_add_quiz_result_player.py`:

```python
"""add quiz_result_player and backfill from quizresult

Revision ID: b2c3d4e5f6a7
Revises: f1a2b3c4d5e6
"""

import sqlalchemy as sa
from alembic import op

revision = "b2c3d4e5f6a7"
down_revision = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "quiz_result_player",
        sa.Column("quiz_result_id", sa.Uuid(), nullable=False),
        sa.Column("slot", sa.Integer(), nullable=False),
        sa.Column("quiz_id", sa.Uuid(), nullable=False),
        sa.Column("player_id", sa.Uuid(), nullable=False),
        sa.Column("country", sa.String(length=3), nullable=True),
        sa.ForeignKeyConstraint(
            ["quiz_result_id"], ["quizresult.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["quiz_id"], ["quiz.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["player_id"], ["player.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("quiz_result_id", "slot"),
        sa.UniqueConstraint("quiz_id", "player_id", name="uq_quiz_result_player_quiz_player"),
    )
    op.create_index(
        "ix_quiz_result_player_quiz_id", "quiz_result_player", ["quiz_id"]
    )
    op.create_index(
        "ix_quiz_result_player_player_id", "quiz_result_player", ["player_id"]
    )

    # Backfill: one slot-1 participant per existing result.
    op.execute(
        """
        INSERT INTO quiz_result_player
            (quiz_result_id, slot, quiz_id, player_id, country)
        SELECT id, 1, quiz_id, player_id, country FROM quizresult
        """
    )

    # Every result must have produced exactly one participant row.
    bind = op.get_bind()
    results = bind.execute(sa.text("SELECT count(*) FROM quizresult")).scalar_one()
    participants = bind.execute(
        sa.text("SELECT count(*) FROM quiz_result_player")
    ).scalar_one()
    if results != participants:
        raise RuntimeError(
            f"backfill mismatch: {results} results produced {participants} participants"
        )


def downgrade() -> None:
    op.drop_index("ix_quiz_result_player_player_id", "quiz_result_player")
    op.drop_index("ix_quiz_result_player_quiz_id", "quiz_result_player")
    op.drop_table("quiz_result_player")
```

- [ ] **Step 6: Apply the migration and verify the backfill**

```bash
cd backend && ../.venv/bin/python -m alembic upgrade head
```

Expected: runs clean. The count assertion inside the migration is the backfill test — if results and participants disagree it raises and the transaction rolls back.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd backend && ../.venv/bin/python -m pytest tests/crud/test_quiz_result_player.py tests/test_cleanup_safety.py -v
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/app/models.py backend/app/alembic/versions/b2c3d4e5f6a7_add_quiz_result_player.py backend/tests/crud/test_quiz_result_player.py backend/tests/conftest.py
git commit -m "feat(backend): add quiz_result_player join table with backfill"
```

---

### Task 3: Dual-write participants on submit

`create_quiz_results` starts writing join rows alongside the existing `player_id`/`country` columns, and the submit API starts accepting participants. Both writes stay in place until Task 9.

**Files:**
- Modify: `backend/app/models.py` (`QuizResultCreate`, `ResolvedResultRow`)
- Modify: `backend/app/crud.py:723-763` (`create_quiz_results`)
- Modify: `backend/app/api/routes/quizzes.py:279-351` (`submit_results`)
- Test: `backend/tests/api/routes/test_quiz_pairs.py`

**Interfaces:**
- Consumes: `QuizResultPlayer`, `QuizParticipantMode`.
- Produces: `ResultParticipant(player_id: uuid.UUID | None, player_create: PlayerCreate | None, country: str | None)`; `ResolvedResultRow.participants: list[ResultParticipant]`; `QuizResultCreate.participants: list[ResultParticipantCreate]` where `ResultParticipantCreate(player_id: uuid.UUID, country: str | None)`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/api/routes/test_quiz_pairs.py`:

```python
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete, select

from app.core.config import settings
from app.models import (
    Player,
    Quiz,
    QuizParticipantMode,
    QuizResult,
    QuizResultPlayer,
)
from tests.utils.quiz import create_random_player, create_random_quiz
from tests.utils.utils import random_lower_string


@pytest.fixture(autouse=True)
def clean_data(db: Session) -> Generator[None, None, None]:
    pre_quizzes = {r.id for r in db.exec(select(Quiz)).all()}
    pre_players = {r.id for r in db.exec(select(Player)).all()}
    yield
    db.rollback()
    db.expire_all()
    new_quiz_ids = {r.id for r in db.exec(select(Quiz)).all()} - pre_quizzes
    if new_quiz_ids:
        db.execute(delete(Quiz).where(col(Quiz.id).in_(new_quiz_ids)))
    new_player_ids = {r.id for r in db.exec(select(Player)).all()} - pre_players
    if new_player_ids:
        db.execute(delete(Player).where(col(Player.id).in_(new_player_ids)))
    db.commit()


def _pairs_quiz(db: Session) -> Quiz:
    quiz = create_random_quiz(db)
    quiz.participant_mode = QuizParticipantMode.pairs
    db.add(quiz)
    db.commit()
    db.refresh(quiz)
    return quiz


def test_submit_pair_creates_two_participants(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    quiz = _pairs_quiz(db)
    alice, bob = create_random_player(db), create_random_player(db)
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "final_rank": 1,
                    "score": 50,
                    "participants": [
                        {"player_id": str(alice.id)},
                        {"player_id": str(bob.id)},
                    ],
                }
            ],
            "mode": "replace",
        },
    )
    assert response.status_code == 200

    result = db.exec(
        select(QuizResult).where(QuizResult.quiz_id == quiz.id)
    ).one()
    participants = db.exec(
        select(QuizResultPlayer)
        .where(QuizResultPlayer.quiz_result_id == result.id)
        .order_by(col(QuizResultPlayer.slot))
    ).all()
    assert [p.slot for p in participants] == [1, 2]
    assert {p.player_id for p in participants} == {alice.id, bob.id}
    assert all(p.quiz_id == quiz.id for p in participants)


def test_submit_solo_row_in_pairs_quiz_is_allowed(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    quiz = _pairs_quiz(db)
    alice = create_random_player(db)
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "final_rank": 1,
                    "score": 50,
                    "participants": [{"player_id": str(alice.id)}],
                }
            ],
            "mode": "replace",
        },
    )
    assert response.status_code == 200
    result = db.exec(select(QuizResult).where(QuizResult.quiz_id == quiz.id)).one()
    participants = db.exec(
        select(QuizResultPlayer).where(
            QuizResultPlayer.quiz_result_id == result.id
        )
    ).all()
    assert len(participants) == 1


def test_submit_rejects_three_participants(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    quiz = _pairs_quiz(db)
    players = [create_random_player(db) for _ in range(3)]
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "final_rank": 1,
                    "score": 50,
                    "participants": [{"player_id": str(p.id)} for p in players],
                }
            ],
            "mode": "replace",
        },
    )
    assert response.status_code == 422
    assert "at most 2" in str(response.json()["detail"])


def test_submit_rejects_two_participants_on_individual_quiz(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    quiz = create_random_quiz(db)  # participant_mode defaults to individual
    alice, bob = create_random_player(db), create_random_player(db)
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "final_rank": 1,
                    "score": 50,
                    "participants": [
                        {"player_id": str(alice.id)},
                        {"player_id": str(bob.id)},
                    ],
                }
            ],
            "mode": "replace",
        },
    )
    assert response.status_code == 422
    assert "individual" in str(response.json()["detail"])


def test_submit_rejects_duplicate_player_in_one_result(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    quiz = _pairs_quiz(db)
    alice = create_random_player(db)
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "final_rank": 1,
                    "score": 50,
                    "participants": [
                        {"player_id": str(alice.id)},
                        {"player_id": str(alice.id)},
                    ],
                }
            ],
            "mode": "replace",
        },
    )
    assert response.status_code == 422
    assert "same player" in str(response.json()["detail"])


def test_submit_creates_new_players_for_both_halves(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    quiz = _pairs_quiz(db)
    name_a, name_b = random_lower_string(), random_lower_string()
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "final_rank": 1,
                    "score": 50,
                    "participants": [
                        {"player_create": {"display_name": name_a, "countries": ["IE"]}},
                        {"player_create": {"display_name": name_b, "countries": ["GB"]}},
                    ],
                }
            ],
            "mode": "replace",
        },
    )
    assert response.status_code == 200
    created = db.exec(
        select(Player).where(col(Player.display_name).in_([name_a, name_b]))
    ).all()
    assert len(created) == 2
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && ../.venv/bin/python -m pytest tests/api/routes/test_quiz_pairs.py -v
```

Expected: FAIL — `participants` is an unknown field, so results submit with no participants and the assertions on `QuizResultPlayer` find nothing.

- [ ] **Step 3: Add the API models**

In `backend/app/models.py`, in the upload-flow section beside `ResolvedResultRow`:

```python
class ResultParticipant(SQLModel):
    """One member of a result, as submitted by the upload wizard."""

    player_id: uuid.UUID | None = None
    player_create: PlayerCreate | None = None
    country: str | None = Field(default=None, max_length=3)

    @field_validator("country")
    @classmethod
    def validate_country(cls, v: str | None) -> str | None:
        return _validate_country_code(v)


class ResultParticipantCreate(SQLModel):
    """One member of a result, after players have been resolved to ids."""

    player_id: uuid.UUID
    country: str | None = Field(default=None, max_length=3)
```

Add to `ResolvedResultRow`:

```python
    participants: list[ResultParticipant] = Field(default_factory=list)
```

Add to `QuizResultCreate`:

```python
    participants: list[ResultParticipantCreate] = Field(default_factory=list)
```

Keep `QuizResultCreate.player_id` and `ResolvedResultRow.player_id` for now — Task 9 removes them. During dual-write, `player_id` is the slot-1 participant.

- [ ] **Step 4: Validate participants in `submit_results`**

In `backend/app/api/routes/quizzes.py`, inside the existing validation loop in `submit_results`, replace the `if not row.player_id and not row.player_create:` check with:

```python
        participants = row.participants or (
            [ResultParticipant(player_id=row.player_id, player_create=row.player_create)]
            if (row.player_id or row.player_create)
            else []
        )
        if not participants:
            errors.append(f"Row {i + 1}: at least one participant is required")
        max_participants = (
            2 if quiz.participant_mode == QuizParticipantMode.pairs else 1
        )
        if len(participants) > max_participants:
            if max_participants == 1:
                errors.append(
                    f"Row {i + 1}: this quiz is individual; "
                    f"got {len(participants)} participants"
                )
            else:
                errors.append(
                    f"Row {i + 1}: a pairs result takes at most 2 participants; "
                    f"got {len(participants)}"
                )
        known_ids = [p.player_id for p in participants if p.player_id]
        if len(known_ids) != len(set(known_ids)):
            errors.append(
                f"Row {i + 1}: the same player cannot appear twice in one result"
            )
        for p in participants:
            if not p.player_id and not p.player_create:
                errors.append(
                    f"Row {i + 1}: each participant needs player_id or player_create"
                )
        resolved_rows.append((row, participants))
```

Initialise `resolved_rows: list[tuple[ResolvedResultRow, list[ResultParticipant]]] = []` before the loop, so the normalisation is done once and reused below.

- [ ] **Step 5: Build participants in the create loop**

Replace the body of the `for row in request.results:` creates loop with:

```python
    for row, participants in resolved_rows:
        assert row.score is not None  # validated above
        participant_creates: list[ResultParticipantCreate] = []
        for p in participants:
            if p.player_id:
                player_id = p.player_id
            else:
                assert p.player_create is not None  # validated above
                player = crud.create_player(
                    session=session, player_in=p.player_create, commit=False
                )
                player_id = player.id
            participant_creates.append(
                ResultParticipantCreate(player_id=player_id, country=p.country)
            )
        creates.append(
            QuizResultCreate(
                player_id=participant_creates[0].player_id,
                final_rank=row.final_rank,
                score=row.score,
                round_scores=row.round_scores,
                country=row.country or participant_creates[0].country,
                participants=participant_creates,
            )
        )
```

Import `QuizParticipantMode`, `ResultParticipant` and `ResultParticipantCreate` at the top of the route module.

- [ ] **Step 6: Dual-write in `create_quiz_results`**

In `backend/app/crud.py`, in `create_quiz_results`, after the existing add of each result (both the update and insert branches), write the participant rows. Add this immediately before the `if commit:` block:

```python
    session.flush()  # results need ids before participants can reference them
    for result, r in zip(db_results, results, strict=True):
        for row in session.exec(
            select(QuizResultPlayer).where(
                QuizResultPlayer.quiz_result_id == result.id
            )
        ).all():
            session.delete(row)
        session.flush()
        participants = r.participants or [
            ResultParticipantCreate(player_id=r.player_id, country=r.country)
        ]
        for slot, participant in enumerate(participants, start=1):
            session.add(
                QuizResultPlayer(
                    quiz_result_id=result.id,
                    slot=slot,
                    quiz_id=quiz_id,
                    player_id=participant.player_id,
                    country=participant.country,
                )
            )
```

Deleting the existing participant rows first is what makes re-upload idempotent: a result whose pair changed must not keep its old members. Import `QuizResultPlayer` and `ResultParticipantCreate` at the top of `crud.py`.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd backend && ../.venv/bin/python -m pytest tests/api/routes/test_quiz_pairs.py tests/api/routes/test_quizzes.py -v
```

Expected: PASS, including every pre-existing quiz test — individual submissions still write one participant via the fallback.

- [ ] **Step 8: Regenerate the API client**

With the stack running, from the repo root:

```bash
bash ./scripts/generate-client.sh
```

- [ ] **Step 9: Commit**

```bash
git add backend/app/models.py backend/app/crud.py backend/app/api/routes/quizzes.py backend/tests/api/routes/test_quiz_pairs.py frontend/src/client
git commit -m "feat(backend): accept and store result participants"
```

---

### Task 4: Quiz results read path

`GET /quizzes/{id}/results/with-players` returns participants instead of one player, sourced from the join table.

**Files:**
- Modify: `backend/app/models.py` (`QuizResultWithPlayer`)
- Modify: `backend/app/api/routes/quizzes.py:218-250` (`read_quiz_results_with_players`)
- Test: `backend/tests/api/routes/test_quiz_pairs.py`

**Interfaces:**
- Consumes: Task 3's participant writes.
- Produces: `ResultParticipantPublic(player_id, player_display_name, player_slug, country, slot)`; `QuizResultWithPlayer.participants: list[ResultParticipantPublic]`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/api/routes/test_quiz_pairs.py`:

```python
def test_results_with_players_returns_both_members(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    quiz = _pairs_quiz(db)
    quiz.status = QuizStatus.approved
    db.add(quiz)
    db.commit()
    alice, bob = create_random_player(db), create_random_player(db)
    client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "final_rank": 1,
                    "score": 50,
                    "participants": [
                        {"player_id": str(alice.id), "country": "IE"},
                        {"player_id": str(bob.id), "country": "GB"},
                    ],
                }
            ],
            "mode": "replace",
        },
    )

    response = client.get(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/with-players"
    )
    assert response.status_code == 200
    row = response.json()["data"][0]
    assert [p["slot"] for p in row["participants"]] == [1, 2]
    assert [p["player_display_name"] for p in row["participants"]] == [
        alice.display_name,
        bob.display_name,
    ]
    assert [p["country"] for p in row["participants"]] == ["IE", "GB"]
```

Add `QuizStatus` to the module's imports from `app.models`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && ../.venv/bin/python -m pytest tests/api/routes/test_quiz_pairs.py::test_results_with_players_returns_both_members -v
```

Expected: FAIL with `KeyError: 'participants'`.

- [ ] **Step 3: Add the public model**

In `backend/app/models.py`, above `QuizResultWithPlayer`:

```python
class ResultParticipantPublic(SQLModel):
    slot: int
    player_id: uuid.UUID
    player_display_name: str
    player_slug: str | None = None
    country: str | None = None
```

Add to `QuizResultWithPlayer`:

```python
    participants: list[ResultParticipantPublic] = Field(default_factory=list)
```

Leave the existing scalar `player_id` / `player_display_name` / `player_slug` / `country` fields in place for now — Task 9 removes them, and the frontend still reads them until Task 13.

- [ ] **Step 4: Read participants in the route**

In `read_quiz_results_with_players`, after the existing `rows` query, load every participant for the quiz in one go and group them:

```python
    participant_rows = session.exec(
        select(QuizResultPlayer, Player)
        .join(Player, QuizResultPlayer.player_id == Player.id)
        .where(QuizResultPlayer.quiz_id == quiz.id)
        .order_by(col(QuizResultPlayer.slot).asc())
    ).all()
    by_result: dict[uuid.UUID, list[ResultParticipantPublic]] = {}
    for participant, player in participant_rows:
        by_result.setdefault(participant.quiz_result_id, []).append(
            ResultParticipantPublic(
                slot=participant.slot,
                player_id=participant.player_id,
                player_display_name=player.display_name,
                player_slug=player.slug,
                country=participant.country,
            )
        )
```

One query for all participants, not one per result — a large quiz would otherwise issue hundreds of round trips. Then add `participants=by_result.get(r.id, [])` to each `QuizResultWithPlayer(...)` in the comprehension below.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd backend && ../.venv/bin/python -m pytest tests/api/routes/test_quiz_pairs.py -v
```

Expected: PASS.

- [ ] **Step 6: Regenerate the client and commit**

```bash
bash ./scripts/generate-client.sh
git add backend/app/models.py backend/app/api/routes/quizzes.py backend/tests/api/routes/test_quiz_pairs.py frontend/src/client
git commit -m "feat(backend): return result participants from the results endpoint"
```

---

### Task 5: Player history credits both members

A pairs result appears in both players' history, with the partner named, and counts toward both players' wins and podiums.

**Files:**
- Modify: `backend/app/models.py` (`PlayerResultWithQuiz`)
- Modify: `backend/app/crud.py:516-575` (`get_player_history_grouped`), `backend/app/crud.py:579-628` (`get_player_competition_history`)
- Test: `backend/tests/api/routes/test_player_pairs_history.py`

**Interfaces:**
- Consumes: `QuizResultPlayer`.
- Produces: `PlayerResultWithQuiz.partners: list[ResultPartner]` where `ResultPartner(player_id, display_name, slug)`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/api/routes/test_player_pairs_history.py`:

```python
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete, select

from app import crud
from app.core.config import settings
from app.models import (
    Player,
    Quiz,
    QuizParticipantMode,
    QuizResultCreate,
    QuizStatus,
    ResultParticipantCreate,
)
from tests.utils.quiz import create_approved_quiz, create_random_player


@pytest.fixture(autouse=True)
def clean_data(db: Session) -> Generator[None, None, None]:
    pre_quizzes = {r.id for r in db.exec(select(Quiz)).all()}
    pre_players = {r.id for r in db.exec(select(Player)).all()}
    yield
    db.rollback()
    db.expire_all()
    new_quiz_ids = {r.id for r in db.exec(select(Quiz)).all()} - pre_quizzes
    if new_quiz_ids:
        db.execute(delete(Quiz).where(col(Quiz.id).in_(new_quiz_ids)))
    new_player_ids = {r.id for r in db.exec(select(Player)).all()} - pre_players
    if new_player_ids:
        db.execute(delete(Player).where(col(Player.id).in_(new_player_ids)))
    db.commit()


def _pair_win(db: Session) -> tuple[Quiz, Player, Player]:
    quiz = create_approved_quiz(db)
    quiz.participant_mode = QuizParticipantMode.pairs
    db.add(quiz)
    db.commit()
    alice, bob = create_random_player(db), create_random_player(db)
    crud.create_quiz_results(
        session=db,
        quiz_id=quiz.id,
        results=[
            QuizResultCreate(
                player_id=alice.id,
                final_rank=1,
                score=50.0,
                participants=[
                    ResultParticipantCreate(player_id=alice.id, country="IE"),
                    ResultParticipantCreate(player_id=bob.id, country="GB"),
                ],
            )
        ],
    )
    return quiz, alice, bob


def test_pairs_win_appears_in_both_histories(client: TestClient, db: Session) -> None:
    quiz, alice, bob = _pair_win(db)
    for player in (alice, bob):
        response = client.get(
            f"{settings.API_V1_STR}/players/{player.id}/history"
        )
        assert response.status_code == 200
        body = response.json()
        assert body["wins"] == 1
        assert body["podiums"] == 1
        assert body["total_quizzes"] == 1
        quiz_ids = [
            r["quiz_id"] for group in body["data"] for r in group["results"]
        ]
        assert str(quiz.id) in quiz_ids


def test_history_names_the_partner(client: TestClient, db: Session) -> None:
    _quiz, alice, bob = _pair_win(db)
    response = client.get(f"{settings.API_V1_STR}/players/{alice.id}/history")
    result = response.json()["data"][0]["results"][0]
    assert [p["display_name"] for p in result["partners"]] == [bob.display_name]


def test_history_country_comes_from_the_participant_row(
    client: TestClient, db: Session
) -> None:
    _quiz, alice, bob = _pair_win(db)
    alice_result = client.get(
        f"{settings.API_V1_STR}/players/{alice.id}/history"
    ).json()["data"][0]["results"][0]
    bob_result = client.get(
        f"{settings.API_V1_STR}/players/{bob.id}/history"
    ).json()["data"][0]["results"][0]
    assert alice_result["country"] == "IE"
    assert bob_result["country"] == "GB"
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && ../.venv/bin/python -m pytest tests/api/routes/test_player_pairs_history.py -v
```

Expected: FAIL — Bob's history is empty, because the query still filters `QuizResult.player_id`.

- [ ] **Step 3: Add the partner model**

In `backend/app/models.py`, above `PlayerResultWithQuiz`:

```python
class ResultPartner(SQLModel):
    player_id: uuid.UUID
    display_name: str
    slug: str | None = None
```

Add to `PlayerResultWithQuiz`:

```python
    partners: list[ResultPartner] = Field(default_factory=list)
```

- [ ] **Step 4: Add a shared partner lookup to crud**

In `backend/app/crud.py`, above `get_player_history_grouped`:

```python
def _partners_by_result(
    *, session: Session, result_ids: list[uuid.UUID], player_id: uuid.UUID
) -> dict[uuid.UUID, list[ResultPartner]]:
    """Every participant of these results except `player_id` themselves."""
    if not result_ids:
        return {}
    rows = session.exec(
        select(QuizResultPlayer, Player)
        .join(Player, col(QuizResultPlayer.player_id) == col(Player.id))
        .where(col(QuizResultPlayer.quiz_result_id).in_(result_ids))
        .where(col(QuizResultPlayer.player_id) != player_id)
        .order_by(col(QuizResultPlayer.slot).asc())
    ).all()
    partners: dict[uuid.UUID, list[ResultPartner]] = {}
    for participant, player in rows:
        partners.setdefault(participant.quiz_result_id, []).append(
            ResultPartner(
                player_id=player.id,
                display_name=player.display_name,
                slug=player.slug,
            )
        )
    return partners


def _participant_countries(
    *, session: Session, result_ids: list[uuid.UUID], player_id: uuid.UUID
) -> dict[uuid.UUID, str | None]:
    """This player's own recorded country per result."""
    if not result_ids:
        return {}
    rows = session.exec(
        select(QuizResultPlayer)
        .where(col(QuizResultPlayer.quiz_result_id).in_(result_ids))
        .where(col(QuizResultPlayer.player_id) == player_id)
    ).all()
    return {r.quiz_result_id: r.country for r in rows}
```

- [ ] **Step 5: Join through participants in both history queries**

In `get_player_history_grouped`, change the statement's filter from
`.where(QuizResult.player_id == player_id)` to a join through the participant table:

```python
    stmt = (
        select(QuizResult, Quiz, Competition)
        .join(
            QuizResultPlayer,
            col(QuizResultPlayer.quiz_result_id) == col(QuizResult.id),
        )
        .join(Quiz, QuizResult.quiz_id == Quiz.id)
        .join(Competition, Quiz.competition_id == Competition.id, isouter=True)
        .where(col(QuizResultPlayer.player_id) == player_id)
        .where(Quiz.status == QuizStatus.approved)
        .order_by(col(Quiz.start_date).desc())
    )
```

After `rows = session.exec(stmt).all()`, look up partners and countries once:

```python
    result_ids = [result.id for result, _quiz, _competition in rows]
    partners = _partners_by_result(
        session=session, result_ids=result_ids, player_id=player_id
    )
    countries = _participant_countries(
        session=session, result_ids=result_ids, player_id=player_id
    )
```

Then in the `PlayerResultWithQuiz(...)` construction, replace `country=result.country` with
`country=countries.get(result.id, result.country)` and add
`partners=partners.get(result.id, [])`.

Wins and podiums need no change: a pairs result now appears once in `rows` for each member, so each member's own tally counts it.

Apply the same three changes to `get_player_competition_history` — the same join on `base`, the same two lookups after `rows` is materialised, and the same two fields in its `PlayerResultWithQuiz(...)`.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd backend && ../.venv/bin/python -m pytest tests/api/routes/test_player_pairs_history.py tests/api/routes/test_players.py -v
```

Expected: PASS, including the pre-existing individual-history tests.

- [ ] **Step 7: Regenerate the client and commit**

```bash
bash ./scripts/generate-client.sh
git add backend/app/models.py backend/app/crud.py backend/tests/api/routes/test_player_pairs_history.py frontend/src/client
git commit -m "feat(backend): credit both members of a pair in player history"
```

---

### Task 6: Podium credits both members

**Files:**
- Modify: `backend/app/models.py` (`PodiumFinisher`)
- Modify: `backend/app/podium.py`
- Test: `backend/tests/test_podium.py`

**Interfaces:**
- Consumes: `QuizResultPlayer`, `ResultParticipantPublic`.
- Produces: `PodiumFinisher.participants: list[ResultParticipantPublic]`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_podium.py` (reuse the fixtures already in that module):

```python
def test_pairs_podium_names_both_winners_and_credits_both(db: Session) -> None:
    from app import crud
    from app.models import (
        QuizParticipantMode,
        QuizResultCreate,
        ResultParticipantCreate,
    )
    from app.podium import build_podium

    quiz = create_approved_quiz(db)
    quiz.participant_mode = QuizParticipantMode.pairs
    db.add(quiz)
    db.commit()
    alice, bob = create_random_player(db), create_random_player(db)
    crud.create_quiz_results(
        session=db,
        quiz_id=quiz.id,
        results=[
            QuizResultCreate(
                player_id=alice.id,
                final_rank=1,
                score=50.0,
                participants=[
                    ResultParticipantCreate(player_id=alice.id),
                    ResultParticipantCreate(player_id=bob.id),
                ],
            )
        ],
    )

    podium = build_podium(session=db, quizzes=[quiz])

    finisher = podium.quizzes[0].finishers[0]
    assert {p.player_id for p in finisher.participants} == {alice.id, bob.id}
    golds = {s.player_id: s.gold for s in podium.standings}
    assert golds[alice.id] == 1
    assert golds[bob.id] == 1
```

Make sure `create_approved_quiz` and `create_random_player` are imported in that module.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && ../.venv/bin/python -m pytest tests/test_podium.py -k pairs -v
```

Expected: FAIL — `PodiumFinisher` has no `participants`, and only Alice appears in the standings.

- [ ] **Step 3: Add the field**

In `backend/app/models.py`, add to `PodiumFinisher`:

```python
    participants: list[ResultParticipantPublic] = Field(default_factory=list)
```

Keep the existing scalar `player_id` / `player_display_name` / `player_slug` fields — they stay the slot-1 member until Task 9.

- [ ] **Step 4: Build finishers from participants**

In `backend/app/podium.py`, replace the per-quiz query with one that carries participants:

```python
        rows = session.exec(
            select(QuizResult, Player)
            .join(Player, QuizResult.player_id == Player.id)
            .where(
                QuizResult.quiz_id == quiz.id,
                col(QuizResult.final_rank).in_([1, 2, 3]),
            )
            .order_by(col(QuizResult.final_rank).asc())
        ).all()

        participant_rows = session.exec(
            select(QuizResultPlayer, Player)
            .join(Player, col(QuizResultPlayer.player_id) == col(Player.id))
            .where(
                col(QuizResultPlayer.quiz_result_id).in_(
                    [result.id for result, _player in rows]
                )
            )
            .order_by(col(QuizResultPlayer.slot).asc())
        ).all() if rows else []

        participants_by_result: dict[uuid.UUID, list[ResultParticipantPublic]] = {}
        for participant, player in participant_rows:
            participants_by_result.setdefault(
                participant.quiz_result_id, []
            ).append(
                ResultParticipantPublic(
                    slot=participant.slot,
                    player_id=participant.player_id,
                    player_display_name=player.display_name,
                    player_slug=player.slug,
                    country=participant.country,
                )
            )
```

Add `participants=participants_by_result.get(result.id, [])` to each `PodiumFinisher(...)`.

Then change the standings tally so it iterates participants rather than the result's single player:

```python
        for result, _player in rows:
            for participant in participants_by_result.get(result.id, []):
                standing = tally.get(participant.player_id)
                if standing is None:
                    standing = PodiumStanding(
                        player_id=participant.player_id,
                        player_display_name=participant.player_display_name,
                        player_slug=participant.player_slug,
                        gold=0,
                        silver=0,
                        bronze=0,
                    )
                    tally[participant.player_id] = standing
                if result.final_rank == 1:
                    standing.gold += 1
                elif result.final_rank == 2:
                    standing.silver += 1
                elif result.final_rank == 3:
                    standing.bronze += 1
```

Import `QuizResultPlayer` and `ResultParticipantPublic` in `podium.py`.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd backend && ../.venv/bin/python -m pytest tests/test_podium.py -v
```

Expected: PASS, including the existing individual podium tests.

- [ ] **Step 6: Regenerate the client and commit**

```bash
bash ./scripts/generate-client.sh
git add backend/app/models.py backend/app/podium.py backend/tests/test_podium.py frontend/src/client
git commit -m "feat(backend): credit both members of a pair on the podium"
```

---

### Task 7: Player merge handles partners

Merging two people who were partners in the same result would put one player in both slots. Detect it, surface it as its own conflict type, and delete the offending result on merge.

**Files:**
- Modify: `backend/app/models.py` (`MergeConflict`, `MergePlayersPreview`)
- Modify: `backend/app/crud.py:779-895` (`_merge_conflicts`, `preview_merge_players`, `merge_players`)
- Test: `backend/tests/api/routes/test_player_merge.py`

**Interfaces:**
- Consumes: `QuizResultPlayer`.
- Produces: `MergeConflict.kind: Literal["separate_results", "same_result"]`; `_partner_results(session, source_id, target_id) -> list[tuple[QuizResult, Quiz]]`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/api/routes/test_player_merge.py`:

```python
def test_merge_detects_partners_in_the_same_result(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    from app import crud
    from app.models import (
        QuizParticipantMode,
        QuizResultCreate,
        QuizResultPlayer,
        ResultParticipantCreate,
    )

    quiz = create_approved_quiz(db)
    quiz.participant_mode = QuizParticipantMode.pairs
    db.add(quiz)
    db.commit()
    alice, bob = create_random_player(db), create_random_player(db)
    crud.create_quiz_results(
        session=db,
        quiz_id=quiz.id,
        results=[
            QuizResultCreate(
                player_id=alice.id,
                final_rank=1,
                score=50.0,
                participants=[
                    ResultParticipantCreate(player_id=alice.id),
                    ResultParticipantCreate(player_id=bob.id),
                ],
            )
        ],
    )

    preview = client.post(
        f"{settings.API_V1_STR}/players/merge/preview",
        headers=superuser_token_headers,
        json={"source_player_id": str(alice.id), "target_player_id": str(bob.id)},
    ).json()
    assert [c["kind"] for c in preview["conflicts"]] == ["same_result"]

    merged = client.post(
        f"{settings.API_V1_STR}/players/merge",
        headers=superuser_token_headers,
        json={"source_player_id": str(alice.id), "target_player_id": str(bob.id)},
    )
    assert merged.status_code == 200

    # The shared result is gone, and no participant row survives it.
    assert (
        db.exec(
            select(QuizResultPlayer).where(QuizResultPlayer.quiz_id == quiz.id)
        ).all()
        == []
    )
```

Check the merge route paths against the existing tests in that file and use whatever they use.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && ../.venv/bin/python -m pytest tests/api/routes/test_player_merge.py -k partners -v
```

Expected: FAIL — `conflicts` is empty (the current rule only looks for two separate results), and the merge raises an `IntegrityError` on `UNIQUE (quiz_id, player_id)`.

- [ ] **Step 3: Add the conflict kind**

In `backend/app/models.py`, add to `MergeConflict`:

```python
    kind: str = "separate_results"  # or "same_result" when they were partners
```

`same_result` conflicts have no meaningful pair of scores to compare, so `source_score`/`target_score` both carry the shared result's score and `source_rank`/`target_rank` its rank.

- [ ] **Step 4: Detect partner results**

In `backend/app/crud.py`, above `_merge_conflicts`:

```python
def _partner_results(
    *, session: Session, source_id: uuid.UUID, target_id: uuid.UUID
) -> list[tuple[QuizResult, Quiz]]:
    """Results where source and target are both participants — i.e. partners."""
    source_result_ids = {
        r.quiz_result_id
        for r in session.exec(
            select(QuizResultPlayer).where(
                col(QuizResultPlayer.player_id) == source_id
            )
        ).all()
    }
    if not source_result_ids:
        return []
    shared_ids = {
        r.quiz_result_id
        for r in session.exec(
            select(QuizResultPlayer)
            .where(col(QuizResultPlayer.player_id) == target_id)
            .where(col(QuizResultPlayer.quiz_result_id).in_(source_result_ids))
        ).all()
    }
    if not shared_ids:
        return []
    return list(
        session.exec(
            select(QuizResult, Quiz)
            .join(Quiz, col(QuizResult.quiz_id) == col(Quiz.id))
            .where(col(QuizResult.id).in_(shared_ids))
        ).all()
    )
```

In `_merge_conflicts`, exclude shared results so they are not double-counted as separate-result conflicts: compute `partner_result_ids = {r.id for r, _q in _partner_results(...)}` at the top and `continue` past any `source_result` whose `id` is in that set.

- [ ] **Step 5: Report and resolve the new conflict**

In `preview_merge_players`, after building the existing conflicts list:

```python
    partner_rows = _partner_results(
        session=session, source_id=source.id, target_id=target.id
    )
    partner_conflicts = [
        MergeConflict(
            kind="same_result",
            quiz_id=quiz.id,
            quiz_name=quiz.name,
            start_date=quiz.start_date,
            source_score=result.score,
            source_rank=result.final_rank,
            target_score=result.score,
            target_rank=result.final_rank,
        )
        for result, quiz in partner_rows
    ]
```

Include `partner_conflicts` in the returned `conflicts` list, and subtract `len(partner_rows)` from `moved_results_count` as well — those results are deleted, not moved.

In `merge_players`, delete the shared results before moving anything else:

```python
    for result, _quiz in _partner_results(
        session=session, source_id=source.id, target_id=target.id
    ):
        session.delete(result)
    session.flush()
```

Their participant rows cascade. Then, for the results that do move, repoint the participant rows as well as the result:

```python
    for participant in session.exec(
        select(QuizResultPlayer).where(
            col(QuizResultPlayer.player_id) == source.id
        )
    ).all():
        participant.player_id = target.id
        session.add(participant)
```

Place this alongside the existing loop that repoints `result.player_id`, and inside the same `conflict_quiz_ids` guard — a participant row belonging to a deleted conflict result must not be repointed.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd backend && ../.venv/bin/python -m pytest tests/api/routes/test_player_merge.py -v
```

Expected: PASS, including the existing separate-results merge tests.

- [ ] **Step 7: Regenerate the client and commit**

```bash
bash ./scripts/generate-client.sh
git add backend/app/models.py backend/app/crud.py backend/tests/api/routes/test_player_merge.py frontend/src/client
git commit -m "feat(backend): handle merging two halves of a pair"
```

---

### Task 8: Editing a single result

`PUT /quizzes/{id}/results/{result_id}` must be able to change either participant.

**Files:**
- Modify: `backend/app/models.py` (`QuizResultUpdate`, `QuizResultPublic`)
- Modify: `backend/app/crud.py:917-932` (`update_quiz_result`)
- Modify: `backend/app/api/routes/quizzes.py:371-...` (`update_quiz_result` route)
- Test: `backend/tests/api/routes/test_quiz_pairs.py`

**Interfaces:**
- Consumes: `ResultParticipantCreate`, `ResultParticipantPublic`.
- Produces: `QuizResultUpdate.participants: list[ResultParticipantCreate] | None`; `QuizResultPublic.participants: list[ResultParticipantPublic]`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/api/routes/test_quiz_pairs.py`:

```python
def test_update_result_replaces_the_second_member(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    quiz = _pairs_quiz(db)
    alice, bob, carol = (
        create_random_player(db),
        create_random_player(db),
        create_random_player(db),
    )
    client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "final_rank": 1,
                    "score": 50,
                    "participants": [
                        {"player_id": str(alice.id)},
                        {"player_id": str(bob.id)},
                    ],
                }
            ],
            "mode": "replace",
        },
    )
    result = db.exec(select(QuizResult).where(QuizResult.quiz_id == quiz.id)).one()

    response = client.put(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/{result.id}",
        headers=organizer_token_headers,
        json={
            "participants": [
                {"player_id": str(alice.id)},
                {"player_id": str(carol.id)},
            ]
        },
    )
    assert response.status_code == 200

    db.expire_all()
    participants = db.exec(
        select(QuizResultPlayer)
        .where(QuizResultPlayer.quiz_result_id == result.id)
        .order_by(col(QuizResultPlayer.slot))
    ).all()
    assert [p.player_id for p in participants] == [alice.id, carol.id]


def test_update_result_rejects_duplicate_participants(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    quiz = _pairs_quiz(db)
    alice, bob = create_random_player(db), create_random_player(db)
    client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "final_rank": 1,
                    "score": 50,
                    "participants": [
                        {"player_id": str(alice.id)},
                        {"player_id": str(bob.id)},
                    ],
                }
            ],
            "mode": "replace",
        },
    )
    result = db.exec(select(QuizResult).where(QuizResult.quiz_id == quiz.id)).one()
    response = client.put(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/{result.id}",
        headers=organizer_token_headers,
        json={
            "participants": [
                {"player_id": str(alice.id)},
                {"player_id": str(alice.id)},
            ]
        },
    )
    assert response.status_code == 422
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && ../.venv/bin/python -m pytest tests/api/routes/test_quiz_pairs.py -k update_result -v
```

Expected: FAIL — `participants` is ignored, so Bob is still in slot 2, and the duplicate is accepted.

- [ ] **Step 3: Add the fields**

In `backend/app/models.py`, add to `QuizResultUpdate`:

```python
    participants: list[ResultParticipantCreate] | None = None
```

And to `QuizResultPublic`:

```python
    participants: list[ResultParticipantPublic] = Field(default_factory=list)
```

- [ ] **Step 4: Rewrite participants in `update_quiz_result`**

In `backend/app/crud.py`, in `update_quiz_result`, after `data.pop("round_scores", None)` add `data.pop("participants", None)` so the scalar update ignores it, then before the commit:

```python
    if result_in.participants is not None:
        for row in session.exec(
            select(QuizResultPlayer).where(
                col(QuizResultPlayer.quiz_result_id) == db_result.id
            )
        ).all():
            session.delete(row)
        session.flush()
        for slot, participant in enumerate(result_in.participants, start=1):
            session.add(
                QuizResultPlayer(
                    quiz_result_id=db_result.id,
                    slot=slot,
                    quiz_id=db_result.quiz_id,
                    player_id=participant.player_id,
                    country=participant.country,
                )
            )
        db_result.player_id = result_in.participants[0].player_id
```

The last line keeps the dual-written scalar in step until Task 9 drops it.

- [ ] **Step 5: Validate in the route**

In the `update_quiz_result` route in `backend/app/api/routes/quizzes.py`, before calling crud:

```python
    if result_in.participants is not None:
        max_participants = (
            2 if quiz.participant_mode == QuizParticipantMode.pairs else 1
        )
        player_ids = [p.player_id for p in result_in.participants]
        if not player_ids:
            raise HTTPException(
                status_code=422, detail="At least one participant is required"
            )
        if len(player_ids) > max_participants:
            raise HTTPException(
                status_code=422,
                detail=f"This quiz takes at most {max_participants} participants per result",
            )
        if len(player_ids) != len(set(player_ids)):
            raise HTTPException(
                status_code=422,
                detail="The same player cannot appear twice in one result",
            )
```

If the route does not already load the quiz, resolve it with `crud.resolve_by_id_or_slug(session=session, model=Quiz, value=id)` and 404 when missing, matching the sibling routes.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd backend && ../.venv/bin/python -m pytest tests/api/routes/test_quiz_pairs.py tests/api/routes/test_quizzes.py -v
```

Expected: PASS.

- [ ] **Step 7: Regenerate the client and commit**

```bash
bash ./scripts/generate-client.sh
git add backend/app/models.py backend/app/crud.py backend/app/api/routes/quizzes.py backend/tests/api/routes/test_quiz_pairs.py frontend/src/client
git commit -m "feat(backend): allow editing a result's participants"
```

---

### Task 9: Contract — drop the old columns

**Do this task only once Tasks 3–8 and the frontend Tasks 10–16 are all merged and green.** It is the point of no return: after it, nothing reads `QuizResult.player_id`.

**Files:**
- Modify: `backend/app/models.py` (`QuizResult`, `QuizResultCreate`, `QuizResultPublic`, `QuizResultWithPlayer`, `ResolvedResultRow`, `PodiumFinisher`)
- Modify: `backend/app/crud.py`, `backend/app/podium.py`, `backend/app/api/routes/quizzes.py`
- Create: `backend/app/alembic/versions/c3d4e5f6a7b8_drop_quizresult_player_columns.py`

**Interfaces:**
- Consumes: everything above.
- Produces: `QuizResult` without `player_id` or `country`; participants are the only source of membership.

- [ ] **Step 1: Verify nothing still reads the scalars**

```bash
cd /Users/ahancock/dev/quiz-reference-demo
grep -rn "QuizResult.player_id\|result\.player_id\|player_display_name" backend/app frontend/src --include='*.py' --include='*.ts' --include='*.tsx'
```

Expected: only the dual-write assignments this task removes. Anything else is a reader that still needs migrating — stop and fix that first.

- [ ] **Step 2: Write the migration**

Create `backend/app/alembic/versions/c3d4e5f6a7b8_drop_quizresult_player_columns.py`:

```python
"""drop quizresult.player_id and quizresult.country

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
"""

import sqlalchemy as sa
from alembic import op

revision = "c3d4e5f6a7b8"
down_revision = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    orphans = bind.execute(
        sa.text(
            """
            SELECT count(*) FROM quizresult r
            WHERE NOT EXISTS (
                SELECT 1 FROM quiz_result_player p
                WHERE p.quiz_result_id = r.id
            )
            """
        )
    ).scalar_one()
    if orphans:
        raise RuntimeError(
            f"{orphans} results have no participants; backfill before dropping columns"
        )

    op.drop_constraint("quizresult_quiz_id_player_id_key", "quizresult", type_="unique")
    op.drop_column("quizresult", "player_id")
    op.drop_column("quizresult", "country")


def downgrade() -> None:
    op.add_column("quizresult", sa.Column("country", sa.String(length=3), nullable=True))
    op.add_column("quizresult", sa.Column("player_id", sa.Uuid(), nullable=True))
    op.execute(
        """
        UPDATE quizresult r
        SET player_id = p.player_id, country = p.country
        FROM quiz_result_player p
        WHERE p.quiz_result_id = r.id AND p.slot = 1
        """
    )
    op.alter_column("quizresult", "player_id", nullable=False)
    op.create_unique_constraint(
        "quizresult_quiz_id_player_id_key", "quizresult", ["quiz_id", "player_id"]
    )
```

Confirm the real constraint name first — it may differ:

```bash
cd backend && ../.venv/bin/python -c "
from sqlalchemy import create_engine, inspect
from app.core.config import settings
i = inspect(create_engine(str(settings.SQLALCHEMY_DATABASE_URI)))
print([c['name'] for c in i.get_unique_constraints('quizresult')])
"
```

Use whatever that prints in both `drop_constraint` and `create_unique_constraint`.

- [ ] **Step 3: Remove the fields and dual-writes**

- `QuizResult`: delete `player_id`, `country`, and `__table_args__`.
- `QuizResultCreate`: delete `player_id` and `country`; `participants` becomes required (`list[ResultParticipantCreate]`, no default).
- `ResolvedResultRow`: delete `player_id`, `player_create`, `country`; `participants` becomes required.
- `QuizResultPublic` / `QuizResultWithPlayer` / `PodiumFinisher`: delete the scalar `player_id`, `player_display_name`, `player_slug`, `country` fields, keeping only `participants`.
- `crud.create_quiz_results`: drop the `r.participants or [...]` fallback and the `player_id=`/`country=` assignments on `QuizResult`; look up the existing row by its participant set rather than by `player_id`:

```python
        existing_ids = {
            r.quiz_result_id
            for r in session.exec(
                select(QuizResultPlayer)
                .where(QuizResultPlayer.quiz_id == quiz_id)
                .where(
                    col(QuizResultPlayer.player_id).in_(
                        [p.player_id for p in r.participants]
                    )
                )
            ).all()
        }
        existing = (
            session.get(QuizResult, next(iter(existing_ids)))
            if len(existing_ids) == 1
            else None
        )
```

- `submit_results`: drop the `row.player_id or row.player_create` fallback branch; participants are now the only input.
- `podium.py` and `read_quiz_results_with_players`: drop the `.join(Player, QuizResult.player_id == Player.id)`, selecting `QuizResult` alone and taking names from participants.
- `update_quiz_result`: drop the `db_result.player_id = ...` line.

- [ ] **Step 4: Apply the migration**

```bash
cd backend && ../.venv/bin/python -m alembic upgrade head
```

Expected: runs clean. If it raises the orphan error, a result was created without participants — find it before continuing.

- [ ] **Step 5: Run the full backend suite**

```bash
cd backend && ../.venv/bin/python -m pytest tests/ -v
```

Expected: PASS, all of it.

- [ ] **Step 6: Regenerate the client, rebuild, and commit**

```bash
bash ./scripts/generate-client.sh
cd frontend && bun run build
```

Expected: type-check clean. Any error here is a frontend reader of a removed scalar that Tasks 10–16 missed.

```bash
git add -A
git commit -m "refactor(backend): drop QuizResult.player_id in favour of participants"
```

---

### Task 10: `splitPairNames`

The separator rules as a pure function. CSV parsing is entirely client-side in this app (`Step2CsvInput` → `parsedRows`), so splitting belongs in `frontend/src/lib/` beside `normalizePlayerName` and `columnDetection` — the backend only ever sees resolved participants.

**Files:**
- Create: `frontend/src/lib/splitPairNames.ts`
- Test: `frontend/tests/split-pair-names.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `splitPairNames(cell: string): string[]`, `PAIR_SEPARATOR_PATTERN: RegExp` (global, for `.split`) and `HAS_PAIR_SEPARATOR: RegExp` (non-global, for `.test`). Task 12 adds `namesForRow` to the same module.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/split-pair-names.test.ts`:

```typescript
import { describe, expect, test } from "bun:test"
import { splitPairNames } from "../src/lib/splitPairNames"

describe("splitPairNames", () => {
  test("splits on an ampersand", () => {
    expect(splitPairNames("Alice & Bob")).toEqual(["Alice", "Bob"])
  })

  test("splits on an ampersand without spaces", () => {
    expect(splitPairNames("Alice&Bob")).toEqual(["Alice", "Bob"])
  })

  test("splits on the word and", () => {
    expect(splitPairNames("Alice and Bob")).toEqual(["Alice", "Bob"])
  })

  test("splits on the word And regardless of case", () => {
    expect(splitPairNames("Alice And Bob")).toEqual(["Alice", "Bob"])
  })

  test("leaves a lone name alone", () => {
    expect(splitPairNames("Alice")).toEqual(["Alice"])
  })

  test("does not split a name containing and", () => {
    expect(splitPairNames("Alexander")).toEqual(["Alexander"])
  })

  test("does not split Sandy", () => {
    expect(splitPairNames("Sandy")).toEqual(["Sandy"])
  })

  test("splits a pair whose names contain and", () => {
    expect(splitPairNames("Alexander and Sandy")).toEqual([
      "Alexander",
      "Sandy",
    ])
  })

  test("returns three names when there are three", () => {
    expect(splitPairNames("Alice & Bob & Carol")).toEqual([
      "Alice",
      "Bob",
      "Carol",
    ])
  })

  test("handles mixed separators", () => {
    expect(splitPairNames("Alice & Bob and Carol")).toEqual([
      "Alice",
      "Bob",
      "Carol",
    ])
  })

  test("collapses internal whitespace and trims", () => {
    expect(splitPairNames("  Alice   Smith  &  Bob  ")).toEqual([
      "Alice Smith",
      "Bob",
    ])
  })

  test("drops empty segments from a trailing separator", () => {
    expect(splitPairNames("Alice &")).toEqual(["Alice"])
  })

  test("returns an empty array for an empty cell", () => {
    expect(splitPairNames("   ")).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd frontend && bun run test:unit split-pair-names
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/splitPairNames.ts`:

```typescript
/**
 * Split a result's name cell into its individual quizzers.
 *
 * Separators are `&` (with or without surrounding whitespace) and the
 * standalone word `and`. The whitespace requirement around `and` is what
 * keeps names like "Alexander" and "Sandy" intact — only a free-standing
 * "and" separates two people.
 */
export const PAIR_SEPARATOR_PATTERN = /\s*&\s*|\s+and\s+/gi

export function splitPairNames(cell: string): string[] {
  return cell
    .split(PAIR_SEPARATOR_PATTERN)
    .map((name) => name.trim().replace(/\s+/g, " "))
    .filter((name) => name.length > 0)
}
```

`PAIR_SEPARATOR_PATTERN` carries the `g` flag, which makes `RegExp.lastIndex` stateful across `.test()` calls. `String.split` does not use `lastIndex`, so it is safe here — but Task 12 needs a detection test, so export a separate non-global pattern for that:

```typescript
export const HAS_PAIR_SEPARATOR = /\s*&\s*|\s+and\s+/i
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd frontend && bun run test:unit split-pair-names
```

Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/splitPairNames.ts frontend/tests/split-pair-names.test.ts
git commit -m "feat(frontend): add pair name splitting"
```

---

### Task 11: Participant mode in the wizard

**Files:**
- Modify: `frontend/src/components/Upload/types.ts`
- Modify: `frontend/src/components/Upload/steps/Step1QuizMeta.tsx`
- Modify: `frontend/src/test-ids.ts`

**Interfaces:**
- Consumes: `QuizParticipantMode` from the generated client.
- Produces: `QuizMeta.participant_mode: "individual" | "pairs"`; `WizardState.columnMapping.player_name_2: number | null`; `WizardState.columnMapping.pairsLayout: "combined" | "two-columns"`; test ids `uploadParticipantModeIndividual`, `uploadParticipantModePairs`.

- [ ] **Step 1: Extend the wizard types**

In `frontend/src/components/Upload/types.ts`, add to `QuizMeta`:

```typescript
  participant_mode: "individual" | "pairs"
```

and to `emptyQuizMeta()`'s return: `participant_mode: "individual",`.

Add to `ColumnMapping`:

```typescript
  player_name_2: number | null
  pairsLayout: "combined" | "two-columns"
```

and to `INITIAL_STATE.columnMapping`: `player_name_2: null,` and `pairsLayout: "combined",`.

Add to `WizardState`:

```typescript
  participantMode: "individual" | "pairs"
```

and to `INITIAL_STATE`: `participantMode: "individual",`. This mirrors `selectedFormat` — Step 0 sets it from the existing quiz when uploading to one, Step 1 sets it for a new quiz, and Steps 3–5 read it without caring which.

- [ ] **Step 2: Add the test ids**

In `frontend/src/test-ids.ts`, add to `Labels`:

```typescript
  uploadParticipantModeIndividual: "upload-participant-mode-individual",
  uploadParticipantModePairs: "upload-participant-mode-pairs",
  columnMappingPlayerName2: "column-mapping-player-name-2",
  pairsLayoutCombined: "pairs-layout-combined",
  pairsLayoutTwoColumns: "pairs-layout-two-columns",
```

- [ ] **Step 3: Add the control to Step 1**

In `Step1QuizMeta.tsx`, add a two-button toggle styled like the existing `submitModeToggle` in `Step5Preview.tsx`, placed directly after the quiz name field:

```tsx
<div className="grid gap-1.5">
  <Label>Contested by</Label>
  <div className="flex rounded-md border overflow-hidden self-start">
    {(
      [
        ["individual", "Individual", Labels.uploadParticipantModeIndividual],
        ["pairs", "Pairs", Labels.uploadParticipantModePairs],
      ] as const
    ).map(([mode, label, testId]) => (
      <button
        key={mode}
        type="button"
        data-testid={testId}
        onClick={() => setParticipantMode(mode)}
        className={`px-4 py-1.5 text-sm ${
          participantMode === mode
            ? "bg-primary text-primary-foreground"
            : "bg-background text-muted-foreground hover:bg-muted"
        }`}
      >
        {label}
      </button>
    ))}
  </div>
  <p className="text-xs text-muted-foreground">
    Pairs quizzes record two quizzers per result.
  </p>
</div>
```

Hold it in `const [participantMode, setParticipantMode] = useState<"individual" | "pairs">(state.participantMode)`, following the `selectedFormatId` pattern already in this file, and include both `participant_mode: participantMode` in the `quizMeta` patch and `participantMode` in the `update({...})` call on submit.

- [ ] **Step 4: Carry the mode from an existing quiz**

In `Step0ModeSelect.tsx`, where the existing-quiz `onChange` already passes `quiz.format_id` and `quiz.format`, also pass `quiz.participant_mode` and store it as `participantMode` in the wizard state. An upload to an existing pairs quiz must behave as pairs without the user restating it.

- [ ] **Step 5: Verify the build**

```bash
cd frontend && bun run build
```

Expected: type-check clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Upload/types.ts frontend/src/components/Upload/steps/Step1QuizMeta.tsx frontend/src/components/Upload/steps/Step0ModeSelect.tsx frontend/src/test-ids.ts
git commit -m "feat(frontend): choose individual or pairs in the upload wizard"
```

---

### Task 12: Pairs column mapping

**Files:**
- Create: `frontend/src/lib/detectPairsLayout.ts`
- Modify: `frontend/src/lib/splitPairNames.ts` (adds `namesForRow`)
- Modify: `frontend/src/lib/columnDetection.ts`
- Modify: `frontend/src/components/Upload/types.ts` (`country` becomes nullable)
- Modify: `frontend/src/components/Upload/steps/Step3ColumnMapping.tsx`
- Modify: `frontend/src/components/Upload/steps/Step5Preview.tsx` (null-guard only)
- Test: `frontend/tests/detect-pairs-layout.test.ts`

**Interfaces:**
- Consumes: `HAS_PAIR_SEPARATOR`, `detectColumn`, `ColumnMapping`.
- Produces: `PARTNER_HEADER_NAMES: string[]`; `detectPairsLayout(rows, nameColumn, header, claimed) -> { layout, player_name_2 }`; `namesForRow(row, mapping, participantMode) -> string[]`; `ColumnMapping.country: number | null`.

**Note on the country type.** Making the country column optional changes
`ColumnMapping.country` from `number` to `number | null`, which breaks every existing
reader until it is guarded. Both readers must be fixed *in this task* to keep the build
green: `Step3ColumnMapping.tsx` (handled below) and `Step5Preview.tsx`, where the
`parseRows` mapping becomes
`country: state.columnMapping.country !== null ? (row[state.columnMapping.country] ?? "") : ""`.
Task 14 builds on that guard.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/detect-pairs-layout.test.ts`:

```typescript
import { describe, expect, test } from "bun:test"
import { detectPairsLayout } from "../src/lib/detectPairsLayout"

describe("detectPairsLayout", () => {
  test("picks combined when most name cells hold a separator", () => {
    const rows = [
      ["Team", "Country", "Score"],
      ["Alice & Bob", "IE", "50"],
      ["Carol and Dave", "IE", "48"],
      ["Solo Sam", "IE", "40"],
    ]
    expect(detectPairsLayout(rows, 0, rows[0], new Set())).toEqual({
      layout: "combined",
      player_name_2: null,
    })
  })

  test("picks two columns when a partner header exists", () => {
    const rows = [
      ["Player 1", "Player 2", "Country", "Score"],
      ["Alice", "Bob", "IE", "50"],
      ["Carol", "Dave", "IE", "48"],
    ]
    expect(detectPairsLayout(rows, 0, rows[0], new Set([0]))).toEqual({
      layout: "two-columns",
      player_name_2: 1,
    })
  })

  test("recognises a partner column", () => {
    const rows = [
      ["Name", "Partner", "Score"],
      ["Alice", "Bob", "50"],
    ]
    expect(detectPairsLayout(rows, 0, rows[0], new Set([0]))).toEqual({
      layout: "two-columns",
      player_name_2: 1,
    })
  })

  test("falls back to combined when nothing matches", () => {
    const rows = [
      ["Name", "Country", "Score"],
      ["Alice", "IE", "50"],
    ]
    expect(detectPairsLayout(rows, 0, rows[0], new Set([0]))).toEqual({
      layout: "combined",
      player_name_2: null,
    })
  })

  test("ignores blank name cells when counting separators", () => {
    const rows = [
      ["Team", "Score"],
      ["Alice & Bob", "50"],
      ["", ""],
    ]
    expect(detectPairsLayout(rows, 0, rows[0], new Set())).toEqual({
      layout: "combined",
      player_name_2: null,
    })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd frontend && bun run test:unit detect-pairs-layout
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the detector**

Add to `frontend/src/lib/columnDetection.ts`:

```typescript
export const PARTNER_HEADER_NAMES = [
  "player 2",
  "player2",
  "partner",
  "name 2",
  "name2",
  "player b",
]
```

Create `frontend/src/lib/detectPairsLayout.ts`:

```typescript
import { detectColumn, PARTNER_HEADER_NAMES } from "@/lib/columnDetection"
import { HAS_PAIR_SEPARATOR } from "@/lib/splitPairNames"

export interface PairsLayoutDetection {
  layout: "combined" | "two-columns"
  player_name_2: number | null
}

const SEPARATOR_SHARE_THRESHOLD = 0.5

/**
 * Guess whether a pairs CSV holds both names in one column or two.
 *
 * A majority of separator-bearing name cells is the strongest signal, so it
 * wins outright. Failing that, an unclaimed partner-ish header means two
 * columns. Otherwise assume combined: a lone name per row is a legitimate
 * solo result, and the Player 1 / Player 2 preview makes a wrong guess
 * visible before submit.
 */
export function detectPairsLayout(
  rows: string[][],
  nameColumn: number,
  header: string[],
  claimed: Set<number>,
): PairsLayoutDetection {
  const cells = rows
    .slice(1)
    .map((row) => row[nameColumn] ?? "")
    .filter((cell) => cell.trim().length > 0)

  const withSeparator = cells.filter((cell) =>
    HAS_PAIR_SEPARATOR.test(cell),
  ).length

  if (
    cells.length > 0 &&
    withSeparator / cells.length >= SEPARATOR_SHARE_THRESHOLD
  ) {
    return { layout: "combined", player_name_2: null }
  }

  const partner = detectColumn(header, PARTNER_HEADER_NAMES, claimed)
  if (partner !== null) {
    return { layout: "two-columns", player_name_2: partner }
  }

  return { layout: "combined", player_name_2: null }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd frontend && bun run test:unit detect-pairs-layout
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Wire it into Step 3**

In `Step3ColumnMapping.tsx`:

1. Make the country field optional for pairs. Move `country` out of `REQUIRED_FIELDS` into its own `Select` that renders a `__none__` option — labelled `Country column *` and without `__none__` when `state.participantMode === "individual"`, and `Country column (optional)` with `__none__` when it is `"pairs"`. Below it, when pairs, add:

```tsx
<p className="text-xs text-muted-foreground">
  Optional for pairs — leave unmapped and each quizzer's own country is used.
</p>
```

2. In the `useState` initialiser, after the required-field detection, when `state.participantMode === "pairs"` and the mapping still holds its defaults, run `detectPairsLayout(state.parsedRows, core.player_name, header, claimed)` and seed `pairsLayout` and `player_name_2` from it, claiming `player_name_2` if non-null.

3. Render the layout radio when pairs:

```tsx
{state.participantMode === "pairs" && (
  <div className="grid gap-1.5">
    <Label>Pairs layout</Label>
    <div className="flex rounded-md border overflow-hidden self-start">
      {(
        [
          ["combined", "One column, split on & / and", Labels.pairsLayoutCombined],
          ["two-columns", "Two separate columns", Labels.pairsLayoutTwoColumns],
        ] as const
      ).map(([layout, label, testId]) => (
        <button
          key={layout}
          type="button"
          data-testid={testId}
          onClick={() => setMapping((m) => ({ ...m, pairsLayout: layout }))}
          className={`px-4 py-1.5 text-sm ${
            mapping.pairsLayout === layout
              ? "bg-primary text-primary-foreground"
              : "bg-background text-muted-foreground hover:bg-muted"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  </div>
)}
```

4. When pairs and `pairsLayout === "two-columns"`, render a second name `Select` bound to `player_name_2` with `data-testid={Labels.columnMappingPlayerName2}`.

5. Replace the preview's `["Pos", "Player", "Country", "Score"]` header with `["Pos", "Player 1", "Player 2", "Country", "Score"]` when pairs, and render the two name cells from a shared helper so Step 5 can use the same one:

```tsx
const names = namesForRow(row, mapping, state.participantMode)
// names[0] ?? "—" in the first cell, names[1] ?? "—" in the second
```

6. Export that helper from `frontend/src/lib/splitPairNames.ts` so Steps 3, 4 and 5 all agree:

```typescript
export function namesForRow(
  row: string[],
  mapping: { player_name: number; player_name_2: number | null; pairsLayout: "combined" | "two-columns" },
  participantMode: "individual" | "pairs",
): string[] {
  const first = row[mapping.player_name] ?? ""
  if (participantMode !== "pairs") {
    const trimmed = first.trim()
    return trimmed ? [trimmed] : []
  }
  if (mapping.pairsLayout === "two-columns") {
    const second =
      mapping.player_name_2 !== null ? (row[mapping.player_name_2] ?? "") : ""
    return [first, second].map((n) => n.trim()).filter((n) => n.length > 0)
  }
  return splitPairNames(first)
}
```

7. `handleNext` normalises names in place today via `normalizePlayerName` on the single name column. Extend it to normalise `player_name_2` as well when the layout is two-columns; leave the combined column untouched at this stage, since Task 13 normalises each name after splitting.

- [ ] **Step 6: Verify the build and commit**

```bash
cd frontend && bun run build && bun run test:unit
git add frontend/src/lib/detectPairsLayout.ts frontend/src/lib/columnDetection.ts frontend/src/lib/splitPairNames.ts frontend/src/components/Upload/steps/Step3ColumnMapping.tsx frontend/tests/detect-pairs-layout.test.ts
git commit -m "feat(frontend): map pairs columns with layout auto-detection"
```

---

### Task 13: Matching both halves

Step 4 resolves participants, not rows. A row with one confident match and one ambiguous name shows only the ambiguous half.

**Files:**
- Modify: `frontend/src/lib/matchPlayers.ts`
- Modify: `frontend/src/components/Upload/types.ts`
- Modify: `frontend/src/components/Upload/steps/Step4Disambiguation.tsx`
- Test: `frontend/tests/match-players.test.ts`, `frontend/tests/upload-auto-resolution.test.ts`

**Interfaces:**
- Consumes: `namesForRow`, `getAutoResolution`.
- Produces: `RowResolution = { participants: Resolution[] }`; `buildRowResolutions(rows: ParsedRow[][], candidatesByName) => RowResolution[]`; `WizardState.resolutions: RowResolution[]`.

- [ ] **Step 1: Write the failing test**

Append to `frontend/tests/match-players.test.ts`:

```typescript
import { buildRowResolutions } from "../src/lib/matchPlayers"

describe("buildRowResolutions", () => {
  const candidate = (id: string, name: string, similarity: number) => ({
    player: {
      id,
      display_name: name,
      countries: ["IE"],
      is_published: true,
      slug: name.toLowerCase(),
    },
    similarity,
  })

  test("resolves both halves of a pair independently", () => {
    const rows = [
      [
        { player_name: "Alice", country: "IE", score: 50 },
        { player_name: "Bob", country: "IE", score: 50 },
      ],
    ]
    const resolutions = buildRowResolutions(rows, {
      Alice: [candidate("a1", "Alice", 1)],
      Bob: [candidate("b1", "Bob", 1)],
    })
    expect(resolutions).toHaveLength(1)
    expect(resolutions[0].participants.map((p) => p.player_id)).toEqual([
      "a1",
      "b1",
    ])
  })

  test("auto-resolves one half and flags the other", () => {
    const rows = [
      [
        { player_name: "Alice", country: "IE", score: 50 },
        { player_name: "Bob", country: "IE", score: 50 },
      ],
    ]
    const resolutions = buildRowResolutions(rows, {
      Alice: [candidate("a1", "Alice", 1)],
      Bob: [candidate("b1", "Bobby", 0.5), candidate("b2", "Bobbie", 0.5)],
    })
    expect(resolutions[0].participants[0].autoResolved).toBe(true)
    expect(resolutions[0].participants[1].autoResolved).toBe(false)
    expect(resolutions[0].participants[1].reviewClass).toBe("ambiguous")
  })

  test("creates a new player for each unmatched half", () => {
    const rows = [
      [
        { player_name: "Alice", country: "IE", score: 50 },
        { player_name: "Bob", country: "GB", score: 50 },
      ],
    ]
    const resolutions = buildRowResolutions(rows, {})
    expect(
      resolutions[0].participants.map((p) => p.player_create?.display_name),
    ).toEqual(["Alice", "Bob"])
    expect(resolutions[0].participants[1].player_create?.countries).toEqual([
      "GB",
    ])
  })

  test("handles a solo row in a pairs upload", () => {
    const rows = [[{ player_name: "Alice", country: "IE", score: 50 }]]
    const resolutions = buildRowResolutions(rows, {
      Alice: [candidate("a1", "Alice", 1)],
    })
    expect(resolutions[0].participants).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd frontend && bun run test:unit match-players
```

Expected: FAIL — `buildRowResolutions` is not exported.

- [ ] **Step 3: Add the row-level builder**

In `frontend/src/lib/matchPlayers.ts`, keep `getAutoResolution` exactly as it is — it already resolves one name and every existing test covers it — and add:

```typescript
export interface RowResolution {
  participants: Resolution[]
}

export function buildRowResolutions(
  rows: ParsedRow[][],
  candidatesByName: Record<string, PlayerSearchResult[]>,
): RowResolution[] {
  return rows.map((participants) => ({
    participants: participants.map((participant) =>
      getAutoResolution(participant, candidatesByName[participant.player_name] ?? []),
    ),
  }))
}
```

Keep the existing `buildResolutions` export until Task 14 has moved Step 5 across, then delete it.

- [ ] **Step 4: Change the wizard's resolution shape**

In `types.ts`, change `resolutions: Resolution[]` to `resolutions: RowResolution[]` on `WizardState`, importing `RowResolution` from `@/lib/matchPlayers`.

- [ ] **Step 5: Build participant rows in Step 4**

In `Step4Disambiguation.tsx`:

1. Build the parsed rows as a list of participant lists, using `namesForRow` so the split matches Step 3's preview exactly:

```typescript
const parsedRows: ParsedRow[][] = state.parsedRows.slice(1).map((row) => {
  const names = namesForRow(row, state.columnMapping, state.participantMode)
  const country =
    state.columnMapping.country !== null
      ? (row[state.columnMapping.country] ?? "")
      : ""
  const score = parseFloat(row[state.columnMapping.score] || "0")
  return names.map((player_name) => ({
    player_name: normalizePlayerName(player_name),
    country,
    score,
  }))
})
```

The country column may now be unmapped, hence the `null` check — `ColumnMapping.country` becomes `number | null` as part of Task 12's optional-country change.

2. Feed `chunkUniqueNames(parsedRows.flat().map((p) => p.player_name), BATCH_SIZE)` to the existing batch search — flattening means each distinct name is searched once whether it appears as a first or second member.

3. Replace `buildResolutions(...)` with `buildRowResolutions(parsedRows, candidatesByName)`.

4. Render one `RowDisambiguator` per *participant*, not per row. Keep the component itself unchanged; change its call site to iterate `row.participants.map((resolution, slot) => ...)`, pass `index={rowIndex * 2 + slot}` so the radio-group `name` stays unique, and label a pairs participant with its slot:

```tsx
{state.participantMode === "pairs" && (
  <p className="text-xs text-muted-foreground">
    Row {rowIndex + 1}, quizzer {slot + 1}
    {partnerName ? ` — partner: ${partnerName}` : ""}
  </p>
)}
```

where `partnerName` is the other participant's `player_name` from `parsedRows[rowIndex]`. Naming the partner is what lets an admin tell two identically-named quizzers apart.

5. The "needs review" filtering that currently counts rows must now count participants: a row appears in the review list if **any** of its participants is unresolved, and only the unresolved participants render inside it.

- [ ] **Step 6: Run the tests and build**

```bash
cd frontend && bun run test:unit && bun run build
```

Expected: PASS and a clean type-check. `upload-auto-resolution.test.ts` covers `getAutoResolution` directly and should be untouched by this task — if it fails, you changed behaviour you should not have.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/matchPlayers.ts frontend/src/components/Upload/types.ts frontend/src/components/Upload/steps/Step4Disambiguation.tsx frontend/tests/match-players.test.ts
git commit -m "feat(frontend): match both members of a pair"
```

---

### Task 14: Preview, validation and submit

**Files:**
- Modify: `frontend/src/lib/validateUploadRows.ts`
- Modify: `frontend/src/components/Upload/steps/Step5Preview.tsx`
- Test: `frontend/tests/validate-upload-rows.test.ts`

**Interfaces:**
- Consumes: `namesForRow`, `RowResolution`.
- Produces: submit payload rows carrying `participants: [{ player_id?, player_create?, country? }]`.

- [ ] **Step 1: Write the failing test**

Append to `frontend/tests/validate-upload-rows.test.ts`:

```typescript
const pairsMapping: ColumnMapping = {
  player_name: 0,
  player_name_2: null,
  pairsLayout: "combined",
  country: 1,
  score: 2,
  position: null,
  rounds: [],
}

function pairResolution(): RowResolution {
  return {
    participants: [
      { player_id: "a1", player_create: null },
      { player_id: "b1", player_create: null },
    ],
  }
}

describe("validateUploadRows — pairs", () => {
  test("accepts a well-formed pair", () => {
    const parsedRows = [
      ["Team", "Country", "Score"],
      ["Alice & Bob", "Ireland", "50"],
    ]
    expect(
      validateUploadRows(parsedRows, pairsMapping, [pairResolution()], "pairs"),
    ).toEqual([])
  })

  test("accepts a solo entry without complaint", () => {
    const parsedRows = [
      ["Team", "Country", "Score"],
      ["Alice", "Ireland", "50"],
    ]
    const resolutions: RowResolution[] = [
      { participants: [{ player_id: "a1", player_create: null }] },
    ]
    expect(
      validateUploadRows(parsedRows, pairsMapping, resolutions, "pairs"),
    ).toEqual([])
  })

  test("rejects three names", () => {
    const parsedRows = [
      ["Team", "Country", "Score"],
      ["Alice & Bob & Carol", "Ireland", "50"],
    ]
    const errors = validateUploadRows(
      parsedRows,
      pairsMapping,
      [pairResolution()],
      "pairs",
    )
    expect(errors).toEqual([
      {
        row: 1,
        message: 'Expected at most two quizzers, found 3 ("Alice & Bob & Carol")',
      },
    ])
  })

  test("rejects the same person twice", () => {
    const parsedRows = [
      ["Team", "Country", "Score"],
      ["Alice & Alice", "Ireland", "50"],
    ]
    const errors = validateUploadRows(
      parsedRows,
      pairsMapping,
      [pairResolution()],
      "pairs",
    )
    expect(errors).toEqual([
      { row: 1, message: "The same quizzer appears twice in this row" },
    ])
  })

  test("still flags a missing name", () => {
    const parsedRows = [
      ["Team", "Country", "Score"],
      ["", "Ireland", "50"],
    ]
    const errors = validateUploadRows(
      parsedRows,
      pairsMapping,
      [{ participants: [] }],
      "pairs",
    )
    expect(errors).toEqual([{ row: 1, message: "Player name is missing" }])
  })
})
```

Import `RowResolution` from `../src/lib/matchPlayers` and add `player_name_2`, `pairsLayout` to the existing `baseMapping` in this file (with `null` and `"combined"`), plus `"individual"` as the fourth argument in every existing call.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd frontend && bun run test:unit validate-upload-rows
```

Expected: FAIL — `validateUploadRows` takes three arguments and knows nothing about participants.

- [ ] **Step 3: Extend the validator**

Rewrite `frontend/src/lib/validateUploadRows.ts`'s signature and name check:

```typescript
export function validateUploadRows(
  parsedRows: string[][],
  columnMapping: ColumnMapping,
  resolutions: RowResolution[],
  participantMode: "individual" | "pairs",
): RowError[] {
  const errors: RowError[] = []

  resolutions.forEach((resolution, i) => {
    const row = parsedRows[i + 1]
    if (!row) return

    const displayNumber = i + 1
    const names = namesForRow(row, columnMapping, participantMode)
    const created = resolution.participants
      .map((p) => p.player_create?.display_name)
      .filter((n): n is string => Boolean(n))
    const effective = names.length > 0 ? names : created

    if (effective.length === 0) {
      errors.push({ row: displayNumber, message: "Player name is missing" })
    } else if (participantMode === "pairs" && effective.length > 2) {
      errors.push({
        row: displayNumber,
        message: `Expected at most two quizzers, found ${effective.length} ("${row[columnMapping.player_name]}")`,
      })
    } else if (
      participantMode === "pairs" &&
      effective.length === 2 &&
      effective[0].toLowerCase() === effective[1].toLowerCase()
    ) {
      errors.push({
        row: displayNumber,
        message: "The same quizzer appears twice in this row",
      })
    }
    // ...score and round validation below is unchanged
  })

  return errors
}
```

Keep the existing score and round-score blocks exactly as they are.

- [ ] **Step 4: Build the submit payload from participants**

In `Step5Preview.tsx`:

1. Pass `state.participantMode` as the new fourth argument to `validateUploadRows`.
2. Add `participant_mode: meta.participant_mode` to `buildQuizMeta`.
3. Replace the per-row payload's `player_id` / `player_create` / `country` with a participants list:

```typescript
const results = state.resolutions.map((r, i) => {
  const row = state.parsedRows[i + 1]
  // ...roundScores, final_rank unchanged
  const rowCountry =
    state.columnMapping.country !== null && row
      ? (resolveCountryCode(row[state.columnMapping.country]) ?? undefined)
      : undefined
  return {
    participants: r.participants.map((p) => ({
      player_id: p.player_id ?? undefined,
      player_create: p.player_create ?? undefined,
      country: rowCountry,
    })),
    final_rank,
    score: parseRows[i]?.score ?? 0,
    round_scores: hasRoundData ? roundScores : undefined,
  }
})
```

The row's single country applies to both members, per the spec — a second country column is out of scope.

4. In the preview table, show a Player 2 column when pairs, sourcing both names from `namesForRow` so it matches Step 3 exactly, and count new players across all participants:

```typescript
state.resolutions.flatMap((r) => r.participants).filter((p) => p.player_create).length
```

5. Update the `parseRows` mapping at the top of the component to tolerate an unmapped country column (`state.columnMapping.country !== null ? ... : ""`).

- [ ] **Step 5: Run the tests and build**

```bash
cd frontend && bun run test:unit && bun run build
```

Expected: PASS and a clean type-check.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/validateUploadRows.ts frontend/src/components/Upload/steps/Step5Preview.tsx frontend/tests/validate-upload-rows.test.ts
git commit -m "feat(frontend): validate and submit pairs results"
```

---

### Task 15: Display pairs in public views

**Files:**
- Modify: `frontend/src/components/Quizzes/QuizResultsTable.tsx`
- Modify: `frontend/src/components/Players/historyColumns.tsx`
- Modify: `frontend/src/components/Competitions/CompetitionPodium.tsx`
- Test: covered by Task 16's E2E; no unit test (these are presentational)

**Interfaces:**
- Consumes: `QuizResultWithPlayer.participants`, `PlayerResultWithQuiz.partners`, `PodiumFinisher.participants`.
- Produces: a shared `PlayerLinks` component.

- [ ] **Step 1: Add a shared participant renderer**

Create `frontend/src/components/Common/PlayerLinks.tsx`:

```tsx
import { Link } from "@tanstack/react-router"

export interface LinkablePlayer {
  player_id: string
  player_display_name: string
  player_slug?: string | null
}

/** Renders one or more players as links, joined by " & ". */
export function PlayerLinks({ players }: { players: LinkablePlayer[] }) {
  if (players.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <span className="font-medium">
      {players.map((p, i) => (
        <span key={p.player_id}>
          {i > 0 && <span className="text-muted-foreground"> & </span>}
          {p.player_slug ? (
            <Link
              to={"/players/$slug" as any}
              params={{ slug: p.player_slug } as any}
              className="hover:underline"
            >
              {p.player_display_name}
            </Link>
          ) : (
            <span>{p.player_display_name}</span>
          )}
        </span>
      ))}
    </span>
  )
}
```

- [ ] **Step 2: Use it in the results table**

In `QuizResultsTable.tsx`, replace the `player_display_name` column's cell with
`<PlayerLinks players={row.original.participants} />` and change its header to
`Players` when any row has more than one participant, otherwise `Player`.

Change the Country cell to render each participant's country, falling back to the
player's own when null:

```tsx
cell: ({ row }) => (
  <span className="text-muted-foreground">
    {row.original.participants
      .map((p) => countryName(p.country) || "—")
      .join(" / ")}
  </span>
),
```

- [ ] **Step 3: Name the partner in player history**

In `historyColumns.tsx`, in the quiz-name cell, append the partners when present:

```tsx
{result.partners.length > 0 && (
  <span className="text-muted-foreground text-xs">
    {" "}with{" "}
    {result.partners.map((p) => p.display_name).join(" & ")}
  </span>
)}
```

- [ ] **Step 4: Show both winners on the podium**

In `CompetitionPodium.tsx`, replace each finisher's single player link with
`<PlayerLinks players={finisher.participants} />`. The standings table is already
per-player and needs no change — the backend now emits a row for each member.

- [ ] **Step 5: Verify the build and commit**

```bash
cd frontend && bun run build && bun run lint
```

Expected: clean.

```bash
git add frontend/src/components/Common/PlayerLinks.tsx frontend/src/components/Quizzes/QuizResultsTable.tsx frontend/src/components/Players/historyColumns.tsx frontend/src/components/Competitions/CompetitionPodium.tsx
git commit -m "feat(frontend): render both members of a pair"
```

---

### Task 16: End-to-end pairs upload

**Files:**
- Create: `frontend/tests/pairs-upload.spec.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing — this is the acceptance gate.

- [ ] **Step 1: Check the environment before running anything**

The E2E suite has three environment traps, all of which produce confusing failures:

```bash
docker compose ps            # mailcatcher must be up, or auth specs die on :1080
docker compose stop frontend # the container shadows the local dev server on :5173
```

And never run two Playwright suites at once — they share the dev DB and superuser.

- [ ] **Step 2: Write the spec**

Create `frontend/tests/pairs-upload.spec.ts`, following the structure of the existing
`upload.spec.ts` (reuse its login helper and its navigation to the upload page):

```typescript
import { expect, test } from "@playwright/test"
import { Labels } from "../src/test-ids"

const COMBINED_CSV = `Team,Country,Score
Alice Combined & Bob Combined,Ireland,50
Carol Combined and Dave Combined,Ireland,48
Solo Combined,Ireland,40`

const TWO_COLUMN_CSV = `Player 1,Player 2,Country,Score
Alice Split,Bob Split,Ireland,50
Carol Split,Dave Split,Ireland,48`

test.describe.configure({ mode: "serial" })

test("uploads a pairs quiz with both names in one column", async ({ page }) => {
  // ...log in, go to upload, choose "new quiz"
  await page.getByTestId(Labels.uploadParticipantModePairs).click()
  // ...fill quiz name and dates, continue to the CSV step
  await page.getByRole("textbox", { name: /csv/i }).fill(COMBINED_CSV)
  // ...continue to column mapping
  await expect(page.getByTestId(Labels.pairsLayoutCombined)).toHaveClass(
    /bg-primary/,
  )
  // ...continue through matching, accepting the auto-created players
  await expect(page.getByText("Alice Combined")).toBeVisible()
  await expect(page.getByText("Bob Combined")).toBeVisible()
  // ...submit, then assert the results table shows both names
  await expect(
    page.getByText("Alice Combined & Bob Combined"),
  ).toBeVisible()
})

test("uploads a pairs quiz with two name columns", async ({ page }) => {
  // ...same flow with TWO_COLUMN_CSV
  await expect(page.getByTestId(Labels.pairsLayoutTwoColumns)).toHaveClass(
    /bg-primary/,
  )
  await expect(page.getByText("Alice Split & Bob Split")).toBeVisible()
})

test("blocks a row with three quizzers", async ({ page }) => {
  // ...upload a CSV whose first row is "A & B & C"
  await expect(page.getByTestId(Labels.uploadValidationErrors)).toContainText(
    "found 3",
  )
  await expect(page.getByRole("button", { name: /submit/i })).toBeDisabled()
})
```

Fill the elided steps from the test at `frontend/tests/upload.spec.ts:507`
("selecting a format then submitting attaches the format and saves round scores") —
it already drives this wizard end to end for an individual quiz, from mode selection
through quiz details, CSV paste, column mapping and matching to a successful submit.
Copy its step sequence verbatim and add only the pairs-specific assertions above.
The distinctive player names keep the assertions unambiguous and make the rows easy
to identify.

- [ ] **Step 3: Run the spec**

```bash
cd frontend && bunx playwright test --config playwright.config.cts pairs-upload
```

Expected: 3 passed.

- [ ] **Step 4: Run the whole suite once**

```bash
cd frontend && bunx playwright test --config playwright.config.cts
```

Expected: no new failures against the pre-change baseline. If a pre-existing failure
is already known-flaky, say so explicitly rather than treating it as caused by this work.

- [ ] **Step 5: Commit**

```bash
git add frontend/tests/pairs-upload.spec.ts
git commit -m "test(frontend): end-to-end pairs upload"
```

---

## Done when

- [ ] A quiz can be created as Individual or Pairs, and the mode round-trips through the API.
- [ ] A pairs CSV uploads from one combined column and from two separate columns.
- [ ] A lone name in a pairs quiz records a solo result; three names or a repeated name blocks submission.
- [ ] Both members of a pair see the quiz in their history and gain a win and a podium from it.
- [ ] A pairs podium names both winners and credits both in the standings.
- [ ] Merging two people who were partners in one result is flagged before it happens and does not corrupt the result.
- [ ] `QuizResult.player_id` and `QuizResult.country` are gone; participants are the only source of membership.
- [ ] `cd backend && ../.venv/bin/python -m pytest tests/` passes.
- [ ] `cd frontend && bun run test:unit && bun run build` passes.
- [ ] `cd frontend && bunx playwright test --config playwright.config.cts` shows no new failures.
