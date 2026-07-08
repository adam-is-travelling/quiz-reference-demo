# Auto-Detect Column Mapping Defaults

**Date:** 2026-07-08
**Status:** Approved

## Background

Step 3 of the upload wizard (`Step3ColumnMapping.tsx`) already auto-detects the **position** column via `detectPositionColumn`, matching header names against a fixed candidate list (`position`, `pos`, `rank`, `place`, `#`, `no`, `no.`). `player_name`, `country`, and `score` have no equivalent — they always default to hardcoded column indices 0, 1, 2 regardless of the CSV's actual headers. Round columns also have no name-based detection; the only assistance is a "cascade" that fills rounds 2..N sequentially once the user manually picks round 1.

This spec generalizes the position-detection pattern to all required fields and adds exact-name detection for round columns.

## Changes

### `frontend/src/components/Upload/steps/Step3ColumnMapping.tsx`

**Generalize the detector.** Replace `detectPositionColumn` with a reusable function:

```ts
function detectColumn(
  header: string[],
  candidates: string[],
  claimed: Set<number>,
): number | null {
  const normalized = header.map((h) => h.trim().toLowerCase())
  const candidateSet = candidates.map((c) => c.toLowerCase())

  // Exact match first
  for (let i = 0; i < normalized.length; i++) {
    if (claimed.has(i)) continue
    if (candidateSet.includes(normalized[i])) return i
  }
  // Substring fallback
  for (let i = 0; i < normalized.length; i++) {
    if (claimed.has(i)) continue
    if (candidateSet.some((c) => normalized[i].includes(c))) return i
  }
  return null
}
```

**Candidate lists** (module-level constants):

```ts
const PLAYER_NAME_HEADER_NAMES = ["name", "player", "player name"]
const COUNTRY_HEADER_NAMES = ["country"]
const SCORE_HEADER_NAMES = ["total", "score", "overall"]
const POSITION_HEADER_NAMES = [
  "position", "pos", "rank", "place", "#", "no", "no.", "psn",
]
```

(`psn` is newly added to the existing position list.)

**Detection order and claiming.** In the `useState` initializer (runs once on mount, same as today's position logic — never re-runs on re-render, so it won't clobber a mapping the user already edited and navigated back to):

1. Build a `claimed: Set<number>` of column indices.
2. Detect `player_name` against unclaimed columns; if found, add to `claimed`; else fall back to `existing.player_name` (today's hardcoded default of `0`, preserved unchanged).
3. Detect `country` the same way, falling back to `existing.country` (`1`).
4. Detect `score` the same way, falling back to `existing.score` (`2`).
5. Detect `position` the same way (existing behavior, unchanged fallback of `null`).
6. For each round `i` where `state.selectedFormat.rounds[i]` is a non-empty string, detect an **exact match only** (no substring fallback) of that round's name against unclaimed columns; if found, add to `claimed` and set `mapping.rounds[i]`. Rounds with no name, or with no match, are left as they are today (`null`, eligible for the existing manual cascade-fill).

Fields are processed in this fixed order — `player_name → country → score → position → rounds[0..N]` — so an earlier field always wins a contested column, and later fields simply fall back to their existing default behavior for that slot.

**Not changed:**
- The existing cascade behavior (picking round 1 manually auto-fills rounds 2..N sequentially) is untouched and still applies to any round left `null` by name-detection.
- The Select components, preview table, and `handleNext` logic are unchanged.

## Tests

### Playwright — `frontend/tests/upload.spec.ts`

Extend the existing "Upload wizard — column mapping" describe block:

- CSV with headers `Player Name, Country, Total, Rank` → assert Step 3's selects for player name/country/score/position pre-select the correct columns without any manual interaction.
- CSV with headers matching via substring only (e.g. `Total Score`) → assert score pre-selects that column.
- CSV with a header exactly matching a configured round name (e.g. format round named "Picture Round" and a CSV column `Picture Round`) → assert that round's select pre-selects the matching column.
- CSV with no recognizable headers (e.g. `A, B, C, D`) → assert player_name/country/score fall back to columns 0/1/2 (today's behavior, unchanged).

These remain UI-only tests, consistent with existing upload wizard tests — no backend required.

## Out of Scope

- Fuzzy/typo-tolerant matching (e.g. Levenshtein distance) — exact-then-substring is sufficient for now.
- Generic "Round N" / "R1" pattern matching for unnamed rounds — only exact round-name matching is added; can be revisited later if needed.
- Letting the user re-trigger auto-detection after manually editing a mapping.
