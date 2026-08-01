# Player Competition History Grouped by Series — Design

**Date:** 2026-07-31
**Status:** Approved (pending spec review)

## Problem

The player profile page (`/players/$slug`, rendered by `PlayerProfile.tsx`) shows a
player's results as a single flat "Competition History" table. As the database
accumulates many quiz series, this flat list becomes unreadable — results from
unrelated series are interleaved.

We want the profile to present results **grouped by series**, showing only the **5
most recent** results per series. When a series has more than 5 results, a
**"See all results"** link opens a dedicated, paginated page listing every result
that player has in that series.

## Goals

- Group a player's competition history by quiz series on the profile page.
- Show at most the 5 most-recent results per series, newest first.
- When a series has more than 5 results, show a "See all {N} results" link to a
  dedicated per-series page.
- Handle results whose quiz has no series (`Quiz.series_id IS NULL`) via a
  catch-all **"Other"** group, subject to the same 5-cap + "see all" rule.

## Non-goals

- No change to how quizzes are assigned to series.
- No change to the public quiz or series pages.
- No new filtering/search UI beyond the per-series "see all" page.

## Current state

- `GET /players/{id}/history` → `PlayerHistory` (`{ data: PlayerResultWithQuiz[] }`),
  built by `crud.get_player_history`, which joins `QuizResult` + `Quiz` and filters
  to `QuizStatus.approved`, ordered by `Quiz.start_date` desc.
- `PlayerResultWithQuiz` carries no series information.
- `Quiz.series_id` is a nullable FK to `QuizSeries` (`ON DELETE SET NULL`).
- Sole consumers of `getPlayerHistoryRoute` (verified by grep):
  - `frontend/src/routes/_public/players_.$slug.tsx` — stats cards + delete-guard
    (`history.data.length === 0`).
  - `frontend/src/components/Players/PlayerProfile.tsx` — the history table + stats.
- Pagination convention across routes is `skip` / `limit` query params.

## Design

### 1. Backend models (`backend/app/models.py`)

- **`PlayerResultWithQuiz`** — add:
  - `series_id: uuid.UUID | None = None`
  - `series_name: str | None = None`
- **`PlayerSeriesGroup`** (new):
  - `series_id: uuid.UUID | None`
  - `series_name: str | None`
  - `results: list[PlayerResultWithQuiz]` — up to 5, newest first
  - `total_count: int` — full count of the player's results in this group
- **`PlayerHistoryGrouped`** (new):
  - `data: list[PlayerSeriesGroup]`
  - `total_events: int`
  - `wins: int`
  - `podiums: int`
  - (Aggregates live on the backend because the per-group `results` are capped at
    5, so the frontend can no longer compute totals from the payload.)
- **`PlayerSeriesHistory`** (new) — response for the "see all" page:
  - `data: list[PlayerResultWithQuiz]`
  - `count: int`
  - `series_name: str | None`

`PlayerHistory` and its flat shape are removed from the `/history` route (see §5).

### 2. Backend CRUD (`backend/app/crud.py`)

- Modify the history query to `LEFT JOIN QuizSeries` so each row carries
  `series_id` + `series_name`. Continue to filter `Quiz.status == approved`.
- **`get_player_history_grouped(session, player_id) -> PlayerHistoryGrouped`**:
  - Group rows by `series_id`; `NULL` → the "Other" bucket.
  - Order groups by their newest result's `start_date` **desc** (most recently
    active series first). The **"Other" bucket is always last**, regardless of date.
  - Within each group, order results newest-first and keep the 5 most recent in
    `results`, while recording the full `total_count`.
  - Compute aggregates over **all** rows: `total_events` = row count;
    `wins` = rows with `final_rank == 1`; `podiums` = rows with
    `final_rank` in 1..3.
- **`get_player_series_history(session, player_id, series_id, skip, limit)
  -> tuple[list[(QuizResult, Quiz)], int, str | None]`**:
  - Filters `QuizResult.player_id == player_id`, `Quiz.status == approved`, and
    either `Quiz.series_id == series_id` or `Quiz.series_id IS NULL` when
    `series_id is None`.
  - Orders newest-first, applies `skip`/`limit`, and returns the page rows, the
    total count, and the series name (None for the ungrouped bucket).

