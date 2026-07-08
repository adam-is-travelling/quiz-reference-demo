# Shorthand Country Search Aliases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the players page's freetext country search resolve common shorthand abbreviations (USA, UK, UAE, PNG, etc.) to the right country, by reusing and extending the existing `normalize_country` alias table.

**Architecture:** One shared alias table lives in `backend/app/utils.py` (renamed from `_COUNTRY_ALIASES` to `COUNTRY_ALIASES` since it becomes cross-module), extended with nine new entries. `crud.py`'s `_resolve_country_codes` (the function backing `/players/search?country=`) imports it and adds one more exact-match check alongside its existing exact-code and substring-name checks.

**Tech Stack:** FastAPI + SQLModel + pytest (backend only — no frontend or API contract changes; `_resolve_country_codes` is an internal function, not a route parameter).

**Spec:** `docs/superpowers/specs/2026-07-08-country-search-aliases-design.md`

## Global Constraints

- Branch: work happens on `search-by-country` (already checked out).
- New alias table (exact content, case-insensitive keys stored uppercase):
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
- Alias matching is exact only (trimmed, uppercased typed text must equal an alias key) — no substring/prefix matching on aliases.
- Alias resolution is additive to the existing exact-code and substring-name matching in `_resolve_country_codes` — neither is removed or narrowed.
- `normalize_country`'s behavior for its five pre-existing aliases (UK, BRITAIN, GREAT BRITAIN, USA, UNITED STATES OF AMERICA) must be unchanged.
- No frontend or API contract changes.
- Backend tests run from the host (`cd backend && uv run pytest ...`) with `docker compose up -d db` running.
- The backend Docker image does not bind-mount source; run `docker compose up -d --build backend` after the change, before any live verification.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Shared alias table + country search resolution

**Files:**
- Modify: `backend/app/utils.py` (`_COUNTRY_ALIASES` at lines 127-133; `normalize_country` reference at line 148)
- Modify: `backend/app/crud.py` (imports at line 11; `_resolve_country_codes` at lines 185-193)
- Modify: `backend/tests/test_countries.py` (append a new test)
- Modify: `backend/tests/api/routes/test_players.py` (append two new tests)

**Interfaces:**
- Consumes: existing `app.countries.COUNTRY_NAMES`, `app.utils.normalize_country`, `app.crud._resolve_country_codes` (all pre-existing).
- Produces: `app.utils.COUNTRY_ALIASES: dict[str, str]` (public, renamed from `_COUNTRY_ALIASES`, 14 entries). No later task depends on anything beyond this.

- [ ] **Step 1: Ensure environment**

```bash
docker compose up -d db
cd backend && uv sync
```

- [ ] **Step 2: Add failing tests for the new aliases**

Append to `backend/tests/test_countries.py` (after the existing `test_normalize_country_alias_russia` test, before `test_normalize_country_unknown_returns_none`):

```python
def test_normalize_country_new_shorthand_aliases() -> None:
    assert normalize_country("UAE") == "AE"
    assert normalize_country("PNG") == "PG"
    assert normalize_country("DRC") == "CD"
    assert normalize_country("RSA") == "ZA"
    assert normalize_country("KSA") == "SA"
    assert normalize_country("CAR") == "CF"
    assert normalize_country("Ivory Coast") == "CI"
    assert normalize_country("DPRK") == "KP"
    assert normalize_country("ROK") == "KR"
```

Append to `backend/tests/api/routes/test_players.py` (after the existing `test_search_by_country_only_orders_alphabetically` test — the last test in the file):

```python
def test_search_by_country_resolves_new_shorthand_aliases(
    client: TestClient, db: Session
) -> None:
    from app.models import PlayerCreate

    seeded = {
        "uae": ("AE", "Zayed Aliasplayer"),
        "png": ("PG", "Kila Aliasplayer"),
        "drc": ("CD", "Joseph Aliasplayer"),
        "rsa": ("ZA", "Thabo Aliasplayer"),
        "ksa": ("SA", "Faisal Aliasplayer"),
        "car": ("CF", "Jean Aliasplayer"),
        "ivory coast": ("CI", "Kolo Aliasplayer"),
        "dprk": ("KP", "Kim Aliasplayer"),
        "rok": ("KR", "Sun Aliasplayer"),
    }
    players = {}
    for alias, (code, name) in seeded.items():
        p = crud.create_player(
            session=db, player_in=PlayerCreate(display_name=name, countries=[code])
        )
        p.is_published = True
        db.add(p)
        players[alias] = p
    db.commit()

    for alias in seeded:
        r = client.get(
            f"{settings.API_V1_STR}/players/search", params={"country": alias}
        )
        assert r.status_code == 200
        ids = {item["player"]["id"] for item in r.json()["data"]}
        assert str(players[alias].id) in ids, f"alias {alias!r} did not match its player"


def test_search_by_country_alias_near_miss_returns_empty(client: TestClient) -> None:
    r = client.get(
        f"{settings.API_V1_STR}/players/search", params={"country": "usab"}
    )
    assert r.status_code == 200
    assert r.json()["data"] == []
```

