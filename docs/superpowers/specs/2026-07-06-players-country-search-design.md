# Players: freetext country search box

**Date:** 2026-07-06
**Scope:** `backend/app/crud.py` (`search_players`), `backend/app/api/routes/players.py` (`/players/search`), regenerated OpenAPI client, `frontend/src/routes/_public/players.tsx`.

## Problem

The public Players page has one search box that matches player names. There is no way to find players by country. The backend `/players/search` endpoint already accepts a `country` param, but:
- it normalizes the value to one exact ISO code and exact-matches (not freetext), and
- it requires a name query `q` first, so country cannot drive a search on its own.

## Requirements

Add a second, freetext search box beside the name box that searches by country. The two boxes are independent and combinable:

| name | country | result |
|------|---------|--------|
| ""   | "irel"  | all players from Ireland |
| "jo" | ""      | players whose name ~ "jo" (as today) |
| "jo" | "irel"  | Ireland players whose name ~ "jo" |
| ""   | ""      | no results (unchanged empty-query behavior) |

**Freetext country matching:** the typed value matches any country whose **name contains** the text (case-insensitive substring) OR whose **code equals** the text uppercased. Examples: `irel` → {IE}; `united` → {US, GB, AE, …}; `IE` → {IE}. Players match if their `countries` list intersects the resolved code set.

## Design

### Backend — `search_players` (crud.py)

Signature stays `search_players(*, session, q, country=None, limit, published_only=False)` but semantics change:

- `q` is now optional/empty-allowed.
  - `q` non-empty → keep the existing `display_name ilike` filter (raw and normalized).
  - `q` empty → no name filter (select all players, still subject to `published_only`).
- `country` is now **freetext**, not a pre-normalized code. Resolve it in the crud (or a small helper) to a set of codes:
  - `text_upper = country.strip().upper()`
  - a code is included if `text_upper == code` OR `country.strip().lower()` is a substring of `COUNTRY_NAMES[code].lower()`.
  - If the resolved set is empty (text matches no country) → return `[]` (no players match a nonexistent country).
  - If `country` resolves to a non-empty set → keep only players whose `set(countries) & resolved_codes` is non-empty.
- Ordering:
  - `q` non-empty → rank by `SequenceMatcher` name similarity (unchanged).
  - `q` empty (country-only) → order alphabetically by `display_name` (case-insensitive). Assign a constant/secondary score so the return type `list[tuple[Player, float]]` is preserved.
- Guard: if `q` empty AND `country` empty/whitespace → return `[]`.
- `limit` still applies after ordering.

The country-name lookup uses the existing `app.countries.COUNTRY_NAMES` (code→name) and `VALID_COUNTRY_CODES`.

### Backend — route (`/players/search`)

- `q: str = ""` (was required) — now optional.
- `country: str | None = None` — pass the raw freetext straight to `search_players` (remove the `normalize_country(country)` pre-step; resolution now happens in crud as substring matching).
- `limit` default handling unchanged; the frontend will pass 50.
- `published_only = current_user is None` unchanged.

### API contract

`q` becomes optional. Regenerate the frontend client via `bash ./scripts/generate-client.sh` after the backend change.

### Frontend — `players.tsx`

- Add a second debounced `Input` with placeholder "Search by country…" beside the existing "Search players…" input, wrapped in a flex row (`flex gap-3`, each `max-w-sm`).
- Add `countryInput` / `debouncedCountry` state mirroring the existing name debounce (300 ms).
- `isSearching = debouncedQuery.length > 0 || debouncedCountry.length > 0`.
- `searchQuery`:
  - `queryKey: ["players", "search", debouncedQuery, debouncedCountry]`
  - `queryFn`: `PlayersService.searchPlayersRoute({ q: debouncedQuery, country: debouncedCountry || undefined, limit: 50 })`
  - `enabled: isSearching`
- The rest of the page (table, browse query, pagination for browse mode, empty/loading states) is unchanged. Search results remain non-paginated and capped at the `limit` (50).

## Non-goals

- No pagination for search results (browse-mode pagination stays). A country search returns up to 50 players; going beyond that is out of scope for now.
- No change to how countries are stored on players or displayed in the table.

## Testing

- Backend route/crud tests (pytest, `backend/tests/api/routes/test_players.py` + crud):
  - country-only by partial name → returns players from that country; name box empty.
  - country-only by code ("IE") → same result as "ireland".
  - name-only → unchanged behavior.
  - combined name + country → intersection.
  - country text matching multiple countries ("united") → union of those countries' players.
  - country text matching nothing ("zzzz") → empty.
  - both empty → empty.
  - `published_only` still excludes unpublished players for anonymous callers in country-only mode.
- Frontend: manual verification on the running stack — typing a country name filters the table; combining with a name narrows further; clearing both returns to browse mode.
