# Entity Slugs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give quizzes, organizations, and competitions readable URL slugs, replacing UUIDs in public URLs.

**Architecture:** Extract the existing player slug logic into two shared helpers, add a NOT NULL unique `slug` column to three tables with a backfilling migration, make the detail route parameters accept either a UUID or a slug, then move the frontend detail routes onto slugs. Backend lands first and stays green on its own; the frontend follows once the client is regenerated.

**Tech Stack:** FastAPI, SQLModel, Alembic, PostgreSQL 18, React, TanStack Router/Query, `@hey-api/openapi-ts`, Playwright, Docker Compose.

## Global Constraints

- Branch is `add-slugs-for-quiz-and-competition`, forked from `main` at `27003a2`. The trunk is `main`, **not** `master`.
- `slugify` is the existing `_generate_slug` character logic extracted **verbatim** — two `re.sub` passes over `[^\w\s-]` then `[\s_]+`, lowercased, `.strip("-")`. **No behaviour change.** Do NOT add diacritic stripping, Unicode normalisation, or transliteration; that was considered and rejected because it corrupts non-Latin scripts (`Московский` → `московскии`) and collides distinct names (`Müller`/`Muller`).
- Existing player-slug tests must pass **unmodified** — they are the regression guard proving the extraction was behaviour-preserving.
- Slug columns are `str` (NOT NULL), `unique=True`, `index=True`, `max_length=255`.
- Quiz slug base is `slugify(name) + "-" + start_date.isoformat()`. Organization and competition slug base is `slugify(name)`.
- Slugs are generated server-side at creation only. `*Create` models never accept a slug. Renaming never regenerates a slug.
- Slug conflicts on update raise `ValueError("Slug already in use")` in crud; routes convert with `except ValueError as e: raise HTTPException(status_code=409, detail=str(e))`.
- New migration's `down_revision` is `"a7b3c9d1e2f4"` (verified current head, in code and in the live `alembic_version` table).
- **Never run backend code via `docker compose exec backend`** — that container has no source bind mount and runs a stale baked image, so alembic reports "already at head" and pytest passes against old code. Both are false greens.
- Run backend commands on the host from `backend/`, using the **repo-root** venv: `/Users/ahancock/dev/quiz-reference-demo/.venv/bin/{alembic,pytest,ruff}`. `backend/.venv` is an empty stub.
- **Never run `docker compose down -v`** or remove any Docker volume — it destroys both databases including staging.
- `frontend/src/client/` and `frontend/src/routeTree.gen.ts` are generated. Never hand-edit them.
- Test cleanup stays non-destructive: fixtures delete only rows they create, tracked by id diff. Never a table-wide delete.
- The known failure `test_search_by_country_matches_multiple_countries` is pre-existing dev-database data pollution, unrelated to this work. Expect `pytest` to report it. Any *other* failure is real.

---

### Task 1: Shared slug helpers

Pure refactor. Extract the player-specific slug logic into two reusable functions and prove nothing changed.

**Files:**
- Modify: `backend/app/crud.py:159-166` (replace `_generate_slug`), `crud.py:180`
- Test: `backend/tests/test_slugs.py` (create)

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `slugify(text: str) -> str`
  - `generate_unique_slug(*, session: Session, model: type, base: str) -> str`
  Both in `app.crud`. Later tasks import them for Organization, Competition, and Quiz creation.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_slugs.py`:

```python
from sqlmodel import Session

from app.crud import generate_unique_slug, slugify
from app.models import Organization


def test_slugify_lowercases_and_hyphenates() -> None:
    assert slugify("London Open") == "london-open"


def test_slugify_strips_punctuation_including_em_dash() -> None:
    assert slugify("Summer League — Quiz 10") == "summer-league-quiz-10"


def test_slugify_collapses_whitespace_and_underscores() -> None:
    assert slugify("Winter   Cup_2026") == "winter-cup-2026"


def test_slugify_strips_leading_and_trailing_hyphens() -> None:
    assert slugify("!! Big Quiz !!") == "big-quiz"


def test_slugify_preserves_non_ascii() -> None:
    # Deliberate: transliteration was rejected because NFD-stripping corrupts
    # non-Latin scripts and collides distinct names. Do not "fix" this.
    assert slugify("Московский Квиз") == "московский-квиз"
    assert slugify("Café Quiz") == "café-quiz"


