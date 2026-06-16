# Position Column in Upload Wizard

**Date:** 2026-06-15
**Status:** Approved

## Background

`final_rank` was recently made a required field on `ResolvedResultRow` (the backend submission model for quiz results). It must be an explicit integer — not recomputed from scores — because quizzes have their own tiebreaking criteria and may use ordinal positions like 1, 2, 2, 4.

The upload wizard currently has no way for users to map a CSV column to position. This spec wires position through the full wizard flow.

## Changes

### `frontend/src/components/Upload/types.ts`

Add `position: number | null` to `ColumnMapping`. `null` means "not mapped — use row order."

```ts
export type ColumnMapping = {
  player_name: number
  country: number
  score: number
  position: number | null   // new
  rounds: (number | null)[]
}
```

Update `INITIAL_STATE` to set `columnMapping.position = null`.

### Step 3 — Column Mapping (`Step3ColumnMapping.tsx`)

Add an optional "Position column (optional)" selector below Score, above the rounds section. Pattern is identical to round column selectors:

- Default value: `__none__` ("Not mapped")
- When a column is selected, store its index in `mapping.position`
- When cleared back to "Not mapped", store `null`

The preview table (first 3 rows) gains a Position column showing the mapped value or "—" if unmapped.

### Step 5 — Preview & Submit (`Step5Preview.tsx`)

When building the `results` array for `submitResults`, compute `final_rank` per row:

```ts
final_rank: columnMapping.position !== null
  ? parseInt(row[columnMapping.position] || "0", 10)
  : i + 1
```

The preview table adds a Position column so the user can verify values before submitting.

## Tests

### Playwright — `frontend/tests/upload.spec.ts`

New describe block: `Upload wizard — column mapping`.

- Verify the "Position column (optional)" label is visible in Step 3 (requires navigating through Steps 0–2 with valid CSV data).
- Verify selecting "Not mapped" is a valid/default state (no validation error on Next).

Step 3 is reached after pasting CSV, so tests need to drive through Steps 0–2 before asserting Step 3 content. These tests remain UI-only (no backend required), consistent with existing upload tests.

### Backend pytest — `backend/tests/api/routes/test_quizzes.py`

New test: `test_submit_results_with_tied_ranks`

- Submit four results with `final_rank` values `[1, 2, 2, 4]` (explicit tie at position 2).
- Read results back via `GET /quizzes/{id}/results`.
- Assert the set of stored `final_rank` values is exactly `{1, 2, 2, 4}`.

This is a direct DB round-trip that proves position values survive ingestion unchanged with no recomputation.

## Out of Scope

- Auto-detecting position column headers ("Rank", "Place", etc.) — can be added later if needed.
- Validating that position values form a sensible sequence — left to the organiser.
