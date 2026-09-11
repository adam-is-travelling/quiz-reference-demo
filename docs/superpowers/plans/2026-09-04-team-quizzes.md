# Team Quizzes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a quiz be contested by teams — national sides (with a country), international sides (no country) and clubs — recording which players turned out for each team, editable inline afterwards by admins, and credited on every one of those players' public pages.

**Architecture:** `teams` becomes a third `QuizParticipantMode`. A team has **no cross-quiz identity and no table**: `team_name`, `team_type` and `team_country` are nullable columns on `QuizResult`. The squad is the result's existing `quiz_result_player` rows, so a lineup is keyed by `quiz_result_id` and editing one quiz's England A cannot touch another's. A result with zero participants is a supported state — the "filled in later" case.

**Tech Stack:** FastAPI + SQLModel + Alembic + PostgreSQL 18 (backend); React + TanStack Router/Query + shadcn/ui + Tailwind v4 (frontend); pytest (backend tests), `bun test` (frontend unit), Playwright (E2E).

**Spec:** `docs/superpowers/specs/2026-09-04-team-quizzes-design.md`

## Global Constraints

- **Team identity is per quiz.** No `team` table, no standing roster, no cross-quiz matching. Never add one.
- **`international` is not a team type.** An international side is `team_type = national` with `team_country = NULL`. The label is derived at render time, never stored.
- **Zero participants is valid in `teams` mode only.** `individual` → exactly 1, `pairs` → 1 or 2, `teams` → 0 or more.
- **Team fields are exclusive to `teams` mode.** An `individual` or `pairs` result carrying any of the three team fields is a 422.
- **Country codes** must be members of `app.countries.VALID_COUNTRY_CODES` (ISO-3166 alpha-2, e.g. `GB`, `US`). `team_country` is optional for both types.
- **Backend commands run on the host, never in the container.** The backend container serves a stale baked image with no source mount. Run `uv run pytest ...` from `backend/`.
- **Tests must delete only rows they create.** No table-wide deletes — `backend/tests/test_cleanup_safety.py` enforces this, and the suite runs against the dev database.
- **Never run two Playwright suites at once**, and never run `docker compose down -v`.
- **Before an E2E run:** the mailcatcher compose service must be up, and the Docker `frontend` container must be stopped or it shadows port 5173 with a stale build.
- **Do not pipe Playwright through `| tail`** — it masks the exit code.
- **After any backend schema change**, regenerate the client with `bash ./scripts/generate-client.sh` from the repo root. It runs `uv run python` on the host, so no container rebuild is needed.

---

## File Structure

**Backend — modified**
- `backend/app/models.py` — `TeamType`, `teams` mode, three `QuizResult` columns, the partial unique index, `validate_team_fields`, team fields on the API models.
- `backend/app/crud.py` — `create_quiz_results` (team-aware upsert), `update_quiz_result`, the two player-history builders.
- `backend/app/api/routes/quizzes.py` — `submit_results` validation, `_results_public`, `read_quiz_results_with_players`, `update_quiz_result` route.
- `backend/app/podium.py` — team fields on finishers.

**Backend — created**
- `backend/app/alembic/versions/d5e6f7a8b9c0_add_team_fields_to_quizresult.py`
- `backend/tests/unit/test_team_fields.py`
- `backend/tests/api/routes/test_quiz_teams.py`
- `backend/tests/api/routes/test_player_team_history.py`

**Frontend — created**
- `frontend/src/lib/splitTeamNames.ts` — comma-aware splitting, kept separate so pairs behaviour is untouched.
- `frontend/src/lib/detectLineupLayout.ts` — combined vs numbered-columns auto-detect.
- `frontend/src/components/Quizzes/TeamLineupEditor.tsx` — the admin inline add/remove surface.
- `frontend/src/components/Upload/steps/TeamsPanel.tsx` — Step 4's "Teams in this file" panel.
- `frontend/tests/split-team-names.test.ts`, `frontend/tests/detect-lineup-layout.test.ts`, `frontend/tests/validate-upload-rows-teams.test.ts`, `frontend/tests/teams-upload.spec.ts`

**Frontend — modified**
- `frontend/src/lib/splitPairNames.ts` (`namesForRow` gains the teams branch), `frontend/src/lib/validateUploadRows.ts`, `frontend/src/lib/columnDetection.ts`
- `frontend/src/components/Upload/types.ts`, `steps/Step1QuizMeta.tsx`, `steps/Step3ColumnMapping.tsx`, `steps/Step4Disambiguation.tsx`, `steps/Step5Preview.tsx`
- `frontend/src/components/Quizzes/QuizResultsTable.tsx`, `frontend/src/routes/_public/quizzes_.$slug.tsx`, `frontend/src/components/Players/historyColumns.tsx`

---

### Task 1: Team columns, enum and migration

**Files:**
- Modify: `backend/app/models.py`
- Create: `backend/app/alembic/versions/d5e6f7a8b9c0_add_team_fields_to_quizresult.py`
- Test: `backend/tests/unit/test_team_fields.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `TeamType` (enum, members `national`/`club`); `QuizParticipantMode.teams`; `QuizResult.team_name: str | None`, `QuizResult.team_type: TeamType | None`, `QuizResult.team_country: str | None`; `TeamFieldsError(ValueError)`; `validate_team_fields(*, participant_mode: QuizParticipantMode, team_name: str | None, team_type: TeamType | None, team_country: str | None) -> None`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_team_fields.py`. This directory holds pure-validation tests with no database (see its own `conftest.py`).

```python
import pytest

from app.models import (
    QuizParticipantMode,
    TeamFieldsError,
    TeamType,
    validate_team_fields,
)


def _validate(**overrides: object) -> None:
    kwargs: dict[str, object] = {
        "participant_mode": QuizParticipantMode.teams,
        "team_name": "England A",
        "team_type": TeamType.national,
        "team_country": "GB",
    }
    kwargs.update(overrides)
    validate_team_fields(**kwargs)  # type: ignore[arg-type]


def test_national_team_with_country_is_valid() -> None:
    _validate()


def test_international_side_is_a_national_team_without_a_country() -> None:
    _validate(team_country=None)


def test_club_without_country_is_valid() -> None:
    _validate(team_type=TeamType.club, team_country=None)


def test_teams_mode_requires_a_team_name() -> None:
    with pytest.raises(TeamFieldsError, match="team_name"):
        _validate(team_name=None)


def test_teams_mode_rejects_a_blank_team_name() -> None:
    with pytest.raises(TeamFieldsError, match="team_name"):
        _validate(team_name="   ")


def test_teams_mode_requires_a_team_type() -> None:
    with pytest.raises(TeamFieldsError, match="team_type"):
        _validate(team_type=None)


def test_individual_quiz_rejects_team_fields() -> None:
    with pytest.raises(TeamFieldsError, match="teams quiz"):
        _validate(participant_mode=QuizParticipantMode.individual)


def test_pairs_quiz_rejects_team_fields() -> None:
    with pytest.raises(TeamFieldsError, match="teams quiz"):
        _validate(participant_mode=QuizParticipantMode.pairs)


def test_individual_quiz_accepts_all_team_fields_unset() -> None:
    validate_team_fields(
        participant_mode=QuizParticipantMode.individual,
        team_name=None,
        team_type=None,
        team_country=None,
    )


def test_invalid_country_code_is_rejected() -> None:
    with pytest.raises(ValueError, match="Invalid country code"):
        _validate(team_country="ZZ")
```

- [ ] **Step 2: Run test to verify it fails**

Run from `backend/`: `uv run pytest tests/unit/test_team_fields.py -v`
Expected: FAIL — `ImportError: cannot import name 'TeamFieldsError' from 'app.models'`

- [ ] **Step 3: Add the enum, the validator and the columns**

In `backend/app/models.py`, extend the SQLAlchemy import line that currently reads
`from sqlalchemy import JSON, Boolean, Column, DateTime, UniqueConstraint` to:

```python
from sqlalchemy import JSON, Boolean, Column, DateTime, Index, UniqueConstraint, text
```

Add `teams` to the existing enum:

```python
class QuizParticipantMode(str, enum.Enum):
    individual = "individual"
    pairs = "pairs"
    teams = "teams"
```

Add this block immediately above the `QuizResult` class in the QuizResult section:

```python
class TeamType(str, enum.Enum):
    national = "national"
    club = "club"


class TeamFieldsError(ValueError):
    """Raised when a result's team fields disagree with its quiz's mode.

    A subclass of ValueError so the route layer can map it to 422 alongside
    the plain ValueErrors raised by the country-code validators.
    """


def validate_team_fields(
    *,
    participant_mode: QuizParticipantMode,
    team_name: str | None,
    team_type: TeamType | None,
    team_country: str | None,
) -> None:
    """Validate the merged state of a result's team fields.

    Called on both the create and the edit path. On the edit path the caller
    merges the stored row with the patch first — a partial PATCH cannot be
    judged from the patch alone, the same way update_event handles events.

    A national team with no country is an international side; that is the
    only way to express one, so a null country is never an error.
    """
    if participant_mode == QuizParticipantMode.teams:
        if not (team_name or "").strip():
            raise TeamFieldsError("A team result requires a team_name")
        if team_type is None:
            raise TeamFieldsError("A team result requires a team_type")
    elif team_name is not None or team_type is not None or team_country is not None:
        raise TeamFieldsError(
            "Only a teams quiz may carry team_name, team_type or team_country"
        )
    _validate_country_code(team_country)
```

Then add the columns and index to `QuizResult`. Insert `__table_args__` as the first statement in the class body, and the three fields immediately after `final_rank`:

```python
class QuizResult(SQLModel, table=True):
    __table_args__ = (
        Index(
            "ix_quizresult_quiz_team_name",
            "quiz_id",
            text("lower(team_name)"),
            unique=True,
            postgresql_where=text("team_name IS NOT NULL"),
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    quiz_id: uuid.UUID = Field(foreign_key="quiz.id", ondelete="CASCADE")
    score: float
    final_rank: int | None = None
    team_name: str | None = Field(default=None, max_length=255)
    team_type: TeamType | None = Field(
        default=None,
        sa_column=Column(SAEnum(TeamType, name="teamtype"), nullable=True),
    )
    team_country: str | None = Field(default=None, max_length=3)
    round_1: float | None = None
    # ... round_2 through round_20 unchanged
```

- [ ] **Step 4: Run test to verify it passes**

Run from `backend/`: `uv run pytest tests/unit/test_team_fields.py -v`
Expected: PASS — 10 passed

- [ ] **Step 5: Write the migration**

Create `backend/app/alembic/versions/d5e6f7a8b9c0_add_team_fields_to_quizresult.py`. `c3d4e5f6a7b8` is the current head.

```python
"""add team fields to quizresult

Revision ID: d5e6f7a8b9c0
Revises: c3d4e5f6a7b8
"""

import sqlalchemy as sa
from alembic import op

revision = "d5e6f7a8b9c0"
down_revision = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Safe inside alembic's transaction on PostgreSQL 12+ because this
    # migration does not USE the new value in the same transaction.
    op.execute("ALTER TYPE quizparticipantmode ADD VALUE IF NOT EXISTS 'teams'")

    team_type = sa.Enum("national", "club", name="teamtype")
    team_type.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "quizresult", sa.Column("team_name", sa.String(length=255), nullable=True)
    )
    op.add_column("quizresult", sa.Column("team_type", team_type, nullable=True))
    op.add_column(
        "quizresult", sa.Column("team_country", sa.String(length=3), nullable=True)
    )

    # Teams need not be unique across quizzes, but two results in ONE quiz
    # naming the same team under different spellings is a data error.
    op.execute(
        "CREATE UNIQUE INDEX ix_quizresult_quiz_team_name "
        "ON quizresult (quiz_id, lower(team_name)) "
        "WHERE team_name IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_quizresult_quiz_team_name")
    op.drop_column("quizresult", "team_country")
    op.drop_column("quizresult", "team_type")
    op.drop_column("quizresult", "team_name")
    sa.Enum(name="teamtype").drop(op.get_bind(), checkfirst=True)
    # quizparticipantmode keeps 'teams'; removing an enum value requires
    # rewriting the type, and an unused value is harmless.
```

- [ ] **Step 6: Apply the migration and confirm the schema**

Run from `backend/`:
```bash
uv run alembic upgrade head
uv run python -c "
from sqlmodel import Session, text
from app.core.db import engine
with Session(engine) as s:
    print(s.exec(text(\"select column_name from information_schema.columns where table_name='quizresult' and column_name like 'team%' order by column_name\")).all())
    print(s.exec(text(\"select indexname from pg_indexes where tablename='quizresult' and indexname='ix_quizresult_quiz_team_name'\")).all())
"
```
Expected: `[('team_country',), ('team_name',), ('team_type',)]` then `[('ix_quizresult_quiz_team_name',)]`

- [ ] **Step 7: Verify the downgrade round-trips**

Run from `backend/`:
```bash
uv run alembic downgrade -1
uv run alembic upgrade head
```
Expected: both complete without error.

- [ ] **Step 8: Run the existing backend suite for regressions**

Run from `backend/`: `uv run pytest tests/ -q`
Expected: PASS — the same set that passed before this task.

- [ ] **Step 9: Commit**

```bash
git add backend/app/models.py backend/app/alembic/versions/d5e6f7a8b9c0_add_team_fields_to_quizresult.py backend/tests/unit/test_team_fields.py
git commit -m "feat(backend): add team fields to quiz results"
```

---

### Task 2: Team-aware result creation in crud

**Files:**
- Modify: `backend/app/models.py` (API models)
- Modify: `backend/app/crud.py:866-931` (`create_quiz_results`)
- Test: `backend/tests/crud/test_team_results.py` (create)

