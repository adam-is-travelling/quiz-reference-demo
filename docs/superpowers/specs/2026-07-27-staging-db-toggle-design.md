# Toggleable dev / staging database

**Date:** 2026-07-27
**Status:** Approved (pending spec review)

## Goal

Let a developer run the local stack against either the existing **dev** database or a
separate, persistent **staging** database that holds a curated known-good dataset, and
toggle between them with a single env var. Staging lives in its own volume so dev churn
(resets, re-seeds) never touches it. Startup logs clearly state which database is active.

## Scope

- Local development only (`compose.yml` + `compose.override.yml` + `.env`).
- No application/business-logic changes beyond a config field and two startup log lines.
- No new DB tables or migrations.

## Design

### Volume selection by `DB_TARGET`

The single `db` service mounts one of two named volumes, chosen by `DB_TARGET`:

```yaml
# compose.yml — db service
    volumes:
      - app-db-${DB_TARGET:-dev}-data:/var/lib/postgresql/data/pgdata

# compose.yml — top-level volumes
volumes:
  app-db-dev-data:
    name: quiz-reference-demo_app-db-data   # reuse EXISTING dev volume → no data loss
  app-db-staging-data:                        # new volume for staging
```

- `DB_TARGET=dev` (or unset → defaults to `dev`) mounts the existing dev data. Non-breaking.
- `DB_TARGET=staging` mounts a separate new volume.
- Backend/prestart connect to the same host (`db`) and port (`5432`); only the mounted
  volume changes. Only one database runs at a time, which matches an env-var toggle.

The `name:` mapping pins `app-db-dev-data` to the already-existing physical volume
`quiz-reference-demo_app-db-data` (confirmed present), so switching to this scheme preserves
current dev data. `app-db-staging-data` resolves to the default project-prefixed name
`quiz-reference-demo_app-db-staging-data`.

### Toggle workflow

In `.env`:

```
DB_TARGET=staging   # or dev, or omit (defaults to dev)
```

Then `docker compose up -d` recreates `db` + `backend` against the selected volume. First
time up with `DB_TARGET=staging`, the existing `prestart` service runs migrations and
creates the superuser on the empty staging volume, so it is immediately usable; the
developer then curates data into it. No dump/restore tooling is built (out of scope).

### Startup log lines

The backend must announce the active database at startup, without logging the password.

1. Add a field to `Settings` (`backend/app/core/config.py`), which currently uses
   `extra="ignore"`:

   ```python
   DB_TARGET: str = "dev"
   ```

2. Pass `DB_TARGET` into both the `prestart` and `backend` service environments in
   `compose.yml`:

   ```yaml
       - DB_TARGET=${DB_TARGET:-dev}
   ```

3. Log a single clear line in two places:

   - `backend/app/backend_pre_start.py` `main()` (logs once during prestart):
     ```python
     logger.info(
         "Database target: %s (host=%s port=%s db=%s)",
         settings.DB_TARGET, settings.POSTGRES_SERVER,
         settings.POSTGRES_PORT, settings.POSTGRES_DB,
     )
     ```
     (import `settings` from `app.core.config`)

   - `backend/app/main.py` at module load (logs when the API boots):
     ```python
     import logging
     logging.getLogger(__name__).info(
         "Database target: %s (host=%s port=%s db=%s)",
         settings.DB_TARGET, settings.POSTGRES_SERVER,
         settings.POSTGRES_PORT, settings.POSTGRES_DB,
     )
     ```

   The password is never included.

### Resetting dev safely (no new code)

`docker compose down` (without `-v`) keeps both volumes. To reset only dev, remove
`quiz-reference-demo_app-db-data`; the staging volume is untouched. `down -v` still wipes
everything and remains forbidden per existing team guidance.

## Documentation

Add a short "Dev vs staging database" subsection to `CLAUDE.md` covering the `DB_TARGET`
toggle, the persistence/isolation guarantee, and the safe dev-reset command. Record the
same in project memory.

## Testing / verification

Manual (infra change, no unit tests):

1. With `DB_TARGET` unset/`dev`, `docker compose up -d`; confirm existing dev data is
   present and the startup log reads `Database target: dev ...`.
2. Set `DB_TARGET=staging`, `docker compose up -d`; confirm the log reads
   `Database target: staging ...`, the staging DB is migrated with the superuser present
   but otherwise empty.
3. Switch back to `dev`; confirm the original dev data is still intact.
4. Confirm `docker volume ls` shows both `quiz-reference-demo_app-db-data` and
   `quiz-reference-demo_app-db-staging-data`.

## Out of scope

- Dump/restore or dev→staging copy tooling.
- Running dev and staging simultaneously.
- Any remote/hosted staging environment (this is local only).
- New DB tables or migrations.
