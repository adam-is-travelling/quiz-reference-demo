# Normalize player countries into a join table; DB-side country search

**Date:** 2026-07-07
**Scope:** `backend/app/models.py` (`Player`/`PlayerBase`/`PlayerCreate`/`PlayerPublic`, new `PlayerCountry` table), `backend/app/crud.py` (`create_player`, `update_player`, `search_players`, new `build_players_public`/`build_player_public`), `backend/app/api/routes/players.py` and `backend/app/api/routes/quizzes.py` (route-level serialization call sites), one Alembic migration, regenerated OpenAPI client (only if the schema actually changes), existing player/country tests.

## Problem

`Player.countries` is a Postgres `json` column holding a list of ISO codes. `search_players`'s country-only path loads every published player into Python and filters with `codes & set(p.countries)` — an O(all players) scan that will not scale as the player table grows into the thousands. There is no way to run country-centric analytics (counts per country, joins) without deserializing JSON per row.

The team anticipates country-centric analytics and there is currently no data in any environment (dev/staging/prod all empty on this table), so this is the cheapest possible time to normalize rather than patch the JSON column with an index.

## Requirements

1. Player countries are stored in a new join table, one row per (player, country), instead of a JSON list column.
2. Exactly one country per player may be marked primary. The primary country is what `countries[0]` means today (used by the frontend in four places: `players.tsx`, `admin_.players.$id.tsx`, `Step4Disambiguation.tsx` ×2). No ordering guarantee beyond "primary first" is required for the rest.
3. The public API contract is unchanged: `PlayerCreate.countries` and `PlayerPublic.countries` remain `list[str]`, first element = primary. No frontend changes required.
4. `search_players`'s country filter runs in SQL (an indexed lookup against the join table), not by loading all rows into Python and filtering in application code.
5. Country-only search (no name query) also does its ordering and `LIMIT` in SQL, so only the requested page of rows is fetched — not the full published-player table.
6. Existing behavior is preserved: duplicate codes rejected, invalid codes rejected (422), name+country combined search, empty query → `[]`, unresolvable country text → `[]`, `published_only` filtering, freetext country matching (substring on name or exact code) unchanged.

## Design

### Convention note

This codebase has no `SQLModel Relationship()` usage anywhere. The established pattern for "a public response needs data from a related table" is a private helper that takes `(obj, session)`, runs an explicit query, and builds the `*Public` model by hand — e.g. `_quiz_public` in `backend/app/api/routes/quizzes.py:50` (looks up `QuizFormat` for `format_id`) and `_series_public` in `backend/app/api/routes/series.py:21` (looks up `Organization` for `organization_id`). This design follows that convention rather than introducing an ORM relationship: no lazy-loading magic, and a batched query is easy to make N+1-safe, which a naive lazy relationship would not be.

### Schema

New table `PlayerCountry` (`backend/app/models.py`, `table=True`):

```python
class PlayerCountry(SQLModel, table=True):
    __tablename__ = "player_country"
    player_id: uuid.UUID = Field(
        foreign_key="player.id", primary_key=True, ondelete="CASCADE"
    )
    code: str = Field(max_length=3, primary_key=True)
    is_primary: bool = Field(default=False)
```

- Composite primary key `(player_id, code)` — enforces "no duplicate codes per player" at the DB level, same guarantee the existing Pydantic validator provides at the application level (both stay; the validator gives a clean 422 instead of an IntegrityError).
- A plain index on `code` (declared via `Field(max_length=3, index=True)` is not compatible with a composite PK column in SQLModel, so the migration adds it explicitly as a separate `CREATE INDEX`) supports both the search filter and future per-country analytics.
- No DB constraint enforcing "at most one `is_primary=True` per player" — enforced by CRUD code, which is the only writer. Adding a partial unique index is more machinery than this needs given single-writer control.
- No `Player.country_links` relationship — the table class carries no reference to `PlayerCountry` at all; all access goes through explicit queries in `crud.py`.

### `Player`/`PlayerBase`/`PlayerCreate`/`PlayerPublic` changes