**Interfaces:**
- Consumes: `TeamType`, `validate_team_fields`, `QuizResult.team_*` from Task 1.
- Produces: `QuizResultCreate.team_name/team_type/team_country`, `QuizResultUpdate.team_name/team_type/team_country`, `ResolvedResultRow.team_name/team_type/team_country`, and `crud.create_quiz_results` upserting by team name in `teams` mode.

**Why the upsert changes.** `create_quiz_results` currently finds the row to overwrite by looking for an existing result sharing a participant. A team with an empty lineup has no participants, so that lookup finds nothing and a re-submit inserts a second row — which now violates `ix_quizresult_quiz_team_name` and, since `app/` has no `IntegrityError` handler, surfaces as a 500. In `teams` mode the identity of a row is its team name, so that is what the lookup must use.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/crud/test_team_results.py`:

```python
from collections.abc import Generator

import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, delete, select

from app import crud
from app.models import (
    Player,
    Quiz,
    QuizParticipantMode,
    QuizResult,
    QuizResultCreate,
    QuizResultPlayer,
    ResultParticipantCreate,
    TeamType,
)
from tests.utils.quiz import create_random_player, create_random_quiz


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


def _teams_quiz(db: Session) -> Quiz:
    quiz = create_random_quiz(db)
    quiz.participant_mode = QuizParticipantMode.teams
    db.add(quiz)
    db.commit()
    db.refresh(quiz)
    return quiz


def test_creates_a_team_result_with_no_participants(db: Session) -> None:
    quiz = _teams_quiz(db)
    [result] = crud.create_quiz_results(
        session=db,
        quiz_id=quiz.id,
        results=[
            QuizResultCreate(
                final_rank=1,
                score=100.0,
                participants=[],
                team_name="England A",
                team_type=TeamType.national,
                team_country="GB",
            )
        ],
    )
    assert result.team_name == "England A"
    assert result.team_type == TeamType.national
    assert result.team_country == "GB"
    rows = db.exec(
        select(QuizResultPlayer).where(QuizResultPlayer.quiz_result_id == result.id)
    ).all()
    assert rows == []


def test_creates_a_team_result_with_a_squad(db: Session) -> None:
    quiz = _teams_quiz(db)
    a, b, c = (create_random_player(db) for _ in range(3))
    [result] = crud.create_quiz_results(
        session=db,
        quiz_id=quiz.id,
        results=[
            QuizResultCreate(
                final_rank=1,
                score=100.0,
                participants=[
                    ResultParticipantCreate(player_id=p.id) for p in (a, b, c)
                ],
                team_name="Quiz Inn",
                team_type=TeamType.club,
                team_country=None,
            )
        ],
    )
    rows = db.exec(
        select(QuizResultPlayer)
        .where(QuizResultPlayer.quiz_result_id == result.id)
        .order_by(col(QuizResultPlayer.slot))
    ).all()
    assert [r.slot for r in rows] == [1, 2, 3]
    assert [r.player_id for r in rows] == [a.id, b.id, c.id]


def test_resubmitting_an_empty_team_updates_it_rather_than_duplicating(
    db: Session,
) -> None:
    quiz = _teams_quiz(db)
    payload = QuizResultCreate(
        final_rank=1,
        score=100.0,
        participants=[],
        team_name="England A",
        team_type=TeamType.national,
        team_country="GB",
    )
    crud.create_quiz_results(session=db, quiz_id=quiz.id, results=[payload])
    crud.create_quiz_results(
        session=db,
        quiz_id=quiz.id,
        results=[payload.model_copy(update={"score": 120.0})],
    )
    results = db.exec(select(QuizResult).where(QuizResult.quiz_id == quiz.id)).all()
    assert len(results) == 1
    assert results[0].score == 120.0


def test_team_name_match_is_case_insensitive(db: Session) -> None:
    quiz = _teams_quiz(db)
    crud.create_quiz_results(
        session=db,
        quiz_id=quiz.id,
        results=[
            QuizResultCreate(
                final_rank=1,
                score=100.0,
                participants=[],
                team_name="England A",
                team_type=TeamType.national,
                team_country="GB",
            )
        ],
    )
    crud.create_quiz_results(
        session=db,
        quiz_id=quiz.id,
        results=[
            QuizResultCreate(
                final_rank=1,
                score=90.0,
                participants=[],
                team_name="england a",
                team_type=TeamType.national,
                team_country="GB",
            )
        ],
    )
    results = db.exec(select(QuizResult).where(QuizResult.quiz_id == quiz.id)).all()
    assert len(results) == 1
    assert results[0].score == 90.0


def test_the_unique_index_rejects_a_duplicate_team_in_one_quiz(
    db: Session,
) -> None:
    """The crud upsert normally prevents this from ever being attempted, so
    the index is a backstop — exercise it directly rather than through the
    API, which would only ever see the upsert."""
    quiz = _teams_quiz(db)
    db.add(
        QuizResult(
            quiz_id=quiz.id,
            score=100.0,
            final_rank=1,
            team_name="England A",
            team_type=TeamType.national,
            team_country="GB",
        )
    )
    db.commit()
    db.add(
        QuizResult(
            quiz_id=quiz.id,
            score=90.0,
            final_rank=2,
            team_name="england a",
            team_type=TeamType.national,
            team_country="GB",
        )
    )
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_the_same_team_name_in_two_quizzes_is_two_results(db: Session) -> None:
    first, second = _teams_quiz(db), _teams_quiz(db)
    for quiz in (first, second):
        crud.create_quiz_results(
            session=db,
            quiz_id=quiz.id,
            results=[
                QuizResultCreate(
                    final_rank=1,
                    score=100.0,
                    participants=[],
                    team_name="England A",
                    team_type=TeamType.national,
                    team_country="GB",
                )
            ],
        )
    for quiz in (first, second):
        rows = db.exec(select(QuizResult).where(QuizResult.quiz_id == quiz.id)).all()
        assert len(rows) == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run from `backend/`: `uv run pytest tests/crud/test_team_results.py -v`
Expected: FAIL — `ValidationError: QuizResultCreate ... unexpected keyword argument 'team_name'`

- [ ] **Step 3: Add team fields to the API models**

In `backend/app/models.py`, replace the three payload models in the QuizResult section:

```python
class QuizResultCreate(SQLModel):
    final_rank: int
    score: float
    round_scores: list[float | None] | None = None
    participants: list[ResultParticipantCreate]
    team_name: str | None = Field(default=None, max_length=255)
    team_type: TeamType | None = None
    team_country: str | None = Field(default=None, max_length=3)


class QuizResultUpdate(SQLModel):
    final_rank: int | None = None
    score: float | None = None
    round_scores: list[float | None] | None = None
    participants: list[ResultParticipantCreate] | None = None
    team_name: str | None = Field(default=None, max_length=255)
    team_type: TeamType | None = None
    team_country: str | None = Field(default=None, max_length=3)
```

And in the upload section, `ResolvedResultRow`:

```python
class ResolvedResultRow(SQLModel):
    final_rank: int
    score: float | None = None
    round_scores: list[float | None] | None = None
    participants: list[ResultParticipant]
    team_name: str | None = Field(default=None, max_length=255)
    team_type: TeamType | None = None
    team_country: str | None = Field(default=None, max_length=3)
```

- [ ] **Step 4: Make `create_quiz_results` team-aware**

In `backend/app/crud.py`, replace the body of `create_quiz_results` down to `session.flush()  # results need ids ...` with:

```python
def create_quiz_results(
    *,
    session: Session,
    quiz_id: uuid.UUID,
    results: list[QuizResultCreate],
    commit: bool = True,
) -> list[QuizResult]:
    quiz = session.get(Quiz, quiz_id)
    is_teams = quiz is not None and quiz.participant_mode == QuizParticipantMode.teams

    db_results = []
    for r in results:
        if is_teams:
            # A team's identity in this quiz is its name — matched
            # case-insensitively, the same way ix_quizresult_quiz_team_name
            # does. Matching on participants (below) cannot work here: a team
            # submitted with an empty lineup has none, so every re-submit
            # would insert a second row and violate that index.
            existing = session.exec(
                select(QuizResult)
                .where(QuizResult.quiz_id == quiz_id)
                .where(
                    func.lower(col(QuizResult.team_name))
                    == (r.team_name or "").strip().lower()
                )
            ).first()
        else:
            existing_ids = {
                pr.quiz_result_id
                for pr in session.exec(
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
        if existing:
            existing.score = r.score
            existing.final_rank = r.final_rank
            existing.team_name = r.team_name
            existing.team_type = r.team_type
            existing.team_country = r.team_country
            if r.round_scores is not None:
                _apply_round_scores(existing, r.round_scores)
            session.add(existing)
            db_results.append(existing)
        else:
            result = QuizResult(
                quiz_id=quiz_id,
                score=r.score,
                final_rank=r.final_rank,
                team_name=r.team_name,
                team_type=r.team_type,
                team_country=r.team_country,
            )
            if r.round_scores is not None:
                _apply_round_scores(result, r.round_scores)
            session.add(result)
            db_results.append(result)
    session.flush()  # results need ids before participants can reference them
```

The remainder of the function (deleting and re-inserting `QuizResultPlayer` rows, the commit/flush, the refresh loop) is unchanged.

Confirm `Quiz`, `QuizParticipantMode` and `func` are already imported in `crud.py` — `func` is imported from `sqlmodel` at the top, and `Quiz` is used elsewhere in the file. Add `QuizParticipantMode` to the `from app.models import (...)` block if it is not already there.

- [ ] **Step 5: Run test to verify it passes**

Run from `backend/`: `uv run pytest tests/crud/test_team_results.py -v`
Expected: PASS — 6 passed

- [ ] **Step 6: Verify individual and pairs upsert behaviour is unchanged**

Run from `backend/`: `uv run pytest tests/crud/ tests/api/routes/test_quiz_pairs.py tests/api/routes/test_quizzes.py -q`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/app/models.py backend/app/crud.py backend/tests/crud/test_team_results.py
git commit -m "feat(backend): create team results, keyed by team name within a quiz"
```

---

### Task 3: Submit and edit routes accept teams

**Files:**
- Modify: `backend/app/api/routes/quizzes.py:308-455` (`submit_results`), `:476-529` (`update_quiz_result`)
- Modify: `backend/app/crud.py:1182-1211` (`update_quiz_result`)
- Test: `backend/tests/api/routes/test_quiz_teams.py`

**Interfaces:**
- Consumes: everything from Tasks 1 and 2.
- Produces: `POST /quizzes/{id}/results` and `PATCH /quizzes/{quiz_id}/results/{result_id}` accepting and validating team fields; helper `_max_participants(mode: QuizParticipantMode) -> int | None` in `quizzes.py` returning `None` for `teams` (unlimited).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/api/routes/test_quiz_teams.py`:

