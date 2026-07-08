# Players Freetext Country Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second, freetext search box on the public Players page that finds players by country (partial country-name or code), working independently of and combinable with the existing name search.

**Architecture:** Backend-first. Extend `search_players` (crud) to (a) allow an empty name query and (b) resolve freetext country text to a set of country codes via `app.countries.COUNTRY_NAMES`, filtering players by code-set intersection; make the `/players/search` route's `q` optional. Regenerate the OpenAPI client, then add the second debounced input on the players page.

**Tech Stack:** FastAPI + SQLModel + pytest (backend); React + TanStack Query/Router + shadcn/ui (frontend); `@hey-api/openapi-ts` client generation.

**Spec:** `docs/superpowers/specs/2026-07-06-players-country-search-design.md`

## Global Constraints

- Branch: work happens on `search-by-country` (already checked out; based on merged `main`).
- Freetext country match: a code is included if the typed text uppercased equals the code, OR the typed text lowercased is a substring of the country's name (`COUNTRY_NAMES[code]`) lowercased. Players match if `resolved_codes & set(player.countries)` is non-empty.
- Independent + combinable: name-only works as today; country-only returns all players from matching countries; both together = intersection; both empty = `[]`.
- Country text that resolves to no codes → `[]` (no player matches a nonexistent country).
- Ordering: name present → rank by `SequenceMatcher` similarity (unchanged); name empty (country-only) → alphabetical by `display_name`, case-insensitive.
- Search results stay non-paginated; the frontend requests `limit: 50`.
- Backend tests/alembic run from the host (`cd backend && uv run ...`) with `docker compose up -d db` running; `.env` points Postgres at localhost:5432.
- The backend Docker image does not bind-mount source; run `docker compose up -d --build backend` before any frontend/Playwright task that needs the new API.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Backend — freetext country search

**Files:**
- Modify: `backend/app/crud.py` (`search_players`, ~line 172-193; add a helper above it; add imports at line 10-ish)
- Modify: `backend/app/api/routes/players.py` (`search_players_route` line 37-56; remove now-unused `normalize_country` import line 32)
- Modify: `backend/tests/api/routes/test_players.py` (update `test_search_players_missing_q`; append new tests)

**Interfaces:**
- Consumes: `app.countries.COUNTRY_NAMES` (`dict[str, str]` code→name); existing `_normalize`, `Player`, `PlayerCreate`.
- Produces: `search_players(*, session, q: str = "", country: str | None = None, limit: int = 5, published_only: bool = False) -> list[tuple[Player, float]]` with freetext country semantics; `/players/search` route with optional `q: str = ""`. Task 2 regenerates the client from the route.

- [ ] **Step 1: Ensure environment**

```bash
docker compose up -d db
cd backend && uv sync
```

- [ ] **Step 2: Update the now-invalid test and add new failing tests**

In `backend/tests/api/routes/test_players.py`, replace `test_search_players_missing_q` (currently asserts 422) with the new empty-query contract:

```python
def test_search_players_no_params_returns_empty(client: TestClient) -> None:
    r = client.get(f"{settings.API_V1_STR}/players/search")
    assert r.status_code == 200
    assert r.json()["data"] == []
```

Then append these tests (they use the existing `create_player` + `is_published` pattern already used at test_players.py:398):

```python
def test_search_by_country_partial_name_only(client: TestClient, db: Session) -> None:
    from app.models import PlayerCreate

    ie = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name="Aoife Irishplayer", countries=["IE"]),
    )
    ie.is_published = True
    fr = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name="Marie Frenchplayer", countries=["FR"]),
    )
    fr.is_published = True
    db.add(ie)
    db.add(fr)
    db.commit()

    r = client.get(
        f"{settings.API_V1_STR}/players/search", params={"country": "irel"}
    )
    assert r.status_code == 200
    ids = {item["player"]["id"] for item in r.json()["data"]}
    assert str(ie.id) in ids
    assert str(fr.id) not in ids


def test_search_by_country_code_matches_same_as_name(
    client: TestClient, db: Session
) -> None:
    from app.models import PlayerCreate

    ie = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name="Sean Codeplayer", countries=["IE"]),
    )
    ie.is_published = True
    db.add(ie)
    db.commit()

    r = client.get(f"{settings.API_V1_STR}/players/search", params={"country": "IE"})
    assert r.status_code == 200
    ids = {item["player"]["id"] for item in r.json()["data"]}
    assert str(ie.id) in ids


def test_search_by_country_matches_multiple_countries(
    client: TestClient, db: Session
) -> None:
    from app.models import PlayerCreate

    us = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name="Hank Unitedstates", countries=["US"]),
    )
    us.is_published = True
    gb = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name="Nigel Unitedkingdom", countries=["GB"]),
    )
    gb.is_published = True
    fr = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name="Marie Notunited", countries=["FR"]),
    )
    fr.is_published = True
    db.add(us)
    db.add(gb)
    db.add(fr)
    db.commit()

    r = client.get(
        f"{settings.API_V1_STR}/players/search", params={"country": "united"}
    )
    assert r.status_code == 200
    ids = {item["player"]["id"] for item in r.json()["data"]}
    assert str(us.id) in ids
    assert str(gb.id) in ids
    assert str(fr.id) not in ids


def test_search_by_country_no_match_returns_empty(client: TestClient) -> None:
    r = client.get(
        f"{settings.API_V1_STR}/players/search", params={"country": "zzzznotacountry"}
    )
    assert r.status_code == 200
    assert r.json()["data"] == []


def test_search_name_and_country_combined(client: TestClient, db: Session) -> None:
    from app.models import PlayerCreate

    match = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name="Liam Combined", countries=["IE"]),
    )
    match.is_published = True
    wrong_country = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name="Liam Combined", countries=["FR"]),
    )
    wrong_country.is_published = True
    db.add(match)
    db.add(wrong_country)
    db.commit()

    r = client.get(
        f"{settings.API_V1_STR}/players/search",
        params={"q": "Liam Combined", "country": "ireland"},
    )
    assert r.status_code == 200
    ids = {item["player"]["id"] for item in r.json()["data"]}
    assert str(match.id) in ids
    assert str(wrong_country.id) not in ids


def test_search_by_country_only_excludes_unpublished_for_anonymous(
    client: TestClient, db: Session
) -> None:
    from app.models import PlayerCreate

    hidden = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name="Ghost Hiddenplayer", countries=["IE"]),
    )  # is_published defaults False
    db.add(hidden)
    db.commit()

    r = client.get(
        f"{settings.API_V1_STR}/players/search", params={"country": "ireland"}
    )
    assert r.status_code == 200
    ids = {item["player"]["id"] for item in r.json()["data"]}
    assert str(hidden.id) not in ids
```

