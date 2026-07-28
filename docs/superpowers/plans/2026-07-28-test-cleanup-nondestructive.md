# Non-destructive Test Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop backend tests from deleting data they did not create, so the suite can run against the dev database non-destructively, and add a durable guard against reintroduction.

**Architecture:** Remove/rescope the three unconditional table-wide deletes in the test suite (they already coexist with correct snapshot-diff cleanup elsewhere), and add an AST-based meta-test that fails on any `delete(<Model>)` statement lacking a `.where(...)` filter.

**Tech Stack:** pytest, SQLModel/SQLAlchemy, Python `ast`, Postgres (dev DB).

## Global Constraints

- No test may issue an unconditional/table-wide delete; each test deletes only rows it created.
- When cleanup completeness conflicts with safety, prefer leaving stray test rows behind over deleting data a test did not create.
- Tests continue to run against the dev database (no separate test DB, no transactional isolation).
- Only backend test files change; app/product code is untouched.

---

### Task 1: Make test cleanup non-destructive + add regression guard

**Files:**
- Create: `backend/tests/test_cleanup_safety.py`
- Modify: `backend/tests/api/routes/test_players.py` (remove `clear_accumulated_data`)
- Modify: `backend/tests/conftest.py` (skip empty-pre instead of wiping)
- Modify: `backend/tests/api/routes/test_player_merge.py` (scope audit delete)

**Interfaces:** none consumed by other tasks (single-task plan).

- [ ] **Step 1: Write the regression guard (the failing test)**

Create `backend/tests/test_cleanup_safety.py`:

```python
"""Guard: no test may issue an unconditional `delete(<Model>)` statement.

Tests must only delete rows they create. A bare `delete(Model)` (SQLAlchemy/
SQLModel statement builder) with no `.where(...)` deletes an entire table,
which has wiped real dev data before. This meta-test parses every module under
backend/tests/ and fails if any such unfiltered statement-delete exists.

It intentionally ignores `client.delete(...)` (HTTP calls) and `db.delete(obj)`
(single-object deletes) — both have an attribute `func`, not a bare `delete`
name, so they are never flagged.
"""

import ast
from pathlib import Path

TESTS_DIR = Path(__file__).parent


def _unconditional_delete_lines(path: Path) -> list[int]:
    tree = ast.parse(path.read_text(), filename=str(path))

    # delete(...) calls that are the receiver of a `.where(...)` call are safe.
    safe: set[int] = set()
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "where"
            and isinstance(node.func.value, ast.Call)
            and isinstance(node.func.value.func, ast.Name)
            and node.func.value.func.id == "delete"
        ):
            safe.add(id(node.func.value))

    offenders: list[int] = []
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "delete"
            and id(node) not in safe
        ):
            offenders.append(node.lineno)
    return sorted(offenders)


def test_no_unconditional_statement_deletes() -> None:
    offenders: dict[str, list[int]] = {}
    for path in sorted(TESTS_DIR.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        lines = _unconditional_delete_lines(path)
        if lines:
            offenders[str(path.relative_to(TESTS_DIR))] = lines
    assert not offenders, (
        "Unconditional delete(<Model>) statements (no .where filter) found. "
        "Tests must delete only rows they create. Offenders (file -> lines): "
        f"{offenders}"
    )
```

- [ ] **Step 2: Run the guard to verify it fails (RED)**

Run: `cd backend && uv run pytest tests/test_cleanup_safety.py -v`
Expected: FAIL, listing the current offenders — `api/routes/test_players.py: [21, 22]`, `api/routes/test_player_merge.py: [28]`, and `conftest.py: [43]`.

- [ ] **Step 3: Remove the destructive wipe in test_players.py**

In `backend/tests/api/routes/test_players.py`, delete the entire `clear_accumulated_data` module fixture (lines 19-24):

```python
@pytest.fixture(scope="module", autouse=True)
def clear_accumulated_data(db: Session) -> Generator[None, None, None]:
    db.execute(delete(Quiz))
    db.execute(delete(Player))
    db.commit()
    yield
```

Leave the `clean_player_data` per-test fixture (immediately below it) untouched — it already
cleans up only rows created during each test. Do not remove any imports; `Generator`,
`delete`, `col`, and `select` are all still used by `clean_player_data`.

- [ ] **Step 4: Make the conftest teardown skip empty tables instead of wiping**

In `backend/tests/conftest.py`, replace the teardown loop (currently lines 41-47):

