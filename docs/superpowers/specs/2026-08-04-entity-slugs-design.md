# Slugs for quizzes, organizations, and competitions

**Date:** 2026-08-04
**Status:** Approved
**Base branch:** `add-slugs-for-quiz-and-competition`, forked from `main` at `27003a2`

## Problem

Quizzes, organizations, and competitions are addressed by UUID in public URLs:
`/competitions/8f3a91bc-…`. Players already have readable URLs
(`/players/sean-codeplayer`) via a `slug` column. This spec extends that treatment to
the other three public entities.

## Decisions

Settled during design:

1. **Slugs replace UUIDs in public URLs.** `/competitions/world-quiz-championship`.
2. **Quiz slugs include the start date.** Quiz names repeat constantly ("Weekly Quiz"),
   so a name-only slug degrades into `weekly-quiz-47`. Appending `start_date` keeps
   slugs meaningful and collisions rare.
3. **Slugs are frozen at creation and editable by superusers.** Renaming an entity does
   not regenerate its slug, so existing links keep working. The slug may drift from the
   name; that is accepted.
4. **Columns are NOT NULL and unique**, backfilled for existing rows. Routing can rely
   on a slug always existing.
5. **The existing path parameter accepts either a UUID or a slug** rather than adding a
   separate `/by-slug/` endpoint.
6. **The nested player-history route uses competition slugs too**, so no competition URL
   is left carrying a UUID.

### Accepted divergence

Decision 5 diverges from `Player`, which keeps a separate
`GET /players/by-slug/{slug}` endpoint alongside `GET /players/{player_id}`. After this
change the codebase has two conventions for slug lookup. This was chosen deliberately;
migrating `Player` to the polymorphic form is out of scope.

## Slug helpers

`crud.py` currently holds `_generate_slug`, hardcoded to query `Player`. Extract two
reusable functions and have `Player` use them:

```python
def slugify(text: str) -> str:
    """Diacritic-strip, lowercase, collapse to hyphens."""


def generate_unique_slug(*, session: Session, model: type, base: str) -> str:
    """Return `base`, or `base-2`, `base-3`, … until unique for `model`."""
```

`slugify` normalises with NFD and drops combining marks before the existing
character-class pass, so `Café` yields `cafe`. The current helper leaves `café`, which
is awkward in a URL. This is a **behaviour change for newly created players**; existing
player slugs are frozen and unaffected. Em-dashes (`Summer League — Quiz 10`) already
collapse correctly under the existing rules and continue to.

`generate_unique_slug` takes the model class so one implementation serves all four
entities.

Composition per entity:

| Entity | Slug base |
|---|---|
| Organization | `slugify(name)` |
| Competition | `slugify(name)` |
| Quiz | `slugify(name) + "-" + start_date.isoformat()` |
| Player (unchanged) | `slugify(display_name)` |

Example: `Summer League — Quiz 10` starting 2025-09-08 → `summer-league-quiz-10-2025-09-08`.

## Data model

Add to `Quiz`, `Organization`, and `Competition` table models:

```python
slug: str = Field(unique=True, index=True, max_length=255)
```

Add `slug` to each entity's `*Public` model (so list endpoints return it for link
construction) and to each `*Update` model (so superusers can edit it).
`OrganizationCreate`, `CompetitionCreate`, and `QuizCreate` do **not** take a slug — it
is always derived server-side at creation.

Add `competition_slug: str | None` to `PlayerCompetitionGroup`, alongside the existing
`competition_id` and `competition_name`. It is nullable because the ungrouped bucket has
no competition.

## Migration

One Alembic revision with `down_revision = "a7b3c9d1e2f4"` (verified current head, in
code and in the live `alembic_version` table). For each of the three tables, three
phases:

1. Add `slug` as a nullable `VARCHAR(255)` column.
2. Backfill every existing row (30 quizzes, 2 organizations, 5 competitions in dev).
3. `ALTER COLUMN … SET NOT NULL` and create a unique index.

The backfill reimplements the slug rules inline rather than importing from `app.crud`,
so the migration stays self-contained and reproducible — importing application code into
a migration breaks the moment that code changes.

Backfill must be deterministic: iterate rows ordered by primary key, and track slugs
assigned within the transaction so the uniqueness counter accounts for rows not yet
committed. Two organizations named "Test Org" must produce `test-org` and `test-org-2`
in a stable order, not race.

`downgrade()` drops the three columns and their indexes.

Apply to both database targets (`DB_TARGET=dev` and `DB_TARGET=staging`), each with
`docker compose up -d --build` so `prestart` runs current code.