def test_generate_unique_slug_returns_base_when_free(db: Session) -> None:
    assert generate_unique_slug(
        session=db, model=Organization, base="totally-unused-slug-xyz"
    ) == "totally-unused-slug-xyz"
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend
/Users/ahancock/dev/quiz-reference-demo/.venv/bin/pytest tests/test_slugs.py -v
```

Expected: FAIL — `ImportError: cannot import name 'slugify' from 'app.crud'`.

- [ ] **Step 3: Extract the helpers**

In `backend/app/crud.py`, replace `_generate_slug` (lines 159-166) with:

```python
def slugify(text: str) -> str:
    base = re.sub(r"[^\w\s-]", "", text.lower())
    return re.sub(r"[\s_]+", "-", base).strip("-")


def generate_unique_slug(*, session: Session, model: type, base: str) -> str:
    slug, counter = base, 2
    while session.exec(select(model).where(model.slug == slug)).first():
        slug = f"{base}-{counter}"
        counter += 1
    return slug
```

The character logic in `slugify` is copied verbatim from the old `_generate_slug`; only
the `Player`-specific query moved out into `generate_unique_slug`, which takes the model
class so one implementation serves all four entities.

- [ ] **Step 4: Point player creation at the helpers**

In `crud.py:180`, `create_player` currently calls
`_generate_slug(session=session, display_name=player_in.display_name)`. Replace with:

```python
    slug = generate_unique_slug(
        session=session,
        model=Player,
        base=slugify(player_in.display_name),
    )
```

- [ ] **Step 5: Run the new tests and the player regression guard**

```bash
cd backend
/Users/ahancock/dev/quiz-reference-demo/.venv/bin/pytest tests/test_slugs.py tests/api/routes/test_players.py -q
```

Expected: `tests/test_slugs.py` all PASS. `test_players.py` passes except the known
pre-existing `test_search_by_country_matches_multiple_countries`. If any *other* player
test fails, the extraction changed behaviour — fix it rather than editing the test.

- [ ] **Step 6: Commit**

```bash
git add backend/app/crud.py backend/tests/test_slugs.py
git commit -m "refactor(backend): extract slugify and generate_unique_slug helpers

Pure extraction of the player slug logic; character rules unchanged."
```

---

### Task 2: Migration, models, and slug generation on create

Adds the columns, backfills, and wires generation into the three create paths.

**Files:**
- Create: `backend/app/alembic/versions/b4c8e1f7a2d9_add_entity_slugs.py`
- Modify: `backend/app/models.py` (Organization block 100-128, Competition block ~175-205, Quiz block ~218-275, `PlayerResultWithQuiz` ~392, `PlayerCompetitionGroup` ~409, `CompetitionEventPodium` ~594)
- Modify: `backend/app/crud.py` — `create_organization` (102-109), `create_competition`, `create_quiz` (474-483)
- Test: `backend/tests/test_slugs.py` (extend)

**Interfaces:**
- Consumes: `slugify(text)`, `generate_unique_slug(*, session, model, base)` from Task 1.
- Produces: `Organization.slug`, `Competition.slug`, `Quiz.slug` (all `str`, NOT NULL, unique). `OrganizationPublic.slug`, `CompetitionPublic.slug`, `QuizPublic.slug`. Denormalized: `CompetitionPublic.organization_slug`, `PlayerResultWithQuiz.quiz_slug`, `CompetitionEventPodium.quiz_slug`, `PlayerCompetitionGroup.competition_slug` — all `str | None`.

- [ ] **Step 1: Add slug to the three table models**

In `backend/app/models.py`, add to `Organization`, `Competition`, and `Quiz` table classes:

```python
    slug: str = Field(unique=True, index=True, max_length=255)
```

Add `slug: str` to `OrganizationPublic`, `CompetitionPublic`, and `QuizPublic`. Add
`slug: str | None = None` to `OrganizationUpdate`, `CompetitionUpdate`, and `QuizUpdate`.
Do **not** add slug to any `*Create` model.

- [ ] **Step 2: Add the denormalized slug fields**

Still in `models.py`:

```python
class CompetitionPublic(CompetitionBase):
    id: uuid.UUID
    slug: str
    organization_id: uuid.UUID
    organization_name: str | None = None
    organization_slug: str | None = None
```

Add `quiz_slug: str | None = None` to `PlayerResultWithQuiz` (beside `quiz_name`) and to
`CompetitionEventPodium` (beside `quiz_name`). Add
`competition_slug: str | None` to `PlayerCompetitionGroup` (beside `competition_name`).

- [ ] **Step 3: Write the migration**

Create `backend/app/alembic/versions/b4c8e1f7a2d9_add_entity_slugs.py`:

```python
"""add slugs to quiz, organization, competition

Revision ID: b4c8e1f7a2d9
Revises: a7b3c9d1e2f4
Create Date: 2026-08-04 00:00:00.000000

"""
import re

