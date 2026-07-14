# Needs-Review Classification Outlines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Color-code the upload wizard's "Needs Review" player-match rows by why they need review: green (pre-selected sole match, different country), yellow (one clear option), red (ambiguous).

**Architecture:** A `reviewClass` field is stamped on `Resolution` objects by the pure classification function `getAutoResolution` at auto-match time, unit-tested in isolation. The Step 4 component maps that class to a border color, adds a legend, and preserves the class on user edits so colors stay fixed while the admin works.

**Tech Stack:** React/TypeScript, Tailwind v4, bun:test for unit tests, Biome.

**Spec:** `docs/superpowers/specs/2026-07-14-needs-review-classes-design.md`

## Global Constraints

- Frontend only. No backend changes.
- Classification rules (exact): `"country-mismatch"` (green) = single ≥90%-similarity match with CSV-country mismatch AND it is the only candidate; `"single-candidate"` (yellow) = that same pre-selected mismatch when other candidates are also listed, OR no pre-selection with exactly one candidate (any similarity); `"ambiguous"` (red) = every other needs-review case. Auto-resolved rows get NO `reviewClass`.
- Colors are **fixed at initial classification** — they must not change as the admin selects options.
- Border colors (exact): green `border-green-600 dark:border-green-500`; yellow `border-yellow-500 dark:border-yellow-400`; red `border-destructive`. Missing `reviewClass` on a review row falls back to red.
- Color must not be the only signal: legend under the "Needs Review" heading + `title`/`aria-label` on each review row.
- All commands run from `frontend/`. Unit tests: `bun run test:unit`. Type-check/build: `bun run build`. Lint: `bun run lint`.
- Playwright note: if running E2E, the Docker `frontend` container shadows port 5173 with a stale build — `docker compose stop frontend` first, `docker compose up -d frontend` after. NEVER `docker compose down -v` or anything touching volumes.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Classification — `reviewClass` on `Resolution`

**Files:**
- Modify: `frontend/src/components/Upload/types.ts:48-52` (the `Resolution` type)
- Modify: `frontend/src/lib/matchPlayers.ts:13-54` (`getAutoResolution`)
- Test: `frontend/tests/match-players.test.ts`

