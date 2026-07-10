# Validate Upload Results Before Submission

**Date:** 2026-07-10
**Status:** Approved

## Background

Malformed CSVs (e.g. a player name like `Smith, Jr., John`) currently produce a partially-uploaded state: the quiz gets created, some `Player` rows get created, but no `QuizResult` rows exist. Three compounding bugs cause this:

1. **`Step2CsvInput.tsx`'s `parseCsv`** (lines 12-18) splits every line on `/,|\t/` with no quoted-field support. A comma inside a quoted name shifts every subsequent cell in that row by one column, so the score column ends up containing text (a country, a tiebreaker value, etc.) instead of a number.
2. **`Step5Preview.tsx`** parses scores with `parseFloat(row[...] || "0")` (lines 34-38, 44-46) and never checks for `NaN`. A shifted or genuinely malformed score cell becomes JS `NaN`, which `JSON.stringify` silently serializes as `null` in the request body.
3. **`submit_results`** (`backend/app/api/routes/quizzes.py:285-320`) loops over rows and, for rows needing a new player, calls `crud.create_player`, which **commits immediately** (`backend/app/crud.py:171,178`). Validation of `row.score is None` happens per-row in the same loop, *after* earlier rows' players have already been committed. So a bad row N leaves rows 1..N-1's players committed with no matching results.

This spec fixes all three: parse CSVs correctly, catch bad data client-side before submission, and make the backend atomic as a safety net regardless of client behavior.

## Changes

### 1. `frontend/src/components/Upload/steps/Step2CsvInput.tsx` — quote-aware parsing

Replace `parseCsv` with a single-pass, quote-aware parser that processes the raw text as one stream (not pre-split by `\n`), so quoted fields may contain the delimiter or embedded newlines:

```ts
function detectDelimiter(raw: string): string {
  const firstLine = raw.split("\n")[0] ?? ""
  const tabCount = (firstLine.match(/\t/g) ?? []).length
  const commaCount = (firstLine.match(/,/g) ?? []).length
  return tabCount > commaCount ? "\t" : ","
}

function parseDelimited(raw: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let inQuotes = false

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i]
    if (inQuotes) {
      if (char === '"' && raw[i + 1] === '"') { cell += '"'; i++; continue }
      if (char === '"') { inQuotes = false; continue }
      cell += char
      continue
    }
    if (char === '"') { inQuotes = true; continue }
    if (char === delimiter) { row.push(cell.trim()); cell = ""; continue }
    if (char === "\r") continue
    if (char === "\n") { row.push(cell.trim()); rows.push(row); row = []; cell = ""; continue }
    cell += char
  }
  row.push(cell.trim())
  rows.push(row)

  return rows.filter((r) => r.some((c) => c.length > 0))
}

function parseCsv(raw: string): string[][] {
  return parseDelimited(raw.trim(), detectDelimiter(raw.trim()))
}
```