import sqlalchemy as sa
from alembic import op

revision = "b4c8e1f7a2d9"
down_revision = "a7b3c9d1e2f4"
branch_labels = None
depends_on = None

TABLES = ("quiz", "organization", "competition")


def _slugify(text: str) -> str:
    # Mirrors app.crud.slugify. Reimplemented inline so the migration stays
    # self-contained and keeps working if the application helper changes.
    base = re.sub(r"[^\w\s-]", "", text.lower())
    return re.sub(r"[\s_]+", "-", base).strip("-")


def upgrade() -> None:
    for table in TABLES:
        op.add_column(table, sa.Column("slug", sa.String(255), nullable=True))

    conn = op.get_bind()
    for table in TABLES:
        if table == "quiz":
            rows = conn.execute(
                sa.text("SELECT id, name, start_date FROM quiz ORDER BY id")
            ).fetchall()
        else:
            rows = conn.execute(
                sa.text(f"SELECT id, name FROM {table} ORDER BY id")  # noqa: S608
            ).fetchall()

        seen: set[str] = set()
        for row in rows:
            base = _slugify(row.name or "")
            if table == "quiz":
                base = f"{base}-{row.start_date.isoformat()}" if base else str(row.start_date)
            if not base:
                base = str(row.id)
            slug, counter = base, 2
            while slug in seen:
                slug = f"{base}-{counter}"
                counter += 1
            seen.add(slug)
            conn.execute(
                sa.text(f"UPDATE {table} SET slug = :slug WHERE id = :id"),  # noqa: S608
                {"slug": slug, "id": row.id},
            )

    for table in TABLES:
        op.alter_column(table, "slug", nullable=False)
        op.create_index(f"ix_{table}_slug", table, ["slug"], unique=True)


def downgrade() -> None:
    for table in TABLES:
        op.drop_index(f"ix_{table}_slug", table_name=table)
        op.drop_column(table, "slug")
```

`ORDER BY id` plus the in-transaction `seen` set makes the backfill deterministic:
identically named rows always get the same slug and counter, and the counter accounts for
rows assigned earlier in this same uncommitted pass. The empty-base fallback to the row id
guarantees NOT NULL can be satisfied even for a row whose name slugifies to nothing.

- [ ] **Step 4: Apply and round-trip the migration**

```bash
cd backend
ALEMBIC=/Users/ahancock/dev/quiz-reference-demo/.venv/bin/alembic
$ALEMBIC upgrade head
docker compose exec -T db psql -U postgres -d app -c "SELECT name, slug FROM quiz ORDER BY start_date DESC LIMIT 5;"
docker compose exec -T db psql -U postgres -d app -c "SELECT name, slug FROM competition ORDER BY name;"
docker compose exec -T db psql -U postgres -d app -c "SELECT count(*) FROM quiz WHERE slug IS NULL;"
```

Expected: quiz slugs like `summer-league-quiz-10-2025-09-08`; competition slugs from
names; zero NULL slugs. Then prove the downgrade and return to head:

```bash
$ALEMBIC downgrade -1
docker compose exec -T db psql -U postgres -d app -c "\d quiz" | grep -c slug
$ALEMBIC upgrade head
```

Expected: `0` slug columns after downgrade; column back after upgrade.

- [ ] **Step 5: Generate slugs on create**

In `backend/app/crud.py`, `create_organization` (line 102) becomes:

```python
def create_organization(
    *, session: Session, org_in: OrganizationCreate
) -> Organization:
    org = Organization.model_validate(
        org_in,
        update={
            "slug": generate_unique_slug(
                session=session, model=Organization, base=slugify(org_in.name)
            )
        },
    )
    session.add(org)
    session.commit()
    session.refresh(org)
    return org
```

`create_competition` takes the same shape with `Competition` and `competition_in.name`.

`create_quiz` (line 474) becomes:

```python
def create_quiz(
    *, session: Session, event_in: QuizCreate, submitted_by_id: uuid.UUID
) -> Quiz:
    base = f"{slugify(event_in.name)}-{event_in.start_date.isoformat()}"
    event = Quiz.model_validate(
        event_in,
        update={
            "submitted_by_id": submitted_by_id,
            "slug": generate_unique_slug(session=session, model=Quiz, base=base),
        },
    )
    session.add(event)
    session.commit()
    session.refresh(event)
    return event
```

- [ ] **Step 6: Write tests for slug generation on create**

Append to `backend/tests/test_slugs.py`:

```python
import uuid
from datetime import date