**Interfaces:**
- Consumes: existing `getAutoResolution(parsedRow: ParsedRow, candidates: PlayerSearchResult[]): Resolution` and the `candidate(id, similarity)` helper already defined in the test file (its player has `countries: ["IE"]`).
- Produces: `Resolution.reviewClass?: "country-mismatch" | "single-candidate" | "ambiguous"` — Task 2 reads exactly these three string values.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/tests/match-players.test.ts`. Two changes: extend the import to include `getAutoResolution`, and append a new describe block.

Change the import line:

```ts
import {
  buildResolutions,
  chunkUniqueNames,
  getAutoResolution,
} from "../src/lib/matchPlayers"
```

Append at the end of the file (the `candidate()` helper's player has `countries: ["IE"]`, so row country `"DE"` is a mismatch and `"IE"` is not):

```ts
describe("getAutoResolution review classes", () => {
  const mismatchRow = { player_name: "Jane Doe", country: "DE", score: 10 }

  test("sole high-similarity candidate with country mismatch → country-mismatch, pre-selected", () => {
    const r = getAutoResolution(mismatchRow, [candidate("p1", 0.95)])
    expect(r.player_id).toBe("p1")
    expect(r.autoResolved).toBe(false)
    expect(r.reviewClass).toBe("country-mismatch")
  })

  test("high-similarity mismatch among other candidates → single-candidate, still pre-selected", () => {
    const r = getAutoResolution(mismatchRow, [
      candidate("p1", 0.95),
      candidate("p2", 0.5),
    ])
    expect(r.player_id).toBe("p1")
    expect(r.autoResolved).toBe(false)
    expect(r.reviewClass).toBe("single-candidate")
  })

  test("one low-similarity candidate → single-candidate, nothing selected", () => {
    const r = getAutoResolution(mismatchRow, [candidate("p1", 0.6)])
    expect(r.player_id).toBeNull()
    expect(r.autoResolved).toBe(false)
    expect(r.reviewClass).toBe("single-candidate")
  })

  test("multiple low-similarity candidates → ambiguous", () => {
    const r = getAutoResolution(mismatchRow, [
      candidate("p1", 0.6),
      candidate("p2", 0.5),
    ])
    expect(r.player_id).toBeNull()
    expect(r.reviewClass).toBe("ambiguous")
  })

  test("two high-confidence candidates → ambiguous", () => {
    const r = getAutoResolution(mismatchRow, [
      candidate("p1", 0.95),
      candidate("p2", 0.92),
    ])
    expect(r.player_id).toBeNull()
    expect(r.reviewClass).toBe("ambiguous")
  })

  test("auto-resolved match (country agrees) has no reviewClass", () => {
    const agreeRow = { player_name: "Jane Doe", country: "IE", score: 10 }
    const r = getAutoResolution(agreeRow, [candidate("p1", 0.95)])
    expect(r.autoResolved).toBe(true)
    expect(r.reviewClass).toBeUndefined()
  })

  test("auto-create (no candidates) has no reviewClass", () => {
    const r = getAutoResolution(mismatchRow, [])
    expect(r.autoResolved).toBe(true)
    expect(r.reviewClass).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `bun run test:unit`
Expected: the five class-asserting tests FAIL (`reviewClass` is `undefined`); the two "no reviewClass" tests may already pass; all pre-existing tests still pass.

- [ ] **Step 3: Implement**

In `frontend/src/components/Upload/types.ts`, replace the `Resolution` type:

```ts
export type ReviewClass = "country-mismatch" | "single-candidate" | "ambiguous"

export type Resolution = {
  player_id: string | null
  player_create: PlayerCreate | null
  autoResolved?: boolean
  reviewClass?: ReviewClass
}
```

In `frontend/src/lib/matchPlayers.ts`, update the two needs-review returns in `getAutoResolution` (the zero-candidates and clean-single-match branches stay untouched):

```ts
    if (countryMismatch) {
      // Pre-select the name match so admin can confirm, but flag for review
      return {
        player_id: candidate.player.id,
        player_create: null,
        autoResolved: false,
        reviewClass:
          candidates.length === 1 ? "country-mismatch" : "single-candidate",
      }
    }
```

and the final fall-through:

```ts
  return {
    player_id: null,
    player_create: null,
    autoResolved: false,
    reviewClass: candidates.length === 1 ? "single-candidate" : "ambiguous",
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test:unit`
Expected: all pass (previous count + 7 new), no failures.

- [ ] **Step 5: Type-check, lint, commit**

Run: `bun run build && bun run lint` — both clean. Then:

```bash
git add src/components/Upload/types.ts src/lib/matchPlayers.ts tests/match-players.test.ts
git commit -m "feat(frontend): classify needs-review player matches by review class

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Rendering — colored outlines, legend, fixed classes

**Files:**
- Modify: `frontend/src/components/Upload/steps/Step4Disambiguation.tsx`

**Interfaces:**
- Consumes: `Resolution.reviewClass?: "country-mismatch" | "single-candidate" | "ambiguous"` from Task 1.
- Produces: user-visible outlines only; no new exports.

- [ ] **Step 1: Add the style map and apply it in `RowDisambiguator`**

At module level in `Step4Disambiguation.tsx` (below the `BATCH_SIZE` constant), add:

```tsx
const REVIEW_STYLES: Record<
  "country-mismatch" | "single-candidate" | "ambiguous",
  { border: string; dot: string; label: string }
> = {
  "country-mismatch": {
    border: "border-green-600 dark:border-green-500",
    dot: "bg-green-600 dark:bg-green-500",
    label: "Match found, different country — confirm",
  },
  "single-candidate": {
    border: "border-yellow-500 dark:border-yellow-400",
    dot: "bg-yellow-500 dark:bg-yellow-400",
    label: "One possible match",
  },
  ambiguous: {
    border: "border-destructive",
    dot: "bg-destructive",
    label: "Needs a decision",
  },
}
```

In `RowDisambiguator`, replace the outer `<div>`'s opening tag (currently the ternary on `variant === "review" ? "border-destructive" : ""`):

```tsx
  const review =
    variant === "review"
      ? REVIEW_STYLES[resolution.reviewClass ?? "ambiguous"]
      : null

  return (
    <div
      className={`border rounded-lg p-4 flex flex-col gap-3 ${
        review ? review.border : ""
      }`}
      title={review?.label}
      aria-label={review ? `${parsedRow.player_name}: ${review.label}` : undefined}
    >
```

(The `?? "ambiguous"` fallback keeps rows red when `reviewClass` is absent — e.g. wizard state saved before this feature.)

- [ ] **Step 2: Render the legend under the "Needs Review" heading**

In `Step4Disambiguation`'s JSX, inside the `needsReviewIndices.length > 0` block, insert the legend between the `<p>Needs Review (…)</p>` line and `<VirtualRowList …>`:

```tsx
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {Object.entries(REVIEW_STYLES).map(([key, s]) => (
              <span key={key} className="inline-flex items-center gap-1.5">
                <span
                  className={`h-2 w-2 rounded-full ${s.dot}`}
                  aria-hidden="true"
                />
                {s.label}
              </span>
            ))}
          </div>
```

- [ ] **Step 3: Preserve `reviewClass` on user edits**

In `handleChange`, extend the merged object so a user selection never drops the class (same pattern as `autoResolved`):

```tsx
  const handleChange = (i: number, r: Resolution) =>
    setResolutions((prev) => {
      const next = [...prev]
      // Use the incoming autoResolved if provided (auto-selection); otherwise preserve
      // the existing bucket so admin overrides stay in their original section
      next[i] = {
        ...r,
        autoResolved:
          r.autoResolved !== undefined ? r.autoResolved : prev[i]?.autoResolved,
        reviewClass: r.reviewClass ?? prev[i]?.reviewClass,
      }
      return next
    })
```

- [ ] **Step 4: Verify**

Run (from `frontend/`): `bun run test:unit && bun run build && bun run lint`
Expected: all clean.

Then the upload-flow E2E regression check (the wizard step this touches):

```bash
docker compose stop frontend
bunx playwright test tests/upload.spec.ts --config playwright.config.cts
docker compose up -d frontend
```

(`tests/upload-auto-resolution.test.ts` is a bun unit test, already covered by `bun run test:unit`.)
Expected: all upload E2E tests pass (1 known `test.skip` in upload.spec.ts is normal). NEVER use `docker compose down` or touch volumes.

- [ ] **Step 5: Commit**

```bash
git add src/components/Upload/steps/Step4Disambiguation.tsx
git commit -m "feat(frontend): color-code needs-review rows by review class with legend

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
