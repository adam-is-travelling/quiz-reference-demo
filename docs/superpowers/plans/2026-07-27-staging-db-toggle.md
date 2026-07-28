# Dev / Staging Database Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the local stack run against either the existing dev database or a separate persistent staging database, toggled by a `DB_TARGET` env var, with a startup log line naming the active database.

**Architecture:** A single `db` service selects its data volume via `${DB_TARGET:-dev}` (dev reuses the existing volume; staging gets a new one). A new `Settings.DB_TARGET` field plus a shared log helper announce the target at prestart and backend boot. No application logic changes; no migrations.

**Tech Stack:** Docker Compose, pydantic-settings, FastAPI, pytest.

## Global Constraints

- `DB_TARGET` defaults to `dev` everywhere it is referenced (`${DB_TARGET:-dev}`); an unset var must preserve current behavior (non-breaking).
- Dev volume must remain the existing physical volume `quiz-reference-demo_app-db-data` — no dev data loss.
- Staging volume is separate (`app-db-staging-data` → `quiz-reference-demo_app-db-staging-data`).
- The startup log line must include the target, host, port, and db name, and must NEVER include the password.
- Local development only: changes limited to `compose.yml`, `.env`, backend config/startup files, `CLAUDE.md`. No new DB tables or migrations.

---

### Task 1: Backend `DB_TARGET` setting + startup log line

**Files:**
- Modify: `backend/app/core/config.py` (add `DB_TARGET` field + `format_db_target()` helper)
- Modify: `backend/app/backend_pre_start.py` (log the target in `main()`)
- Modify: `backend/app/main.py` (log the target at module load)
- Test: `backend/tests/unit/test_db_target.py` (new)

**Interfaces:**
- Produces: `Settings.DB_TARGET: str` (default `"dev"`); `app.core.config.format_db_target() -> str`.
- Consumes: existing module-level `settings` instance and its `POSTGRES_SERVER`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_PASSWORD` fields.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_db_target.py`:

```python
from app.core.config import Settings, format_db_target, settings


def test_db_target_field_defaults_to_dev() -> None:
    assert Settings.model_fields["DB_TARGET"].default == "dev"


def test_settings_exposes_db_target() -> None:
    assert isinstance(settings.DB_TARGET, str)
    assert settings.DB_TARGET != ""


def test_format_db_target_names_target_and_host() -> None:
    msg = format_db_target()
    assert f"Database target: {settings.DB_TARGET}" in msg
    assert settings.POSTGRES_SERVER in msg
    assert str(settings.POSTGRES_PORT) in msg
    assert settings.POSTGRES_DB in msg


def test_format_db_target_never_leaks_password() -> None:
    # The password may be blank in some envs; only assert when it is set.
    if settings.POSTGRES_PASSWORD:
        assert settings.POSTGRES_PASSWORD not in format_db_target()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_db_target.py -v`
Expected: FAIL — `ImportError: cannot import name 'format_db_target'` (and `DB_TARGET` field missing).

- [ ] **Step 3: Add the setting field**

In `backend/app/core/config.py`, add the field to the `Settings` class alongside the other Postgres fields (after `POSTGRES_DB: str = ""`, around line 57):

```python
    DB_TARGET: str = "dev"
```

- [ ] **Step 4: Add the log helper**

In `backend/app/core/config.py`, after the module-level `settings = Settings()` line (end of file), add:

```python
def format_db_target() -> str:
    """One-line summary of the active database target for startup logs.

    Never includes the password.
    """
    return (
        f"Database target: {settings.DB_TARGET} "
        f"(host={settings.POSTGRES_SERVER} port={settings.POSTGRES_PORT} "
        f"db={settings.POSTGRES_DB})"
    )
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && uv run pytest tests/unit/test_db_target.py -v`
Expected: PASS (4 tests).

- [ ] **Step 6: Wire the log line into prestart**

In `backend/app/backend_pre_start.py`, update the import and `main()`.