Delimiter is now detected once per file from the header line (tab wins if it's more frequent than comma, matching the existing `.tsv` support), rather than treating every comma or tab as interchangeable on every line. Quoted fields follow standard CSV convention: wrapped in `"`, with `""` as an escaped literal quote.

### 2. `frontend/src/components/Upload/steps/Step5Preview.tsx` — pre-submit validation gate

Add a `useMemo`-derived list of row-level errors, computed independently of the existing "default to 0" display logic so blank vs. garbage cells are distinguished correctly:

```ts
interface RowError {
  row: number // 1-indexed among data rows
  message: string
}

const validationErrors = useMemo<RowError[]>(() => {
  const errors: RowError[] = []
  state.resolutions.forEach((r, i) => {
    const row = state.parsedRows[i + 1]
    if (!row) return

    const name = r.player_create?.display_name ?? row[state.columnMapping.player_name]
    if (!name?.trim()) {
      errors.push({ row: i + 1, message: "Player name is missing" })
    }

    const rawScore = row[state.columnMapping.score]
    if (!rawScore?.trim()) {
      errors.push({ row: i + 1, message: "Score is missing" })
    } else if (Number.isNaN(parseFloat(rawScore))) {
      errors.push({ row: i + 1, message: `Score "${rawScore}" is not a number` })
    }

    state.columnMapping.rounds.forEach((colIdx, roundIdx) => {
      if (colIdx === null) return
      const raw = row[colIdx]
      if (raw?.trim() && Number.isNaN(parseFloat(raw))) {
        errors.push({
          row: i + 1,
          message: `Round ${roundIdx + 1} score "${raw}" is not a number`,
        })
      }
    })
  })
  return errors
}, [state.resolutions, state.parsedRows, state.columnMapping])
```

UI: when `validationErrors.length > 0`, render a red-bordered list above the submit button (`"Row 8: Score "DNF" is not a number"`, one per error) and disable the submit button:

```tsx
<Button
  onClick={() => submitMutation.mutate()}
  disabled={submitMutation.isPending || validationErrors.length > 0}
>
```

A blank overall-score cell is now a validation error rather than silently defaulting to `0` — the existing `|| "0"` fallback in `parseRows` and the mutation body was masking missing data, which is exactly the class of bug being fixed here. Blank **round** score cells remain allowed (a round simply wasn't played/recorded for that player) — only a non-blank, non-numeric round cell is an error. The `final_rank`/position fallback (already `isNaN`-guarded, defaults to sequential rank) is unrelated and unchanged.

Users fix errors by clicking "← Back" to Step 2 (edit the raw CSV) or Step 3 (remap columns), then returning to Step 5, where `validationErrors` recomputes automatically.

### 3. `backend/app/api/routes/quizzes.py` — validate-then-write in `submit_results`

Split the single loop (lines 285-320) into two passes. Pass 1 validates every row and collects **all** failures with no DB writes; if any exist, raise one `422` before touching the database:

```python
errors: list[str] = []
for i, row in enumerate(request.results):
    if row.round_scores is not None:
        if fmt is None:
            errors.append(f"Row {i + 1}: quiz has no format; round_scores are not accepted")
        elif len(row.round_scores) > num_rounds:
            errors.append(f"Row {i + 1}: round_scores length exceeds format round count")
    if row.score is None:
        errors.append(f"Row {i + 1}: score is required")
    if not row.player_id and not row.player_create:
        errors.append(f"Row {i + 1}: player_id or player_create is required")

if errors:
    raise HTTPException(status_code=422, detail={"errors": errors})
```

Pass 2 (unchanged logic, just no longer needs to raise) creates players and builds `creates` exactly as today, then calls `crud.create_quiz_results`. A single `session.commit()` happens at the very end of `submit_results`, after both passes succeed.

### 4. `backend/app/crud.py` — `create_player` and `create_quiz_results` stop committing

- `create_player` (lines 166-179): replace both `session.commit()` calls with `session.flush()`. `session.refresh(player)` still works post-flush (re-selects within the same open transaction).
- `create_quiz_results` (lines 397-429): replace its `session.commit()` with `session.flush()`.

Commit ownership moves entirely to the calling route. `SessionDep` (`backend/app/api/deps.py:21-26`) wraps every request in `with Session(engine)`, which rolls back anything not explicitly committed on teardown — so if `submit_results` raises at any point before its final commit, everything flushed so far (any players created in pass 2) is discarded automatically. This is strictly safer than today's behavior, not just equivalent.

**`create_player` has one other caller** — `create_player_route` in `backend/app/api/routes/players.py:129-136` — which currently relies on `create_player`'s internal commit and never commits itself. Since `create_player` no longer commits, add `session.commit()` to `create_player_route` after the call:

```python
@router.post("/", response_model=PlayerPublic)
def create_player_route(
    player_in: PlayerCreate,
    session: SessionDep,
    _current_user: CurrentOrganizer,
) -> PlayerPublic:
    player = create_player(session=session, player_in=player_in)
    session.commit()
    return build_player_public(session=session, player=player)
```

`create_quiz_results` has only the one call site in `submit_results`, so no other caller is affected.

## Tests

### Backend — `backend/app/tests/`

- `submit_results` with a batch where a later row has `score: None` (or missing `player_id`/`player_create`) → assert `422`, and assert **no** `Player` rows were created for any row in the batch (query players by the names used in the request, expect zero matches). This is the regression test for the orphan-player bug.
- `submit_results` with a batch where a middle row has `round_scores` exceeding the format's round count → same assertion (fully atomic, nothing persisted).
- `create_player_route` (`POST /players/`) still persists a player after the crud change (existing test should already cover this — verify it still passes with `flush`-based `create_player`).

### Frontend — `frontend/tests/upload.spec.ts` (Playwright) and a unit test for `parseCsv`

- Unit test: `parseCsv('Name,Score\n"Smith, Jr., John",42\n')` → asserts the name cell parses as a single field `Smith, Jr., John` and the score cell is `42`, not shifted.
- Unit test: `parseCsv` with a `.tsv`-style input (tab-delimited, no quotes) still parses correctly (delimiter detection).
- Playwright: paste a CSV with a quoted comma-containing name and a valid score → assert Step 5 shows no validation errors and the submit button is enabled.
- Playwright: paste a CSV with a non-numeric score cell (e.g. `DNF`) → assert Step 5 shows a "Score ... is not a number" error for that row and the submit button is disabled.

## Out of Scope

- Auto-fixing malformed rows (e.g. suggesting a corrected numeric value) — the gate only blocks and reports; the admin edits the CSV manually.
- CSV encoding edge cases beyond quotes: BOM stripping, semicolon delimiters, alternate quote characters.
- Retrying or resuming a failed upload automatically — with the backend fix, a failed submission now simply persists nothing, so re-submitting from Step 5 after fixing the CSV behaves like a fresh attempt.
- Broader audit of other `crud.py` functions for the same eager-commit pattern — only `create_player` and `create_quiz_results` are touched, since those are the ones reachable from `submit_results`.