## API

A shared resolver in `crud.py`:

```python
def resolve_by_id_or_slug(*, session: Session, model: type, value: str):
    try:
        pk = uuid.UUID(value)
    except ValueError:
        return session.exec(select(model).where(model.slug == value)).first()
    return session.get(model, pk)
```

Applied uniformly to `GET`, `PATCH`, and `DELETE` on `/quizzes/{…}`,
`/organizations/{…}`, and `/competitions/{…}` — the parameter means the same thing on
every verb rather than varying by method.

Path parameter types change from `uuid.UUID` to `str`, which changes the OpenAPI schema
and therefore regenerates the client. Handlers that currently declare `id: uuid.UUID`
become `id: str` and resolve through the helper. A 404 is raised when the resolver
returns `None`, exactly as the current `session.get` checks do.

**Known edge case, undefended:** a slug that happens to parse as a UUID resolves as an
id and 404s. This requires someone to name an entity as a bare UUID. Not worth a guard.

The competition-history endpoint gains slug support:
`GET /players/{player_id}/competition-history?competition={id_or_slug}`. The existing
`competition_id` query parameter is renamed to `competition` and accepts either form,
with `None` still meaning the ungrouped bucket.

### Update validation

Each `PATCH` validates a supplied `slug` for uniqueness before writing, following the
mechanism `update_player` already uses: the crud function raises
`ValueError("Slug already in use")` when the slug belongs to a different row of the same
model, and the route converts it with
`except ValueError as e: raise HTTPException(status_code=409, detail=str(e))` —
the exact pattern at `players.py:248-249`. A slug equal to the row's current value is a
no-op, not a conflict.

## Frontend

### Route files

The detail-route parameter now carries a slug, so the files are renamed:

| Old | New | URL |
|---|---|---|
| `_public/quizzes_.$id.tsx` | `_public/quizzes_.$slug.tsx` | `/quizzes/$slug` |
| `_public/organizations_.$id.tsx` | `_public/organizations_.$slug.tsx` | `/organizations/$slug` |
| `_public/competitions_.$id.tsx` | `_public/competitions_.$slug.tsx` | `/competitions/$slug` |
| `_public/players_.$slug_.competitions.$competitionId.tsx` | `_public/players_.$slug_.competitions.$competitionSlug.tsx` | `/players/$slug/competitions/$competitionSlug` |

Admin routes keep UUIDs: `_layout/admin_.quizzes_.$id.tsx` is unchanged, because admin
pages work from ids the list endpoints hand them. `routeTree.gen.ts` regenerates from
the filenames.

The `"none"` sentinel in the nested competition route is preserved — it represents
results not belonging to any competition and is not a slug.

### Link sites

Every `Link` to a detail page passes `.slug` instead of `.id`. List endpoints already
return whole objects, so the slug is available without extra fetches. Sites include the
competitions list, organizations list, quizzes list, player profile competition group
headings, the competition podium, and the home page's recent-quizzes section.

`PlayerProfile.tsx` passes `competitionSlug: group.competition_slug ?? "none"`.

### Admin editing

A `slug` input joins the admin dialogs for quizzes, organizations, and competitions,
pre-filled with the current value, matching how `EditPlayerDialog` already exposes
`slug`. A 409 from the API surfaces as a field-level "that slug is already taken" error.

## Testing

**Backend.** Unit coverage for `slugify` (diacritics, em-dash, punctuation, collapsing
whitespace, leading/trailing hyphens) and `generate_unique_slug` (counter behaviour).
Per entity: slug generated on create; quiz slug includes the start date; duplicate names
produce `-2`; `GET` resolves by both UUID and slug; `GET` by unknown slug 404s; `PATCH`
with a duplicate slug returns 409; `PATCH` with the row's own slug succeeds; renaming
does not change the slug. Plus the migration's backfill determinism.

**Frontend E2E.** Navigating to each detail page by slug; the nested player-history route
by competition slug; the `"none"` bucket still resolving; admin slug editing round-trip.

Test cleanup stays non-destructive — fixtures delete only rows they create, tracked by id
diff. Never a table-wide delete.

## Out of scope

- Migrating `Player` to the polymorphic `{id_or_slug}` form. It keeps `/players/by-slug/{slug}`.
- Redirects from old UUID URLs. UUIDs still resolve in the same path position, so existing
  links keep working without redirect machinery.
- Regenerating slugs on rename, or slug history/aliases.
- Changing how `Player` slugs are composed, beyond the diacritic-stripping improvement
  that follows from sharing `slugify`.