```python
        # Delete in FK-safe order, skipping records that pre-existed the test run
        for model in (QuizResult, Quiz, QuizFormat, QuizSeries, Player, Organization, User):
            stmt = delete(model)
            if pre[model]:
                stmt = stmt.where(~col(model.id).in_(pre[model]))
            session.execute(stmt)
        session.commit()
```

with:

```python
        # Delete only rows created during the session, preserving everything that
        # pre-existed. Never issue an unconditional delete: if a table had no
        # pre-existing rows we cannot distinguish test-created rows from data added
        # by anything else, so we leave them (prefer a leak over deleting data a
        # test did not create). Deletes run in FK-safe order.
        for model in (QuizResult, Quiz, QuizFormat, QuizSeries, Player, Organization, User):
            if not pre[model]:
                continue
            session.execute(delete(model).where(~col(model.id).in_(pre[model])))
        session.commit()
```

- [ ] **Step 5: Scope the merge-audit delete to rows created during the test**

In `backend/tests/api/routes/test_player_merge.py`, replace the `clean_merge_data` fixture body (lines 22-35) so the audit delete is snapshot-diffed like the quizzes/players:

```python
@pytest.fixture(autouse=True)
def clean_merge_data(db: Session) -> Generator[None, None, None]:
    pre_players = {r.id for r in db.exec(select(Player)).all()}
    pre_quizzes = {r.id for r in db.exec(select(Quiz)).all()}
    pre_audits = {r.id for r in db.exec(select(PlayerMergeAudit)).all()}
    yield
    db.expire_all()
    new_audit_ids = {r.id for r in db.exec(select(PlayerMergeAudit)).all()} - pre_audits
    if new_audit_ids:
        db.execute(
            delete(PlayerMergeAudit).where(col(PlayerMergeAudit.id).in_(new_audit_ids))
        )
    new_quiz_ids = {r.id for r in db.exec(select(Quiz)).all()} - pre_quizzes
    if new_quiz_ids:
        db.execute(delete(Quiz).where(col(Quiz.id).in_(new_quiz_ids)))
    new_player_ids = {r.id for r in db.exec(select(Player)).all()} - pre_players
    if new_player_ids:
        db.execute(delete(Player).where(col(Player.id).in_(new_player_ids)))
    db.commit()
```

- [ ] **Step 6: Run the guard to verify it passes (GREEN)**

Run: `cd backend && uv run pytest tests/test_cleanup_safety.py -v`
Expected: PASS (no offenders remain).

- [ ] **Step 7: Run the full backend suite (no regressions)**

Run: `cd backend && uv run pytest`
Expected: all tests pass. The `test_players.py` tests assert membership / query specific
created rows and do not require an empty table, so removing the wipe does not break them.

- [ ] **Step 8: Sentinel verification against the dev DB**

Confirm the stack is on dev (`grep DB_TARGET .env` → `dev`). Insert a clearly-marked
pre-existing player, run the whole suite, and confirm it survives:

```bash
docker compose exec -T db psql -U postgres -d app -c \
  "INSERT INTO player (id, display_name, is_published) VALUES (gen_random_uuid(), 'ZZZ_SENTINEL_KEEP_ME', false);"
cd backend && uv run pytest -q
docker compose exec -T db psql -U postgres -d app -c \
  "SELECT count(*) FROM player WHERE display_name = 'ZZZ_SENTINEL_KEEP_ME';"
```
Expected: the count is `1` — the sentinel survived a full suite run. Then remove it:

```bash
docker compose exec -T db psql -U postgres -d app -c \
  "DELETE FROM player WHERE display_name = 'ZZZ_SENTINEL_KEEP_ME';"
```

- [ ] **Step 9: Commit**

```bash
git add backend/tests/test_cleanup_safety.py backend/tests/conftest.py backend/tests/api/routes/test_players.py backend/tests/api/routes/test_player_merge.py
git commit -m "test: make cleanup non-destructive; guard against unconditional table deletes"
```

---

## Notes for the implementer

- The meta-test flags a bare `delete(Model)` (SQLAlchemy statement builder). `conftest.py`'s
  pre-fix `stmt = delete(model)` is flagged because the `.where(...)` is applied on a later
  line to a variable, not chained on the same call; the fixed inline
  `delete(model).where(...)` is recognized as safe.
- Do not touch the frontend E2E tests — they already delete only by specific id, and the
  meta-test only scans `backend/tests/`.
- `PlayerMergeAudit` is already imported in `test_player_merge.py`; `select`/`col`/`delete`
  are imported there too.
- If the full suite surfaces a pre-existing flaky/skip count, compare against the baseline
  rather than assuming this change caused it.