from app import crud
from app.models import CompetitionCreate, OrganizationCreate


def test_organization_slug_generated_on_create(db: Session) -> None:
    name = f"Slug Test Org {uuid.uuid4().hex[:8]}"
    org = crud.create_organization(session=db, org_in=OrganizationCreate(name=name))
    try:
        assert org.slug == slugify(name)
    finally:
        db.delete(org)
        db.commit()


def test_duplicate_organization_names_get_counter(db: Session) -> None:
    name = f"Dup Org {uuid.uuid4().hex[:8]}"
    first = crud.create_organization(session=db, org_in=OrganizationCreate(name=name))
    second = crud.create_organization(session=db, org_in=OrganizationCreate(name=name))
    try:
        assert first.slug == slugify(name)
        assert second.slug == f"{slugify(name)}-2"
    finally:
        db.delete(first)
        db.delete(second)
        db.commit()


def test_competition_slug_generated_on_create(db: Session) -> None:
    org = crud.create_organization(
        session=db, org_in=OrganizationCreate(name=f"Comp Org {uuid.uuid4().hex[:8]}")
    )
    name = f"Slug Test Competition {uuid.uuid4().hex[:8]}"
    comp = crud.create_competition(
        session=db,
        competition_in=CompetitionCreate(name=name, organization_id=org.id),
    )
    try:
        assert comp.slug == slugify(name)
    finally:
        db.delete(comp)
        db.delete(org)
        db.commit()
```

For the quiz case, build one directly through `crud.create_quiz` — `tests/utils/quiz.py`
has no helper that takes a caller-supplied name, and adding one for a single test is not
worth it:

```python
def test_quiz_slug_includes_start_date(db: Session) -> None:
    from app.models import QuizCreate
    from tests.utils.user import create_random_user

    user = create_random_user(db)
    quiz = crud.create_quiz(
        session=db,
        event_in=QuizCreate(
            name="Slug Date Quiz",
            start_date=date(2026, 3, 15),
            end_date=date(2026, 3, 15),
        ),
        submitted_by_id=user.id,
    )
    try:
        assert quiz.slug == "slug-date-quiz-2026-03-15"
    finally:
        db.delete(quiz)
        db.delete(user)
        db.commit()


def test_same_name_same_day_quizzes_get_counter(db: Session) -> None:
    from app.models import QuizCreate
    from tests.utils.user import create_random_user

    user = create_random_user(db)
    quizzes = [
        crud.create_quiz(
            session=db,
            event_in=QuizCreate(
                name="Repeat Day Quiz",
                start_date=date(2026, 4, 1),
                end_date=date(2026, 4, 1),
            ),
            submitted_by_id=user.id,
        )
        for _ in range(2)
    ]
    try:
        assert quizzes[0].slug == "repeat-day-quiz-2026-04-01"
        assert quizzes[1].slug == "repeat-day-quiz-2026-04-01-2"
    finally:
        for quiz in quizzes:
            db.delete(quiz)
        db.delete(user)
        db.commit()
```

The `create_random_user` import path matches how `tests/utils/quiz.py:75` already obtains
a submitter.

- [ ] **Step 7: Run the tests**

```bash
cd backend
/Users/ahancock/dev/quiz-reference-demo/.venv/bin/pytest tests/test_slugs.py -q
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/app/models.py backend/app/crud.py backend/app/alembic/versions/ backend/tests/
git commit -m "feat(backend): add slug columns with backfill migration

Slugs generated at creation for organizations, competitions, and quizzes.
Quiz slugs include start_date to avoid collisions on repeated names."
```

---

### Task 3: Resolve routes by UUID or slug

**Files:**
- Modify: `backend/app/crud.py` (add resolver)
- Modify: `backend/app/api/routes/organizations.py:29-73`, `backend/app/api/routes/competitions.py`, `backend/app/api/routes/quizzes.py`
- Modify: `backend/app/api/routes/players.py` (competition-history query param)
- Test: `backend/tests/api/routes/test_slug_routes.py` (create)

**Interfaces:**
- Consumes: the slug columns from Task 2.
- Produces: `GET|PATCH|DELETE /api/v1/{organizations,competitions,quizzes}/{id_or_slug}` accepting either form; `GET /api/v1/players/{player_id}/competition-history?competition={id_or_slug}`. `resolve_by_id_or_slug(*, session, model, value) -> Any | None` in `app.crud`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/api/routes/test_slug_routes.py`:

