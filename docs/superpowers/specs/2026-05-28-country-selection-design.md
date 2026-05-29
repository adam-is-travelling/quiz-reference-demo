# Country Selection Design

## Goal

Replace the free-text `country` field on players with a constrained dropdown of valid countries, displayed as full names everywhere. Covers ISO 3166-1 alpha-2 countries plus the four home nations (England, Scotland, Wales, Northern Ireland) which compete independently in the quizzing world.

## Architecture

The DB column stays a plain `varchar(3)` — no type change, just a length and nullability update. Validation is enforced via a `frozenset` in the backend models. A `normalize_country` utility converts free-text input (from CSV uploads) to the correct code. The frontend holds the canonical country list and uses it for both the picker and display.

---

## Data Layer

**`backend/app/models.py`**

- `PlayerBase.country`: change from `str = Field(max_length=100)` to `str | None = Field(default=None, max_length=3)`
- `PlayerUpdate.country`: already `str | None`, change `max_length=100` to `max_length=3`
- Add a `VALID_COUNTRY_CODES` frozenset (imported from a shared constants module or defined inline) used in a `@field_validator` on `PlayerBase` and `PlayerUpdate` — rejects any non-`None` value not in the set.

**Alembic migration**

- Alter column: `country varchar(100) NOT NULL` → `country varchar(3) NULL`
- Data migration: for each existing player row, call `normalize_country(country)` and update; set `NULL` if unresolvable.

---

## Normalisation

**`backend/app/utils.py`** — add `normalize_country(raw: str | None) -> str | None`

Accepts any string, returns an ISO alpha-2 or home-nation code, or `None` if unresolvable. Lookup order:

1. Exact match against `VALID_COUNTRY_CODES` (case-insensitive, uppercased)
2. Name match against the canonical country list (case-insensitive)
3. Alias table:

| Input | Code |
|-------|------|
| UK, United Kingdom, Britain, Great Britain | GB |
| England | ENG |
| Scotland | SCO |
| Wales | WAL |
| Northern Ireland | NIR |
| USA, United States of America | US |
| Russia | RU |

4. Returns `None` if no match found.

Used by: the CSV upload path (Step 4 disambiguation / `player_create`) and the Alembic data migration.

---

## Country Constants

**`frontend/src/lib/countries.ts`**

Exports:

```ts
export type Country = { code: string; name: string }
export const COUNTRIES: Country[]  // ~254 entries, sorted A-Z by name
export function countryName(code: string | null | undefined): string  // returns name or code as fallback
```

Entries: all ISO 3166-1 alpha-2 countries plus four custom entries:
- `{ code: "ENG", name: "England" }`
- `{ code: "SCO", name: "Scotland" }`
- `{ code: "WAL", name: "Wales" }`
- `{ code: "NIR", name: "Northern Ireland" }`

Sorted alphabetically by name. No flag emojis.

A matching `VALID_COUNTRY_CODES` set (the same codes) is exported from `backend/app/countries.py` for use in model validation.

---

## Frontend Changes

### Display (read-only)

Everywhere `player.country` is rendered as text, replace the raw code with `countryName(player.country)`:

- `frontend/src/components/Players/PlayerProfile.tsx`
- `frontend/src/routes/_public/quizzers.tsx`
- `frontend/src/routes/_layout/admin_.players.$id.tsx` (the avatar subtitle line)

### Admin player edit form (`admin_.players.$id.tsx`)

Replace the `country` `<Input>` with a `<CountrySelect>` component. On save, the stored value is the code (`"GB"`, `"ENG"`, etc.) or `null` if "Unknown" is selected.

### Upload wizard Step 4 disambiguation (`Step4Disambiguation.tsx`)

Replace the `country` freetext `<input>` for new-player rows with `<CountrySelect>`.

### `CountrySelect` component

**`frontend/src/components/ui/CountrySelect.tsx`**

A native `<select>` wrapper:
- First option: `<option value="">— Unknown —</option>`
- Then all `COUNTRIES` entries in alphabetical order
- `value` is the code string or `""` for unknown
- `onChange` yields the code string or `null`

---

## Backend Changes

**`backend/app/countries.py`** — new file

Exports `VALID_COUNTRY_CODES: frozenset[str]` — the set of all valid 2- and 3-letter codes. Used by model validators and `normalize_country`.

**`backend/app/api/routes/players.py`** — no changes needed (validation is model-level).

**`backend/app/api/routes/events.py`** — `submit_results` creates players via `player_create`; the `country` field on `PlayerCreate` will now be validated automatically.

---

## Testing

**`backend/tests/test_countries.py`** (new)

- `normalize_country` with exact code (uppercase and lowercase)
- `normalize_country` with full name ("United Kingdom" → "GB")
- `normalize_country` with alias ("UK" → "GB", "England" → "ENG", "USA" → "US")
- `normalize_country` with unknown input → `None`
- `normalize_country` with `None` input → `None`

**`backend/tests/api/routes/test_players.py`** (modify or create)

- Creating a player with an invalid country code returns 422
- Creating a player with `country=null` succeeds
- Creating a player with `country="ENG"` succeeds

**Frontend**: TypeScript compile passes — the `<CountrySelect>` only emits valid codes, so no runtime validation needed.