- [ ] **Step 3: Run the new tests to verify they fail**

```bash
cd backend && uv run pytest tests/test_countries.py::test_normalize_country_new_shorthand_aliases tests/api/routes/test_players.py::test_search_by_country_resolves_new_shorthand_aliases -v
```

Expected: FAIL. `test_normalize_country_new_shorthand_aliases` fails because `normalize_country` returns `None` for these nine strings today (not in `_COUNTRY_ALIASES` yet). `test_search_by_country_resolves_new_shorthand_aliases` fails because `_resolve_country_codes` doesn't consult any alias table today, so none of the nine `country=<alias>` searches find their seeded player.

(`test_search_by_country_alias_near_miss_returns_empty` already passes today — it's a regression guard, not new-behavior-under-test — that's expected and fine.)

- [ ] **Step 4: Rename and extend the alias table in `utils.py`**

In `backend/app/utils.py`, replace lines 127-133:

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

Update the reference at line 148 (inside `normalize_country`):

```python
    if upper in COUNTRY_ALIASES:
        return COUNTRY_ALIASES[upper]
```

- [ ] **Step 5: Wire the alias table into `_resolve_country_codes` in `crud.py`**

In `backend/app/crud.py`, update the import at line 11:

```python
from app.countries import COUNTRY_NAMES
from app.utils import COUNTRY_ALIASES
```

(Keep both import lines — `app.countries` and `app.utils` are separate modules; don't merge them into one `from` statement.)

Replace `_resolve_country_codes` (currently lines 185-193):

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

- [ ] **Step 6: Run the new tests to verify they pass**

```bash
cd backend && uv run pytest tests/test_countries.py tests/api/routes/test_players.py -v
```

Expected: all PASS, including the two new tests from Step 2 and all pre-existing tests in both files (in particular `test_normalize_country_alias_uk`, `test_normalize_country_alias_usa`, and the other four pre-existing alias tests, confirming the rename didn't break anything).

- [ ] **Step 7: Run the full backend suite**

```bash
cd backend && bash scripts/test.sh
```

Expected: all PASS.

- [ ] **Step 8: Rebuild the running backend container**

```bash
docker compose up -d --build backend
```

Verify:

```bash
curl -s "http://localhost:8000/api/v1/players/search?country=uae" -o /dev/null -w "%{http_code}\n"
```

Expected: `200`.

- [ ] **Step 9: Commit**

```bash
git add backend/app/utils.py backend/app/crud.py backend/tests/test_countries.py backend/tests/api/routes/test_players.py
git commit -m "feat(backend): add shorthand aliases (UAE, PNG, DRC, RSA, KSA, CAR, DPRK, ROK, Ivory Coast) to country search

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Final verification

**Files:** none new — fixes only if something fails.

- [ ] **Step 1: Full backend suite**

```bash
cd backend && bash scripts/test.sh
```

Expected: all PASS.

- [ ] **Step 2: Live smoke checks against the running backend**

```bash
for alias in uae png drc rsa ksa car dprk rok; do
  echo "=== $alias ==="
  curl -s "http://localhost:8000/api/v1/players/search?country=$alias" -w "\nHTTP %{http_code}\n"
done
curl -s "http://localhost:8000/api/v1/players/search?country=Ivory%20Coast" -w "\nHTTP %{http_code}\n"
```

Expected: all HTTP 200, well-formed `data` arrays (may be empty if no published players from those countries exist in the current dev DB — the point is 200 + well-formed, not necessarily non-empty, since Task 1's own tests already prove the resolution logic against seeded data).

- [ ] **Step 3: Commit any straggler fixes**

Only if Step 1 changed files:

```bash
git add -A && git commit -m "chore: fixes from final verification of country search aliases

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