Change the import line `from app.core.db import engine` to also import the helper:

```python
from app.core.config import format_db_target
from app.core.db import engine
```

Update `main()` to log the target first:

```python
def main() -> None:
    logger.info("Initializing service")
    logger.info(format_db_target())
    init(engine)
    logger.info("Service finished initializing")
```

- [ ] **Step 7: Wire the log line into backend boot**

In `backend/app/main.py`, add logging at module load. Update the imports at the top:

```python
import logging

import sentry_sdk
from fastapi import FastAPI
from fastapi.routing import APIRoute
from starlette.middleware.cors import CORSMiddleware

from app.api.main import api_router
from app.core.config import format_db_target, settings
```

Then, immediately after the `from app.core.config import ...` imports and before `custom_generate_unique_id`, add:

```python
logging.getLogger(__name__).info(format_db_target())
```

- [ ] **Step 8: Verify the full unit suite and that the app imports cleanly**

Run: `cd backend && uv run pytest tests/unit/ -v`
Expected: PASS (existing unit tests + the 4 new ones).

Run: `cd backend && uv run python -c "import app.main; print('import ok')"`
Expected: prints a `Database target: ...` log line followed by `import ok`.

- [ ] **Step 9: Commit**

```bash
git add backend/app/core/config.py backend/app/backend_pre_start.py backend/app/main.py backend/tests/unit/test_db_target.py
git commit -m "feat(backend): add DB_TARGET setting and startup log line for active database"
```

---

### Task 2: Compose volume toggle, env wiring, and docs

**Files:**
- Modify: `compose.yml` (db volume interpolation; top-level volumes; `DB_TARGET` env on `prestart` and `backend`)
- Modify: `.env` (add `DB_TARGET=dev` with comment)
- Modify: `CLAUDE.md` (add "Dev vs staging database" subsection)

**Interfaces:**
- Consumes: `Settings.DB_TARGET` / `format_db_target()` from Task 1 (the backend containers read `DB_TARGET` from the environment wired here).

- [ ] **Step 1: Point the db service volume at the target**

In `compose.yml`, in the `db` service, change:

```yaml
    volumes:
      - app-db-data:/var/lib/postgresql/data/pgdata
```

to:

```yaml
    volumes:
      - app-db-${DB_TARGET:-dev}-data:/var/lib/postgresql/data/pgdata
```

- [ ] **Step 2: Declare both named volumes**

In `compose.yml`, change the top-level volumes block:

```yaml
volumes:
  app-db-data:
```

to:

```yaml
volumes:
  app-db-dev-data:
    # Reuse the existing physical volume so current dev data is preserved.
    name: quiz-reference-demo_app-db-data
  app-db-staging-data:
```

- [ ] **Step 3: Pass DB_TARGET into prestart and backend**

In `compose.yml`, add this line to the `environment:` list of BOTH the `prestart` service and the `backend` service (e.g. right after the `- POSTGRES_PASSWORD=...` line in each):

```yaml
      - DB_TARGET=${DB_TARGET:-dev}
```

- [ ] **Step 4: Add DB_TARGET to .env**

In `.env`, under the `# Postgres` section (after `POSTGRES_PASSWORD=changethis`, around line 39), add:

```
# Local database toggle: "dev" (default, existing data) or "staging"
# (separate persistent volume for a curated dataset). Change and re-run
# `docker compose up -d` to switch which database the stack uses.
DB_TARGET=dev
```

- [ ] **Step 5: Validate compose resolves for both targets**

Run: `DB_TARGET=dev docker compose config --volumes`
Expected: lists `app-db-dev-data` and `app-db-staging-data` with no interpolation errors.

Run: `DB_TARGET=staging docker compose config | grep -A2 'app-db-.*-data:/var/lib'`
Expected: the db service mount resolves to `app-db-staging-data:/var/lib/postgresql/data/pgdata`.

- [ ] **Step 6: Verify dev target preserves existing data and logs correctly**

