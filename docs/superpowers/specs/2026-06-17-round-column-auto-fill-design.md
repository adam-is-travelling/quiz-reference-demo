# Round Column Auto-Fill Design

**Date:** 2026-06-17
**Branch:** select-format-columns-default

## Summary

When a quiz has a format with rounds, and the user selects the first round's column on the Step 3 mapping page, automatically fill the remaining round columns with the next consecutive CSV column indices.

## Trigger Condition

Auto-fill fires when ALL of the following are true:
- The user is changing round index `0`
- The selected value is not `__none__` (i.e., a real column was chosen)
- All rounds in current state are `null` (first time round 0 is being set)

It does NOT re-fire when the user later changes round 0 again (other rounds are no longer all null).

## Auto-Fill Behavior

For a format with N rounds and round 0 mapped to column index C:
- Round 1 → column C+1
- Round 2 → column C+2
- …
- Round N-1 → column C+(N-1)

If C+j is out of bounds (≥ header column count), that round stays `null`.

All auto-filled values are user-editable — the selects remain fully interactive after auto-fill.

## Files Changed

### `frontend/src/components/Upload/steps/Step3ColumnMapping.tsx`

1. Extend the round `onValueChange` handler with the auto-fill guard.
2. Add `data-testid={`round-column-${i}`}` to each round `SelectTrigger`.

### `frontend/src/components/Upload/steps/Step1EventMeta.tsx`

1. Add `data-testid="format-select"` to the Format `SelectTrigger` (needed for the Playwright test to locate and click it).

### `frontend/src/test-ids.ts`

1. Add `formatSelect: "format-select"` to the `Labels` object.

### `frontend/tests/upload.spec.ts`

New describe block: **"Upload wizard — round column auto-fill"**

- `beforeAll`: create a 3-round format via `request.post("/api/v1/formats/", { name: "...", rounds: ["R1", "R2", "R3"] })`.
- `afterAll`: delete the format via `request.delete(\`/api/v1/formats/${formatId}\`)`.
- Test flow:
  1. Go to `/upload`, select New quiz.
  2. Fill quiz name, select the test format from the Format dropdown.
  3. Advance to Step 2, paste a 6-column CSV (`Name,Country,Score,R1,R2,R3` + 2 data rows).
  4. Advance to Step 3.
  5. Click the Round 1 trigger (`[data-testid="round-column-0"]`), pick `R1`.
  6. Assert Round 2 trigger shows `R2` and Round 3 trigger shows `R3`.

## Out of Scope

- Auto-fill for any round other than round 0.
- Re-triggering auto-fill when round 0 is changed after other rounds have been set.
- Any backend changes.