```python
import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app import crud
from app.core.config import settings
from app.models import OrganizationCreate


def test_get_organization_by_uuid_and_by_slug(client: TestClient, db: Session) -> None:
    name = f"Resolver Org {uuid.uuid4().hex[:8]}"
    org = crud.create_organization(session=db, org_in=OrganizationCreate(name=name))
    try:
        by_id = client.get(f"{settings.API_V1_STR}/organizations/{org.id}")
        by_slug = client.get(f"{settings.API_V1_STR}/organizations/{org.slug}")
        assert by_id.status_code == 200
        assert by_slug.status_code == 200
        assert by_id.json()["id"] == by_slug.json()["id"] == str(org.id)
    finally:
        db.delete(org)
        db.commit()


def test_get_organization_by_unknown_slug_returns_404(client: TestClient) -> None:
    r = client.get(f"{settings.API_V1_STR}/organizations/no-such-org-slug-xyz")
    assert r.status_code == 404


def test_patch_organization_by_slug(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    org = crud.create_organization(
        session=db, org_in=OrganizationCreate(name=f"Patch Org {uuid.uuid4().hex[:8]}")
    )
    try:
        r = client.patch(
            f"{settings.API_V1_STR}/organizations/{org.slug}",
            headers=superuser_token_headers,
            json={"description": "updated via slug"},
        )
        assert r.status_code == 200
        assert r.json()["description"] == "updated via slug"
    finally:
        db.delete(org)
        db.commit()


def test_patch_duplicate_slug_returns_409(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    a = crud.create_organization(
        session=db, org_in=OrganizationCreate(name=f"Dup A {uuid.uuid4().hex[:8]}")
    )
    b = crud.create_organization(
        session=db, org_in=OrganizationCreate(name=f"Dup B {uuid.uuid4().hex[:8]}")
    )
    try:
        r = client.patch(
            f"{settings.API_V1_STR}/organizations/{b.id}",
            headers=superuser_token_headers,
            json={"slug": a.slug},
        )
        assert r.status_code == 409
    finally:
        db.delete(a)
        db.delete(b)
        db.commit()


def test_patch_own_slug_is_not_a_conflict(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    org = crud.create_organization(
        session=db, org_in=OrganizationCreate(name=f"Self Slug {uuid.uuid4().hex[:8]}")
    )
    try:
        r = client.patch(
            f"{settings.API_V1_STR}/organizations/{org.id}",
            headers=superuser_token_headers,
            json={"slug": org.slug},
        )
        assert r.status_code == 200
    finally:
        db.delete(org)
        db.commit()


def test_rename_does_not_change_slug(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    org = crud.create_organization(
        session=db, org_in=OrganizationCreate(name=f"Original {uuid.uuid4().hex[:8]}")
    )
    original_slug = org.slug
    try:
        r = client.patch(
            f"{settings.API_V1_STR}/organizations/{org.id}",
            headers=superuser_token_headers,
            json={"name": "Completely Different Name"},
        )
        assert r.status_code == 200
        assert r.json()["slug"] == original_slug
    finally:
        db.delete(org)
        db.commit()
```

- [ ] **Step 2: Run to verify failure**

```bash
cd backend
/Users/ahancock/dev/quiz-reference-demo/.venv/bin/pytest tests/api/routes/test_slug_routes.py -q
```

Expected: FAIL — slug lookups 404 or return validation errors, since the path parameter
is still typed `uuid.UUID`.

- [ ] **Step 3: Add the resolver**

In `backend/app/crud.py`:

```python
def resolve_by_id_or_slug(*, session: Session, model: type, value: str) -> Any | None:
    try:
        pk = uuid.UUID(value)
    except ValueError:
        return session.exec(select(model).where(model.slug == value)).first()
    return session.get(model, pk)
```

- [ ] **Step 4: Use it in the organization routes**

In `backend/app/api/routes/organizations.py`, change every handler's path parameter from
`id: uuid.UUID` to `id: str` and replace `session.get(Organization, id)` with
`crud.resolve_by_id_or_slug(session=session, model=Organization, value=id)`. For example
`read_organization` (line 29) becomes:

```python
@router.get("/{id}", response_model=OrganizationPublic)
def read_organization(session: SessionDep, id: str) -> Any:
    org = crud.resolve_by_id_or_slug(session=session, model=Organization, value=id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org
```

Apply the same change to `update_organization` (line 46) and `delete_organization`
(line 62). The 403 superuser checks stay exactly as they are.

- [ ] **Step 5: Add slug-conflict validation to update_organization**

In `crud.py`, `update_organization` becomes:

