# Rename "series" to "competition"

**Date:** 2026-08-01
**Status:** Approved

## Problem

The domain concept currently called a *series* — a named grouping of quizzes owned by
an organization — is called a *competition* by users. The code, database, HTTP API, and
URLs all say "series". This spec renames the concept everywhere in live code so the
system's vocabulary matches the domain's.

## Decisions

Four decisions were settled during design:

1. **Full rename, including the database.** An Alembic migration renames the table and
   the foreign-key column. The alternative — overriding `__tablename__` and field names
   in SQLModel to preserve the old schema — was rejected because it leaves the database
   permanently disagreeing with the code.
2. **Clean break on URLs and API paths.** No deprecated aliases or redirects. Nothing
   outside this repository consumes the API, and the frontend's generated client is
   regenerated in lockstep.
3. **History is not rewritten.** Existing files under `docs/superpowers/specs/` and
   `docs/superpowers/plans/`, and existing Alembic migration files, keep saying "series".
   They are a dated record of decisions made when the concept had that name.
4. **Model class is `Competition`, table is `competition`.** The `Quiz` prefix is
   dropped rather than becoming `QuizCompetition`.

## Naming rule

Every identifier maps `series` → `competition` and `Series` → `Competition` in place.
Two refinements:

- **Plural-sensitive names get real plurals.** "Series" is invariant; "competition" is
  not. So `seriesList` → `competitionList`, `allSeries` → `allCompetitions`,
  `orgSeries` → `orgCompetitions`, and the list endpoint becomes `/competitions`.
- **`SeriesEventPodium` → `CompetitionEventPodium`.** The "Event" in that name refers to
  a quiz event, not to the series, and stays.

## Database

One new Alembic revision, with `down_revision = "c1d2e3f4a5b6"` (the current head). It
follows the pattern already established by revision `09b03772bf36`, which renamed
`quizevent` → `quiz` and `eventresult` → `quizresult`.

`upgrade()`:

1. `op.rename_table("quizseries", "competition")`
2. Drop FK `quiz_series_id_fkey` on `quiz`
3. `op.alter_column("quiz", "series_id", new_column_name="competition_id")`
4. Recreate the FK as `quiz_competition_id_fkey` → `competition.id`, `ondelete="SET NULL"`
5. Rename constraints and indexes that Postgres carries over unchanged from the table
   rename, so nothing in the schema still reads `quizseries`:
   - `quizseries_pkey` → `competition_pkey`
   - `quizseries_organization_id_fkey` → `competition_organization_id_fkey`

`downgrade()` reverses all five steps in order.

The migration must be applied against **both** database volumes, since the repository
keeps two: `DB_TARGET=dev` (scratch data) and `DB_TARGET=staging` (the curated
known-good dataset). The `db` service mounts `app-db-${DB_TARGET:-dev}-data`, and
`backend` depends on `prestart` completing successfully, so `prestart` runs
`alembic upgrade head` against whichever volume is currently selected. Switching
`DB_TARGET` in the root `.env` and bringing the stack up therefore migrates that target
automatically.

**Rebuild is required.** `prestart` runs from the baked
`${DOCKER_IMAGE_BACKEND}:${TAG-latest}` image and — unlike `backend`, which has a
`develop.watch` sync on `./backend` — is not overridden in `compose.override.yml`, so it
has no source sync and no volume mount. A newly created migration file is not inside
that image. Running plain `docker compose up -d` would execute prestart from the stale
image, find no new revision, exit successfully, and start the backend against an
unmigrated database. Use `docker compose up -d --build` for each target instead;
`prestart` has a `build:` section, so this picks up the new revision.

## Backend

### `app/models.py`

| Old | New |
|---|---|
| `QuizSeriesBase` | `CompetitionBase` |
| `QuizSeriesCreate` | `CompetitionCreate` |
| `QuizSeriesUpdate` | `CompetitionUpdate` |
| `QuizSeries` (table) | `Competition` (table `competition`) |
| `QuizSeriesPublic` | `CompetitionPublic` |
| `QuizSeriesListPublic` | `CompetitionListPublic` |
| `PlayerSeriesGroup` | `PlayerCompetitionGroup` |
| `PlayerSeriesHistory` | `PlayerCompetitionHistory` |
| `SeriesEventPodium` | `CompetitionEventPodium` |
| `SeriesPodiumPublic` | `CompetitionPodiumPublic` |

Field renames: `Quiz.series_id` → `competition_id` (FK target `competition.id`), applied
across `QuizBase`, `QuizCreate`, `QuizUpdate`, and `QuizPublic`. The `series_id` /
`series_name` fields on the player-history and podium schemas become `competition_id` /
`competition_name`.

