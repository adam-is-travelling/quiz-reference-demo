# Per-round statistics eligibility flag on QuizFormat

**Date:** 2026-07-28
**Status:** Approved (pending spec review)

## Goal

Add a boolean flag to a quiz format indicating whether its rounds are eligible for
per-round statistics (e.g. topic rounds like History/Sports that could later have their own
sub-standings), versus plain positional rounds (R1, R2) that are not. This task delivers
only the flag (model + migration + admin UI + API); computing/showing per-round statistics
is out of scope.

## Scope

- One format-level boolean: `per_round_stats_eligible`, default `false`.
- No new tables; one additive, non-breaking column migration.
- No changes to how rounds themselves are stored or displayed.

## Backend

### Model (`backend/app/models.py`)

Add `Boolean` to the sqlalchemy import (`from sqlalchemy import Boolean, JSON, Column, DateTime, UniqueConstraint`).

- `QuizFormatBase` gains the field (so it flows into `QuizFormatCreate` and `QuizFormatPublic`):

  ```python
  per_round_stats_eligible: bool = False
  ```

- `QuizFormat` (table) overrides the column with a server default so existing rows backfill
  to `false` (mirroring how `rounds` overrides its column):

  ```python
  per_round_stats_eligible: bool = Field(
      default=False,
      sa_column=Column(Boolean, nullable=False, server_default="false"),
  )
  ```

- `QuizFormatUpdate` gains:

  ```python
  per_round_stats_eligible: bool | None = None
  ```

- `QuizFormatPublic` inherits the field from `QuizFormatBase` — no change needed.

### Migration

A hand-written Alembic migration (down_revision = current head `e7a1b2c3d4f5`) that adds the
column non-destructively:

```python
def upgrade():
    op.add_column(
        "quizformat",
        sa.Column(
            "per_round_stats_eligible",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )

def downgrade():
    op.drop_column("quizformat", "per_round_stats_eligible")
```

Plain boolean column with a server default — existing formats get `false`, no native enum,
no `ALTER TYPE`.

### CRUD / route

No change. `create_format` (`crud.py:665`, `model_validate`) and `update_format`
(`sqlmodel_update` with `exclude_unset`) already pass base fields through generically, and
the formats route forwards `format_in`.

## Frontend

- Regenerate the client (`bash ./scripts/generate-client.sh`) so `per_round_stats_eligible:
  boolean` appears on the format types.
- `frontend/src/components/Admin/FormatDialog.tsx`: add a checkbox to the form (react-hook-form
  field), labeled **"Rounds eligible for per-round statistics"**, defaulting to the format's
  current value (or `false` for new). Include it in both the create and update payloads. Add
  it to the zod schema as `z.boolean()`.
- `frontend/src/routes/_layout/admin_.formats.tsx`: show a small muted badge (e.g.
  "Per-round stats") on formats where `per_round_stats_eligible` is `true`.

## Tests

- **Backend** (`backend/tests/api/routes/test_formats.py`):
  - Creating a format with `per_round_stats_eligible: true` persists and returns it `true`.
  - Creating a format without the field defaults to `false` in the response.
  - Updating a format flips the flag (`false` → `true`) and it persists.
- **Frontend E2E** (extend `frontend/tests/` format coverage): as the superuser, create a
  format with the checkbox enabled and confirm the flag persists (badge shown / value round-trips).

## Out of scope

- Computing or displaying per-round / per-topic statistics or sub-standings.
- Any per-round (rather than per-format) flag.
- Backfilling existing formats to anything other than the default `false`.