- [ ] **Step 3: Run the new tests to verify they fail**

```bash
cd backend && uv run pytest tests/api/routes/test_players.py -k "search" -v
```

Expected: `test_search_players_no_params_returns_empty` fails (currently 422, not 200), and the country tests fail (country is currently normalized to an exact code, so `irel`/`united` resolve to nothing and return empty; `no_params` still 422). This confirms RED.

- [ ] **Step 4: Add the country-resolution helper and rewrite `search_players`**

In `backend/app/crud.py`, add the countries import near the top (after line 10 `from app.core.security ...`):

```python
from app.countries import COUNTRY_NAMES
```

Add this helper immediately above `def search_players`:

```python
def _resolve_country_codes(text: str) -> set[str]:
    needle = text.strip().lower()
    if not needle:
        return set()
    upper = needle.upper()
    return {
        code
        for code, name in COUNTRY_NAMES.items()
        if upper == code or needle in name.lower()
    }
```

Replace the whole `search_players` function with:

```python
def search_players(
    *,
    session: Session,
    q: str = "",
    country: str | None = None,
    limit: int = 5,
    published_only: bool = False,
) -> list[tuple[Player, float]]:
    name_query = (q or "").strip()
    country_text = (country or "").strip()
    if not name_query and not country_text:
        return []

    q_norm = _normalize(q or "")
    stmt = select(Player)
    if name_query:
        stmt = stmt.where(
            or_(
                col(Player.display_name).ilike(f"%{q}%"),
                col(Player.display_name).ilike(f"%{q_norm}%"),
            )
        )
    if published_only:
        stmt = stmt.where(Player.is_published == True)  # noqa: E712
    players = list(session.exec(stmt).all())

    if country_text:
        codes = _resolve_country_codes(country_text)
        if not codes:
            return []
        players = [p for p in players if codes & set(p.countries)]

    if name_query:
        scored = [
            (p, SequenceMatcher(None, q_norm, _normalize(p.display_name)).ratio())
            for p in players
        ]
        scored.sort(key=lambda x: x[1], reverse=True)
    else:
        scored = [
            (p, 0.0)
            for p in sorted(players, key=lambda p: p.display_name.lower())
        ]

    return scored[:limit]
```

- [ ] **Step 5: Update the route to make `q` optional and drop pre-normalization**

In `backend/app/api/routes/players.py`, remove the import at line 32:

```python
from app.utils import normalize_country
```

Replace `search_players_route` (lines 37-56) with:

```python
@router.get("/search", response_model=PlayerSearchResults)
def search_players_route(
    session: SessionDep,
    current_user: OptionalCurrentUser,
    q: str = "",
    country: str | None = None,
    limit: int = 5,
) -> PlayerSearchResults:
    published_only = current_user is None
    results = search_players(
        session=session,
        q=q,
        country=country,
        limit=limit,
        published_only=published_only,
    )
    return PlayerSearchResults(
        data=[
            PlayerSearchResult(player=PlayerPublic.model_validate(p), similarity=score)
            for p, score in results
        ]
    )
```

- [ ] **Step 6: Run the search tests to verify they pass**

```bash
cd backend && uv run pytest tests/api/routes/test_players.py -k "search" -v
```

Expected: all PASS, including the pre-existing `test_search_players_filters_by_country_membership` (crud-level, `country="GB"` still resolves to `{GB}` via code match) and `test_search_players_normalizes_diacritics`.

- [ ] **Step 7: Run the full players test file**

