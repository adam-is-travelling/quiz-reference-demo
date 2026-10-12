# Upload: optional country, per-result venue, compact column mapping

Date: 2026-10-12
Branch: `add-optional-locations-for-quiz`

## Goals

1. **Country is optional on upload, in every participant mode.** New players
   that will be created without a country are flagged to the uploader (a
   warning, never a blocker).
2. **Per-result venue.** Some quizzes are written simultaneously at several
   venues and the results file records where each quizzer sat it. When it
   does, store that venue on the result and show it on the results tables.
3. **Compact column mapping.** Step 3 of the upload wizard is too tall on
   desktop; lay the mappings out in a compact grid.

## Non-goals

- No Venue entity, venue pages, or cross-quiz venue identity. A venue is free
  text on the result (same stance as teams — see "Teams are per-quiz only").
- No venue on player history pages (may come later).
- No venue city/country structure.
- No change to how the Event's own `venue`/`city`/`country` work.

## 1. Data model and API

### `QuizResult`

Add a nullable column:

```python
venue: str | None = Field(default=None, max_length=255)
```

One venue per **result**, not per participant — a pair or team sits a quiz
together, so it lives alongside `team_name`.

Alembic migration: add nullable `venue VARCHAR(255)` to `quizresult`; existing
rows stay null. Migration is additive and safe on both dev and staging
volumes.

### Schemas

Add `venue: str | None` (max_length 255) to:

- `ResolvedResultRow` (upload submit)
- `QuizResultCreate`, `QuizResultUpdate`
- `QuizResultPublic`, `QuizResultWithPlayer`

### Normalisation

On create, submit and update the backend trims the value; an empty or
whitespace-only string is stored as null. On `QuizResultUpdate`, an explicit
`venue: null` (or `""`) clears it; an omitted field leaves it unchanged
(existing `exclude_unset` PATCH semantics).

### Backend tests

- Submit results with and without `venue`; read back via `/results` and
  `/results/with-players`.
- PATCH sets, changes and clears venue.
- Whitespace-only venue is stored as null.
- Tests follow the non-destructive cleanup rule (only delete rows they
  create).

## 2. Upload wizard behaviour

### Country is optional

- `Step3ColumnMapping`: the Country select loses the `*` in every mode, and
  every mode offers "Not mapped". The pairs/teams-only helper text becomes a
  general one: "Optional — new players without a country will be flagged on
  the next step."
- `resolveCountryColumn` (`lib/columnDetection.ts`): when nothing is detected
  and the user hasn't changed it, fall back to `null` ("Not mapped") in every
  mode, instead of column 1 for individual quizzes. A user's explicit choice
  and a successful header detection still win, unchanged.
- `ParsedResultRow.country` stays a string; unmapped sends `""`.

### "No country" flag

A new player is **countryless** when its `player_create.countries` is empty —
i.e. the column is unmapped, or the row's value is blank / not recognised by
`resolveCountryCode`.

- **Step 4 (disambiguation)**:
  - A non-blocking amber banner at the top when any new player is
    countryless: "N new player(s) will be created without a country. You can
    set one below, or later from their profile."
  - An amber "No country" badge on each countryless auto-create row, and on
    the manual "create new" form while its country picker is empty.
  - The count updates live as countries are picked.
- **Step 5 (preview)**: the summary repeats the countryless count.
- **Matching**: a blank CSV country never counts as a country mismatch. This
  is already true in `getAutoResolution` (`csvCountry !== null` guard); add a
  unit test to pin it.

### Venue column

- `ColumnMapping` gains `venue: number | null`, default `null`.
- Auto-detection: `VENUE_HEADER_NAMES = ["venue", "location", "site"]`, via
  `detectColumn`, claiming columns like the other fields so it can't steal an
  already-claimed column.
- Mapping UI: optional "Venue" select with "Not mapped".
- Submit (`Step5Preview`): each `ResolvedResultRow` gets the row's trimmed
  venue, or null when unmapped/blank. For a team whose result spans several
  CSV rows, use the first non-empty venue among its rows.

### Unmapped optional columns are hidden

- Step 3's 3-row preview shows a Country column only when Country is mapped,
  and a Venue column only when Venue is mapped (today Country shows as an
  empty column when unmapped).
- Step 5's results preview shows a Venue column only when Venue is mapped.

## 3. Layout and display

### Compact column-mapping grid (Step 3)

At `md` and above:

- Container widens from `max-w-xl` (to roughly `max-w-4xl`).
- Field controls render in a 3-column grid, label inline beside its select:
  - Core: Player\*, Score\*, Position, Country, Venue.
  - Mode-specific controls (Player 2, Team, Squad column(s)) join the same
    grid.
  - Segmented toggles (Pairs layout, Squad layout) span a full grid row; they
    stay the standard segmented control with `bg-primary` on the active
    option (load-bearing for E2E).
- Round mappings use a tighter 4-column sub-grid with short labels
  ("R1 — Arts"); the existing "picking Round 1 auto-fills the rest" behaviour
  is unchanged.
- The 3-row data preview stays below the grid.

Below `md` the layout falls back to today's stacked label-over-select form.
All existing `data-testid`s are kept.

### Venue on results tables

- Public quiz results table (`QuizResultsTable`) and the admin quiz page
  (`admin_.quizzes_.$id.tsx`) show a Venue column only when at least one
  result in the quiz has a venue — same pattern as `hasTeams`.
- Admin quiz page: venue is editable per result via the existing
  `updateQuizResult` PATCH, so typos can be corrected after upload.

## Testing

- **Unit (frontend)**: `resolveCountryColumn` falls back to null for
  individual mode; venue header detection; blank-country-is-not-a-mismatch;
  countryless counting.
- **Backend**: as in section 1.
- **E2E (Playwright)**, updating any specs that assumed country is required
  for individual quizzes:
  - Individual upload with no country column: flag banner and badges show,
    upload still submits, players are created with no country.
  - Upload with a venue column: Venue column appears on the quiz results
    page with the right values.
  - Upload with no venue mapped: no Venue column in the Step 5 preview or on
    the results page.
- Regenerate the OpenAPI client after the backend change
  (`scripts/generate-client.sh`); E2E fixtures that call the client are
  updated with it.