### `app/crud.py`

Functions: `create_series` → `create_competition`, `update_series` → `update_competition`,
`delete_series` → `delete_competition`, `get_player_series_history` →
`get_player_competition_history`.

Locals and parameters: `series_in`, `db_series`, `series`, `series_names`, `series_id`,
`series_name` all rename. The join in the player-history query
(`.join(QuizSeries, Quiz.series_id == QuizSeries.id, isouter=True)`) becomes
`.join(Competition, Quiz.competition_id == Competition.id, isouter=True)`.

### `app/api/routes/`

`series.py` → `competitions.py`. Router becomes
`APIRouter(prefix="/competitions", tags=["competitions"])`. The tag matters: it is what
`@hey-api/openapi-ts` uses to name the generated client service, so it must be
`competitions` for `CompetitionsService` to be produced.

Handlers: `read_series` → `read_competitions`, `read_series_item` → `read_competition`,
`read_series_podium` → `read_competition_podium`, `create_series` → `create_competition`,
`update_series` → `update_competition`, `delete_series` → `delete_competition`. The
module-local helper `_series_public` → `_competition_public`. The 404 detail string
`"Series not found"` → `"Competition not found"`.

`api/main.py`: update the import and `include_router` call.

`players.py`: the route `/{player_id}/series-history` → `/{player_id}/competition-history`;
handler `get_player_series_history_route` → `get_player_competition_history_route`; query
parameter `series_id` → `competition_id`.

`quizzes.py`: query parameter `series_id` → `competition_id`, and the filter
`Quiz.series_id == series_id` → `Quiz.competition_id == competition_id`.

## HTTP API surface

Breaking, with no back-compatible aliases:

| Old | New |
|---|---|
| `GET`, `POST` `/api/v1/series/` | `/api/v1/competitions/` |
| `GET`, `PATCH`, `DELETE` `/api/v1/series/{id}` | `/api/v1/competitions/{id}` |
| `GET /api/v1/series/{id}/podium` | `/api/v1/competitions/{id}/podium` |
| `GET /api/v1/players/{id}/series-history?series_id=` | `/api/v1/players/{id}/competition-history?competition_id=` |
| `GET /api/v1/quizzes/?series_id=` | `/api/v1/quizzes/?competition_id=` |

After the backend changes land, run `bash ./scripts/generate-client.sh` from the project
root. This rewrites `frontend/src/client/` — `schemas.gen.ts`, `types.gen.ts`,
`sdk.gen.ts` — turning `SeriesService` into `CompetitionsService` and renaming
`readSeries` → `readCompetitions`, `readSeriesItem` → `readCompetition`,
`readSeriesPodium` → `readCompetitionPodium`, `createSeries` → `createCompetition`,
`updateSeries` → `updateCompetition`, `deleteSeries` → `deleteCompetition`, and
`getPlayerSeriesHistoryRoute` → `getPlayerCompetitionHistoryRoute`. These files are
generated and must not be hand-edited.

## Frontend

### Routes

File-based routing means the filename determines the URL.

| Old file | New file | New URL |
|---|---|---|
| `_public/series.tsx` | `_public/competitions.tsx` | `/competitions` |
| `_public/series_.$id.tsx` | `_public/competitions_.$id.tsx` | `/competitions/$id` |
| `_layout/admin_.series.tsx` | `_layout/admin_.competitions.tsx` | `/admin/competitions` |
| `_public/players_.$slug_.series.$seriesId.tsx` | `_public/players_.$slug_.competitions.$competitionId.tsx` | `/players/$slug/competitions/$competitionId` |

`routeTree.gen.ts` is regenerated by the dev server or build; it is not hand-edited.

Route-file identifiers: `SeriesPage` → `CompetitionsPage`, `SeriesListContent` →
`CompetitionListContent`, `SeriesRow` → `CompetitionRow`, `SeriesTableContent` →
`CompetitionTableContent`, `AdminSeries` → `AdminCompetitions`, `SeriesHistoryPage` →
`CompetitionHistoryPage`, `getSeriesQueryOptions` → `getCompetitionsQueryOptions`,
`getSeriesPodiumQueryOptions` → `getCompetitionPodiumQueryOptions`, `seriesLabel` →
`competitionLabel`, `allSeries` → `allCompetitions`.

### Components

