# Country pages

**Date:** 2026-09-22
**Status:** Design approved

## Problem

Countries appear all over the site — on player profiles, in the results table's country
column, on national team labels — but a country has no page of its own. There is nowhere to
see who has quizzed for Canada, which national sides the UAE has fielded, or how many medals
a country's quizzers have won.

This spec adds a public splash page per country at `/countries/<slug>` (e.g.
`/countries/canada`, `/countries/united-arab-emirates`) showing headline stats, a medal
table, the country's national team appearances, and every player who has represented it.

## Where country data lives today

Country is recorded in three independent places, all as ISO codes validated against
`backend/app/countries.py`:

1. **Player profile** — `player_country` rows; a player may hold several, one `is_primary`.
2. **Per result** — `quiz_result_player.country`: the country a participant was listed under
   on one specific result. Nullable.
3. **Team** — `quizresult.team_country`, alongside `team_type` (`national` | `club`).

This feature reads all three. It adds no tables, columns or migrations.

## Identity and routing

- **Slug:** a country's slug is `slugify(name)` over the names in `backend/app/countries.py`
  (`Canada` → `canada`, `United Arab Emirates` → `united-arab-emirates`). The backend builds a
  slug → code map once at import time. Non-ASCII names keep their characters
  (`Åland Islands` → `åland-islands`), consistent with the existing slugify policy of no
  transliteration.
- **Frontend slug:** `frontend/src/lib/countries.ts` gains `countrySlug(code)`, implemented
  with the same rule. A unit test pins that the frontend list and slugs agree with the
  backend list.
- **Name drift fix:** the frontend list spells `"Britsh Virgin Islands"`; correct it to
  `"British Virgin Islands"` to match the backend, since slugs derive from names.
- **Unknown slug** → `404 Country not found`; the page renders the standard not-found
  treatment used by other slug pages.
- **Known country with no data** → `200` with zero stats and empty lists; the page renders
  its header and an empty state ("No quizzers have represented {Country} yet"). Every valid
  country has a page.
- **Frontend route:** `frontend/src/routes/_public/countries_.$slug.tsx`, public (no auth),
  like the player and competition pages.
- **No `/countries` index page** and no nav entry in this iteration.

## Definitions

Two visibility rules apply everywhere on the page, matching the rest of the public site:

- Only quizzes with `status = approved` count.
- Only players with `is_published = true` appear or are counted.

### A player's country on one result ("competed under")

For a participant row on an approved quiz's result, the country they competed under is:

| Result shape | Country competed under |
|---|---|
| `team_type = national` | the result's `team_country` |
| anything else (individual, pairs, club team) | the row's `quiz_result_player.country`; if null, the player's profile fallback country — the same one every results display uses (`crud._primary_countries`: the primary, else the lowest code); if they hold none, no country |

A player *competed under* country X if at least one approved-quiz participant row resolves
to X.

### Who has "represented" a country

A published player has represented country X if **either**:

- X is in their profile countries (`player_country`, primary or not), **or**
- they competed under X at least once (above).

### Medals

A **medal** is a result with `final_rank` in 1–3 on a quiz where `is_qualifier = false`.

- **Individual medals** (medal table, headline tile, per-player columns): for each medal
  result that is *not* a national team result, every participant who competed under X on
  that result earns that medal for X. A pair of two Canadians who win gold yields two
  Canadian golds, one per player — the same crediting `app/podium.py` uses.
- **National team medals** are shown only in the national teams section. They are **not**
  expanded into individual medals for the squad's members.
- **Club team results** earn no medals on this page (clubs are out of scope; see below).
  Their participants still count as having *competed* under their resolved country.

## API

`GET /api/v1/countries/{slug}` — public, no auth. New router
`backend/app/api/routes/countries.py`; the assembly logic lives in a new module
`backend/app/country_page.py` (same shape as `app/podium.py`), keeping the route thin.