```python
from collections.abc import Generator
from typing import Any

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


def _teams_quiz(db: Session) -> Quiz:
    quiz = create_random_quiz(db)
    quiz.participant_mode = QuizParticipantMode.teams
    db.add(quiz)
    db.commit()
    db.refresh(quiz)
    return quiz


def _submit(
    client: TestClient, quiz: Quiz, headers: dict[str, str], rows: list[dict[str, Any]]
) -> Any:
    return client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=headers,
        json={"results": rows, "mode": "append"},
    )


def test_submit_team_with_squad(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    quiz = _teams_quiz(db)
    a, b = create_random_player(db), create_random_player(db)
    response = _submit(
        client,
        quiz,
        organizer_token_headers,
        [
            {
                "final_rank": 1,
                "score": 100,
                "team_name": "England A",
                "team_type": "national",
                "team_country": "GB",
                "participants": [{"player_id": str(a.id)}, {"player_id": str(b.id)}],
            }
        ],
    )
    assert response.status_code == 200, response.text
    [row] = response.json()["data"]
    assert row["team_name"] == "England A"
    assert row["team_type"] == "national"
    assert row["team_country"] == "GB"
    assert len(row["participants"]) == 2


def test_submit_team_with_no_squad_is_allowed(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    quiz = _teams_quiz(db)
    response = _submit(
        client,
        quiz,
        organizer_token_headers,
        [
            {
                "final_rank": 1,
                "score": 100,
                "team_name": "Rest of the World",
                "team_type": "national",
                "team_country": None,
                "participants": [],
            }
        ],
    )
    assert response.status_code == 200, response.text
    [row] = response.json()["data"]
    assert row["participants"] == []
    assert row["team_country"] is None


def test_submit_team_without_a_name_is_rejected(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    quiz = _teams_quiz(db)
    response = _submit(
        client,
        quiz,
        organizer_token_headers,
        [{"final_rank": 1, "score": 100, "team_type": "national", "participants": []}],
    )
    assert response.status_code == 422


def test_individual_quiz_rejects_team_fields(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    quiz = create_random_quiz(db)
    player = create_random_player(db)
    response = _submit(
        client,
        quiz,
        organizer_token_headers,
        [
            {
                "final_rank": 1,
                "score": 100,
                "team_name": "England A",
                "team_type": "national",
                "participants": [{"player_id": str(player.id)}],
            }
        ],
    )
    assert response.status_code == 422


def test_teams_quiz_rejects_a_result_with_no_team_name_but_players(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    quiz = _teams_quiz(db)
    player = create_random_player(db)
    response = _submit(
        client,
        quiz,
        organizer_token_headers,
        [
            {
                "final_rank": 1,
                "score": 100,
                "participants": [{"player_id": str(player.id)}],
            }
        ],
    )
    assert response.status_code == 422


def test_player_cannot_turn_out_for_two_teams_in_one_quiz(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    quiz = _teams_quiz(db)
    player = create_random_player(db)
    response = _submit(
        client,
        quiz,
        organizer_token_headers,
        [
            {
                "final_rank": 1,
                "score": 100,
                "team_name": "England A",
                "team_type": "national",
                "team_country": "GB",
                "participants": [{"player_id": str(player.id)}],
            },
            {
                "final_rank": 2,
                "score": 90,
                "team_name": "Scotland",
                "team_type": "national",
                "team_country": "GB",
                "participants": [{"player_id": str(player.id)}],
            },
        ],
    )
    assert response.status_code == 422


def test_superuser_adds_a_player_to_an_empty_lineup(
    client: TestClient,
    db: Session,
    organizer_token_headers: dict[str, str],
    superuser_token_headers: dict[str, str],
) -> None:
    quiz = _teams_quiz(db)
    _submit(
        client,
        quiz,
        organizer_token_headers,
        [
            {
                "final_rank": 1,
                "score": 100,
                "team_name": "England A",
                "team_type": "national",
                "team_country": "GB",
                "participants": [],
            }
        ],
    )
    result = db.exec(select(QuizResult).where(QuizResult.quiz_id == quiz.id)).one()
    player = create_random_player(db)
    response = client.patch(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/{result.id}",
        headers=superuser_token_headers,
        json={"participants": [{"player_id": str(player.id)}]},
    )
    assert response.status_code == 200, response.text
    assert [p["player_id"] for p in response.json()["participants"]] == [str(player.id)]


def test_superuser_removes_the_last_player_from_a_lineup(
    client: TestClient,
    db: Session,
    organizer_token_headers: dict[str, str],
    superuser_token_headers: dict[str, str],
) -> None:
    quiz = _teams_quiz(db)
    player = create_random_player(db)
    _submit(
        client,
        quiz,
        organizer_token_headers,
        [
            {
                "final_rank": 1,
                "score": 100,
                "team_name": "England A",
                "team_type": "national",
                "team_country": "GB",
                "participants": [{"player_id": str(player.id)}],
            }
        ],
    )
    result = db.exec(select(QuizResult).where(QuizResult.quiz_id == quiz.id)).one()
    response = client.patch(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/{result.id}",
        headers=superuser_token_headers,
        json={"participants": []},
    )
    assert response.status_code == 200, response.text
    assert response.json()["participants"] == []
    assert (
        db.exec(
            select(QuizResultPlayer).where(
                QuizResultPlayer.quiz_result_id == result.id
            )
        ).all()
        == []
    )


def test_patch_can_correct_the_team_country(
    client: TestClient,
    db: Session,
    organizer_token_headers: dict[str, str],
    superuser_token_headers: dict[str, str],
) -> None:
    quiz = _teams_quiz(db)
    _submit(
        client,
        quiz,
        organizer_token_headers,
        [
            {
                "final_rank": 1,
                "score": 100,
                "team_name": "England A",
                "team_type": "national",
                "team_country": "GB",
                "participants": [],
            }
        ],
    )
    result = db.exec(select(QuizResult).where(QuizResult.quiz_id == quiz.id)).one()
    response = client.patch(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/{result.id}",
        headers=superuser_token_headers,
        json={"team_country": None},
    )
    assert response.status_code == 200, response.text
    assert response.json()["team_country"] is None


def test_non_superuser_cannot_edit_a_lineup(
    client: TestClient,
    db: Session,
    organizer_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
) -> None:
    quiz = _teams_quiz(db)
    _submit(
        client,
        quiz,
        organizer_token_headers,
        [
            {
                "final_rank": 1,
                "score": 100,
                "team_name": "England A",
                "team_type": "national",
                "team_country": "GB",
                "participants": [],
            }
        ],
    )
    result = db.exec(select(QuizResult).where(QuizResult.quiz_id == quiz.id)).one()
    response = client.patch(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/{result.id}",
        headers=normal_user_token_headers,
        json={"participants": []},
    )
    assert response.status_code == 403
```

- [ ] **Step 2: Run test to verify it fails**

Run from `backend/`: `uv run pytest tests/api/routes/test_quiz_teams.py -v`
Expected: FAIL — the submit tests return 422 "at least one participant is required" and the response has no `team_name` key.

- [ ] **Step 3: Update `submit_results`**

In `backend/app/api/routes/quizzes.py`, add these imports to the `from app.models import (...)` block: `TeamFieldsError`, `TeamType`, `validate_team_fields`.

Add this helper directly below `_get_round_scores`:

```python
def _max_participants(mode: QuizParticipantMode) -> int | None:
    """Upper bound on a result's participants, or None for no bound.

    Teams have no bound and no lower bound either: a team recorded from an
    upload that listed no squad is a supported state, filled in later from
    the results page.
    """
    if mode == QuizParticipantMode.pairs:
        return 2
    if mode == QuizParticipantMode.teams:
        return None
    return 1
```

In `submit_results`, replace the participant-count block — the lines from `participants = row.participants` through the `if len(participants) > max_participants:` branch — with:

```python
        participants = row.participants
        try:
            validate_team_fields(
                participant_mode=quiz.participant_mode,
                team_name=row.team_name,
                team_type=row.team_type,
                team_country=row.team_country,
            )
        except ValueError as exc:
            errors.append(f"Row {i + 1}: {exc}")
        max_participants = _max_participants(quiz.participant_mode)
        if max_participants is None:
            pass  # teams: any number, including none
        elif not participants:
            errors.append(f"Row {i + 1}: at least one participant is required")
        elif len(participants) > max_participants:
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
```

Note the original `if not participants:` check that stood above the `max_participants` computation is folded into the chain above — delete it rather than leaving it in place, or teams rows will still be rejected.

Then, in the `creates.append(...)` block near the end of the function, add the three fields:

```python
        creates.append(
            QuizResultCreate(
                final_rank=row.final_rank,
                score=row.score,
                round_scores=row.round_scores,
                participants=participant_creates,
                team_name=row.team_name,
                team_type=row.team_type,
                team_country=row.team_country,
            )
        )
```

- [ ] **Step 4: Update the PATCH route**

In `update_quiz_result` in the same file, replace the participant-count guards inside `if result_in.participants is not None:` with:

```python
    if result_in.participants is not None:
        max_participants = _max_participants(quiz.participant_mode)
        player_ids = [p.player_id for p in result_in.participants]
        if max_participants is not None:
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

The `other_holders` guard below it is unchanged.

Immediately before the `crud.update_quiz_result(...)` call, validate the *merged* state — a partial PATCH cannot be judged from the patch alone:

```python
    patch = result_in.model_dump(exclude_unset=True)
    try:
        validate_team_fields(
            participant_mode=quiz.participant_mode,
            team_name=patch.get("team_name", db_result.team_name),
            team_type=patch.get("team_type", db_result.team_type),
            team_country=patch.get("team_country", db_result.team_country),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
```

`crud.update_quiz_result` needs no change: it already applies `model_dump(exclude_unset=True)` via `sqlmodel_update`, which now carries the three team fields.

- [ ] **Step 5: Run test to verify it passes**

Run from `backend/`: `uv run pytest tests/api/routes/test_quiz_teams.py -v`
Expected: FAIL on the three assertions reading `team_name` / `team_type` / `team_country` off the response — those fields land in Task 4. Every other test passes.

Confirm exactly that: 7 passed, 3 failed with `KeyError: 'team_name'`.

- [ ] **Step 6: Run the regression suite**

Run from `backend/`: `uv run pytest tests/ -q -k "not test_quiz_teams"`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/app/api/routes/quizzes.py backend/tests/api/routes/test_quiz_teams.py
git commit -m "feat(backend): accept team results on submit and edit"
```

---

### Task 4: Team fields on every read path

**Files:**
- Modify: `backend/app/models.py` (`QuizResultPublic`, `QuizResultWithPlayer`, `PlayerResultWithQuiz`, `PodiumFinisher`)
- Modify: `backend/app/api/routes/quizzes.py:55-78` (`_results_public`), `:248-279` (`read_quiz_results_with_players`)
- Modify: `backend/app/crud.py` (`get_player_history_grouped`, `get_player_competition_history`)
- Modify: `backend/app/podium.py:44-58`
- Test: `backend/tests/api/routes/test_quiz_teams.py` (completes Task 3's three failing tests), `backend/tests/api/routes/test_player_team_history.py`

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: `team_name: str | None`, `team_type: TeamType | None`, `team_country: str | None` on `QuizResultPublic`, `QuizResultWithPlayer`, `PlayerResultWithQuiz` and `PodiumFinisher`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/api/routes/test_player_team_history.py`:

```python
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete, select

from app.core.config import settings
from app.models import Player, Quiz, QuizParticipantMode, QuizStatus
from tests.utils.quiz import create_random_player, create_random_quiz


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


def _approved_teams_quiz(db: Session) -> Quiz:
    quiz = create_random_quiz(db)
    quiz.participant_mode = QuizParticipantMode.teams
    quiz.status = QuizStatus.approved
    db.add(quiz)
    db.commit()
    db.refresh(quiz)
    return quiz


def test_every_squad_member_gets_the_result_and_the_win(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    quiz = _approved_teams_quiz(db)
    squad = [create_random_player(db) for _ in range(3)]
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "final_rank": 1,
                    "score": 100,
                    "team_name": "England A",
                    "team_type": "national",
                    "team_country": "GB",
                    "participants": [{"player_id": str(p.id)} for p in squad],
                }
            ],
            "mode": "append",
        },
    )
    assert response.status_code == 200, response.text

    for player in squad:
        history = client.get(
            f"{settings.API_V1_STR}/players/{player.id}/history"
        ).json()
        assert history["total_quizzes"] == 1
        assert history["wins"] == 1
        assert history["podiums"] == 1
        [result] = history["data"][0]["results"]
        assert result["team_name"] == "England A"
        assert result["team_type"] == "national"
        assert result["team_country"] == "GB"
        # A squad is named by its team, not by listing every teammate.
        assert result["partners"] == []


def test_a_team_with_no_squad_credits_nobody_but_still_lists(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    quiz = _approved_teams_quiz(db)
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "final_rank": 1,
                    "score": 100,
                    "team_name": "Rest of the World",
                    "team_type": "national",
                    "team_country": None,
                    "participants": [],
                }
            ],
            "mode": "append",
        },
    )
    assert response.status_code == 200, response.text

    listed = client.get(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/with-players"
    ).json()
    assert listed["count"] == 1
    [row] = listed["data"]
    assert row["team_name"] == "Rest of the World"
    assert row["team_country"] is None
    assert row["participants"] == []
```

- [ ] **Step 2: Run test to verify it fails**

Run from `backend/`: `uv run pytest tests/api/routes/test_player_team_history.py -v`
Expected: FAIL — `KeyError: 'team_name'`

- [ ] **Step 3: Add the fields to the response models**

In `backend/app/models.py`, add these three lines to each of `QuizResultPublic`, `QuizResultWithPlayer`, `PlayerResultWithQuiz` and `PodiumFinisher`:

```python
    team_name: str | None = None
    team_type: TeamType | None = None
    team_country: str | None = None
```

`PodiumFinisher` and `PlayerResultWithQuiz` are declared above `TeamType` in the file today. Move the `TeamType` enum declaration up to sit immediately below `QuizParticipantMode` in the Quiz section so every later model can reference it, and confirm nothing else in the file forward-references it.

- [ ] **Step 4: Populate them in the quiz read paths**

In `backend/app/api/routes/quizzes.py`, add the three fields to the `QuizResultPublic(...)` construction inside `_results_public`:

```python
        QuizResultPublic(
            id=r.id,
            quiz_id=r.quiz_id,
            score=r.score,
            final_rank=r.final_rank,
            participants=by_result.get(r.id, []),
            team_name=r.team_name,
            team_type=r.team_type,
            team_country=r.team_country,
        )
```

and to the `QuizResultWithPlayer(...)` construction inside `read_quiz_results_with_players`:

```python
        QuizResultWithPlayer(
            id=r.id,
            quiz_id=r.quiz_id,
            score=r.score,
            final_rank=r.final_rank,
            round_scores=_get_round_scores(r, num_rounds),
            participants=by_result.get(r.id, []),
            team_name=r.team_name,
            team_type=r.team_type,
            team_country=r.team_country,
        )
```

Both routes already select `QuizResult` rows and neither joins through `QuizResultPlayer`, so a result with an empty lineup already lists correctly — `by_result.get(r.id, [])` yields `[]`.

- [ ] **Step 5: Populate them in player history**

In `backend/app/crud.py`, in `get_player_history_grouped`, replace the `PlayerResultWithQuiz(...)` construction with:

```python
            PlayerResultWithQuiz(
                result_id=result.id,
                quiz_id=quiz.id,
                quiz_name=quiz.name,
                quiz_slug=quiz.slug,
                start_date=quiz.start_date,
                end_date=quiz.end_date,
                score=result.score,
                final_rank=result.final_rank,
                country=countries.get(result.id),
                competition_id=quiz.competition_id,
                competition_name=competition.name if competition else None,
                # A team result is named by its team; listing a whole squad in
                # every history row would bloat the payload and read worse
                # than "for England A".
                partners=(
                    [] if result.team_name else partners.get(result.id, [])
                ),
                team_name=result.team_name,
                team_type=result.team_type,
                team_country=result.team_country,
            )
```

Apply the identical change to the `PlayerResultWithQuiz(...)` construction in `get_player_competition_history`.

Both queries inner-join `QuizResultPlayer`, so a result with an empty lineup never appears in either — which is exactly right, since it credits nobody.

- [ ] **Step 6: Populate them on the podium**

In `backend/app/podium.py`, add the fields to the `PodiumFinisher(...)` construction:

```python
                    PodiumFinisher(
                        place=result.final_rank,  # non-null: filtered to 1/2/3
                        score=result.score,
                        participants=participants_by_result.get(result.id, []),
                        team_name=result.team_name,
                        team_type=result.team_type,
                        team_country=result.team_country,
                    )
```

The standings tally already iterates `participants_by_result.get(result.id, [])`, so every squad member takes the medal and an empty lineup contributes nothing. No change needed there.

- [ ] **Step 7: Run both test files to verify they pass**

Run from `backend/`: `uv run pytest tests/api/routes/test_player_team_history.py tests/api/routes/test_quiz_teams.py -v`
Expected: PASS — 2 passed and 10 passed respectively.

- [ ] **Step 8: Run the whole backend suite**

Run from `backend/`: `uv run pytest tests/ -q`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add backend/app/models.py backend/app/api/routes/quizzes.py backend/app/crud.py backend/app/podium.py backend/tests/api/routes/test_player_team_history.py
git commit -m "feat(backend): surface team fields on results, history and podium"
```