| Old | New |
|---|---|
| `components/Series/SeriesPodium.tsx` | `components/Competitions/CompetitionPodium.tsx` |
| `components/Admin/SeriesDialog.tsx` | `components/Admin/CompetitionDialog.tsx` |

Also updated: `components/Common/PublicNav.tsx` (link target and label),
`components/Sidebar/AppSidebar.tsx` (admin nav entry and path),
`components/Players/PlayerProfile.tsx` (group fields and the history link),
`components/Upload/types.ts` (`series_id` → `competition_id` on the upload meta type and
its initial state), `components/Upload/steps/Step1EventMeta.tsx`, and
`components/Upload/steps/Step5Preview.tsx`.

Component-local identifiers: `seriesList` → `competitionList`, `orgSeries` →
`orgCompetitions`, `selectedSeriesId` / `setSelectedSeriesId` → `selectedCompetitionId` /
`setSelectedCompetitionId`.

TanStack Query keys `["series"]` → `["competitions"]`, including the
`invalidateQueries` call in the dialog.

### User-visible copy

"Series" → "Competitions" in the public nav, the admin sidebar entry, page headings, and
the player-history and see-all page headings. "Series" → "Competition" in singular
contexts: the dialog
titles (`Edit Series` → `Edit Competition`, `New Series` → `New Competition`), the
success and error toasts, and the upload form label `Series (optional)` →
`Competition (optional)`.

## Tests

### Backend

`tests/api/routes/test_series.py` → `test_competitions.py`. All 25 `test_*` functions
rename, e.g. `test_read_series_public` → `test_read_competitions_public`,
`test_delete_series_nullifies_quiz_series_id` →
`test_delete_competition_nullifies_quiz_competition_id`,
`test_series_podium_unknown_series_404` → `test_competition_podium_unknown_competition_404`.
Fixture `clean_series_data` → `clean_competition_data`, helper `_approved_event_in_series`
→ `_approved_event_in_competition`, locals `pre_series` → `pre_competitions` and
`new_series_ids` → `new_competition_ids`.

`tests/utils/quiz.py`: `create_random_series` → `create_random_competition` (24 call
sites), `create_approved_event_in_series` → `create_approved_event_in_competition` (10
call sites), parameter `series_id` → `competition_id`.

`tests/api/routes/test_players.py`: the same fixture-local renames, plus
`test_get_player_history_groups_by_series` → `test_get_player_history_groups_by_competition`
and the three `test_series_history_*` functions.

`tests/conftest.py`: the model tuples used for cleanup reference `QuizSeries` →
`Competition`.

Test cleanup stays non-destructive throughout: fixtures delete only rows they created,
tracked by id diff, never table-wide deletes. The rename must not alter that property.

### Frontend

`tests/series-admin.spec.ts` → `tests/competitions-admin.spec.ts`,
`tests/series-public.spec.ts` → `tests/competitions-public.spec.ts`. Also updated:
`tests/players.spec.ts` (`seriesName` → `competitionName`, the `SeriesService` import,
the URL assertion `/players/${slug}/series/` → `/players/${slug}/competitions/`),
`tests/footer.spec.ts` (navigates to `/series` and asserts a `Series` heading), and
`tests/date-utils.test.ts` (asserts on `meta.series_id`).

## Verification

In order:

1. Migrate both targets. With `DB_TARGET=dev`, run `docker compose up -d --build`; then
   set `DB_TARGET=staging` in the root `.env` and run it again. Confirm the backend logs
   the active target at startup, and check `prestart` logs show the new revision applied
   rather than "already at head" against a stale image.
2. `docker compose exec backend bash scripts/tests-start.sh` — full backend suite.
3. `bash ./scripts/generate-client.sh` from the project root.
4. `bun run build` (type-check + build) and `bun run lint` from `frontend/`.
5. `bunx playwright test` from `frontend/`. The Docker frontend container must be stopped
   first, or it shadows port 5173 and the tests run against a stale build. The stack
   serves baked images, so rebuild (`docker compose up -d --build backend frontend`)
   before running E2E against Docker.
6. `grep -ri series` across `backend/app`, `backend/tests`, `frontend/src`, and
   `frontend/tests` returns nothing.

## Out of scope

- Historical `docs/superpowers/specs/` and `docs/superpowers/plans/` files.
- Existing Alembic migration files, including `c9d4e5f6a7b8_series_require_organization.py`,
  whose filename and docstring keep the old name.
- Stale command strings in `.claude/settings.local.json` that reference old paths. They
  are permission-cache entries and are harmless once the paths no longer exist.
- Any behavior change. This is a rename; no endpoint gains or loses functionality, and
  no query semantics change.
