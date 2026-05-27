# Quiz Competition Results — Design Spec

**Date:** 2026-05-25
**Status:** Approved

## Overview

A website where authorized organizers submit quiz competition results for superuser review and publication. Visitors can browse events, view ranked results, and explore player profiles with competition history.

---

## Data Model

### New entities

**`Organization`**
Fields: `name`, `description`, `website` (optional URL), `logo_url` (optional).
Represents bodies like "World Quizzing Organization" or "Irish Quizzing Association".

**`QuizSeries`**
Fields: `name`, `description`, `organization_id` (nullable FK → `Organization`).
Represents a recurring competition (e.g. "World Quizzing Championships").

**`QuizEvent`**
Fields: `name`, `start_date`, `end_date`, `description`, `organizer_name` (free-text string), `format` (JSON: `{questions: int, rounds: int, categories: string[]}`), `status` (`pending` | `approved`), `submitted_by_id` (FK → `User`), `series_id` (nullable FK → `QuizSeries`), `organization_id` (nullable FK → `Organization`).

An event may belong to a series, an organization directly (one-off), or neither. The effective organization resolves as `event.series.organization ?? event.organization`.

**`Player`**
Fields: `display_name`, `country`, `city`, `club`, `bio`, `photo_url` (nullable), `slug` (unique, nullable, URL-safe).

Players are independent of user accounts — a player does not need a login. `slug` is auto-generated on creation from the display name (e.g. `evan-lynch`, with `-2` suffix on collision) and is editable by superusers only.

**`EventResult`**
Fields: `event_id` (FK → `QuizEvent`), `player_id` (FK → `Player`), `score` (numeric), `tiebreaker_rank` (int), `final_rank` (int, computed and stored at approval time).

### Modifications to existing entities

**`User`** — add `is_organizer: bool = False`.

### Hierarchy

```
Organization
  └── QuizSeries
        └── QuizEvent ←─ (also: Organization directly, or standalone)
              └── EventResult
                    └── Player
```

---

## Authorization

Three tiers:

| Action | Public | Organizer | Superuser |
|--------|--------|-----------|-----------|
| Browse events, players, orgs, series | ✓ | ✓ | ✓ |
| Search players (for disambiguation) | ✓ | ✓ | ✓ |
| Submit an event + results | — | ✓ | ✓ |
| Create a player inline | — | ✓ | ✓ |
| View pending events | — | — | ✓ |
| Approve an event | — | — | ✓ |
| Edit any event / results post-approval | — | — | ✓ |
| Disqualify / remove a result | — | — | ✓ |
| Create/edit organizations, series | — | — | ✓ |
| Edit player (bio, photo, slug) | — | — | ✓ |
| Grant organizer role | — | — | ✓ |

---

## API Routes

### Public

```
GET  /api/v1/organizations
GET  /api/v1/organizations/{id}
GET  /api/v1/series
GET  /api/v1/series/{id}
GET  /api/v1/events                        # approved only
GET  /api/v1/events/{id}                   # approved only
GET  /api/v1/players
GET  /api/v1/players/{id}
GET  /api/v1/players/by-slug/{slug}
GET  /api/v1/players/search?q=&country=    # fuzzy match for disambiguation
```

### Organizer

```
POST /api/v1/events                        # create event
POST /api/v1/events/{id}/results/parse     # upload CSV → candidate matches returned
POST /api/v1/events/{id}/results           # submit resolved results
POST /api/v1/players                       # create player inline
```

### Superuser

```
GET    /api/v1/events?status=pending       # review queue
POST   /api/v1/events/{id}/approve
PATCH  /api/v1/events/{id}
DELETE /api/v1/events/{id}/results/{id}
POST   /api/v1/organizations
PATCH  /api/v1/organizations/{id}
POST   /api/v1/series
PATCH  /api/v1/series/{id}
PATCH  /api/v1/players/{id}               # slug, bio, photo
```

---

## Upload Flow (Organizer)

Five-step wizard at `/upload`:

1. **Event metadata** — name, date range, description, organizer name (free text), optional series/org links, format (rounds count, questions count, category names).
2. **Results input** — paste CSV/TSV or upload a file. Manual row entry available as fallback.
3. **Column mapping** — user maps CSV columns to `player_name`, `country`, `score`, `tiebreaker_rank`.
4. **Disambiguation** — per row, the system returns top fuzzy matches (by name + country). Organizer confirms a match or creates a new player inline. New players require at minimum `display_name` and `country`.
5. **Preview + submit** — full ranked results table (sorted by score desc, tiebreaker_rank asc). Organizer submits; event enters `pending` state.

The `/results/parse` endpoint handles step 4 server-side: receives parsed rows, runs fuzzy name+country search, returns ranked candidate matches per row. Disambiguation resolution happens client-side; confirmed results are POSTed to `/results`.

---

## Superuser Review

`/admin/events` shows a queue of `pending` events. Superuser can:

- **Approve** — sets status to `approved`, computes and stores `final_rank` for all results (ordered by `score` desc, `tiebreaker_rank` asc), event becomes publicly visible.
- **Edit** — update event metadata or individual results at any time (including post-approval). Edits to scores trigger a `final_rank` recompute.
- **Delete result** — remove a player's entry (disqualification). Triggers `final_rank` recompute for remaining entries.

---

## Frontend Routes & Pages

### Public

| Route | Page |
|-------|------|
| `/events` | Paginated list of approved events |
| `/events/{id}` | Event detail: metadata, format, ranked results table |
| `/organizations` | Organization directory |
| `/organizations/{id}` | Org page: description, linked series and one-off events |
| `/series/{id}` | Series page: events in chronological order |
| `/quizzers` | Searchable player directory |
| `/quizzer/{slug}` | Player profile |

### Organizer

| Route | Page |
|-------|------|
| `/upload` | Multi-step event submission wizard |

### Superuser

| Route | Page |
|-------|------|
| `/admin/events` | Pending review queue + all events |
| `/admin/events/{id}` | Review/edit: approve, edit metadata, edit/delete results |
| `/admin/players/{id}` | Edit player: slug, bio, photo, affiliations |

---

## Player Profile Page (`/quizzer/{slug}`)

**Header:** Display name, country, club/affiliation. Avatar uses initials as fallback if no photo is set (shadcn `Avatar` — no broken-image appearance).

**Career stats:** Wins (1st place finishes), Podiums (top-3 finishes), Total events entered.

**Competition history table:** Event name (linked), date, score, rank — sorted by date descending. Empty state shown if no results yet.

---

## Key Decisions

- `organizer_name` on `QuizEvent` is a free-text field, decoupled from the submitting user — the person who ran the quiz may not have an account.
- `format` stored as JSON on `QuizEvent` — avoids a separate rounds table while keeping the data structured.
- `final_rank` is stored at approval time, not computed live — superuser edits are intentional and explicit.
- Player `slug` auto-generated from display name at creation; superuser-editable only to prevent URLs being set arbitrarily.
- The existing `Item` model and related routes are left untouched.
