# Shorthand aliases for multi-word country search

**Date:** 2026-07-08
**Scope:** `backend/app/utils.py` (`_COUNTRY_ALIASES` → `COUNTRY_ALIASES`), `backend/app/crud.py` (`_resolve_country_codes`), backend tests.

## Problem

The players page's freetext country search resolves typed text to country codes by exact code match or substring-of-name match (`app/crud.py::_resolve_country_codes`). Common shorthand abbreviations for multi-word countries — USA, UK, UAE, PNG, and others — don't appear as substrings of their official names (e.g. "usa" is not a substring of "united states") and aren't themselves the ISO code, so they currently fail to match.

A separate alias table already exists at `backend/app/utils.py::_COUNTRY_ALIASES`, used by `normalize_country` (CSV upload / single-country-field parsing) and already containing UK, BRITAIN, GREAT BRITAIN, USA, UNITED STATES OF AMERICA. Country search does not currently consult it.

## Requirements

1. Country search resolves the following additional shorthand aliases (case-insensitive, exact match on the full typed string) to their country codes, alongside the five that already exist for `normalize_country`:

   | Alias | Code | Country |
   |---|---|---|
   | UAE | AE | United Arab Emirates |
   | PNG | PG | Papua New Guinea |
   | DRC | CD | Congo, Democratic Republic |
   | RSA | ZA | South Africa |
   | KSA | SA | Saudi Arabia |
   | CAR | CF | Central African Republic |
   | IVORY COAST | CI | Côte d'Ivoire |
   | DPRK | KP | North Korea |
   | ROK | KR | South Korea |

2. Alias matching is exact only — the typed text (trimmed, uppercased) must equal an alias key. No substring/prefix matching on aliases (typing "us" continues to match via the existing US country-code exact match, not via the USA alias; typing "usab" matches nothing).
3. Alias resolution is additive to the existing exact-code and substring-name matching — it does not replace or narrow either.
4. The alias table is shared between country search and `normalize_country` (single source of truth) rather than duplicated.
5. `normalize_country`'s existing behavior for its five current aliases (UK, BRITAIN, GREAT BRITAIN, USA, UNITED STATES OF AMERICA) is unchanged.

## Design

### `backend/app/utils.py`

Rename `_COUNTRY_ALIASES` to `COUNTRY_ALIASES` (drop the leading underscore — it is now imported from another module, so it is no longer module-private) and add the nine new entries:

```python
COUNTRY_ALIASES: dict[str, str] = {
    "UK": "GB",
    "BRITAIN": "GB",
    "GREAT BRITAIN": "GB",
    "USA": "US",
    "UNITED STATES OF AMERICA": "US",
    "UAE": "AE",
    "PNG": "PG",
    "DRC": "CD",
    "RSA": "ZA",
    "KSA": "SA",
    "CAR": "CF",
    "IVORY COAST": "CI",
    "DPRK": "KP",
    "ROK": "KR",
}
```

`normalize_country`'s reference to the dict updates to the new name; its logic is otherwise unchanged.

### `backend/app/crud.py`

Import `COUNTRY_ALIASES` from `app.utils` (no import-cycle risk: `utils.py` imports only from `app.core` and `app.countries`, nothing from `crud.py` or `models.py`).

Extend `_resolve_country_codes`:

```python
def _resolve_country_codes(text: str) -> set[str]:
    needle = text.strip().lower()
    if not needle:
        return set()
    upper = needle.upper()
    codes = {
        code
        for code, name in COUNTRY_NAMES.items()
        if upper == code or needle in name.lower()
    }
    if upper in COUNTRY_ALIASES:
        codes.add(COUNTRY_ALIASES[upper])
    return codes
```

The existing code-match/substring-match set-comprehension is unchanged; the alias check is an additional `if` that unions in one more code when the full trimmed input exactly matches an alias key.

## Non-goals

- No substring/prefix matching on aliases.
- No frontend changes — this is a backend resolution-logic change behind the existing `/players/search?country=` and upload-flow disambiguation search endpoints; both already call `_resolve_country_codes` indirectly via `search_players`.
- No changes to `normalize_country`'s five existing aliases.

## Testing

- Backend tests (extending the existing country-search test file) for each newly-aliased abbreviation: searching `country=uae` (etc., case variants) returns players from the aliased country; searching `country=usab` (near-miss) returns empty.
- Confirm `normalize_country`'s existing behavior for its five current aliases is unchanged (existing tests should continue to pass against the renamed `COUNTRY_ALIASES`).