```bash
cd backend && uv run pytest tests/api/routes/test_players.py -v
```

Expected: all PASS.

- [ ] **Step 8: Rebuild the running backend container**

```bash
docker compose up -d --build backend
```

Verify: `curl -s "http://localhost:8000/api/v1/players/search?country=ireland" -o /dev/null -w "%{http_code}\n"` prints `200`.

- [ ] **Step 9: Commit**

```bash
git add backend/app/crud.py backend/app/api/routes/players.py backend/tests/api/routes/test_players.py
git commit -m "feat(backend): freetext country search for players

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Regenerate the frontend OpenAPI client

**Files:**
- Modify (generated): `frontend/src/client/types.gen.ts`, `frontend/src/client/schemas.gen.ts` (do NOT commit `frontend/openapi.json` — it is gitignored)

**Interfaces:**
- Consumes: Task 1's route (`q` now optional).
- Produces: `PlayersSearchPlayersRouteData.q?: string` (optional) in `frontend/src/client/types.gen.ts`. Task 3 relies on being able to omit/empty `q`.

- [ ] **Step 1: Regenerate**

From the project root (backend container must be running with Task 1's changes):

```bash
bash ./scripts/generate-client.sh
```

Expected: exits 0.

- [ ] **Step 2: Verify the generated type**

```bash
grep -A 4 "PlayersSearchPlayersRouteData = {" frontend/src/client/types.gen.ts
```

Expected: `q?: (string);` or `q?: string;` (optional — has the `?`).

- [ ] **Step 3: Confirm `frontend/openapi.json` is untracked**

```bash
git status --porcelain frontend/openapi.json
```

Expected: either no output, or a `??` (untracked) line — it must NOT be staged. It is gitignored; do not force-add it.

- [ ] **Step 4: Commit only the generated client**

```bash
git add frontend/src/client/
git commit -m "chore(client): regenerate OpenAPI client for optional search q

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Frontend — second country search box

**Files:**
- Modify: `frontend/src/routes/_public/players.tsx`

**Interfaces:**
- Consumes: Task 2's optional-`q` client type; existing `PlayersService.searchPlayersRoute`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add country search state**

In `frontend/src/routes/_public/players.tsx`, after the existing name debounce block (currently lines 77-83), add a parallel country input + debounce:

```tsx
  const [countryInput, setCountryInput] = useState("")
  const [debouncedCountry, setDebouncedCountry] = useState("")

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedCountry(countryInput), 300)
    return () => clearTimeout(timer)
  }, [countryInput])
```

- [ ] **Step 2: Extend the search condition and query**

Replace the `isSearching` line (currently line 85) with:

```tsx
  const isSearching = debouncedQuery.length > 0 || debouncedCountry.length > 0
```

Replace the `searchQuery` block (currently lines 98-106) with:

```tsx
  const searchQuery = useQuery({
    queryKey: ["players", "search", debouncedQuery, debouncedCountry],
    queryFn: () =>
      PlayersService.searchPlayersRoute({
        q: debouncedQuery,
        country: debouncedCountry || undefined,
        limit: 50,
      }),
    enabled: isSearching,
  })
```

- [ ] **Step 3: Render the second input beside the first**

Replace the single name `Input` (currently lines 151-156) with a flex row containing both inputs:

```tsx
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          placeholder="Search players…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="max-w-sm"
        />
        <Input
          placeholder="Search by country…"
          value={countryInput}
          onChange={(e) => setCountryInput(e.target.value)}
          className="max-w-sm"
        />
      </div>
```

- [ ] **Step 4: Type-check and lint**

```bash
cd frontend && bun run build && bun run lint
```

Expected: both exit 0.

- [ ] **Step 5: Manual verification**

With the stack running (backend rebuilt in Task 1 Step 8; run the frontend via `cd frontend && bun run dev` or rebuild the frontend container), open the Players page and confirm:
- Typing a partial country name (e.g. "irel") filters the table to players from that country, with the name box empty.
- Typing a name alone still works as before.
- Filling both narrows to the intersection.
- Clearing both boxes returns to the paginated browse list.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/routes/_public/players.tsx
git commit -m "feat(players): add freetext country search box

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Final verification

**Files:** none new — fixes only if something fails.

- [ ] **Step 1: Full backend suite**

```bash
cd backend && bash scripts/test.sh
```

Expected: all PASS.

- [ ] **Step 2: Frontend type-check + lint**

```bash
cd frontend && bun run build && bun run lint
```

Expected: both exit 0.

- [ ] **Step 3: Players Playwright spec (regression)**

The players E2E spec must still pass. Backend must be running with Task 1's changes; Playwright starts the Vite dev server itself.

```bash
cd frontend && bunx playwright test tests/players.spec.ts
```

Expected: PASS (or any failures reproduce on the pre-feature commit — verify before treating as new).

- [ ] **Step 4: Commit any straggler fixes**

Only if Steps 1-3 changed files (e.g. lint autofix on the two files this feature touched — do NOT reformat unrelated files):

```bash
git add -A && git commit -m "chore: lint fixes for players country search

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
