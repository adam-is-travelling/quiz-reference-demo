# Upload Disambiguation Auto-Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-resolve unambiguous player matches in Step 4 of the upload wizard, split the UI into a "Needs Review" section (red border, blocks Next) and a collapsed "Auto-resolved" section, and fix similarity scoring to be diacritic-insensitive.

**Architecture:** Backend gets a `_normalize` helper (Unicode NFD strip) applied to both sides of the SequenceMatcher comparison, plus an OR-expanded ilike filter so diacritic-form queries find ASCII-stored names. Frontend adds `autoResolved?: boolean` to the `Resolution` type; `RowDisambiguator` fires a one-shot `useEffect` when its search query settles to call `getAutoResolution` and push an initial resolution. `Step4Disambiguation` derives two index lists from the resolution state and renders two sections.

**Tech Stack:** Python / SQLModel / unicodedata (backend), React / TypeScript / TanStack Query (frontend), Bun (frontend tooling)

---

## File Map

| Action | File | Change |
|---|---|---|
| Modify | `backend/app/crud.py` | Add `_normalize`, add `or_` import, update `search_players` |
| Modify | `backend/tests/api/routes/test_players.py` | Diacritics test |
| Modify | `frontend/src/components/Upload/types.ts` | Add `autoResolved?` to `Resolution` |
| Modify | `frontend/src/components/Upload/steps/Step4Disambiguation.tsx` | Auto-selection logic + two-section layout |

---

## Task 1: Diacritics normalization in `search_players`

**Files:**
- Modify: `backend/app/crud.py`
- Modify: `backend/tests/api/routes/test_players.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/api/routes/test_players.py`. First add `PlayerCreate` to the models import:

```python
from app.models import EventResultCreate, PlayerCreate
```

Then add the test:

```python
def test_search_players_normalizes_diacritics(client: TestClient, db: Session) -> None:
    player = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name="Lucian Sosic", country="HR"),
    )
    r = client.get(
        f"{settings.API_V1_STR}/players/search",
        params={"q": "Lucian Šošić"},
    )
    assert r.status_code == 200
    ids = [item["player"]["id"] for item in r.json()["data"]]
    assert str(player.id) in ids
    match = next(item for item in r.json()["data"] if item["player"]["id"] == str(player.id))
    assert match["similarity"] >= 0.9
```

- [ ] **Step 2: Run to verify it fails**

```bash
docker compose exec backend bash scripts/tests-start.sh tests/api/routes/test_players.py::test_search_players_normalizes_diacritics -x
```

Expected: `FAILED` — similarity is below 0.9 because diacritics aren't stripped.

- [ ] **Step 3: Add `_normalize` and update `search_players` in `backend/app/crud.py`**

Add to the top of the file (after existing stdlib imports, before third-party imports):

```python
import unicodedata
```

Add to the sqlalchemy/sqlmodel import line:

```python
from sqlalchemy import or_
```

After the `_generate_slug` function, add:

```python
def _normalize(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", s.lower())
        if unicodedata.category(c) != "Mn"
    )
```

Replace `search_players` entirely:

```python
def search_players(
    *, session: Session, q: str, country: str | None = None, limit: int = 5
) -> list[tuple[Player, float]]:
    q_norm = _normalize(q)
    stmt = select(Player).where(
        or_(
            col(Player.display_name).ilike(f"%{q}%"),
            col(Player.display_name).ilike(f"%{q_norm}%"),
        )
    )
    if country:
        stmt = stmt.where(col(Player.country).ilike(f"%{country}%"))
    players = session.exec(stmt).all()
    scored = [
        (p, SequenceMatcher(None, q_norm, _normalize(p.display_name)).ratio())
        for p in players
    ]
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:limit]
```

- [ ] **Step 4: Run to verify the new test passes**

```bash
docker compose exec backend bash scripts/tests-start.sh tests/api/routes/test_players.py::test_search_players_normalizes_diacritics -x
```

Expected: `PASSED`

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
docker compose exec backend bash scripts/tests-start.sh
```

Expected: same pass count as before (pre-existing `test_valid_country_codes_is_frozenset` failure is unrelated).

- [ ] **Step 6: Commit**

```bash
git add backend/app/crud.py backend/tests/api/routes/test_players.py
git commit -m "feat: normalize diacritics in player search similarity scoring"
```

---

## Task 2: Auto-selection logic

**Files:**
- Modify: `frontend/src/components/Upload/types.ts`
- Modify: `frontend/src/components/Upload/steps/Step4Disambiguation.tsx`

- [ ] **Step 1: Add `autoResolved` to the `Resolution` type**

In `frontend/src/components/Upload/types.ts`, replace:

```typescript
export type Resolution = {
  player_id: string | null
  player_create: PlayerCreate | null
}
```

With:

```typescript
export type Resolution = {
  player_id: string | null
  player_create: PlayerCreate | null
  autoResolved?: boolean
}
```

- [ ] **Step 2: Add `SIMILARITY_THRESHOLD` and `getAutoResolution` to `Step4Disambiguation.tsx`**

After the imports in `frontend/src/components/Upload/steps/Step4Disambiguation.tsx`, add:

```typescript
const SIMILARITY_THRESHOLD = 0.9