```python
def update_organization(
    *, session: Session, db_org: Organization, org_in: OrganizationUpdate
) -> Organization:
    data = org_in.model_dump(exclude_unset=True)
    if data.get("slug") is not None:
        existing = session.exec(
            select(Organization).where(Organization.slug == data["slug"])
        ).first()
        if existing and existing.id != db_org.id:
            raise ValueError("Slug already in use")
    db_org.sqlmodel_update(data)
    session.add(db_org)
    session.commit()
    session.refresh(db_org)
    return db_org
```

And in `organizations.py`, wrap the call in `update_organization`:

```python
    try:
        return crud.update_organization(session=session, db_org=org, org_in=org_in)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
```

- [ ] **Step 6: Apply the same three changes to competitions and quizzes**

In `backend/app/api/routes/competitions.py`: `read_competition`, `read_competition_podium`,
`update_competition`, and `delete_competition` take `id: str` and resolve via
`crud.resolve_by_id_or_slug(session=session, model=Competition, value=id)`.
`crud.update_competition` gains the same slug-conflict check (querying `Competition`), and
the route wraps it in the same `try/except ValueError` → 409.

In `backend/app/api/routes/quizzes.py`: every handler whose path parameter is the quiz id
takes `id: str` and resolves via
`crud.resolve_by_id_or_slug(session=session, model=Quiz, value=id)`.
`crud.update_quiz` gains the same slug-conflict check (querying `Quiz`), and its route
wraps it the same way.

Also in `competitions.py`, `_competition_public` already loads the `Organization` to fill
`organization_name` — fill `organization_slug` from the same object:

```python
    return CompetitionPublic(
        **competition.model_dump(),
        organization_name=org.name if org else None,
        organization_slug=org.slug if org else None,
    )
```

- [ ] **Step 7: Populate the denormalized quiz and competition slugs**

In `backend/app/crud.py`:
- `get_player_history_grouped` builds `PlayerResultWithQuiz(...)` — add `quiz_slug=quiz.slug`, and add `competition_slug=competition.slug if competition else None` to the `PlayerCompetitionGroup(...)` construction. The grouped query already selects `Competition`; capture its slug in the `competition_names` pass by tracking a parallel `competition_slugs` dict keyed the same way.
- `get_player_competition_history` builds `PlayerResultWithQuiz(...)` — add `quiz_slug=quiz.slug`.

In `backend/app/api/routes/competitions.py`, `read_competition_podium` builds
`CompetitionEventPodium(...)` — add `quiz_slug=event.slug`.

- [ ] **Step 8: Accept a slug on the competition-history filter**

In `backend/app/api/routes/players.py`, rename the query parameter `competition_id` to
`competition` and type it `str | None = None`. Resolve before calling crud:

```python
    competition_uuid: uuid.UUID | None = None
    if competition is not None:
        resolved = crud.resolve_by_id_or_slug(
            session=session, model=Competition, value=competition
        )
        if not resolved:
            raise HTTPException(status_code=404, detail="Competition not found")
        competition_uuid = resolved.id
```

Then pass `competition_id=competition_uuid` to `get_player_competition_history`, whose
signature is unchanged. `competition=None` still means the ungrouped bucket.

- [ ] **Step 9: Run the full backend suite**

```bash
cd backend
/Users/ahancock/dev/quiz-reference-demo/.venv/bin/pytest tests/ -q
```

Expected: PASS except the one known pre-existing failure
(`test_search_by_country_matches_multiple_countries`). Any other failure is real.

- [ ] **Step 10: Commit**

```bash
git add backend/
git commit -m "feat(backend): resolve entity routes by UUID or slug

Detail, update, and delete routes for organizations, competitions, and
quizzes accept either form. Slug conflicts on update return 409."
```

---

### Task 4: Frontend — slug URLs and admin editing

Atomic: regenerating the client changes the path-parameter types and adds the slug
fields, so every consumer moves together. Ends with `bun run build` and `bun run lint`
green.

**Files:**
- Regenerate: `frontend/src/client/`
- Rename: `frontend/src/routes/_public/quizzes_.$id.tsx` → `quizzes_.$slug.tsx`; `organizations_.$id.tsx` → `organizations_.$slug.tsx`; `competitions_.$id.tsx` → `competitions_.$slug.tsx`; `players_.$slug_.competitions.$competitionId.tsx` → `players_.$slug_.competitions.$competitionSlug.tsx`
- Modify: `routes/_public/competitions.tsx:53`, `routes/_public/organizations.tsx:44`, `routes/_home/index.tsx:43`, `components/Events/columns.tsx:12`, `components/Players/historyColumns.tsx:14`, `components/Competitions/CompetitionPodium.tsx:77`, `components/Players/PlayerProfile.tsx:92`
- Modify: `components/Admin/CompetitionDialog.tsx`, `components/Admin/OrganizationDialog.tsx`, `routes/_layout/admin_.quizzes_.$id.tsx`
- Modify: `frontend/tests/` specs

