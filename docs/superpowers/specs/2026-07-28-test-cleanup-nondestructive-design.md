# Non-destructive test cleanup

**Date:** 2026-07-28
**Status:** Approved (pending spec review)

## Goal

Tests may run against the dev database, but no test may delete data it did not create.
Eliminate the unconditional, table-wide deletes in the backend test suite that wiped
real dev data (quizzes/players), and add a durable guard so they can't be reintroduced.

## Background / root cause

A run of the full backend suite against the dev DB deleted pre-existing quizzes because
three fixtures issue **unconditional** deletes (no `WHERE`), removing rows regardless of
who created them:

1. `backend/tests/api/routes/test_players.py:19-24` — module-scoped `clear_accumulated_data`
   runs `DELETE FROM quiz` and `DELETE FROM player` with no filter. **Primary cause.**
2. `backend/tests/conftest.py:42-46` — the session teardown preserves pre-existing rows only
   when a table was non-empty at session start (`if pre[model]:`); when a table started
   empty it runs `delete(model)` with no `WHERE`, deleting everything.
3. `backend/tests/api/routes/test_player_merge.py:28` — `DELETE FROM player_merge_audit`
   with no filter.

Every other backend fixture already uses the safe pattern (snapshot row IDs before the
test, delete only IDs not present before). The frontend E2E tests are already safe (every
delete targets a specific id). The `db.delete(leftover)` calls in `test_organizations.py`
and `test_series.py` delete a single object the test itself created (scoped, safe).

Guiding principle when cleanup completeness and safety conflict: **prefer leaving stray
test rows behind over ever deleting data a test did not create.**

## Fix

### 1. `backend/tests/api/routes/test_players.py`

Remove the `clear_accumulated_data` module fixture entirely (lines 19-24). The per-test
`clean_player_data` fixture below it already deletes only rows created during each test.
The affected tests assert membership (`created_id in results`) or query a specific created
player, and the "empty result" tests rely on endpoint behavior for absent/invalid params
— none require a globally empty table, so removing the wipe does not break them.

### 2. `backend/tests/conftest.py`

Change the session teardown so a model with an empty pre-snapshot is **skipped** rather than
wiped. Only ever delete rows whose IDs are not in the pre-existing snapshot:

```python
        # Delete rows created during the session, preserving everything that
        # pre-existed. Never issue an unconditional delete: if a table had no
        # pre-existing rows we cannot distinguish test-created rows from data
        # added by anything else, so we leave them (prefer a leak over deleting
        # data a test did not create).
        for model in (QuizResult, Quiz, QuizFormat, QuizSeries, Player, Organization, User):
            if not pre[model]:
                continue
            session.execute(
                delete(model).where(~col(model.id).in_(pre[model]))
            )
        session.commit()
```

On the dev DB these tables are non-empty (users, players, etc. pre-exist), so cleanup of
session-created rows continues to work exactly as before; only the destructive empty-table
branch changes.

### 3. `backend/tests/api/routes/test_player_merge.py`

Replace the unconditional audit delete with a snapshot-diff, matching the fixture's existing
pattern for quizzes/players. Capture pre-existing audit IDs before `yield`, delete only new
ones after:

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

## Regression guard (automated)

Add `backend/tests/test_cleanup_safety.py`: a meta-test that parses every module under
`backend/tests/` with `ast` and fails if any `delete(<Model>)` statement-delete is not
immediately wrapped by a `.where(...)` call. It distinguishes the SQLAlchemy/SQLModel
`delete(Model)` statement builder (flagged when unfiltered) from `client.delete(...)` HTTP
calls and `db.delete(obj)` single-object deletes (both ignored). This test fails on the
three offenders today and passes once they are fixed, and prevents reintroduction.

## Verification

1. Automated: the new meta-test goes RED (3 offenders) → GREEN (after fixes). Full backend
   suite still passes: `cd backend && uv run pytest`.
2. Sentinel (proves the real-world requirement): insert clearly-marked pre-existing rows
   into the dev DB (a `SENTINEL_KEEP_ME` player + quiz, an audit row), run the full backend
   suite, and confirm the sentinels still exist afterward. Show this RED (deleted before the
   fix) → GREEN (survive after). Clean the sentinels up at the end.
3. Confirm the frontend E2E suite still passes and remains delete-by-id only.

## Out of scope

- Switching tests to a separate test database — the requirement is explicitly that tests
  run against dev safely, not in isolation.
- Transactional/rollback test isolation (larger change; not needed to meet the requirement).
- The frontend E2E tests (already safe; only verified, not changed).
- The accumulated 682 test users on dev (cosmetic leak; can be cleaned separately if desired).
