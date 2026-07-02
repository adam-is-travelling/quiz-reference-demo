# Multi-country players & per-result country

**Date:** 2026-07-01
**Status:** Approved

## Problem

Players can compete under more than one country — sometimes for the UK, sometimes
Ireland, England, etc. Today a `Player` has a single `country` code, which can't
express this. Separately, when a player appears in a quiz result there is no record
of *which* country they competed under for that quiz.

This design gives a player a set of countries and records a country on each quiz
result.

## Decisions

- **Player countries:** `Player.country` (single) becomes `countries` — an
  **ordered list** of country codes where the **first entry is the "primary"** country
  and the rest are "other" countries. Order is meaningful and preserved end-to-end
  (JSON list). The old single value is migrated into the list as the sole/primary entry
  and the old column is dropped. For now the primary is simply the first country added;
  there is no UI to re-designate it (add/remove only).
- **Result country:** `QuizResult` gains an **optional** `country`. It is **not**
  constrained to the player's `countries` list (a player may compete under a country
  not yet in their list). Existing results are **not** backfilled — they stay null.
- **Upload flow:** the normalized per-row CSV country is stored on the created
  `QuizResult`, and when a brand-new player is created during upload their `countries`
  list is seeded with that country. Existing players' `countries` are left unchanged.
- **Frontend scope:** quiz results display the per-result country; player pages
  display *all* of a player's countries; the players search/list column shows a single
  country (first in the list) for simplicity.

All country codes validate against `VALID_COUNTRY_CODES` in
`backend/app/countries.py` (which already includes home nations ENG/SCO/WAL/NIR).

## Backend

### Models (`backend/app/models.py`)

**Player**
- `PlayerBase.country: str | None` → `countries: list[str]` with
  `default_factory=list`. On the table model, back it with a JSON column
  (`sa_column=Column(JSON, nullable=False)`), mirroring `QuizFormat.rounds`. Order is
  significant: `countries[0]` is the primary country, the remainder are "other"
  countries.
- Replace the single-value `validate_country` validator with one that validates every
  code in the list against `VALID_COUNTRY_CODES`, raising `ValueError` on any invalid
  code.
- Propagate to `PlayerCreate` (inherits list), `PlayerUpdate`
  (`countries: list[str] | None = None`, with the same per-item validator applied when
  provided), and `PlayerPublic`.

**QuizResult**
- Add `country: str | None = None` as a nullable table column.
- Validate against `VALID_COUNTRY_CODES` when non-null.
- Add `country: str | None = None` to `QuizResultCreate`, `QuizResultUpdate`,
  `QuizResultPublic`, `QuizResultWithPlayer`, and `PlayerResultWithQuiz`.

**Upload**
- Add `country: str | None = None` to `ResolvedResultRow`. `ParsedResultRow.country`
  already exists.

### Migration (Alembic)

One revision:
- `player`: add `countries` JSON column (non-null, default `[]`); backfill each row
  `countries = [country] if country is not None else []`; drop the `country` column.
- `quizresult`: add nullable `country` column. No backfill.

Downgrade reverses: add `country` back to `player`, populate from first element of
`countries` (best-effort), drop `countries`; drop `quizresult.country`.

### CRUD (`backend/app/crud.py`)

- `search_players`: the `country` filter currently does
  `col(Player.country).ilike(f"%{country}%")`. A JSON list column cannot be filtered
  this way portably across SQLite (tests) and Postgres (prod). The function already
  loads name-matched players into Python to score them, so move the country filter to
  **Python-side membership**: keep only players where `country in p.countries`. Applied
  after the query, before scoring/limiting.
- `create_quiz_results`: set `country` from the `QuizResultCreate` on both the
  create-new and update-existing branches.
- `create_player`: no change — `model_validate` handles `countries` from
  `PlayerCreate`.

### API (`backend/app/api/routes/quizzes.py`)

- `submit_results`: pass `country=row.country` when building each `QuizResultCreate`.
- `parse_results`: unchanged behavior; it still passes `row.country` to
  `search_players`, which now filters by list membership.

## Frontend (`frontend/src/`)

- **New `CountryMultiSelect` component** (`components/ui/`): renders selected countries
  as removable chips (in order, first = primary) plus an add control backed by the
  existing `COUNTRIES` list. Value is `string[]`, `onChange(codes: string[])`; adding
  appends to the end, preserving insertion order.
- **Player form** (`routes/_layout/admin_.players.$id.tsx`): replace the single
  `CountrySelect` with `CountryMultiSelect` bound to a `countries` array field; default
  from `player.countries`. Order is preserved as entered; the first country is the
  primary. There is no "make primary" control for now — the organizer adds/removes and
  the first added stays primary.
- **Player display**: `PlayerProfile.tsx` and the admin player page render the primary
  country (`countries[0]`) distinctly (e.g. emphasized/first badge) followed by the
  "other" countries as additional badges (via `countryName`).
- **Players search/list** (`routes/_public/players.tsx`): the Country column shows the
  **primary** country — `countries[0]` (or "—" when empty).
- **Quiz results table**: add a Country column rendering the per-result country
  (`countryName(result.country)`), "—" when null. The player-history view renders it
  the same way.
- **Upload Step4Disambiguation** (`components/Upload/steps/Step4Disambiguation.tsx`):
  - Mismatch check: `csvCountry !== null && candidate.player.countries.length > 0 &&
    !candidate.player.countries.includes(csvCountry)`.
  - New-player creation: seed `player_create: { display_name, countries: newCountry ?
    [newCountry] : [] }`.
  - The resolved row's `country` (normalized CSV country) flows into
    `ResolvedResultRow.country`.
- **Regenerate the OpenAPI client** (`bash ./scripts/generate-client.sh`) after backend
  changes.

## Testing (TDD)

**Backend**
- Player `countries` validation: rejects invalid codes, accepts valid mixed list
  (incl. home nations), empty list allowed; **order is preserved** so `countries[0]`
  round-trips as the primary through create/update/read.
- `search_players`: filters players by country list membership; a player with the
  country in their list matches, one without does not.
- `submit_results` / `create_quiz_results`: stores `country` on the created result;
  null country allowed.
- Upload path: creating a new player during submit seeds `countries` from the resolved
  row's country.

**Frontend**
- Player form edits multiple countries (add/remove chips, order preserved) and submits
  `countries`.
- Player profile/admin page renders the primary country distinctly plus the other
  country badges.
- Quiz results table renders the per-result country column.
- Step4 mismatch logic flags/does-not-flag correctly against a `countries` list.

## Breaking change

Dropping `Player.country` breaks every current reference (generated client, player
components, upload steps, tests). All are updated as part of this work; there is no
backward-compatibility shim.