Ensure `.env` has `DB_TARGET=dev` (or unset). Then:

Run: `docker compose up -d db prestart backend`
Then: `docker compose logs backend prestart | grep "Database target"`
Expected: at least one line `Database target: dev (host=db port=5432 db=app)`.

Run: `docker compose exec -T db psql -U postgres -d app -c "select count(*) from quiz;"`
Expected: the existing dev quiz rows are still present (non-zero / your prior data intact).

- [ ] **Step 7: Verify staging target is separate, empty, and migrated**

Edit `.env` → `DB_TARGET=staging`, then:

Run: `docker compose up -d db prestart backend`
Then: `docker compose logs backend prestart | grep "Database target" | tail -2`
Expected: `Database target: staging (host=db port=5432 db=app)`.

Run: `docker compose exec -T db psql -U postgres -d app -c "select count(*) from alembic_version;"`
Expected: `1` (migrations applied on the fresh staging volume).

Run: `docker compose exec -T db psql -U postgres -d app -c "select count(*) from quiz;"`
Expected: `0` (staging starts empty — separate volume).

Run: `docker compose exec -T db psql -U postgres -d app -c "select email from \"user\" where is_superuser;"`
Expected: the FIRST_SUPERUSER email (superuser seeded on staging).

Run: `docker volume ls | grep app-db`
Expected: both `quiz-reference-demo_app-db-data` and `quiz-reference-demo_app-db-staging-data` exist.

- [ ] **Step 8: Switch back to dev and confirm data survived**

Edit `.env` → `DB_TARGET=dev`, then:

Run: `docker compose up -d db prestart backend`
Run: `docker compose exec -T db psql -U postgres -d app -c "select count(*) from quiz;"`
Expected: the original dev quiz count from Step 6 — unchanged, proving staging never touched dev.

- [ ] **Step 9: Document the toggle in CLAUDE.md**

In `CLAUDE.md`, under the `### Environment` subsection of `## Architecture`, add:

```markdown
### Dev vs staging database

The local `db` service selects its data volume via `DB_TARGET` in the root `.env`:

- `DB_TARGET=dev` (default, or unset) — uses the existing dev volume
  (`quiz-reference-demo_app-db-data`). Your throwaway scratch data.
- `DB_TARGET=staging` — uses a separate persistent volume
  (`quiz-reference-demo_app-db-staging-data`) for a curated, known-good dataset.

Switch by editing `DB_TARGET` and re-running `docker compose up -d`. Only one database
runs at a time. The backend logs the active target at startup
(`Database target: <dev|staging> ...`). On first switch to staging, the `prestart` service
runs migrations and seeds the superuser on the empty volume; migrations are idempotent, so
subsequent starts are no-ops.

The two volumes are independent: `docker compose down` (without `-v`) keeps both. To reset
only dev, remove `quiz-reference-demo_app-db-data`; staging is untouched. Never run
`docker compose down -v` (wipes all volumes, including staging).
```

- [ ] **Step 10: Commit**

```bash
git add compose.yml .env CLAUDE.md
git commit -m "feat(compose): toggle dev/staging database volume via DB_TARGET"
```

---

## Notes for the implementer

- `.env` is read by both Docker Compose (for `${DB_TARGET}` interpolation) and the backend
  (`config.py`, which uses `extra="ignore"`, so `DB_TARGET` as a real field is fine).
- The existing physical dev volume is confirmed to be `quiz-reference-demo_app-db-data`.
  The `name:` mapping in Step 2 pins the logical `app-db-dev-data` to it so no data is lost.
- `POSTGRES_SERVER` is `localhost` in `.env` but overridden to `db` for containers in
  `compose.yml`; the log line will show `host=db` inside the container, `host=localhost`
  for local (non-docker) runs. Both are correct for their context.
- This stack serves baked images; after Task 1's backend change, rebuild the backend image
  (`docker compose up -d --build backend`) before the Task 2 verification steps so the
  running container has the new log line.