**Interfaces:**
- Consumes: Task 3's API. After regeneration the client's detail methods take `id: string` (was a UUID-formatted string), and `CompetitionPublic` / `QuizPublic` / `OrganizationPublic` carry `slug`, with `organization_slug`, `quiz_slug`, and `competition_slug` on the denormalized models.
- Produces: URLs `/quizzes/$slug`, `/organizations/$slug`, `/competitions/$slug`, `/players/$slug/competitions/$competitionSlug`.

- [ ] **Step 1: Rebuild the backend image and regenerate the client**

The generator reads the schema from the running backend, which serves a baked image:

```bash
docker compose up -d --build backend
bash ./scripts/generate-client.sh
```

- [ ] **Step 2: Verify the regenerated client**

```bash
grep -n "slug" frontend/src/client/types.gen.ts | grep -iE "organization_slug|quiz_slug|competition_slug" | head
```

Expected: the three denormalized fields are present. If they are missing, Task 3 Step 7
was not applied or the backend image was not rebuilt — fix that before continuing.

- [ ] **Step 3: Rename the route files**

```bash
cd frontend/src/routes/_public
git mv quizzes_.\$id.tsx quizzes_.\$slug.tsx
git mv organizations_.\$id.tsx organizations_.\$slug.tsx
git mv competitions_.\$id.tsx competitions_.\$slug.tsx
git mv players_.\$slug_.competitions.\$competitionId.tsx \
       players_.\$slug_.competitions.\$competitionSlug.tsx
```

- [ ] **Step 4: Update each renamed route's internals**

In each renamed file, update the `createFileRoute` string and the params destructure:

- `quizzes_.$slug.tsx`: `createFileRoute("/_public/quizzes_/$slug")`; `const { slug } = Route.useParams()`; pass `slug` where the service call previously took `id`.
- `organizations_.$slug.tsx`: `createFileRoute("/_public/organizations_/$slug")`; same pattern.
- `competitions_.$slug.tsx`: `createFileRoute("/_public/competitions_/$slug")`; same pattern. Its query keys become `["competitions", slug]` and `["competitions", slug, "podium"]` — keep the plural first element so the admin dialog's `invalidateQueries({ queryKey: ["competitions"] })` still prefix-matches.
- `players_.$slug_.competitions.$competitionSlug.tsx`: `createFileRoute("/_public/players_/$slug_/competitions/$competitionSlug")`; `const { slug, competitionSlug } = Route.useParams()`. The service call passes `competition: competitionSlug === "none" ? undefined : competitionSlug`.

- [ ] **Step 5: Update every link site**

Apply exactly these:

| File | Change |
|---|---|
| `routes/_public/competitions.tsx:53` | `to="/competitions/$slug"`, `params={{ slug: competition.slug }}` |
| `routes/_public/organizations.tsx:44` | `to="/organizations/$slug"`, `params={{ slug: org.slug }}` |
| `routes/_public/organizations_.$slug.tsx:61` | `to="/competitions/$slug"`, `params={{ slug: s.slug }}` |
| `routes/_public/competitions_.$slug.tsx:45` | `to="/organizations/$slug"`, `params={{ slug: competition.organization_slug }}` |
| `routes/_home/index.tsx:43` | `to="/quizzes/$slug"`, `params={{ slug: quiz.slug }}` |
| `components/Events/columns.tsx:12` | `to="/quizzes/$slug"`, `params={{ slug: row.original.slug }}` |
| `components/Players/historyColumns.tsx:14` | `to="/quizzes/$slug"`, `params={{ slug: row.original.quiz_slug }}` |
| `components/Competitions/CompetitionPodium.tsx:77` | `to="/quizzes/$slug"`, `params={{ slug: row.original.quiz_slug }}` |
| `components/Players/PlayerProfile.tsx:92` | `to="/players/$slug/competitions/$competitionSlug"`, `params={{ slug, competitionSlug: group.competition_slug ?? "none" }}` |

Admin links in `routes/_layout/admin_.quizzes.tsx:62,76` keep `params={{ id: quiz.id }}` —
those routes are unchanged.

- [ ] **Step 6: Add slug inputs to the admin dialogs**