```
CountryPagePublic
  code: str
  name: str
  slug: str
  stats: CountryStats
    quizzer_count: int     # distinct published players who have represented the country
    competed_count: int    # of those, how many competed under it in >= 1 approved quiz
    quiz_count: int        # distinct approved quizzes with >= 1 participant competing under it,
                           # or a national team appearance for it (even one with no squad)
    medals: MedalCounts    # individual medals only
      gold: int
      silver: int
      bronze: int
  players: list[CountryPlayer]
    player_id, display_name, slug
    quiz_count: int        # approved quizzes in which this player competed under the country
    gold, silver, bronze   # this player's individual medals for the country
  medal_table: list[CountryPlayer]   # the subset of players with >= 1 medal
  national_teams: list[CountryTeamAppearance]
    result_id
    team_name: str | None
    quiz_id, quiz_name, quiz_slug, start_date, end_date
    is_qualifier: bool
    final_rank: int | None
    members: list[ResultParticipantPublic]   # published members only
  national_team_medals: MedalCounts
```

**Ordering**

- `players`: medals (gold, then silver, then bronze, descending), then `quiz_count`
  descending, then `display_name` case-insensitively.
- `medal_table`: gold, silver, bronze descending, then `display_name`.
- `national_teams`: `start_date` descending (newest first), then `quiz_name`.

The full player list is returned unpaginated; country player counts are small. The frontend
paginates the table client-side.

Queries should be set-based (a handful of queries per request, not one per player or
result); reuse `crud.build_participants_public` for team members.

## Page layout

Top to bottom:

1. **Header** — country name, with the headline sentence beneath it:
   "N quizzers have represented {Country} across Y quizzes" (N = `quizzer_count`,
   Y = `quiz_count`; singular "1 quizzer has" / "1 quiz").
2. **Medallists** — hidden when empty; ends with a Total row. Player name links to the player page.
3. **National teams** — hidden when empty. A summary line with `national_team_medals`,
   then one row per appearance: team name, quiz (linked), date, place, a medal badge when
   `final_rank` is 1–3 and not a qualifier, and a "Qualifier" marker when applicable. Members
   are listed with links to their player pages.
4. **Players** — paginated table: name (linked), "Quizzes Played" (the player's `quiz_count`), medals.

Empty country: header plus the empty-state message in place of the headline sentence.

## Links into country pages

Wherever a country name is rendered for a known code, it becomes a link to its page:

- Player profile country chips (`components/Players/PlayerProfile.tsx`).
- The country column in `components/Quizzes/QuizResultsTable.tsx`.
- National team labels, wherever `teamLabel` renders a national team's country.

## Out of scope

- A `/countries` index page and nav entry.
- Club teams on country pages.
- Crediting national team medals to individual squad members.
- Slug transliteration (tracked separately).
- Server-side pagination of the player list.

## Testing

**Backend** — `backend/tests/api/routes/test_countries.py`, following the non-destructive
cleanup convention (tests delete only rows they create):

- slug resolution (`canada`, `united-arab-emirates`), unknown slug → 404, known country
  with no data → 200 with zeros;
- each route to "represented": profile-only, per-result country, null per-result country
  falling back to primary profile country, national team member;
- a non-primary profile country does not act as the fallback;
- qualifier podiums earn no medals; national team podiums appear in `national_teams` and
  `national_team_medals` but not in individual medals;
- pairs crediting: both same-country partners get the medal; a mixed-country pair credits
  each partner only to their own country;
- unpublished players and pending/rejected quizzes are excluded;
- ordering of `players`, `medal_table` and `national_teams`.

**Frontend**

- `countries.test.ts`: `countrySlug` for representative codes, and parity of the frontend
  list with the backend's — the test reads `backend/app/countries.py` from disk, extracts
  its `"XX": "Name"` pairs, and asserts the two lists match code-for-code and name-for-name.
- `countries-public.spec.ts` (Playwright): fixtures created through the generated API client;
  the page shows stats, the medal table, a national team appearance and the player list;
  a country link from a player profile navigates to the country page; an unknown slug shows
  not-found.