function getAutoResolution(
  parsedRow: ParsedRow,
  candidates: PlayerSearchResult[],
): Resolution {
  if (candidates.length === 0) {
    return {
      player_id: null,
      player_create: {
        display_name: parsedRow.player_name,
        country: resolveCountryCode(parsedRow.country) ?? null,
      },
      autoResolved: true,
    }
  }
  const highConf = candidates.filter((c) => c.similarity >= SIMILARITY_THRESHOLD)
  if (highConf.length === 1) {
    return { player_id: highConf[0].player.id, player_create: null, autoResolved: true }
  }
  return { player_id: null, player_create: null, autoResolved: false }
}
```

- [ ] **Step 3: Add `useRef` and `useEffect` to `RowDisambiguator`**

Update the React import at the top of the file to include `useEffect` and `useRef`:

```typescript
import { useEffect, useRef, useState } from "react"
```

In `RowDisambiguator`, add a `variant` prop and a `useRef`/`useEffect` for auto-selection. Replace the entire `RowDisambiguator` function:

```typescript
function RowDisambiguator({
  parsedRow,
  resolution,
  onChange,
  index,
  variant = "default",
}: {
  parsedRow: ParsedRow
  resolution: Resolution
  onChange: (r: Resolution) => void
  index: number
  variant?: "default" | "review"
}) {
  const [creating, setCreating] = useState(resolution.player_create !== null)
  const [newName, setNewName] = useState(parsedRow.player_name)
  const [newCountry, setNewCountry] = useState<string | null>(() =>
    resolveCountryCode(parsedRow.country),
  )

  const { data: searchResults } = useQuery({
    queryFn: () =>
      PlayersService.searchPlayersRoute({
        q: parsedRow.player_name,
        country: parsedRow.country,
      }),
    queryKey: ["players", "search", parsedRow.player_name, parsedRow.country],
  })

  const candidates: PlayerSearchResult[] = searchResults?.data ?? []

  const autoApplied = useRef(false)

  useEffect(() => {
    if (autoApplied.current) return
    if (resolution.autoResolved !== undefined) {
      autoApplied.current = true
      return
    }
    if (searchResults === undefined) return
    autoApplied.current = true
    const auto = getAutoResolution(parsedRow, searchResults.data ?? [])
    if (auto.autoResolved && auto.player_create !== null) {
      setCreating(true)
      setNewName(auto.player_create.display_name ?? parsedRow.player_name)
      setNewCountry(auto.player_create.country ?? null)
    } else if (auto.autoResolved && auto.player_id !== null) {
      setCreating(false)
    }
    onChange(auto)
  }, [searchResults])

  const selectExisting = (id: string) => {
    setCreating(false)
    onChange({ player_id: id, player_create: null })
  }

  const selectNew = () => {
    setCreating(true)
    onChange({
      player_id: null,
      player_create: { display_name: newName, country: newCountry },
    })
  }

  return (
    <div
      className={`border rounded-lg p-4 flex flex-col gap-3 ${
        variant === "review" ? "border-destructive" : ""
      }`}
    >
      <p className="text-sm font-medium">
        {parsedRow.player_name} · {parsedRow.country} · Score: {parsedRow.score}
      </p>

      <div className="flex flex-col gap-2">
        {candidates.map((c) => (
          <label
            key={c.player.id}
            className="flex items-center gap-3 cursor-pointer"
          >
            <input
              type="radio"
              name={`row-${index}`}
              checked={resolution.player_id === c.player.id}
              onChange={() => selectExisting(c.player.id)}
            />
            <span className="text-sm">
              {c.player.display_name}{" "}
              <span className="text-muted-foreground">
                ({countryName(c.player.country)}
                {c.player.city ? `, ${c.player.city}` : ""}) —{" "}
              </span>
              {!c.player.is_published && (
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  user has no published results —{" "}
                </span>
              )}
              <span className="text-muted-foreground">
                {Math.round(c.similarity * 100)}% match
              </span>
            </span>
          </label>
        ))}
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="radio"
            name={`row-${index}`}
            checked={creating}
            onChange={selectNew}
          />
          <span className="text-sm font-medium">Create new player</span>
        </label>
      </div>

      {creating && (
        <div className="flex gap-3 ml-6">
          <div className="grid gap-1">
            <Label className="text-xs">Name</Label>
            <Input
              className="h-7 text-xs"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value)
                onChange({
                  player_id: null,
                  player_create: {
                    display_name: e.target.value,
                    country: newCountry,
                  },
                })
              }}
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Country</Label>
            <CountrySelect
              value={newCountry}
              onChange={(code) => {
                setNewCountry(code)
                onChange({
                  player_id: null,
                  player_create: {
                    display_name: newName,
                    country: code,
                  },
                })
              }}
              className="h-7 text-xs rounded-md border border-input bg-background px-2 py-0.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Type-check**

```bash
cd frontend && bun run build
```

Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Upload/types.ts frontend/src/components/Upload/steps/Step4Disambiguation.tsx
git commit -m "feat: auto-select player match on disambiguation load"
```

---

## Task 3: Two-section layout

**Files:**
- Modify: `frontend/src/components/Upload/steps/Step4Disambiguation.tsx`

- [ ] **Step 1: Replace `Step4Disambiguation` body with two-section layout**

Replace the entire `Step4Disambiguation` function with:

```typescript
export function Step4Disambiguation({ state, update }: Props) {
  const parseRows: ParsedRow[] = state.parsedRows.slice(1).map((row) => ({
    player_name: row[state.columnMapping.player_name] ?? "",
    country: row[state.columnMapping.country] ?? "",
    score: parseFloat(row[state.columnMapping.score] ?? "0"),
    tiebreaker_rank: parseInt(
      row[state.columnMapping.tiebreaker_rank] ?? "1",
      10,
    ),
  }))

  const [resolutions, setResolutions] = useState<Resolution[]>(
    state.resolutions.length === parseRows.length
      ? state.resolutions
      : parseRows.map(() => ({ player_id: null, player_create: null })),
  )

  const [showAutoResolved, setShowAutoResolved] = useState(false)

  const needsReviewIndices = parseRows
    .map((_, i) => i)
    .filter((i) => resolutions[i]?.autoResolved !== true)

  const autoResolvedIndices = parseRows
    .map((_, i) => i)
    .filter((i) => resolutions[i]?.autoResolved === true)

  const canProceed = needsReviewIndices.every(
    (i) =>
      (resolutions[i]?.player_id ?? null) !== null ||
      (resolutions[i]?.player_create ?? null) !== null,
  )

  // Auto-open the auto-resolved section once everything is settled and
  // nothing requires manual attention
  useEffect(() => {
    const allSettled = resolutions.every((r) => r.autoResolved !== undefined)
    const anyNeedsReview = resolutions.some((r) => r.autoResolved !== true)
    const hasAutoResolved = resolutions.some((r) => r.autoResolved === true)
    if (allSettled && !anyNeedsReview && hasAutoResolved) {
      setShowAutoResolved(true)
    }
  }, [resolutions])

  const handleChange = (i: number, r: Resolution) =>
    setResolutions((prev) => {
      const next = [...prev]
      // Preserve the autoResolved bucket flag when the admin overrides a row
      next[i] = { ...r, autoResolved: prev[i]?.autoResolved }
      return next
    })

  const handleNext = () => {
    update({ resolutions, step: 5 })
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Confirm or correct each player match. Select "Create new player" for
        anyone not yet in the system.
      </p>

      {needsReviewIndices.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-destructive">
            Needs Review ({needsReviewIndices.length})
          </p>
          <div className="flex flex-col gap-3 max-h-[50vh] overflow-y-auto pr-1">
            {needsReviewIndices.map((i) => (
              <RowDisambiguator
                key={i}
                parsedRow={parseRows[i]}
                resolution={
                  resolutions[i] ?? { player_id: null, player_create: null }
                }
                onChange={(r) => handleChange(i, r)}
                index={i}
                variant="review"
              />
            ))}
          </div>
        </div>
      )}

      {autoResolvedIndices.length > 0 && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowAutoResolved((v) => !v)}
            className="flex items-center gap-2 text-sm font-medium text-left w-fit"
          >
            <span>{showAutoResolved ? "▾" : "▸"}</span>
            Auto-resolved ({autoResolvedIndices.length})
          </button>
          {showAutoResolved && (
            <div className="flex flex-col gap-3 max-h-[50vh] overflow-y-auto pr-1">
              {autoResolvedIndices.map((i) => (
                <RowDisambiguator
                  key={i}
                  parsedRow={parseRows[i]}
                  resolution={
                    resolutions[i] ?? { player_id: null, player_create: null }
                  }
                  onChange={(r) => handleChange(i, r)}
                  index={i}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-3">
        <Button variant="outline" onClick={() => update({ step: 3 })}>
          ← Back
        </Button>
        <Button onClick={handleNext} disabled={!canProceed}>
          Next →
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check and build**

```bash
cd frontend && bun run build
```

Expected: no TypeScript errors.

- [ ] **Step 3: Rebuild Docker frontend**

```bash
cd .. && docker compose build frontend && docker compose up -d frontend
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Upload/steps/Step4Disambiguation.tsx
git commit -m "feat: split disambiguation into Needs Review and Auto-resolved sections"
```