---

### Task 5: Regenerate the API client

**Files:**
- Modify: `frontend/openapi.json`, `frontend/src/client/` (all generated)

**Interfaces:**
- Consumes: the backend models from Tasks 1–4.
- Produces: TypeScript types `TeamType` (`"national" | "club"`), `QuizParticipantMode` (now including `"teams"`), and `team_name` / `team_type` / `team_country` on `QuizResultPublic`, `QuizResultWithPlayer`, `PlayerResultWithQuiz`, `PodiumFinisher`, `QuizResultCreate`, `QuizResultUpdate` and `ResolvedResultRow`.

- [ ] **Step 1: Regenerate**

Run from the repo root: `bash ./scripts/generate-client.sh`

This runs `uv run python` on the host to export the schema — no container rebuild is needed, and the stale baked backend image is irrelevant here.

- [ ] **Step 2: Verify the new types landed**

Run from the repo root:
```bash
grep -n "TeamType" frontend/src/client/types.gen.ts | head
grep -n "team_name" frontend/src/client/types.gen.ts | head
```
Expected: a `TeamType` union of `"national" | "club"`, and `team_name` on several result types.

- [ ] **Step 3: Type-check**

Run from `frontend/`: `bun run build`
Expected: PASS — no type errors. (Nothing consumes the new fields yet, so this only proves the generated client is coherent.)

- [ ] **Step 4: Commit**

```bash
git add frontend/openapi.json frontend/src/client
git commit -m "chore(frontend): regenerate client for team result fields"
```

---

### Task 6: Comma-aware name splitting

**Files:**
- Create: `frontend/src/lib/splitTeamNames.ts`
- Modify: `frontend/src/lib/splitPairNames.ts` (`namesForRow` only)
- Modify: `frontend/src/components/Upload/types.ts` (`ColumnMapping`, `ParticipantMode`)
- Test: `frontend/tests/split-team-names.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `TEAM_SEPARATOR_PATTERN`, `HAS_TEAM_SEPARATOR`, `splitTeamNames(cell: string): string[]`; `ParticipantMode = "individual" | "pairs" | "teams"`; `ColumnMapping` gains `team_name: number | null`, `lineupLayout: "combined" | "numbered-columns"`, `lineup_combined: number | null`, `lineup_columns: number[]`; `namesForRow` accepts the widened mode.

**Why a separate file.** Adding comma to `PAIR_SEPARATOR_PATTERN` would silently change how existing pairs uploads parse "Alice, Bob". Teams get their own pattern; pairs behaviour is untouched.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/split-team-names.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { HAS_TEAM_SEPARATOR, splitTeamNames } from "@/lib/splitTeamNames"

describe("splitTeamNames", () => {
  test("splits on commas", () => {
    expect(splitTeamNames("Alice Smith, Bob Jones, Carol Ng")).toEqual([
      "Alice Smith",
      "Bob Jones",
      "Carol Ng",
    ])
  })

  test("splits on ampersands", () => {
    expect(splitTeamNames("Alice&Bob")).toEqual(["Alice", "Bob"])
  })

  test("splits on a standalone and", () => {
    expect(splitTeamNames("Alice and Bob")).toEqual(["Alice", "Bob"])
  })

  test("mixes separators", () => {
    expect(splitTeamNames("Alice, Bob and Carol & Dave")).toEqual([
      "Alice",
      "Bob",
      "Carol",
      "Dave",
    ])
  })

  test("keeps Alexander intact", () => {
    expect(splitTeamNames("Alexander Reid")).toEqual(["Alexander Reid"])
  })

  test("keeps Sandy intact", () => {
    expect(splitTeamNames("Sandy Duncan")).toEqual(["Sandy Duncan"])
  })

  test("collapses internal whitespace and trims", () => {
    expect(splitTeamNames("  Alice   Smith ,  Bob  ")).toEqual([
      "Alice Smith",
      "Bob",
    ])
  })

  test("drops empty segments", () => {
    expect(splitTeamNames("Alice,,Bob,")).toEqual(["Alice", "Bob"])
  })

  test("returns nothing for an empty cell", () => {
    expect(splitTeamNames("   ")).toEqual([])
  })
})

describe("HAS_TEAM_SEPARATOR", () => {
  test("detects a comma", () => {
    expect(HAS_TEAM_SEPARATOR.test("Alice, Bob")).toBe(true)
  })

  test("does not fire on Alexander", () => {
    expect(HAS_TEAM_SEPARATOR.test("Alexander Reid")).toBe(false)
  })

  test("is stateless across calls", () => {
    expect(HAS_TEAM_SEPARATOR.test("Alice, Bob")).toBe(true)
    expect(HAS_TEAM_SEPARATOR.test("Alice, Bob")).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run from `frontend/`: `bun run test:unit tests/split-team-names.test.ts`
Expected: FAIL — cannot resolve `@/lib/splitTeamNames`

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/splitTeamNames.ts`:

```ts
/**
 * Split a team's lineup cell into its individual quizzers.
 *
 * Separators are `&`, a standalone `and`, and `,`. The comma is what
 * separates this from the pairs splitter: adding it to
 * PAIR_SEPARATOR_PATTERN would silently change how existing pairs uploads
 * parse a cell, so teams get their own pattern instead.
 *
 * The whitespace requirement around `and` is what keeps "Alexander" and
 * "Sandy" intact — only a free-standing "and" separates two people.
 */
export const TEAM_SEPARATOR_PATTERN = /\s*&\s*|\s+and\s+|\s*,\s*/gi

/** Deliberately unflagged with `g`: a global regex's `.test()` is stateful. */
export const HAS_TEAM_SEPARATOR = /\s*&\s*|\s+and\s+|\s*,\s*/i

export function splitTeamNames(cell: string): string[] {
  return cell
    .split(TEAM_SEPARATOR_PATTERN)
    .map((name) => name.trim().replace(/\s+/g, " "))
    .filter((name) => name.length > 0)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run from `frontend/`: `bun run test:unit tests/split-team-names.test.ts`
Expected: PASS — 12 pass

- [ ] **Step 5: Widen the wizard types**

In `frontend/src/components/Upload/types.ts`, add the shared mode alias above `QuizMeta` and use it throughout:

```ts
export type ParticipantMode = "individual" | "pairs" | "teams"
```

Change `QuizMeta.participant_mode` and `WizardState.participantMode` to `ParticipantMode`, add `defaultTeamType` and `teamsByName` to `WizardState`, and extend `ColumnMapping`:

```ts
export type ColumnMapping = {
  player_name: number
  country: number | null
  score: number
  position: number | null
  rounds: (number | null)[]
  player_name_2: number | null
  pairsLayout: "combined" | "two-columns"
  team_name: number | null
  lineupLayout: "combined" | "numbered-columns"
  lineup_combined: number | null
  lineup_columns: number[]
}

/**
 * The type and country chosen for one team name in this file.
 *
 * `is_international` is wizard-only state and is never sent to the API — the
 * backend infers an international side from a national team with a null
 * country. It exists here because "no country chosen yet" and "deliberately
 * has no country" look identical in `team_country` alone, and the checkbox
 * has to know which one it is looking at.
 */
export type TeamDetails = {
  team_type: "national" | "club"
  team_country: string | null
  is_international: boolean
}
```

Add to `WizardState`:

```ts
  defaultTeamType: "national" | "club"
  teamsByName: Record<string, TeamDetails>
```

And to `INITIAL_STATE`, inside `columnMapping`:

```ts
    team_name: null,
    lineupLayout: "combined",
    lineup_combined: null,
    lineup_columns: [],
```

plus, at the top level of `INITIAL_STATE`:

```ts
  defaultTeamType: "national",
  teamsByName: {},
```

- [ ] **Step 6: Teach `namesForRow` about teams**

In `frontend/src/lib/splitPairNames.ts`, replace `namesForRow` with:

```ts
import { splitTeamNames } from "@/lib/splitTeamNames"

