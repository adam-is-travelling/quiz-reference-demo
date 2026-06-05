# Player Published Flag — Design Spec

**Date:** 2026-06-04

## Overview

Newly created player profiles must not appear on public-facing pages until they have results in at least one approved event. This is enforced via a stored `is_published` boolean flag on the `Player` model, auto-set when their first event is approved.

---

## Data Model

### `Player` table

Add one field:

```python
is_published: bool = Field(default=False)
```

- Defaults to `False` on creation — new players are hidden from public until published.
- Exposed in `PlayerPublic` so callers can see the flag value.
- Not present in `PlayerCreate` or `PlayerUpdate` — not settable directly via the API.

### Migration

Alembic migration adds `is_published BOOLEAN NOT NULL DEFAULT FALSE` to the `player` table.

---

## Auto-Publish Trigger

**Location:** `crud.approve_event`

After `_recompute_ranks` runs, collect all `player_id`s from `EventResult` rows for the event being approved. For each player where `is_published` is currently `False`, set it to `True`. This is the only place the flag is ever set to `True`.

This means:
- A player created as part of a result submission becomes visible the moment their event is approved.
- A player with results in multiple events becomes published on the first approval — subsequent approvals are no-ops for the flag.

---

## Public Endpoint Filtering

All four public player read endpoints adopt the `OptionalCurrentUser` pattern already used in the events routes: superusers see all players; everyone else sees only published players.

| Endpoint | Behaviour for non-superusers |
|---|---|
| `GET /players/` | Filter results to `is_published = True` |
| `GET /players/by-slug/{slug}` | Return 404 if player is not published |
| `GET /players/{player_id}` | Return 404 if player is not published |
| `GET /players/{player_id}/history` | Return 404 if player is not published |

`GET /players/search` is left unrestricted — it is used internally by organizers during result upload and must be able to find unpublished players.

---

## Admin Access

Superusers see all players (published and unpublished) through the same endpoints — no separate admin-only route needed. This mirrors the existing pattern on events.

---

## Tests

Tests live alongside existing player route tests. Required coverage:

- **Non-superuser cannot list unpublished players** — even if `is_published=False` is set explicitly on the player record.
- **Non-superuser gets 404 on `by-slug` for unpublished player.**
- **Non-superuser gets 404 on `/{player_id}` for unpublished player.**
- **Non-superuser gets 404 on `/{player_id}/history` for unpublished player.**
- **Superuser can see unpublished players** on all four endpoints.
- **Auto-publish: approving an event sets `is_published=True`** on all players with results in that event.
- **Search is unrestricted** — non-authenticated callers can find unpublished players via search.

---

## Frontend

### Public pages

No frontend changes required. The backend filtering propagates automatically — unpublished players will not appear in the quizzers list, and direct profile URLs will surface the 404 state already handled by the error boundary.

### Upload disambiguation (Step 4)

`PlayerPublic` will include `is_published`, which flows through to `PlayerSearchResult` candidates in the search response. In `Step4Disambiguation.tsx`, when rendering a candidate in `RowDisambiguator`, show a small inline badge next to the player's name when `c.player.is_published === false`:

```tsx
{!c.player.is_published && (
  <span className="text-xs text-muted-foreground">(not yet published)</span>
)}
```

This ensures organizers know they are matching to an unpublished profile, without preventing the match. No backend changes are needed for this — `is_published` is already part of `PlayerPublic`.

---

## Out of Scope

- Manual admin toggle for `is_published` (not needed for this feature).
- Unpublishing a player (no requirement identified).