In `components/Admin/CompetitionDialog.tsx` and `components/Admin/OrganizationDialog.tsx`,
add a `slug` text field to the form, defaulting to the entity's current slug when editing
and omitted entirely when creating (the server derives it). Follow the field markup the
neighbouring `name` field already uses. On a 409 response, surface the API's `detail`
string as a field-level error on `slug` rather than a generic toast.

Do the same for the quiz metadata edit form in `routes/_layout/admin_.quizzes_.$id.tsx`.

- [ ] **Step 7: Build and lint**

```bash
cd frontend
bun run build
bun run lint
```

Expected: both PASS. Type errors point at a missed link site — read the error and fix the
symbol. If `bun run build` type-checks against a stale `routeTree.gen.ts`, run
`bunx vite build` once to force regeneration, then re-run `bun run build`.

- [ ] **Step 8: Update the E2E specs**

In `frontend/tests/`, update any spec asserting a detail URL to expect a slug. In
`competitions-public.spec.ts` and `players.spec.ts`, URL assertions of the form
`/competitions/${id}` become slug-based; capture the slug from the API response the spec
already creates rather than hardcoding one. Keep every existing assertion — only the URL
shape changes.

Add one spec asserting a competition detail page loads by slug and that its
organization link navigates to `/organizations/<org-slug>`.

- [ ] **Step 9: Run Playwright**

Stop the Docker frontend first, or it shadows port 5173 and Playwright tests a stale
build:

```bash
docker compose stop frontend
cd frontend
bunx playwright test
docker compose start frontend
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): slug-based URLs for quizzes, organizations, competitions

Regenerates the client and moves the four public detail routes onto slugs.
Admin dialogs gain a slug field with 409 conflict handling."
```

---

### Task 5: Verification across both database targets

**Files:** none modified. This task runs and observes.

**Interfaces:**
- Consumes: everything from Tasks 1-4.
- Produces: confirmation both database volumes are migrated and the feature works end to end.

- [ ] **Step 1: Confirm dev**

```bash
docker compose up -d --build
docker compose exec -T db psql -U postgres -d app -c "SELECT version_num FROM alembic_version;"
curl -s localhost:8000/api/v1/competitions/ | head -c 300
```

Expected: `b4c8e1f7a2d9`, and competition JSON including a `slug` field.

- [ ] **Step 2: Check both resolution forms against the live API**

```bash
SLUG=$(curl -s localhost:8000/api/v1/competitions/ | python3 -c "import sys,json; print(json.load(sys.stdin)['data'][0]['slug'])")
ID=$(curl -s localhost:8000/api/v1/competitions/ | python3 -c "import sys,json; print(json.load(sys.stdin)['data'][0]['id'])")
curl -s -o /dev/null -w "by slug: %{http_code}\n" "localhost:8000/api/v1/competitions/$SLUG"
curl -s -o /dev/null -w "by uuid: %{http_code}\n" "localhost:8000/api/v1/competitions/$ID"
curl -s -o /dev/null -w "unknown: %{http_code}\n" "localhost:8000/api/v1/competitions/no-such-slug"
```

Expected: `200`, `200`, `404`.

- [ ] **Step 3: Migrate staging**

Edit the root `.env`, set `DB_TARGET=staging`, then:

```bash
docker compose up -d --build
docker compose logs prestart | tail -20
docker compose exec -T db psql -U postgres -d app -c "SELECT version_num FROM alembic_version;"
```

`--build` is required: `prestart` runs from a baked image with no source sync, so a plain
`up -d` would run the old image, apply nothing, and exit zero.

Expected: prestart logs `Running upgrade a7b3c9d1e2f4 -> b4c8e1f7a2d9`; version confirms.
Staging holds reference data only (1 organization, 2 quiz formats, no players/quizzes/
competitions as of 2026-08-04), so the backfill has almost nothing to do — the organization
row should still gain a slug. Verify with:

```bash
docker compose exec -T db psql -U postgres -d app -c "SELECT name, slug FROM organization;"
```

- [ ] **Step 4: Return to dev**

Set `DB_TARGET=dev` in the root `.env` and run `docker compose up -d --build`. Confirm the
backend logs `Database target: dev`. **Never run `docker compose down -v`.**

- [ ] **Step 5: Final checks**

```bash
cd backend && /Users/ahancock/dev/quiz-reference-demo/.venv/bin/pytest tests/ -q
cd ../frontend && bun run build && bun run lint
```

Expected: backend passes except the one known pre-existing failure; frontend clean.

- [ ] **Step 6: Confirm a clean tree**

```bash
git status
```

Expected: clean, or only `frontend/src/routeTree.gen.ts` if a run regenerated it — commit
it if so.