export function namesForRow(
  row: string[],
  mapping: {
    player_name: number
    player_name_2: number | null
    pairsLayout: "combined" | "two-columns"
    lineupLayout?: "combined" | "numbered-columns"
    lineup_combined?: number | null
    lineup_columns?: number[]
  },
  participantMode: "individual" | "pairs" | "teams",
): string[] {
  if (participantMode === "teams") {
    // The team's own name lives in its own column; these are the squad.
    // Either source may be unmapped — a team with no listed squad is a
    // supported upload, filled in later from the results page.
    if (mapping.lineupLayout === "numbered-columns") {
      return (mapping.lineup_columns ?? [])
        .map((i) => (row[i] ?? "").trim().replace(/\s+/g, " "))
        .filter((name) => name.length > 0)
    }
    const col = mapping.lineup_combined
    return col === null || col === undefined ? [] : splitTeamNames(row[col] ?? "")
  }
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

- [ ] **Step 7: Run the full unit suite and type-check**

Run from `frontend/`:
```bash
bun run test:unit
bun run build
```
Expected: PASS both. `split-pair-names.test.ts` must still pass unchanged — pairs parsing is untouched.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/splitTeamNames.ts frontend/src/lib/splitPairNames.ts frontend/src/components/Upload/types.ts frontend/tests/split-team-names.test.ts
git commit -m "feat(frontend): split team lineups on commas"
```

---

### Task 7: Lineup layout auto-detection

**Files:**
- Create: `frontend/src/lib/detectLineupLayout.ts`
- Modify: `frontend/src/lib/columnDetection.ts`
- Test: `frontend/tests/detect-lineup-layout.test.ts`

**Interfaces:**
- Consumes: `HAS_TEAM_SEPARATOR` from Task 6.
- Produces: `TEAM_HEADER_NAMES: string[]`; `detectNumberedColumns(header: string[], claimed: Set<number>): number[]`; `LineupLayoutDetection = { layout: "combined" | "numbered-columns"; lineup_combined: number | null; lineup_columns: number[] }`; `detectLineupLayout(rows: string[][], header: string[], claimed: Set<number>): LineupLayoutDetection`.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/detect-lineup-layout.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { detectLineupLayout, detectNumberedColumns } from "@/lib/detectLineupLayout"

describe("detectNumberedColumns", () => {
  test("finds numbered player headers in header order", () => {
    const header = ["Team", "Player 2", "Player 1", "Score"]
    expect(detectNumberedColumns(header, new Set())).toEqual([1, 2])
  })

  test("accepts member and name variants, with or without a space", () => {
    const header = ["Team", "Member1", "name 2", "Player3"]
    expect(detectNumberedColumns(header, new Set())).toEqual([1, 2, 3])
  })

  test("skips claimed columns", () => {
    const header = ["Player 1", "Player 2"]
    expect(detectNumberedColumns(header, new Set([0]))).toEqual([1])
  })

  test("ignores an unnumbered player header", () => {
    expect(detectNumberedColumns(["Player", "Team"], new Set())).toEqual([])
  })
})

describe("detectLineupLayout", () => {
  test("a majority of separator-bearing cells wins outright", () => {
    const rows = [
      ["Team", "Players", "Score"],
      ["England A", "Alice, Bob", "100"],
      ["Scotland", "Carol & Dave", "90"],
      ["Wales", "Erin", "80"],
    ]
    expect(detectLineupLayout(rows, rows[0], new Set([0]))).toEqual({
      layout: "combined",
      lineup_combined: 1,
      lineup_columns: [],
    })
  })

  test("falls back to numbered columns when no separators are present", () => {
    const rows = [
      ["Team", "Player 1", "Player 2", "Score"],
      ["England A", "Alice", "Bob", "100"],
      ["Scotland", "Carol", "Dave", "90"],
    ]
    expect(detectLineupLayout(rows, rows[0], new Set([0]))).toEqual({
      layout: "numbered-columns",
      lineup_combined: null,
      lineup_columns: [1, 2],
    })
  })

  test("a single numbered column is not enough to choose that layout", () => {
    const rows = [
      ["Team", "Player 1", "Score"],
      ["England A", "Alice", "100"],
    ]
    expect(detectLineupLayout(rows, rows[0], new Set([0]))).toEqual({
      layout: "combined",
      lineup_combined: null,
      lineup_columns: [],
    })
  })

  test("defaults to combined with the detected name column", () => {
    const rows = [
      ["Team", "Players", "Score"],
      ["England A", "Alice", "100"],
      ["Scotland", "Bob", "90"],
    ]
    expect(detectLineupLayout(rows, rows[0], new Set([0]))).toEqual({
      layout: "combined",
      lineup_combined: 1,
      lineup_columns: [],
    })
  })

  test("returns an unmapped combined column when there is no lineup column", () => {
    const rows = [
      ["Team", "Score"],
      ["England A", "100"],
    ]
    expect(detectLineupLayout(rows, rows[0], new Set([0]))).toEqual({
      layout: "combined",
      lineup_combined: null,
      lineup_columns: [],
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run from `frontend/`: `bun run test:unit tests/detect-lineup-layout.test.ts`
Expected: FAIL — cannot resolve `@/lib/detectLineupLayout`

- [ ] **Step 3: Add the team header names**

In `frontend/src/lib/columnDetection.ts`, add below `PARTNER_HEADER_NAMES`:

```ts
export const TEAM_HEADER_NAMES = ["team", "team name", "squad", "nation"]
export const LINEUP_HEADER_NAMES = ["players", "player", "name", "squad members"]
```

- [ ] **Step 4: Write the implementation**

Create `frontend/src/lib/detectLineupLayout.ts`:

```ts
import { detectColumn, LINEUP_HEADER_NAMES } from "@/lib/columnDetection"
import { HAS_TEAM_SEPARATOR } from "@/lib/splitTeamNames"

export interface LineupLayoutDetection {
  layout: "combined" | "numbered-columns"
  lineup_combined: number | null
  lineup_columns: number[]
}

const SEPARATOR_SHARE_THRESHOLD = 0.5
const NUMBERED_LINEUP_HEADER = /^(player|member|name)\s*\d+$/

/**
 * Every unclaimed header of the form "Player 1", "Member2", "name 3",
 * in header order — which is the order the squad is recorded in.
 */
export function detectNumberedColumns(
  header: string[],
  claimed: Set<number>,
): number[] {
  return header
    .map((h, i) => [h.trim().toLowerCase(), i] as const)
    .filter(([h, i]) => !claimed.has(i) && NUMBERED_LINEUP_HEADER.test(h))
    .map(([, i]) => i)
}

/**
 * Guess whether a teams CSV holds its squads in one cell or across
 * numbered columns.
 *
 * A majority of separator-bearing cells in the candidate lineup column is
 * the strongest signal, so it wins outright. Failing that, two or more
 * numbered headers mean a column-per-member layout. Otherwise assume
 * combined: an empty squad is a legitimate upload, and the Lineup preview
 * column makes a wrong guess visible before submit.
 */
export function detectLineupLayout(
  rows: string[][],
  header: string[],
  claimed: Set<number>,
): LineupLayoutDetection {
  const combined = detectColumn(header, LINEUP_HEADER_NAMES, claimed)

  if (combined !== null) {
    const cells = rows
      .slice(1)
      .map((row) => row[combined] ?? "")
      .filter((cell) => cell.trim().length > 0)
    const withSeparator = cells.filter((cell) =>
      HAS_TEAM_SEPARATOR.test(cell),
    ).length
    if (
      cells.length > 0 &&
      withSeparator / cells.length >= SEPARATOR_SHARE_THRESHOLD
    ) {
      return { layout: "combined", lineup_combined: combined, lineup_columns: [] }
    }
  }

  const numbered = detectNumberedColumns(header, claimed)
  if (numbered.length >= 2) {
    return {
      layout: "numbered-columns",
      lineup_combined: null,
      lineup_columns: numbered,
    }
  }

  return { layout: "combined", lineup_combined: combined, lineup_columns: [] }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run from `frontend/`: `bun run test:unit tests/detect-lineup-layout.test.ts`
Expected: PASS — 9 pass

Note the "falls back to numbered columns" case: `LINEUP_HEADER_NAMES` includes `"player"` as a substring candidate, so `detectColumn` may match "Player 1" at index 1. The separator share is then 0 (no commas in "Alice"), so detection falls through to the numbered branch, which returns `[1, 2]`. That is the intended outcome; if the test fails here with `lineup_combined: 1`, the separator-share guard is being skipped — check that `cells.length > 0` is evaluated before the ratio.

- [ ] **Step 6: Run the full unit suite**

Run from `frontend/`: `bun run test:unit`
Expected: PASS — `column-detection.test.ts` and `detect-pairs-layout.test.ts` unaffected.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/detectLineupLayout.ts frontend/src/lib/columnDetection.ts frontend/tests/detect-lineup-layout.test.ts
git commit -m "feat(frontend): auto-detect team lineup layout"
```

---

### Task 8: Row validation for team uploads

**Files:**
- Modify: `frontend/src/lib/validateUploadRows.ts`
- Test: `frontend/tests/validate-upload-rows-teams.test.ts`

**Interfaces:**
- Consumes: `ColumnMapping`, `ParticipantMode` (Task 6).
- Produces: `validateUploadRows(parsedRows, columnMapping, resolutions, participantMode: ParticipantMode): RowError[]` handling the teams branch.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/validate-upload-rows-teams.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import type { ColumnMapping } from "@/components/Upload/types"
import type { RowResolution } from "@/lib/matchPlayers"
import { validateUploadRows } from "@/lib/validateUploadRows"

const mapping: ColumnMapping = {
  player_name: 0,
  country: null,
  score: 2,
  position: null,
  rounds: [],
  player_name_2: null,
  pairsLayout: "combined",
  team_name: 0,
  lineupLayout: "combined",
  lineup_combined: 1,
  lineup_columns: [],
}

function resolutions(count: number): RowResolution[] {
  return Array.from({ length: count }, () => ({ participants: [] }))
}

describe("validateUploadRows in teams mode", () => {
  test("accepts a team with a squad", () => {
    const rows = [
      ["Team", "Players", "Score"],
      ["England A", "Alice, Bob", "100"],
    ]
    expect(validateUploadRows(rows, mapping, resolutions(1), "teams")).toEqual([])
  })

  test("accepts a team with no squad", () => {
    const rows = [
      ["Team", "Players", "Score"],
      ["England A", "", "100"],
    ]
    expect(validateUploadRows(rows, mapping, resolutions(1), "teams")).toEqual([])
  })

  test("rejects a blank team name", () => {
    const rows = [
      ["Team", "Players", "Score"],
      ["  ", "Alice", "100"],
    ]
    const errors = validateUploadRows(rows, mapping, resolutions(1), "teams")
    expect(errors).toEqual([{ row: 1, message: "Team name is missing" }])
  })

  test("rejects the same team appearing twice", () => {
    const rows = [
      ["Team", "Players", "Score"],
      ["England A", "Alice", "100"],
      ["england a", "Bob", "90"],
    ]
    const errors = validateUploadRows(rows, mapping, resolutions(2), "teams")
    expect(errors).toEqual([
      { row: 2, message: 'Team "england a" already appears in row 1' },
    ])
  })

  test("rejects the same player in two teams", () => {
    const rows = [
      ["Team", "Players", "Score"],
      ["England A", "Alice", "100"],
      ["Scotland", "alice", "90"],
    ]
    const errors = validateUploadRows(rows, mapping, resolutions(2), "teams")
    expect(errors).toEqual([
      { row: 2, message: '"alice" already appears in row 1' },
    ])
  })

  test("rejects the same player twice within one team", () => {
    const rows = [
      ["Team", "Players", "Score"],
      ["England A", "Alice, Alice", "100"],
    ]
    const errors = validateUploadRows(rows, mapping, resolutions(1), "teams")
    expect(errors).toEqual([
      { row: 1, message: "The same quizzer appears twice in this row" },
    ])
  })

  test("still reports a missing score", () => {
    const rows = [
      ["Team", "Players", "Score"],
      ["England A", "Alice", ""],
    ]
    const errors = validateUploadRows(rows, mapping, resolutions(1), "teams")
    expect(errors).toEqual([{ row: 1, message: "Score is missing" }])
  })

  test("reads numbered lineup columns", () => {
    const numbered: ColumnMapping = {
      ...mapping,
      lineupLayout: "numbered-columns",
      lineup_combined: null,
      lineup_columns: [1, 3],
      score: 2,
    }
    const rows = [
      ["Team", "Player 1", "Score", "Player 2"],
      ["England A", "Alice", "100", "Alice"],
    ]
    const errors = validateUploadRows(rows, numbered, resolutions(1), "teams")
    expect(errors).toEqual([
      { row: 1, message: "The same quizzer appears twice in this row" },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run from `frontend/`: `bun run test:unit tests/validate-upload-rows-teams.test.ts`
Expected: FAIL — "accepts a team with no squad" reports `Player name is missing`, and no team errors are produced.

- [ ] **Step 3: Write the implementation**

Replace `frontend/src/lib/validateUploadRows.ts` with:

```ts
import type { ColumnMapping, ParticipantMode } from "@/components/Upload/types"
import type { RowResolution } from "@/lib/matchPlayers"
import { namesForRow } from "@/lib/splitPairNames"

export interface RowError {
  row: number
  message: string
}

export function validateUploadRows(
  parsedRows: string[][],
  columnMapping: ColumnMapping,
  resolutions: RowResolution[],
  participantMode: ParticipantMode,
): RowError[] {
  const errors: RowError[] = []
  // Teams only: a team, and a player, may each appear once in the file.
  const seenTeams = new Map<string, number>()
  const seenPlayers = new Map<string, number>()

  resolutions.forEach((resolution, i) => {
    const row = parsedRows[i + 1]
    if (!row) return

    const displayNumber = i + 1
    const names = namesForRow(row, columnMapping, participantMode)
    const created = resolution.participants
      .map((p) => p.player_create?.display_name)
      .filter((n): n is string => Boolean(n))
    const effective = names.length > 0 ? names : created

    if (participantMode === "teams") {
      const teamCell =
        columnMapping.team_name !== null
          ? (row[columnMapping.team_name] ?? "").trim()
          : ""
      if (!teamCell) {
        errors.push({ row: displayNumber, message: "Team name is missing" })
      } else {
        const key = teamCell.toLowerCase()
        const first = seenTeams.get(key)
        if (first === undefined) {
          seenTeams.set(key, displayNumber)
        } else {
          errors.push({
            row: displayNumber,
            message: `Team "${teamCell}" already appears in row ${first}`,
          })
        }
      }

      const lowered = effective.map((n) => n.toLowerCase())
      if (new Set(lowered).size !== lowered.length) {
        errors.push({
          row: displayNumber,
          message: "The same quizzer appears twice in this row",
        })
      } else {
        // Only look across rows once this row is internally consistent, so a
        // doubled name doesn't produce two errors saying the same thing.
        for (const name of effective) {
          const key = name.toLowerCase()
          const first = seenPlayers.get(key)
          if (first === undefined) {
            seenPlayers.set(key, displayNumber)
          } else {
            errors.push({
              row: displayNumber,
              message: `"${name}" already appears in row ${first}`,
            })
          }
        }
      }
      // An empty squad is deliberate: the lineup is filled in later from
      // the results page. No error here.
    } else if (effective.length === 0) {
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

    const rawScore = row[columnMapping.score]
    if (!rawScore?.trim()) {
      errors.push({ row: displayNumber, message: "Score is missing" })
    } else if (Number.isNaN(parseFloat(rawScore))) {
      errors.push({
        row: displayNumber,
        message: `Score "${rawScore}" is not a number`,
      })
    }

    columnMapping.rounds.forEach((colIdx, roundIdx) => {
      if (colIdx === null) return
      const raw = row[colIdx]
      if (raw?.trim() && Number.isNaN(parseFloat(raw))) {
        errors.push({
          row: displayNumber,
          message: `Round ${roundIdx + 1} score "${raw}" is not a number`,
        })
      }
    })
  })

  return errors
}
```

- [ ] **Step 4: Run test to verify it passes**

Run from `frontend/`: `bun run test:unit tests/validate-upload-rows-teams.test.ts`
Expected: PASS — 8 pass

- [ ] **Step 5: Verify individual and pairs validation is unchanged**

Run from `frontend/`: `bun run test:unit && bun run build`
Expected: PASS — `validate-upload-rows.test.ts` passes untouched.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/validateUploadRows.ts frontend/tests/validate-upload-rows-teams.test.ts
git commit -m "feat(frontend): validate team upload rows"
```

---

### Task 9: Wizard Step 1 — teams mode and default team type

**Files:**
- Modify: `frontend/src/components/Upload/steps/Step1QuizMeta.tsx`, `frontend/src/test-ids.ts`

**Interfaces:**
- Consumes: `ParticipantMode`, `WizardState.defaultTeamType` (Task 6).
- Produces: Step 1 emitting `participantMode: "teams"` and `defaultTeamType` into wizard state, `participant_mode: "teams"` on quiz create, and the test ids `Labels.uploadParticipantModeTeams`, `Labels.uploadDefaultTeamTypeNational`, `Labels.uploadDefaultTeamTypeClub`.

- [ ] **Step 1: Read the current control**

Run from the repo root: `sed -n 240,270p frontend/src/components/Upload/steps/Step1QuizMeta.tsx`

This is the existing Individual/Pairs toggle, rendered by mapping over a mode list and comparing against `participantMode`. Note the exact class names and structure — the Teams button must match them.

- [ ] **Step 2: Add Teams to the mode toggle**

In `Step1QuizMeta.tsx`, widen the `useState` at line 143:

```tsx
  const [participantMode, setParticipantMode] = useState<
    "individual" | "pairs" | "teams"
  >(state.participantMode)
  const [defaultTeamType, setDefaultTeamType] = useState<"national" | "club">(
    state.defaultTeamType,
  )
```

Add `"teams"` to the array the toggle maps over — the existing `(["individual", "pairs"] as const)` becomes `(["individual", "pairs", "teams"] as const)`.

Widen the `existingParticipantMode` helper's parameter at line 70 to
`import("@/client").QuizParticipantMode | undefined` (already correct — the regenerated client now includes `"teams"`), and change its `?? "individual"` fallback site at line 212 to keep working unchanged.

- [ ] **Step 3: Register the test ids**

The Playwright specs address wizard controls through `Labels`, never by visible text. Add to `frontend/src/test-ids.ts`, beside the existing `uploadParticipantMode*` entries:

```ts
  uploadParticipantModeTeams: "upload-participant-mode-teams",
  uploadDefaultTeamTypeNational: "upload-default-team-type-national",
  uploadDefaultTeamTypeClub: "upload-default-team-type-club",
```

The existing mode toggle already sets `data-testid` per mode — confirm how it derives the id from the mode string (read the button in the map) and make sure `"teams"` produces `upload-participant-mode-teams`.

- [ ] **Step 4: Add the default team type control**

Immediately below the mode toggle, add:

```tsx
      {participantMode === "teams" && (
        <div className="space-y-2">
          <Label>Teams in this file are</Label>
          <div className="flex gap-2">
            {(["national", "club"] as const).map((type) => (
              <Button
                key={type}
                type="button"
                data-testid={
                  type === "national"
                    ? Labels.uploadDefaultTeamTypeNational
                    : Labels.uploadDefaultTeamTypeClub
                }
                variant={defaultTeamType === type ? "default" : "outline"}
                size="sm"
                onClick={() => setDefaultTeamType(type)}
              >
                {type === "national" ? "National" : "Club"}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            A starting point for each team in this file. You can change any
            team individually, and mark a national side as international, in
            the next steps.
          </p>
        </div>
      )}
```

Match the `Button` and `Label` imports already present in the file; add them to the existing import statements if either is missing.

- [ ] **Step 5: Carry both values into wizard state**

In the submit handler around lines 172-178, add `defaultTeamType` alongside the existing `participantMode`:

```tsx
      participant_mode: participantMode,
      ...
      participantMode,
      defaultTeamType,
```

- [ ] **Step 6: Type-check and lint**

Run from `frontend/`:
```bash
bun run build
bun run lint
```
Expected: PASS

- [ ] **Step 7: Verify by hand**

Start the dev server (`bun run dev` from `frontend/`, with the backend stack up), open `/upload`, choose "New quiz", and confirm: three mode buttons; choosing Teams reveals the National/Club control; choosing Individual or Pairs hides it.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/Upload/steps/Step1QuizMeta.tsx frontend/src/test-ids.ts
git commit -m "feat(frontend): offer teams mode in the upload wizard"
```

---

### Task 10: Wizard Step 3 — team and lineup column mapping

**Files:**
- Modify: `frontend/src/components/Upload/steps/Step3ColumnMapping.tsx`, `frontend/src/lib/columnDetection.ts`, `frontend/src/test-ids.ts`

**Interfaces:**
- Consumes: `detectLineupLayout`, `detectNumberedColumns`, `TEAM_HEADER_NAMES` (Task 7); `namesForRow` teams branch (Task 6).
- Produces: a `ColumnMapping` with `team_name`, `lineupLayout`, `lineup_combined` and `lineup_columns` populated; a preview showing Team and Lineup columns; and the test ids `Labels.lineupLayoutCombined` (`"lineup-layout-combined"`) and `Labels.lineupLayoutNumbered` (`"lineup-layout-numbered"`), added to `frontend/src/test-ids.ts` beside the existing `pairsLayout*` entries.

- [ ] **Step 1: Read the current auto-detect block**

Run from the repo root: `sed -n 90,150p frontend/src/components/Upload/steps/Step3ColumnMapping.tsx`

This is the `useMemo` that builds the initial mapping, claiming columns as it detects them. The teams branch slots in alongside the existing pairs branch.

- [ ] **Step 2: Detect the team and lineup columns**

Inside that memo, after the core detection and before the `return`, add:

```tsx
    let team_name = existing.team_name
    let lineupLayout = existing.lineupLayout
    let lineup_combined = existing.lineup_combined
    let lineup_columns = existing.lineup_columns
    if (
      state.participantMode === "teams" &&
      existing.team_name === null &&
      existing.lineup_combined === null &&
      existing.lineup_columns.length === 0
    ) {
      team_name = detectColumn(header, TEAM_HEADER_NAMES, claimed)
      if (team_name !== null) claimed.add(team_name)
      const detection = detectLineupLayout(state.parsedRows, header, claimed)
      lineupLayout = detection.layout
      lineup_combined = detection.lineup_combined
      lineup_columns = detection.lineup_columns
      if (lineup_combined !== null) claimed.add(lineup_combined)
      for (const idx of lineup_columns) claimed.add(idx)
    }
```

and extend the return:

```tsx
    return {
      ...core,
      country,
      position,
      rounds,
      pairsLayout,
      player_name_2,
      team_name,
      lineupLayout,
      lineup_combined,
      lineup_columns,
    }
```

Add `TEAM_HEADER_NAMES` to the existing `@/lib/columnDetection` import and `detectLineupLayout` from `@/lib/detectLineupLayout`.

The country column must be optional in teams mode too. `resolveCountryColumn` in `frontend/src/lib/columnDetection.ts` currently special-cases `"pairs"`; change its last line to:

```ts
  return participantMode === "individual" ? defaultIndex : null
```

and widen its `participantMode` parameter to `"individual" | "pairs" | "teams"`. Behaviour for individual and pairs is identical to before.

- [ ] **Step 3: Render the team and lineup controls**

Beside the existing `state.participantMode === "pairs"` blocks, add a teams block:

```tsx
      {state.participantMode === "teams" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Team column</Label>
            <Select
              value={mapping.team_name !== null ? String(mapping.team_name) : "__none__"}
              onValueChange={(v) =>
                setMapping((m) => ({
                  ...m,
                  team_name: v === "__none__" ? null : Number(v),
                }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Not mapped" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Not mapped</SelectItem>
                {header.map((h, i) => (
                  <SelectItem key={`team-${i}`} value={String(i)}>
                    {h || `Column ${i + 1}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Squad layout</Label>
            <div className="flex gap-2">
              {(
                [
                  ["combined", "One column, names separated"],
                  ["numbered-columns", "One column per member"],
                ] as const
              ).map(([layout, label]) => (
                <Button
                  key={layout}
                  type="button"
                  size="sm"
                  data-testid={
                    layout === "combined"
                      ? Labels.lineupLayoutCombined
                      : Labels.lineupLayoutNumbered
                  }
                  variant={mapping.lineupLayout === layout ? "default" : "outline"}
                  onClick={() =>
                    setMapping((m) => ({ ...m, lineupLayout: layout }))
                  }
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          {mapping.lineupLayout === "combined" ? (
            <div className="space-y-2">
              <Label>Squad column</Label>
              <Select
                value={
                  mapping.lineup_combined !== null
                    ? String(mapping.lineup_combined)
                    : "__none__"
                }
                onValueChange={(v) =>
                  setMapping((m) => ({
                    ...m,
                    lineup_combined: v === "__none__" ? null : Number(v),
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Not mapped" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Not mapped</SelectItem>
                  {header.map((h, i) => (
                    <SelectItem key={`lineup-${i}`} value={String(i)}>
                      {h || `Column ${i + 1}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Leave unmapped to record the teams without their squads — you
                can add players from the results page afterwards.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Squad columns</Label>
              <div className="flex flex-wrap gap-2">
                {header.map((h, i) => (
                  <Button
                    key={`lineup-col-${i}`}
                    type="button"
                    size="sm"
                    variant={
                      mapping.lineup_columns.includes(i) ? "default" : "outline"
                    }
                    onClick={() =>
                      setMapping((m) => ({
                        ...m,
                        lineup_columns: m.lineup_columns.includes(i)
                          ? m.lineup_columns.filter((c) => c !== i)
                          : [...m.lineup_columns, i].sort((a, b) => a - b),
                      }))
                    }
                  >
                    {h || `Column ${i + 1}`}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 4: Add Team and Lineup preview columns**

In the preview table around lines 395-430, the header cells currently branch on `state.participantMode === "pairs"`. Add a teams branch that renders a **Team** header before the name header and a **Lineup** header after it, and in the body:

```tsx
                  {state.participantMode === "teams" && (
                    <TableCell>
                      {mapping.team_name !== null
                        ? (row[mapping.team_name] ?? "")
                        : "—"}
                    </TableCell>
                  )}
```

and, for the lineup cell, reuse the same `names` value the existing preview already computes via `namesForRow(row, mapping, state.participantMode)`:

```tsx
                  {state.participantMode === "teams" && (
                    <TableCell className="text-muted-foreground">
                      {names.length > 0 ? names.join(", ") : "—"}
                    </TableCell>
                  )}
```

An all-`—` Lineup column across every row is the visible signal that the squad column is unmapped or the layout was mis-detected.

- [ ] **Step 5: Type-check and lint**

Run from `frontend/`:
```bash
bun run build
bun run lint
```
Expected: PASS

- [ ] **Step 6: Verify by hand**

With the dev server running, upload this CSV in teams mode and confirm the mapping auto-detects Team → column 1, layout → combined, squad → column 2, and that the preview's Lineup column reads "Alice Smith, Bob Jones":

```csv
Team,Players,Score
England A,"Alice Smith, Bob Jones",100
Scotland,"Carol Ng & Dave Roy",90
```

Then upload this one and confirm the layout auto-detects as one column per member with columns 2 and 3 selected:

```csv
Team,Player 1,Player 2,Score
England A,Alice Smith,Bob Jones,100
Scotland,Carol Ng,Dave Roy,90
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/Upload/steps/Step3ColumnMapping.tsx frontend/src/lib/columnDetection.ts frontend/src/test-ids.ts
git commit -m "feat(frontend): map team and squad columns in the upload wizard"
```

---

### Task 11: Wizard Step 4 — the teams panel

**Files:**
- Create: `frontend/src/components/Upload/steps/TeamsPanel.tsx`
- Modify: `frontend/src/components/ui/CountrySelect.tsx`, `frontend/src/components/Upload/steps/Step4Disambiguation.tsx`

**Interfaces:**
- Consumes: `TeamDetails`, `WizardState.teamsByName`, `WizardState.defaultTeamType` (Task 6).
- Produces: `<TeamsPanel teamNames={string[]} value={Record<string, TeamDetails>} defaultTeamType={"national" | "club"} onChange={(next: Record<string, TeamDetails>) => void} />`, and Step 4 seeding `teamsByName` for every distinct team name in the file.

- [ ] **Step 1: Give `CountrySelect` a `disabled` prop**

The country picker used by Step 4 and the event dialog is `frontend/src/components/ui/CountrySelect.tsx` — a native `<select>` with props `{ value, onChange, className }`. It needs to grey out for an international side. Add the prop:

```tsx
interface CountrySelectProps {
  value: string | null | undefined
  onChange: (code: string | null) => void
  className?: string
  disabled?: boolean
}

export function CountrySelect({
  value,
  onChange,
  className,
  disabled,
}: CountrySelectProps) {
  return (
    <select
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
      className={...}   // unchanged
    >
```

The existing `className` default already carries `disabled:cursor-not-allowed disabled:opacity-50`, so no styling change is needed. Both existing call sites omit the prop and are unaffected.

- [ ] **Step 2: Write the panel**

Create `frontend/src/components/Upload/steps/TeamsPanel.tsx`:

```tsx
import type { TeamDetails } from "@/components/Upload/types"
import { Checkbox } from "@/components/ui/checkbox"
import { CountrySelect } from "@/components/ui/CountrySelect"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/**
 * Seed one TeamDetails per distinct team name, preserving any the admin has
 * already edited.
 */
export function defaultTeamDetails(
  teamNames: string[],
  defaultTeamType: "national" | "club",
  seededCountries: Record<string, string | null>,
  existing: Record<string, TeamDetails>,
): Record<string, TeamDetails> {
  const next: Record<string, TeamDetails> = {}
  for (const name of teamNames) {
    next[name] = existing[name] ?? {
      team_type: defaultTeamType,
      team_country: seededCountries[name] ?? null,
      is_international: false,
    }
  }
  return next
}

/**
 * Type and country for each distinct team in this file.
 *
 * Teams have no cross-quiz identity, so there is nothing to match against
 * and no team search — every team here is created fresh with this quiz's
 * result. A national side with no country IS an international team; the
 * checkbox is how that intent is stated, since "not chosen yet" and
 * "deliberately none" are indistinguishable in the country value alone.
 */
export function TeamsPanel({
  teamNames,
  value,
  onChange,
}: {
  teamNames: string[]
  value: Record<string, TeamDetails>
  onChange: (next: Record<string, TeamDetails>) => void
}) {
  if (teamNames.length === 0) return null

  const update = (name: string, patch: Partial<TeamDetails>) =>
    onChange({ ...value, [name]: { ...value[name], ...patch } })

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Teams in this file</h3>
      <div className="space-y-3">
        {teamNames.map((name) => {
          const details = value[name]
          if (!details) return null
          return (
            <div
              key={name}
              data-testid={`team-details-${name}`}
              className="flex flex-wrap items-end gap-3 rounded-md border p-3"
            >
              <span className="font-medium">{name}</span>

              <div className="space-y-1">
                <Label className="text-xs">Type</Label>
                <Select
                  value={details.team_type}
                  onValueChange={(v) =>
                    update(name, { team_type: v as "national" | "club" })
                  }
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="national">National</SelectItem>
                    <SelectItem value="club">Club</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Country</Label>
                <CountrySelect
                  value={details.team_country}
                  disabled={details.is_international}
                  onChange={(code) => update(name, { team_country: code })}
                  className="h-9 w-48 rounded-md border border-input bg-background px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>

              {details.team_type === "national" && (
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox
                    checked={details.is_international}
                    onCheckedChange={(checked) =>
                      update(name, {
                        is_international: checked === true,
                        team_country: checked === true
                          ? null
                          : details.team_country,
                      })
                    }
                  />
                  International (no single country)
                </label>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

Ticking the box clears the country and disables the picker; unticking re-enables it with the country still cleared, ready for a choice. Because the state is explicit rather than derived from `team_country === null`, the box never re-ticks itself.

- [ ] **Step 3: Wire the panel into Step 4**

In `Step4Disambiguation.tsx`, widen every `participantMode: "individual" | "pairs"` annotation (lines 92, 243) to `ParticipantMode`, importing it from `@/components/Upload/types`.

Add, near the other `useMemo`s around line 297:

```tsx
  const teamNames = useMemo(() => {
    if (state.participantMode !== "teams") return []
    const col = state.columnMapping.team_name
    if (col === null) return []
    const seen = new Set<string>()
    const names: string[] = []
    for (const row of state.parsedRows.slice(1)) {
      const name = (row[col] ?? "").trim()
      if (name && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase())
        names.push(name)
      }
    }
    return names
  }, [state.parsedRows, state.columnMapping.team_name, state.participantMode])

  const seededCountries = useMemo(() => {
    const col = state.columnMapping.country
    const out: Record<string, string | null> = {}
    if (state.participantMode !== "teams" || col === null) return out
    const teamCol = state.columnMapping.team_name
    if (teamCol === null) return out
    for (const row of state.parsedRows.slice(1)) {
      const name = (row[teamCol] ?? "").trim()
      if (name && !(name in out)) {
        out[name] = resolveCountryCode(row[col] ?? "")
      }
    }
    return out
  }, [
    state.parsedRows,
    state.columnMapping.country,
    state.columnMapping.team_name,
    state.participantMode,
  ])
```

Import `resolveCountryCode` from `@/lib/countries` (already used by `matchPlayers.ts`).

Seed state once the names are known:

```tsx
  useEffect(() => {
    if (state.participantMode !== "teams") return
    const next = defaultTeamDetails(
      teamNames,
      state.defaultTeamType,
      seededCountries,
      state.teamsByName,
    )
    setState((s) => ({ ...s, teamsByName: next }))
  }, [teamNames, seededCountries, state.participantMode, state.defaultTeamType])
```

and render the panel above the existing per-row resolution list:

```tsx
      {state.participantMode === "teams" && (
        <TeamsPanel
          teamNames={teamNames}
          value={state.teamsByName}
          onChange={(next) => setState((s) => ({ ...s, teamsByName: next }))}
        />
      )}
```

Match the setter name Step 4 already uses for wizard state — read the top of the component to confirm whether it is `setState`, `onChange`, or a prop-passed updater, and use that.

- [ ] **Step 4: Type-check and lint**

Run from `frontend/`:
```bash
bun run build
bun run lint
```
Expected: PASS

- [ ] **Step 5: Verify by hand**

Upload the combined-column CSV from Task 10 Step 6 in teams mode, reach Step 4, and confirm: two rows in the panel (England A, Scotland), both prefilled National, the country prefilled if a country column was mapped, and that ticking "International" clears and greys the country picker for that team only.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Upload/steps/TeamsPanel.tsx frontend/src/components/ui/CountrySelect.tsx frontend/src/components/Upload/steps/Step4Disambiguation.tsx
git commit -m "feat(frontend): choose team type and country during upload"
```

---

### Task 12: Wizard Step 5 — submit team results

**Files:**
- Modify: `frontend/src/components/Upload/steps/Step5Preview.tsx`

**Interfaces:**
- Consumes: `state.teamsByName` (Task 11), `namesForRow` teams branch (Task 6).
- Produces: a submit payload whose rows carry `team_name`, `team_type` and `team_country`, and a preview showing Team and Lineup columns.

- [ ] **Step 1: Read the current payload build**

Run from the repo root: `sed -n 25,70p frontend/src/components/Upload/steps/Step5Preview.tsx`

This is where `participant_mode` and the per-row participants are assembled.

- [ ] **Step 2: Add team fields to each submitted row**

Where each row object is built for the submit call, add:

```tsx
        ...(state.participantMode === "teams"
          ? (() => {
              const teamCol = state.columnMapping.team_name
              const teamName =
                teamCol !== null ? (row[teamCol] ?? "").trim() : ""
              const details = state.teamsByName[teamName]
              return {
                team_name: teamName,
                team_type: details?.team_type ?? state.defaultTeamType,
                // An international side is a national team with no country;
                // is_international is wizard-only and is not sent.
                team_country: details?.team_country ?? null,
              }
            })()
          : {}),
```

- [ ] **Step 3: Add Team and Lineup preview columns**

Mirror Task 10 Step 4 exactly: a **Team** header and cell before the name column, a **Lineup** header and cell after it, both gated on `state.participantMode === "teams"`, using the `namesForRow` result the preview already computes.

- [ ] **Step 4: Type-check and lint**

Run from `frontend/`:
```bash
bun run build
bun run lint
```
Expected: PASS

- [ ] **Step 5: Verify end to end by hand**

With the stack up, upload the combined-column CSV from Task 10 Step 6 through all five steps in teams mode. Then confirm the API stored it:

```bash
curl -s "http://localhost:8000/api/v1/quizzes/<quiz-slug>/results/with-players" | python3 -m json.tool
```
Expected: two rows, each with `team_name`, `team_type: "national"`, and two participants.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Upload/steps/Step5Preview.tsx
git commit -m "feat(frontend): submit team results from the upload wizard"
```

---

### Task 13: Team column on the results table

**Files:**
- Modify: `frontend/src/components/Quizzes/QuizResultsTable.tsx`

**Interfaces:**
- Consumes: `QuizResultWithPlayer.team_name/team_type/team_country` (Task 5).
- Produces: `teamLabel(result: { team_type?: TeamType | null; team_country?: string | null }): string` exported for reuse by Task 15.

- [ ] **Step 1: Add the label helper and the column**

In `frontend/src/components/Quizzes/QuizResultsTable.tsx`, add above `buildColumns`:

```tsx
/**
 * How a team's affiliation reads. A national team with no country is an
 * international side — the label is derived here rather than stored, so it
 * can never disagree with the data.
 */
export function teamLabel(result: {
  team_type?: string | null
  team_country?: string | null
}): string {
  if (result.team_country) return countryName(result.team_country)
  return result.team_type === "national" ? "International" : "—"
}
```

Inside `buildColumns`, add above the existing `hasPairs` line:

```tsx
  const hasTeams = data.some((row) => Boolean(row.team_name))
```

and, when `hasTeams`, prepend a Team column to `base` after the rank column:

```tsx
  if (hasTeams) {
    base.splice(1, 0, {
      id: "team",
      accessorFn: (row) => row.team_name ?? "",
      header: "Team",
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.original.team_name}</span>
          <span className="text-muted-foreground text-xs">
            {teamLabel(row.original)}
          </span>
        </div>
      ),
    })
  }
```

Change the player column's header so a team quiz reads correctly:

```tsx
      header: hasTeams ? "Squad" : hasPairs ? "Players" : "Player",
```

and its cell so an empty squad is explicit rather than blank:

```tsx
      cell: ({ row }) =>
        (row.original.participants ?? []).length > 0 ? (
          <PlayerLinks players={row.original.participants ?? []} />
        ) : (
          <span className="text-muted-foreground text-xs">
            No squad recorded
          </span>
        ),
```

When `hasTeams`, drop the per-participant Country column — the team's own country is already shown, and a squad of individual countries adds noise. The country column is currently the third element of the `base` array literal; lift it out into a `const` and push it conditionally, so `base` becomes:

```tsx
  const countryColumn: ColumnDef<QuizResultWithPlayer> = {
    id: "country",
    accessorFn: (row) =>
      (row.participants ?? []).map((p) => p.country ?? "").join(" / "),
    header: "Country",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {(row.original.participants ?? [])
          .map((p) => countryName(p.country) || "—")
          .join(" / ")}
      </span>
    ),
  }

  const base: ColumnDef<QuizResultWithPlayer>[] = [
    rankColumn,      // the existing final_rank column, unchanged
    playerColumn,    // the existing player_display_name column, amended above
    scoreColumn,     // the existing score column, unchanged
  ]

  if (!hasTeams) {
    base.splice(2, 0, countryColumn)
  }
```

Extract `rankColumn`, `playerColumn` and `scoreColumn` as `const`s in the same way — the three are copied verbatim out of the current array literal, with only the player column's `header` and `cell` changed as shown above. Keeping them named also makes the `hasTeams` splice at index 1 (the Team column) unambiguous to read.

- [ ] **Step 2: Type-check and lint**

Run from `frontend/`:
```bash
bun run build
bun run lint
```
Expected: PASS

- [ ] **Step 3: Verify by hand**

Open the quiz uploaded in Task 12 at `/quizzes/<slug>` and confirm: a Team column showing the name with its country beneath; the Squad column listing linked player names; a team with no squad reading "No squad recorded"; and that an existing individual or pairs quiz is visually unchanged.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Quizzes/QuizResultsTable.tsx
git commit -m "feat(frontend): show teams on the quiz results table"
```

---

### Task 14: Inline lineup editing for admins

**Files:**
- Create: `frontend/src/components/Quizzes/TeamLineupEditor.tsx`
- Modify: `frontend/src/components/Quizzes/QuizResultsTable.tsx`, `frontend/src/routes/_public/quizzes_.$slug.tsx`

**Interfaces:**
- Consumes: `PATCH /quizzes/{quiz_id}/results/{result_id}` via `QuizzesService.updateQuizResult`; `PlayersService.searchPlayersRoute` and `PlayersService.createPlayerRoute`; `teamLabel` (Task 13).
- Produces: `<TeamLineupEditor quizId={string} result={QuizResultWithPlayer} />`, rendered only for superusers.

- [ ] **Step 1: Confirm the generated method names**

Run from the repo root:
```bash
grep -n "public static \(searchPlayersRoute\|createPlayerRoute\|updateQuizResult\)" frontend/src/client/sdk.gen.ts
```
Expected: all three present. The generator suffixes several player methods with `Route` — the code below uses `PlayersService.searchPlayersRoute`, `PlayersService.createPlayerRoute` and `QuizzesService.updateQuizResult`. If any name differs, use what the grep prints.

- [ ] **Step 2: Write the editor**

Create `frontend/src/components/Quizzes/TeamLineupEditor.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, X } from "lucide-react"
import { useState } from "react"
import type { QuizResultWithPlayer } from "@/client"
import { PlayersService, QuizzesService } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import useCustomToast from "@/hooks/useCustomToast"

/**
 * Add and remove squad members on one team's result.
 *
 * The lineup lives on the RESULT, so an edit here touches this quiz only —
 * a team of the same name in any other quiz is a different team and is
 * untouched by construction.
 *
 * There is no lineup endpoint: PATCH replaces the whole participant set, so
 * both add and remove send the full list.
 */
export function TeamLineupEditor({
  quizSlug,
  quizId,
  result,
}: {
  quizSlug: string
  quizId: string
  result: QuizResultWithPlayer
}) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [query, setQuery] = useState("")

  const participants = result.participants ?? []

  const { data: candidates } = useQuery({
    queryKey: ["players", "search", query],
    queryFn: () => PlayersService.searchPlayersRoute({ q: query, limit: 5 }),
    enabled: query.trim().length >= 2,
  })

  const save = useMutation({
    mutationFn: (playerIds: string[]) =>
      QuizzesService.updateQuizResult({
        quizId,
        resultId: result.id,
        requestBody: {
          participants: playerIds.map((player_id) => ({ player_id })),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quizzes", quizSlug, "results"] })
      showSuccessToast("Squad updated")
      setQuery("")
    },
    onError: () => showErrorToast("Failed to update the squad"),
  })

  const add = (playerId: string) =>
    save.mutate([...participants.map((p) => p.player_id), playerId])

  const remove = (playerId: string) =>
    save.mutate(
      participants.map((p) => p.player_id).filter((id) => id !== playerId),
    )

  const createAndAdd = useMutation({
    mutationFn: async (displayName: string) => {
      const player = await PlayersService.createPlayerRoute({
        requestBody: { display_name: displayName, countries: [] },
      })
      return player.id
    },
    onSuccess: (playerId) => add(playerId),
    onError: () => showErrorToast("Failed to create the player"),
  })

  return (
    <div className="space-y-2 py-2">
      <div className="flex flex-wrap gap-2">
        {participants.map((p) => (
          <span
            key={p.player_id}
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
          >
            {p.player_display_name}
            <button
              type="button"
              aria-label={`Remove ${p.player_display_name}`}
              onClick={() => remove(p.player_id)}
              disabled={save.isPending}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {participants.length === 0 && (
          <span className="text-muted-foreground text-xs">
            No squad recorded
          </span>
        )}
      </div>

      <div className="flex gap-2">
        <Input
          value={query}
          placeholder="Add a player…"
          className="h-8 max-w-xs"
          onChange={(e) => setQuery(e.target.value)}
        />
        {query.trim().length >= 2 && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => createAndAdd.mutate(query.trim())}
            disabled={createAndAdd.isPending || save.isPending}
          >
            <Plus className="mr-1 h-3 w-3" />
            Create "{query.trim()}"
          </Button>
        )}
      </div>

      {(candidates?.data ?? []).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {(candidates?.data ?? []).map((c) => (
            <Button
              key={c.player.id}
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => add(c.player.id)}
              disabled={save.isPending}
            >
              {c.player.display_name}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
```

Confirm the search response shape against `frontend/src/client/types.gen.ts` — `PlayerSearchResults` has a `data` array of `{ player, similarity }`. Adjust `candidates?.data` if the generated field differs.

- [ ] **Step 3: Render it under each team row for superusers**

`QuizResultsTable` needs to know whether to show the editor. Add two optional props and pass them through:

```tsx
export function QuizResultsTable({
  data,
  format,
  quizId,
  quizSlug,
  canEditLineups = false,
}: {
  data: QuizResultWithPlayer[]
  format?: QuizFormatPublic | null
  quizId?: string
  quizSlug?: string
  canEditLineups?: boolean
}) {
```

When `canEditLineups && quizId && quizSlug` and the row has a `team_name`, render the editor in the Squad column's cell in place of the read-only list:

```tsx
      cell: ({ row }) =>
        canEditLineups && quizId && quizSlug && row.original.team_name ? (
          <TeamLineupEditor
            quizSlug={quizSlug}
            quizId={quizId}
            result={row.original}
          />
        ) : (row.original.participants ?? []).length > 0 ? (
          <PlayerLinks players={row.original.participants ?? []} />
        ) : (
          <span className="text-muted-foreground text-xs">
            No squad recorded
          </span>
        ),
```

`buildColumns` must therefore take these three values as arguments — thread them through from the component.

In `frontend/src/routes/_public/quizzes_.$slug.tsx`, the page already reads `useAuth` for `AdminControls`. Pass the flag at the `<QuizResultsTable ... />` call site:

```tsx
        <QuizResultsTable
          data={results.data}
          format={quiz.format}
          quizId={quiz.id}
          quizSlug={quiz.slug}
          canEditLineups={Boolean(user?.is_superuser)}
        />
```

Match the variable the file already uses for the current user from `useAuth()`.

- [ ] **Step 4: Type-check and lint**

Run from `frontend/`:
```bash
bun run build
bun run lint
```
Expected: PASS

- [ ] **Step 5: Verify by hand**

Signed in as the superuser, open the teams quiz from Task 12. Confirm: each team row shows its squad as removable chips; typing two characters searches players; clicking a candidate adds them and the table refreshes; the X removes a member; "Create …" makes a new player and adds them. Sign out and confirm a logged-out visitor sees plain names with no controls.

Then confirm the per-quiz invariant directly: upload a *second* teams quiz containing a team with the same name, edit one quiz's squad, and check the other quiz's squad is unchanged.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Quizzes/TeamLineupEditor.tsx frontend/src/components/Quizzes/QuizResultsTable.tsx frontend/src/routes/_public/quizzes_.\$slug.tsx
git commit -m "feat(frontend): let admins edit a team's squad inline"
```

---

### Task 15: Team results on player history

**Files:**
- Modify: `frontend/src/components/Players/historyColumns.tsx`

**Interfaces:**
- Consumes: `PlayerResultWithQuiz.team_name/team_type/team_country` (Task 4); `teamLabel` (Task 13).

- [ ] **Step 1: Render the team beside the quiz name**

In `frontend/src/components/Players/historyColumns.tsx`, replace the partners block at lines 27-33 with:

```tsx
          {result.team_name ? (
            <span className="text-muted-foreground text-xs">
              {" "}
              for {result.team_name}
              {result.team_country || result.team_type === "national"
                ? ` (${teamLabel(result)})`
                : ""}
            </span>
          ) : (
            (result.partners ?? []).length > 0 && (
              <span className="text-muted-foreground text-xs">
                {" "}
                with{" "}
                {(result.partners ?? []).map((p) => p.display_name).join(" & ")}
              </span>
            )
          )}
```

Import `teamLabel` from `@/components/Quizzes/QuizResultsTable`. If that import direction feels wrong once you see the file, move `teamLabel` into `frontend/src/lib/countries.ts` alongside `countryName` and import it from there in both places — do not duplicate the function.

- [ ] **Step 2: Type-check and lint**

Run from `frontend/`:
```bash
bun run build
bun run lint
```
Expected: PASS

- [ ] **Step 3: Verify by hand**

Open the player page of a squad member from Task 12's upload. Confirm the row reads "… for England A (United Kingdom)", that the quiz counts toward Total quizzes / Wins / Podiums, and that a pairs result elsewhere still reads "with <partner>".

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Players/historyColumns.tsx
git commit -m "feat(frontend): name the team on a player's history row"
```

---

### Task 16: End-to-end coverage

**Files:**
- Create: `frontend/tests/teams-upload.spec.ts`

**Interfaces:**
- Consumes: the whole feature.

**Before running:** bring up mailcatcher, stop the Docker `frontend` container so it does not shadow port 5173 with a stale build, and make sure no other Playwright run is in progress — concurrent runs share the dev database and the superuser and produce a scatter of fake failures.

- [ ] **Step 1: Read an existing spec for the fixtures**

Run from the repo root: `sed -n 1,60p frontend/tests/pairs-upload.spec.ts`

This is the closest precedent. Reuse its login helper, its CSV-paste flow, and its cleanup pattern — E2E fixtures call the generated client directly, so they must be kept in step with the schema.

- [ ] **Step 2: Write the spec**

Create `frontend/tests/teams-upload.spec.ts`:

```ts
import { expect, test } from "@playwright/test"
import { OpenAPI, PlayersService, QuizzesService } from "../src/client"
import { Labels } from "../src/test-ids"
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

test.describe.configure({ mode: "serial" })

const runId = Date.now()

const COMBINED_QUIZ_NAME = `Teams Combined Quiz ${runId}`
const NUMBERED_QUIZ_NAME = `Teams Numbered Quiz ${runId}`
const EMPTY_SQUAD_QUIZ_NAME = `Teams Empty Squad Quiz ${runId}`

const COMBINED_CSV = `Team,Players,Score
England A,"Alice Teams ${runId}, Bob Teams ${runId}",100
Scotland,"Carol Teams ${runId} & Dave Teams ${runId}",90`

const NUMBERED_CSV = `Team,Player 1,Player 2,Score
Wales,Erin Teams ${runId},Frank Teams ${runId},80`

const EMPTY_SQUAD_CSV = `Team,Score
Rest of the World,70`

const INLINE_PLAYER_NAME = `Gwen Inline ${runId}`

const CREATED_PLAYER_NAMES = [
  `Alice Teams ${runId}`,
  `Bob Teams ${runId}`,
  `Carol Teams ${runId}`,
  `Dave Teams ${runId}`,
  `Erin Teams ${runId}`,
  `Frank Teams ${runId}`,
  INLINE_PLAYER_NAME,
]

const QUIZ_NAMES = [
  COMBINED_QUIZ_NAME,
  NUMBERED_QUIZ_NAME,
  EMPTY_SQUAD_QUIZ_NAME,
]

async function findQuizId(name: string): Promise<string> {
  const pending = await QuizzesService.readQuizzes({
    status: "pending",
    limit: 200,
    q: name,
  })
  const found = pending.data.find((q) => q.name === name)
  expect(found).toBeTruthy()
  return found!.id
}

test.beforeAll(async () => {
  OpenAPI.BASE = process.env.VITE_API_URL!
  OpenAPI.TOKEN = await authenticate()
})

test.afterAll(async () => {
  // Quizzes first — results and their participant rows cascade with them —
  // then the players this run created. Looked up by exact name at cleanup
  // time so teardown still works if a test failed partway through. Only
  // rows this spec created are touched.
  for (const name of QUIZ_NAMES) {
    const pending = await QuizzesService.readQuizzes({
      status: "pending",
      limit: 200,
      q: name,
    }).catch(() => null)
    for (const q of pending?.data ?? []) {
      if (q.name === name) {
        await QuizzesService.deleteQuiz({ id: q.id }).catch(() => {})
      }
    }
  }

  for (const name of CREATED_PLAYER_NAMES) {
    const found = await PlayersService.searchPlayersRoute({
      q: name,
      limit: 5,
    }).catch(() => null)
    for (const r of found?.data ?? []) {
      if (r.player.display_name === name) {
        await PlayersService.deletePlayerRoute({
          playerId: r.player.id,
        }).catch(() => {})
      }
    }
  }
})

test("uploads a teams quiz with the squad in one column", async ({ page }) => {
  await page.goto("/upload")
  await page.getByTestId(Labels.uploadModeNew).click()
  await page.getByTestId(Labels.uploadParticipantModeTeams).click()
  await expect(
    page.getByTestId(Labels.uploadDefaultTeamTypeNational),
  ).toHaveClass(/bg-primary/)
  await page.getByLabel("Quiz name *").fill(COMBINED_QUIZ_NAME)
  await page.getByRole("button", { name: "Next →" }).click() // Step1 -> Step2

  await page.getByLabel("Or paste data directly").fill(COMBINED_CSV)
  await page.getByRole("button", { name: "Next →" }).click() // Step2 -> Step3

  // Every squad cell carries a comma or an ampersand, so the layout must
  // auto-detect as combined.
  await expect(page.getByTestId(Labels.lineupLayoutCombined)).toHaveClass(
    /bg-primary/,
  )
  await page.getByRole("button", { name: "Next →" }).click() // Step3 -> Step4

  // Both teams appear in the panel, prefilled from the National default.
  await expect(page.getByTestId("team-details-England A")).toBeVisible()
  await expect(page.getByTestId("team-details-Scotland")).toBeVisible()
  await expect(page.getByRole("button", { name: "Next →" })).toBeEnabled()
  await page.getByRole("button", { name: "Next →" }).click() // Step4 -> Step5

  await page.getByRole("button", { name: "Submit for review" }).click()
  await expect(page.getByText("Results submitted for review.")).toBeVisible()

  await page.goto(`/quizzes/${await findQuizId(COMBINED_QUIZ_NAME)}`)
  await expect(page.getByText("England A")).toBeVisible()
  await expect(page.getByText("Scotland")).toBeVisible()
  await expect(page.getByText(`Alice Teams ${runId}`)).toBeVisible()
  await expect(page.getByText(`Dave Teams ${runId}`)).toBeVisible()
})

test("uploads a teams quiz with one column per squad member", async ({
  page,
}) => {
  await page.goto("/upload")
  await page.getByTestId(Labels.uploadModeNew).click()
  await page.getByTestId(Labels.uploadParticipantModeTeams).click()
  await page.getByLabel("Quiz name *").fill(NUMBERED_QUIZ_NAME)
  await page.getByRole("button", { name: "Next →" }).click()

  await page.getByLabel("Or paste data directly").fill(NUMBERED_CSV)
  await page.getByRole("button", { name: "Next →" }).click()

  // "Player 1" / "Player 2" headers and no separators in the cells.
  await expect(page.getByTestId(Labels.lineupLayoutNumbered)).toHaveClass(
    /bg-primary/,
  )
  await page.getByRole("button", { name: "Next →" }).click()

  await expect(page.getByRole("button", { name: "Next →" })).toBeEnabled()
  await page.getByRole("button", { name: "Next →" }).click()

  await page.getByRole("button", { name: "Submit for review" }).click()
  await expect(page.getByText("Results submitted for review.")).toBeVisible()

  await page.goto(`/quizzes/${await findQuizId(NUMBERED_QUIZ_NAME)}`)
  await expect(page.getByText("Wales")).toBeVisible()
  await expect(page.getByText(`Erin Teams ${runId}`)).toBeVisible()
  await expect(page.getByText(`Frank Teams ${runId}`)).toBeVisible()
})

test("records a team with no squad, then fills it in from the results page", async ({
  page,
}) => {
  await page.goto("/upload")
  await page.getByTestId(Labels.uploadModeNew).click()
  await page.getByTestId(Labels.uploadParticipantModeTeams).click()
  await page.getByLabel("Quiz name *").fill(EMPTY_SQUAD_QUIZ_NAME)
  await page.getByRole("button", { name: "Next →" }).click()

  await page.getByLabel("Or paste data directly").fill(EMPTY_SQUAD_CSV)
  await page.getByRole("button", { name: "Next →" }).click()
  // No squad column exists in this file; submission must still be allowed.
  await page.getByRole("button", { name: "Next →" }).click()
  await expect(page.getByRole("button", { name: "Next →" })).toBeEnabled()
  await page.getByRole("button", { name: "Next →" }).click()

  await page.getByRole("button", { name: "Submit for review" }).click()
  await expect(page.getByText("Results submitted for review.")).toBeVisible()

  await page.goto(`/quizzes/${await findQuizId(EMPTY_SQUAD_QUIZ_NAME)}`)
  await expect(page.getByText("Rest of the World")).toBeVisible()
  await expect(page.getByText("No squad recorded")).toBeVisible()

  // Add a squad member inline as the superuser.
  await page.getByPlaceholder("Add a player…").fill(INLINE_PLAYER_NAME)
  await page.getByRole("button", { name: `Create "${INLINE_PLAYER_NAME}"` }).click()
  await expect(page.getByText("Squad updated")).toBeVisible()
  await expect(page.getByText(INLINE_PLAYER_NAME)).toBeVisible()
  await expect(page.getByText("No squad recorded")).toHaveCount(0)

  // That player's own page now names the team they turned out for.
  const found = await PlayersService.searchPlayersRoute({
    q: INLINE_PLAYER_NAME,
    limit: 5,
  })
  const player = found.data.find(
    (r) => r.player.display_name === INLINE_PLAYER_NAME,
  )
  expect(player).toBeTruthy()
  await page.goto(`/players/${player!.player.slug ?? player!.player.id}`)
  await expect(page.getByText("for Rest of the World")).toBeVisible()
})
```

Two things to reconcile against the real UI once it exists: the quiz-name field label (`"Quiz name *"`) and the paste-textarea label are copied from `pairs-upload.spec.ts`, so they are correct as long as Step 1 and Step 2 were not otherwise changed; and the player page's route (`/players/$slug`) takes a slug, with the id as a fallback for a freshly created player that may not have one yet.

Note the third test asserts a quiz created with no squad column reaches submission — that is the zero-participant path end to end, and it is the single most important assertion in this file.

- [ ] **Step 3: Run the spec**

Run from `frontend/`: `bunx playwright test --config playwright.config.cts tests/teams-upload.spec.ts`

Do not pipe through `| tail` — it masks the exit code.

Expected: PASS — 3 tests.

- [ ] **Step 4: Run the whole E2E suite once**

Run from `frontend/`: `bunx playwright test --config playwright.config.cts`
Expected: PASS — including `pairs-upload.spec.ts` and `upload.spec.ts` unchanged.

- [ ] **Step 5: Commit**

```bash
git add frontend/tests/teams-upload.spec.ts
git commit -m "test(frontend): cover team uploads and inline squad editing end to end"
```

---

### Task 17: Full verification

**Files:** none modified.

- [ ] **Step 1: Backend suite with coverage**

Run from `backend/`: `bash ./scripts/test.sh`
Expected: PASS

- [ ] **Step 2: Frontend unit suite and build**

Run from `frontend/`:
```bash
bun run test:unit
bun run build
```
Expected: PASS both

- [ ] **Step 3: Lint everything**

Run from `backend/`: `uv run prek run --all-files`
Expected: PASS

- [ ] **Step 4: Confirm the client is in step with the backend**

Run from the repo root: `bash ./scripts/generate-client.sh`
Then: `git status --short frontend/src/client frontend/openapi.json`
Expected: no changes — if the client regenerates differently, Task 5 was stale; commit the regenerated files.

- [ ] **Step 5: Confirm the migration round-trips one more time**

Run from `backend/`:
```bash
uv run alembic downgrade -1
uv run alembic upgrade head
uv run pytest tests/ -q
```
Expected: PASS

- [ ] **Step 6: Commit anything outstanding**

```bash
git status --short
```
Expected: clean. If not, commit what remains with an appropriate message.
