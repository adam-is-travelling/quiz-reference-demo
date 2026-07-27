# Series podium finishers & standings

**Date:** 2026-07-24
**Status:** Approved (pending spec review)

## Goal

On the public series detail page (`/series/$id`), enrich the events table with each
event's podium finishers, and add a series-wide podium standings table below it.

- Each event row shows its **1st / 2nd / 3rd** finishers, each in its own column with a
  medal emoji (🥇 / 🥈 / 🥉) and the player's name.
- A **podium standings** table at the bottom lists every player who has finished on the
  podium in this series, ranked by number of gold, then silver, then bronze finishes.

## Scope

- Applies only to `/series/$id` (series detail). The `/series` list page is unchanged.
- Only **approved** events count (consistent with the existing public events query).
- Aggregation is server-side, in one new read endpoint. No new DB tables or migrations.

## Backend

### New endpoint

`GET /api/v1/series/{id}/podium` → `SeriesPodiumPublic`

- Public (no auth required), mirroring the other public series/quiz read endpoints.
- 404 if the series does not exist (mirrors `read_series_item`).

Placed in `backend/app/api/routes/series.py`.

### New response models (`backend/app/models.py`)

```python
class PodiumFinisher(SQLModel):
    place: int                       # 1, 2, or 3
    player_id: uuid.UUID
    player_display_name: str
    player_slug: str | None = None
    score: float
    country: str | None = None

class SeriesEventPodium(SQLModel):
    quiz_id: uuid.UUID
    quiz_name: str
    start_date: date
    end_date: date
    finishers: list[PodiumFinisher]  # 0–3, ordered by place asc

class PodiumStanding(SQLModel):
    player_id: uuid.UUID
    player_display_name: str
    player_slug: str | None = None
    gold: int
    silver: int
    bronze: int

class SeriesPodiumPublic(SQLModel):
    events: list[SeriesEventPodium]
    standings: list[PodiumStanding]
```

### Logic

1. Load the series; 404 if missing.
2. Select approved quizzes with `series_id == id`, ordered `start_date desc` (matches the
   existing events ordering on the detail page).
3. For each event, select its `QuizResult` rows joined to `Player` where
   `final_rank in (1, 2, 3)`, ordered by `final_rank asc`. Build one `PodiumFinisher` per
   place present. Events with fewer than three podium results (or missing ranks) simply
   yield fewer finishers — no phantom places.
4. Standings: aggregate across those same events by `player_id`:
   - `final_rank == 1` → gold, `== 2` → silver, `== 3` → bronze.
   - Sort by **gold desc, silver desc, bronze desc, then `player_display_name` asc**
     (deterministic tie-break).
   - Only players with at least one podium finish appear.
5. Aggregate by `player_id` (canonical), so merged players count as one.

### Edge cases

- Series with no events → `events: []`, `standings: []`.
- Event with 1–2 podium finishers → returns only those.
- Ties on `final_rank` within one event (e.g. two rank-1 rows) are counted as they appear
  in the data; each qualifying row contributes to its place and to standings counts.

## Frontend (`frontend/src/routes/_public/series_.$id.tsx`)

- Regenerate the client, then add
  `SeriesService.readSeriesPodium({ id })` query (key `["series", id, "podium"]`).
- The podium response carries event metadata, so it replaces the current
  `getSeriesQuizzesQueryOptions` call as the source for the events table.

### Events table

Add three columns after **Date**: **1st / 2nd / 3rd**.

- Each cell renders `🥇 Name` / `🥈 Name` / `🥉 Name` for the matching place.
- Name links to `/players/$slug` when a slug exists, plain text otherwise — reusing the
  linking pattern from `EventResultsTable`.
- Missing place → `—`.

The events table currently uses `eventColumns` + `DataTable`. Because the rows now carry
finishers (a different shape than `QuizPublic`), this becomes a purpose-built table/columns
definition for the podium view rather than reusing `eventColumns`.

### Podium standings table

A new section below the events table:

- Columns: **Player | 🥇 | 🥈 | 🥉** (no total column).
- Rows in the server-provided sorted order; player names linked to `/players/$slug` when a
  slug exists.
- Counts use `tabular-nums`.
- When `standings` is empty, show a muted "No podium results yet." message.

## Tests

### Backend (`backend/tests/api/routes/test_series.py`)

Using existing helpers (`create_random_series`, `create_approved_event`,
`create_random_player`, `crud.create_quiz_results`):

- Multiple events → per-event finishers returned in place order; 4th place and below excluded.
- Standings ordering: more golds outranks more silvers; equal gold/silver/bronze broken
  alphabetically by display name.
- Rejected/pending events in the series are excluded from both events and standings.
- Event with fewer than three finishers returns only the finishers present (no crash).
- Unknown series id → 404.
- Empty series → `events: []`, `standings: []`.

### Frontend E2E (`frontend/tests/series-public.spec.ts`)

Extending the existing suite (already seeds a series + org):

- Seed an approved event and its results via the client, then load `/series/$id` and assert
  the 1st/2nd/3rd columns show the medal finishers and the podium standings table renders
  the leading player.

## Out of scope

- No changes to the `/series` list page.
- No total-podiums column.
- No new DB tables or migrations.
