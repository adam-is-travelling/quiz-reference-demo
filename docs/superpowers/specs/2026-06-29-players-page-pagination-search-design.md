# Players Page: Pagination & Search Design

**Date:** 2026-06-29  
**Branch:** players-updates  

## Overview

Replace the current players page (which fetches up to 200 players at once and renders them as cards in a grid) with a paginated table plus a debounced search input. The table style matches the existing quiz results table (`DataTable` / TanStack Table). The backend already exposes both endpoints needed.

## Layout

```
[Page header: "Players" + subtitle]
[Search input — full width]
[Players table: Name | Country]
[Pagination row — hidden when ≤ 10 total results]
```

## Columns

| Column | Source field | Notes |
|--------|-------------|-------|
| Player name | `display_name` | Linked to `/players/$slug` when `slug` is present |
| Country | `country` | Display full country name via existing `countryName()` helper |

## Browse Mode (default)

- Page number lives in the URL as `?page=N` via TanStack Router `validateSearch` (defaults to `1`)
- Fetches `GET /players/?skip=(page-1)*10&limit=10`
- Uses TanStack Table with `manualPagination: true`; total page count derived from `count` in the `PlayersPublic` response
- Pagination controls (first / prev / next / last, "Page X of Y") match the existing `DataTable` style
- Pagination row is hidden when `count <= 10`
- Entering a search query resets to page 1

## Search Mode

- Activated when the search input is non-empty
- Input is debounced 300 ms before firing a request
- Calls `GET /players/search?q=<term>&limit=10`
- Results (up to 10) replace the table rows; the `PlayerSearchResult` wrapper is unwrapped to `player` before rendering — same column shape
- Pagination row is hidden while a query is active
- Clearing the input returns to browse mode, restoring the URL page param

## State Transitions

```
[empty search, page=N] --type--> [search active, results shown, no pagination]
[search active]        --clear-> [browse mode, page=N restored]
[browse mode]          --page nav-> [browse mode, page=N+1, URL updated]
```

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/routes/_public/players.tsx` | Full rewrite: add search input, replace card grid with table, add URL-driven pagination |

No backend changes required — both `GET /players/` (with `skip`/`limit`) and `GET /players/search` (with `q` and `limit`) already exist and are covered by existing tests.

## Out of Scope

- Rows-per-page selector (fixed at 10)
- Country filter (backend supports it on `/search` but not needed here)
- Avatar / photo display (dropped with the card → table change)
