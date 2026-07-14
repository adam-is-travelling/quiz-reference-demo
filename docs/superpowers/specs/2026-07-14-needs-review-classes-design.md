# Needs-Review Classification Outlines — Design

**Date:** 2026-07-14
**Status:** Approved

## Goal

In the upload wizard's Match Players step (Step 4, "Needs Review" section),
visually differentiate the three classes of rows that need admin review with
colored outlines instead of the current uniform red border:

- **Green** — a name match was found and pre-selected, but the CSV country
  differs from the player's countries (e.g. "Pat Gibson" for England whose
  primary country is Ireland). Admin just confirms.
- **Yellow** — nothing pre-selected, but exactly one candidate player is
  listed. Admin picks the candidate or creates a new player.
- **Red** — every other needs-review case (multiple candidates, or no
  high-confidence match). Admin must decide.

## Decisions

- **Green = all pre-selected review rows.** The existing pre-selection rule
  (single candidate at ≥90% similarity with a country mismatch,
  `matchPlayers.ts` `getAutoResolution`) defines the class; strictly-100%
  similarity is NOT required.
- **Yellow = exactly one candidate, any similarity**, with no pre-selection.
- **Colors are fixed at initial classification.** They communicate *why* the
  row is in review and do not change as the admin makes selections. The Next
  button already tracks completion.

## Scope

Frontend only. No backend changes; `Resolution` is a frontend wizard type.

## Design

### 1. Classification — `frontend/src/lib/matchPlayers.ts` + `Upload/types.ts`

`Resolution` gains an optional field:

```ts
reviewClass?: "country-mismatch" | "single-candidate" | "ambiguous"
```

`getAutoResolution` sets it only on `autoResolved: false` resolutions:

| Branch | reviewClass |
|---|---|
| Single ≥90% match, country mismatch (pre-selected) | `"country-mismatch"` |
| No pre-selection, exactly 1 candidate | `"single-candidate"` |
| Any other needs-review case | `"ambiguous"` |
| Auto-resolved rows (matched or auto-create) | unset |

### 2. Rendering — `frontend/src/components/Upload/steps/Step4Disambiguation.tsx`

- `RowDisambiguator`'s `variant="review"` border switches on
  `resolution.reviewClass`:
  - `"country-mismatch"` → `border-green-600 dark:border-green-500`
  - `"single-candidate"` → `border-yellow-500 dark:border-yellow-400`
  - `"ambiguous"` → `border-destructive` (also the fallback when
    `reviewClass` is missing, e.g. wizard state saved before this feature)
- `handleChange` preserves `reviewClass` on user edits the same way it
  preserves `autoResolved`, keeping colors fixed while the admin works.
- Color must not be the only signal (color-blind users, screen readers):
  - A one-line legend renders under the "Needs Review" heading:
    "● Match found, different country — confirm · ● One possible match ·
    ● Needs a decision" with dots colored to match the outlines.
  - Each review row's container gets a `title` and `aria-label` describing
    its class (e.g. "Match found, different country — confirm").

### 3. Testing

Unit tests in `frontend/tests/match-players.test.ts`:

- Single high-similarity candidate with country mismatch →
  `reviewClass: "country-mismatch"` (and pre-selected `player_id`).
- One low-similarity candidate → `reviewClass: "single-candidate"`, nothing
  selected.
- Multiple candidates, none high-confidence → `reviewClass: "ambiguous"`.
- Two high-confidence candidates → `reviewClass: "ambiguous"`.
- Auto-resolved rows (exact single match, or zero candidates → auto-create)
  have `reviewClass` undefined.

No new E2E tests: the classification logic is pure and unit-tested; the
upload E2E suite already exercises the step's flow.