### 3. Backend endpoints (`backend/app/api/routes/players.py`)

- **Change** `GET /players/{player_id}/history`:
  - `response_model=PlayerHistoryGrouped`.
  - Same auth/visibility rules as today (404 if player missing or unpublished for
    non-superusers).
  - Delegates to `get_player_history_grouped`.
- **New** `GET /players/{player_id}/series-history`:
  - Query params: `series_id: uuid.UUID | None = None`, `skip: int = 0`,
    `limit: int = 50`.
  - Same auth/visibility rules.
  - `series_id` omitted ⇒ the ungrouped ("Other") bucket.
  - `response_model=PlayerSeriesHistory`.

### 4. Frontend

Regenerate the client (`scripts/generate-client.sh`) after the schema change. The
codegen'd return type of `getPlayerHistoryRoute` flips from `PlayerHistory` to
`PlayerHistoryGrouped`, so TypeScript flags every stale call site — a mechanical
migration.

#### 4a. Shared columns

Extract the existing `historyColumns` (`ColumnDef<PlayerResultWithQuiz>[]`) into a
shared module so both the profile sections and the "see all" page use identical
columns.

#### 4b. Profile (`PlayerProfile.tsx`)

- Replace the single `DataTable` with **one section per group**:
  - Heading: `series_name` (or "Other" when `series_id` is null).
  - A `DataTable` over the group's ≤5 `results`.
  - When `total_count > 5`, a `See all {total_count} results →` `Link` to
    `/players/$slug/series/$seriesId`, using `"none"` as `seriesId` for the "Other"
    bucket.
- Stat cards read `history.total_events`, `history.wins`, `history.podiums`.
- Empty state ("No results yet.") shows when `data` is empty.

#### 4c. Route file (`players_.$slug.tsx`)

- Delete-guard becomes `history.total_events === 0`.
- Update the `PlayerProfile` prop type to `PlayerHistoryGrouped`.

#### 4d. "See all" page (new route `/players/$slug/series/$seriesId`)

- TanStack file route resolving `slug` + `seriesId` params, plus a `page` search
  param for pagination.
- Maps `seriesId === "none"` → call `series-history` with no `series_id`; otherwise
  passes the UUID.
- Computes `skip = (page - 1) * limit`, `limit = 50`.
- Header shows the player name + series name (or "Other"). Body is the full
  `DataTable` with pagination controls (mirroring existing paginated list routes).

### 5. Migration / compatibility

- Replacing the `/history` shape is safe: the only two consumers are in-repo and
  the client is codegen'd, so the type flip surfaces every call site at build time.
- No external/untyped consumer of `/history` exists in this monorepo.
- The flat `PlayerResultWithQuiz[]` representation still exists in a more useful
  form via `series-history` (scoped + paginated).
- No database migration required — `Quiz.series_id` and `QuizSeries` already exist.

## Testing

### Backend (`backend/app/tests/`)

- Grouping: results split into correct series groups; "Other" bucket captures
  `series_id IS NULL` results.
- Ordering: groups ordered by newest result desc; "Other" always last; within-group
  newest-first.
- 5-cap: a group with >5 results returns exactly 5 `results` and the correct
  `total_count`.
- Aggregates: `total_events` / `wins` / `podiums` correct across multiple groups.
- `series-history`: pagination (`skip`/`limit`) and total `count`; ungrouped filter
  when `series_id` omitted; series name populated correctly.
- Cleanup is **non-destructive** — only rows created by the test are deleted; no
  table-wide deletes (per `test_cleanup_safety.py`).

### Frontend E2E (`frontend/tests/`)

- Profile renders one section per series with correct headings.
- "See all" link appears only when a series has >5 results and navigates to the
  full paginated per-series list.
- The "Other" bucket renders and its "see all" link routes with `seriesId="none"`.