- Remove `countries: list[str] = Field(default_factory=list)` and its validator from `PlayerBase` entirely — mirrors how `organization_name` is not on `QuizSeriesBase` (it's a derived/related field, not a column every subclass should inherit).
- Add `countries: list[str] = Field(default_factory=list)` with the `validate_countries` validator (same `_validate_country_codes` function) directly to `PlayerCreate`.
- Add `countries: list[str] = Field(default_factory=list)` to `PlayerPublic` (no validator needed — these values are already validated at write time, same as other derived `*Public` fields in this codebase).
- `PlayerUpdate.countries` is unchanged (already declared independently, not inherited from `PlayerBase`).
- `Player` (table class) has no `countries` field/column/property at all after this change — since `PlayerBase` no longer declares it, nothing is inherited.

### New helper: `build_players_public` (`backend/app/crud.py`)

Needed from two route files (`players.py` and `quizzes.py`'s CSV-candidate-matching route), so it lives in `crud.py` rather than as a route-local private helper:

```python
def build_players_public(
    *, session: Session, players: list[Player]
) -> list[PlayerPublic]:
    if not players:
        return []
    ids = [p.id for p in players]
    links = session.exec(
        select(PlayerCountry).where(col(PlayerCountry.player_id).in_(ids))
    ).all()
    by_player: dict[uuid.UUID, list[PlayerCountry]] = {}
    for link in links:
        by_player.setdefault(link.player_id, []).append(link)

    def _countries(player_id: uuid.UUID) -> list[str]:
        player_links = by_player.get(player_id, [])
        primary = [l.code for l in player_links if l.is_primary]
        rest = sorted(l.code for l in player_links if not l.is_primary)
        return primary + rest

    return [
        PlayerPublic(**p.model_dump(), countries=_countries(p.id)) for p in players
    ]


def build_player_public(*, session: Session, player: Player) -> PlayerPublic:
    return build_players_public(session=session, players=[player])[0]
```

One query regardless of how many players (fixes the exact N+1 risk a lazy relationship would introduce), grouped in Python, then assembled per player.

### Route changes

Every route currently relying on automatic `Player` → `PlayerPublic` conversion switches to the helper:

- `backend/app/api/routes/players.py`:
  - `search_players_route`: build `PlayerPublic` for all result players in one batch call, then zip back with similarity scores.
  - `get_player_by_slug_route`, `get_player`: `return build_player_public(session=session, player=player)`.
  - `list_players`: `PlayersPublic(data=build_players_public(session=session, players=list(players)), count=count)`.
  - `create_player_route`, `update_player_route`: same singular wrapper, called after the CRUD write.
- `backend/app/api/routes/quizzes.py:254` (`parse_results`, the CSV-upload disambiguation flow): its `PlayerSearchResult(player=PlayerPublic.model_validate(p), similarity=s)` list comprehension becomes a batch `build_players_public` call over `[p for p, _ in scored]`, zipped with scores — same fix, same reason.

`get_player_history_route` and `delete_player_route` don't serialize a `Player` and are untouched.

### CRUD changes (`backend/app/crud.py`)

- `create_player`: after inserting the `Player` row, insert one `PlayerCountry` row per code in `player_in.countries`, with `is_primary=True` on index 0 (if the list is non-empty) and `False` on the rest.
- `update_player`: when `player_in.countries` is not `None`, delete the player's existing `PlayerCountry` rows and re-insert per the same primary-first rule. When `countries` is `None` (not provided), leave existing rows untouched — same semantics as today's `exclude_unset` pattern elsewhere in this file.
- `search_players`: replace the Python `codes & set(p.countries)` filter with a SQL condition — the player IDs that have a matching country row, via a correlated `IN` subquery against `PlayerCountry`:
  ```python
  if country_text:
      codes = _resolve_country_codes(country_text)
      if not codes:
          return []
      stmt = stmt.where(
          col(Player.id).in_(
              select(PlayerCountry.player_id).where(col(PlayerCountry.code).in_(codes))
          )
      )
  ```
  added to the same `stmt` that already carries the name `ilike` and `published_only` filters — so the country filter, name filter, and publish filter all run in one SQL query.
  - Country-only path (no name query): add `.order_by(func.lower(Player.display_name)).limit(limit)` to `stmt` before executing, so the DB returns at most `limit` rows already in the right order — no Python sort of the full match set.
  - Name-present path: unchanged after this — fetch the SQL-filtered (name + country + published) set, then keep the existing Python `SequenceMatcher` scoring/sort/`[:limit]`, since ranking by similarity can't be pushed into SQL.

### Migration

One Alembic revision, `down_revision` = the current head:

- `upgrade()`:
  - `op.create_table("player_country", ...)` with the composite PK and FK `ondelete="CASCADE"`.
  - `op.create_index("ix_player_country_code", "player_country", ["code"])`.
  - Backfill: `SELECT id, countries FROM player`, for each row insert one `player_country` row per element of the JSON array (index 0 → `is_primary=True`). Dev/staging/prod all have empty `countries` (`[]`) today, so this is a no-op in practice, but the migration must still be correct for any environment.
  - `op.drop_column("player", "countries")`.
- `downgrade()`:
  - `op.add_column("player", sa.Column("countries", sa.JSON(), nullable=False, server_default="[]"))`.
  - Backfill `player.countries` from `player_country` (primary first, then the rest sorted by code — mirrors the `countries` property).
  - `op.drop_index("ix_player_country_code", ...)`, `op.drop_table("player_country")`.
  - Drop the `server_default` after backfill — it exists only so the column can be added `NOT NULL` in one step while old rows get backfilled; the application always supplies a value going forward.

### Client

`PlayerPublic.countries` and `PlayerCreate.countries` keep the same JSON shape (`list[str]`), so the OpenAPI schema is unchanged and no client regeneration should be necessary. Run `bash ./scripts/generate-client.sh` as a verification step regardless; commit only if it actually produces a diff.

## Non-goals

- No frontend changes — the API contract is identical.
- No DB constraint for "at most one primary" — CRUD-enforced only, since CRUD is the sole writer.
- No change to name-only search (still `ilike`, unindexed) — out of scope; the scalability concern raised was specifically about country-only search loading the whole table.
- No analytics endpoints — the join table + `code` index enables future analytics work but none is built here.

## Testing

- All existing player/country tests must still pass in behavior (not necessarily unchanged construction — see below): `test_player_create_accepts_multiple_valid_countries`, `test_player_base_rejects_duplicate_countries`, `test_create_player_eng_country_succeeds`, the six `test_search_by_country_*` tests, `test_search_players_filters_by_country_membership`, etc.
- Test updates required by the `PlayerBase` → `PlayerCreate` field move: in `backend/tests/test_countries.py`, `test_player_base_rejects_invalid_country`, `test_player_base_accepts_valid_iso_code`, `test_player_base_accepts_home_nation`, `test_player_base_accepts_empty_countries` currently construct `PlayerBase(display_name=..., countries=[...])` directly. Since `countries` moves off `PlayerBase`, these switch to constructing `PlayerCreate(...)` instead — same validator, same assertions, different class under test.
- New tests:
  - Creating a player with `countries=["GB", "IE"]` then reading it back (via the API, i.e. through `build_player_public`) returns `countries == ["GB", "IE"]` (primary first).
  - Updating a player's `countries` replaces the set and re-derives primary (e.g. `["IE"]` → `["FR", "DE"]` results in `countries[0] == "FR"`).
  - Updating a player with `countries` omitted (not in the payload) leaves existing country rows untouched.
  - Country-only search still returns alphabetically ordered results (closes the pre-existing gap noted in the prior feature's final review) — now provable end-to-end since ordering happens in SQL.
  - A player with no countries serializes `countries == []`.
  - `parse_results` (quizzes.py CSV-upload flow) still returns candidate players with correct `countries` after switching to `build_players_public` — covered by existing tests in `test_quizzes.py` that exercise this route; verify they still pass, no new test required unless a gap is found.
