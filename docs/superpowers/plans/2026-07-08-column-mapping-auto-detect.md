# Column Mapping Auto-Detect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-detect the CSV columns for player name, country, score, position, and round columns in the upload wizard's Step 3, based on header name matching, instead of relying purely on hardcoded defaults or fully manual selection.

**Architecture:** Extract the existing `detectPositionColumn` logic out of `Step3ColumnMapping.tsx` into a new pure-function module `frontend/src/lib/columnDetection.ts` (mirroring how `normalizePlayerName` already lives in `src/lib/`), generalize it to take a candidate list and a set of already-claimed column indices, and add a second exact-match-only variant for round-name detection. Wire both into `Step3ColumnMapping.tsx`'s existing `useState` initializer, which already runs detection once per mount.

**Tech Stack:** React, TypeScript, `bun:test` for pure-function unit tests, Playwright for E2E wizard tests.

## Global Constraints

- Follow the existing code style: named exports, `@/` path alias for absolute imports within `frontend/src`.
- Pure logic (no React/DOM dependency) belongs in `frontend/src/lib/`, unit-tested with `bun:test` in `frontend/tests/*.test.ts` (see `frontend/tests/normalize-player-name.test.ts` for the established pattern).
- UI wiring is verified with Playwright in `frontend/tests/upload.spec.ts` (`*.spec.ts`), following the existing `navigateToStep3` / `FormatsService.createFormat` patterns already in that file.
- Detection must run once per mount of `Step3ColumnMapping` (inside the `useState` initializer), not on every render — this is the existing pattern for position and must be preserved for all fields.

---

### Task 1: Pure column-detection module

**Files:**
- Create: `frontend/src/lib/columnDetection.ts`
- Create: `frontend/tests/column-detection.test.ts`

**Interfaces:**
- Produces:
  - `PLAYER_NAME_HEADER_NAMES: string[]`
  - `COUNTRY_HEADER_NAMES: string[]`
  - `SCORE_HEADER_NAMES: string[]`
  - `POSITION_HEADER_NAMES: string[]`
  - `detectColumn(header: string[], candidates: string[], claimed: Set<number>): number | null` — exact match first, then substring fallback, skipping indices in `claimed`.
  - `detectExactColumn(header: string[], candidate: string, claimed: Set<number>): number | null` — exact match only (no substring), skipping indices in `claimed`.

- [ ] **Step 1: Write the failing unit tests**

Create `frontend/tests/column-detection.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import {
  COUNTRY_HEADER_NAMES,
  PLAYER_NAME_HEADER_NAMES,
  POSITION_HEADER_NAMES,
  SCORE_HEADER_NAMES,
  detectColumn,
  detectExactColumn,
} from "../src/lib/columnDetection"

describe("detectColumn — exact match", () => {
  test("matches player name candidates", () => {
    const header = ["Player Name", "Country", "Score"]
    expect(detectColumn(header, PLAYER_NAME_HEADER_NAMES, new Set())).toBe(0)
  })

  test("matches country candidate", () => {
    const header = ["Name", "Country", "Score"]
    expect(detectColumn(header, COUNTRY_HEADER_NAMES, new Set())).toBe(1)
  })

  test("matches score candidates", () => {
    const header = ["Name", "Country", "Overall"]
    expect(detectColumn(header, SCORE_HEADER_NAMES, new Set())).toBe(2)
  })

  test("matches position candidates including psn", () => {
    const header = ["Psn", "Name", "Country", "Score"]
    expect(detectColumn(header, POSITION_HEADER_NAMES, new Set())).toBe(0)
  })

  test("is case-insensitive and trims whitespace", () => {
    const header = ["  NAME  ", "Country", "Score"]
    expect(detectColumn(header, PLAYER_NAME_HEADER_NAMES, new Set())).toBe(0)
  })
})

describe("detectColumn — substring fallback", () => {
  test("matches when a candidate is a substring of the header", () => {
    const header = ["Player", "Country", "Total Score"]
    expect(detectColumn(header, SCORE_HEADER_NAMES, new Set())).toBe(2)
  })

  test("prefers an exact match over a substring match", () => {
    const header = ["Total Score", "Score"]
    expect(detectColumn(header, SCORE_HEADER_NAMES, new Set())).toBe(1)
  })
})

describe("detectColumn — claimed columns", () => {
  test("skips a column already claimed by another field", () => {
    const header = ["Score", "Country"]
    expect(detectColumn(header, SCORE_HEADER_NAMES, new Set([0]))).toBeNull()
  })
})

describe("detectColumn — no match", () => {
  test("returns null when no header matches", () => {
    const header = ["A", "B", "C"]
    expect(
      detectColumn(header, PLAYER_NAME_HEADER_NAMES, new Set()),
    ).toBeNull()
  })
})

describe("detectExactColumn — round name matching", () => {
  test("matches an exact round name", () => {
    const header = ["Name", "Country", "Score", "Picture Round"]
    expect(detectExactColumn(header, "Picture Round", new Set())).toBe(3)
  })

  test("is case-insensitive and trims whitespace", () => {
    const header = ["  picture round  "]
    expect(detectExactColumn(header, "Picture Round", new Set())).toBe(0)
  })

  test("does not substring-match", () => {
    const header = ["Picture Round Extra"]
    expect(detectExactColumn(header, "Picture Round", new Set())).toBeNull()
  })

  test("skips claimed columns", () => {
    const header = ["Picture Round"]
    expect(
      detectExactColumn(header, "Picture Round", new Set([0])),
    ).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && bun test tests/column-detection.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/columnDetection'` (module doesn't exist yet).

- [ ] **Step 3: Implement `columnDetection.ts`**

Create `frontend/src/lib/columnDetection.ts`:

```ts
export const PLAYER_NAME_HEADER_NAMES = ["name", "player", "player name"]
export const COUNTRY_HEADER_NAMES = ["country"]
export const SCORE_HEADER_NAMES = ["total", "score", "overall"]
export const POSITION_HEADER_NAMES = [
  "position",
  "pos",
  "rank",
  "place",
  "#",
  "no",
  "no.",
  "psn",
]

function normalizeHeader(header: string[]): string[] {
  return header.map((h) => h.trim().toLowerCase())
}

function findExactMatch(
  normalized: string[],
  candidates: string[],
  claimed: Set<number>,
): number | null {
  const idx = normalized.findIndex(
    (h, i) => !claimed.has(i) && candidates.includes(h),
  )
  return idx === -1 ? null : idx
}

function findSubstringMatch(
  normalized: string[],
  candidates: string[],
  claimed: Set<number>,
): number | null {
  const idx = normalized.findIndex(
    (h, i) => !claimed.has(i) && candidates.some((c) => h.includes(c)),
  )
  return idx === -1 ? null : idx
}

export function detectColumn(
  header: string[],
  candidates: string[],
  claimed: Set<number>,
): number | null {
  const normalized = normalizeHeader(header)
  const lowerCandidates = candidates.map((c) => c.toLowerCase())
  return (
    findExactMatch(normalized, lowerCandidates, claimed) ??
    findSubstringMatch(normalized, lowerCandidates, claimed)
  )
}

export function detectExactColumn(
  header: string[],
  candidate: string,
  claimed: Set<number>,
): number | null {
  const normalized = normalizeHeader(header)
  return findExactMatch(normalized, [candidate.toLowerCase()], claimed)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && bun test tests/column-detection.test.ts`
Expected: PASS — all 12 tests green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/columnDetection.ts frontend/tests/column-detection.test.ts
git commit -m "feat(frontend): add pure column-detection helpers for upload wizard"
```

---

### Task 2: Wire player name / country / score / position auto-detect into Step 3

**Files:**
- Modify: `frontend/src/test-ids.ts`
- Modify: `frontend/src/components/Upload/steps/Step3ColumnMapping.tsx:1-70` (imports, constants, `useState` initializer, required-field `SelectTrigger`s)
- Test: `frontend/tests/upload.spec.ts` (extend `"Upload wizard — column mapping"` describe block)

**Interfaces:**
- Consumes: `detectColumn`, `PLAYER_NAME_HEADER_NAMES`, `COUNTRY_HEADER_NAMES`, `SCORE_HEADER_NAMES`, `POSITION_HEADER_NAMES` from `@/lib/columnDetection` (Task 1).
- Produces: `Labels.columnMappingPlayerName`, `Labels.columnMappingCountry`, `Labels.columnMappingScore` test IDs, used by Task 2's own tests and available to any future test.

- [ ] **Step 1: Write the failing Playwright tests**

In `frontend/tests/upload.spec.ts`, add inside the existing `test.describe("Upload wizard — column mapping", ...)` block (after the existing two tests, before the closing `})`):

```ts
  test("Auto-detects player name, country, score, and position columns from matching headers", async ({
    page,
  }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeNew).click()
    await page.getByLabel("Quiz name *").fill("Test Quiz")
    await page.getByRole("button", { name: "Next →" }).click()
    await page
      .getByLabel("Or paste data directly")
      .fill(
        "Rank,Player Name,Country,Total\n1,Alice,Ireland,50\n2,Bob,England,40",
      )
    await page.getByRole("button", { name: "Next →" }).click()

    await expect(
      page.getByTestId(Labels.columnMappingPlayerName),
    ).toContainText("Player Name")
    await expect(page.getByTestId(Labels.columnMappingCountry)).toContainText(
      "Country",
    )
    await expect(page.getByTestId(Labels.columnMappingScore)).toContainText(
      "Total",
    )
    await expect(page.getByTestId(Labels.columnMappingPosition)).toContainText(
      "Rank",
    )
  })

  test("Falls back to default columns when no header matches", async ({
    page,
  }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeNew).click()
    await page.getByLabel("Quiz name *").fill("Test Quiz")
    await page.getByRole("button", { name: "Next →" }).click()
    await page
      .getByLabel("Or paste data directly")
      .fill("A,B,C,D\nAlice,Ireland,50,1\nBob,England,40,2")
    await page.getByRole("button", { name: "Next →" }).click()

    await expect(
      page.getByTestId(Labels.columnMappingPlayerName),
    ).toContainText("A")
    await expect(page.getByTestId(Labels.columnMappingCountry)).toContainText(
      "B",
    )
    await expect(page.getByTestId(Labels.columnMappingScore)).toContainText(
      "C",
    )
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && bunx playwright test --config playwright.config.cts -g "Auto-detects player name|Falls back to default columns"`
Expected: FAIL — `Labels.columnMappingPlayerName` etc. don't exist yet (TypeScript error) and the selects aren't pre-populated.

- [ ] **Step 3: Add the new test IDs**

In `frontend/src/test-ids.ts`, add three entries next to `columnMappingPosition`:

```ts
export const Labels = {
  adminQuizzesPageHeading: "admin-quizzes-page-heading",
  resultDeleteButton: "result-delete-button",
  uploadModeNew: "upload-mode-new",
  uploadModeExisting: "upload-mode-existing",
  uploadModeToggleNew: "upload-mode-toggle-new",
  uploadModeToggleExisting: "upload-mode-toggle-existing",
  uploadExistingQuizSelect: "upload-existing-quiz-select",
  submitModeToggle: "submit-mode-toggle",
  columnMappingPlayerName: "column-mapping-player-name",
  columnMappingCountry: "column-mapping-country",
  columnMappingScore: "column-mapping-score",
  columnMappingPosition: "column-mapping-position",
  formatSelect: "format-select",
  homeGreeting: "home-greeting",
  homeRecentQuizzes: "home-recent-quizzes",
  homeRecentPlayers: "home-recent-players",
  homeAdminLoginLink: "home-admin-login-link",
} as const
```

- [ ] **Step 4: Rewrite the top of `Step3ColumnMapping.tsx`**

Replace lines 1–61 of `frontend/src/components/Upload/steps/Step3ColumnMapping.tsx` (imports through the end of the `useState` initializer, i.e. everything before the `// Re-initialize rounds array if format changes` comment) with:

```tsx
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  COUNTRY_HEADER_NAMES,
  PLAYER_NAME_HEADER_NAMES,
  POSITION_HEADER_NAMES,
  SCORE_HEADER_NAMES,
  detectColumn,
  detectExactColumn,
} from "@/lib/columnDetection"
import { normalizePlayerName } from "@/lib/normalizePlayerName"
import { Labels } from "@/test-ids"
import type { ColumnMapping, WizardState } from "../types"

interface Props {
  state: WizardState
  update: (patch: Partial<WizardState>) => void
}

type CoreMappingKey = "player_name" | "country" | "score"

const DEFAULT_INDEX: Record<CoreMappingKey, number> = {
  player_name: 0,
  country: 1,
  score: 2,
}

const REQUIRED_FIELDS: Array<{
  key: CoreMappingKey
  label: string
  testId: string
  candidates: string[]
}> = [
  {
    key: "player_name",
    label: "Player name",
    testId: Labels.columnMappingPlayerName,
    candidates: PLAYER_NAME_HEADER_NAMES,
  },
  {
    key: "country",
    label: "Country",
    testId: Labels.columnMappingCountry,
    candidates: COUNTRY_HEADER_NAMES,
  },
  {
    key: "score",
    label: "Score",
    testId: Labels.columnMappingScore,
    candidates: SCORE_HEADER_NAMES,
  },
]

export function Step3ColumnMapping({ state, update }: Props) {
  const numRounds = state.selectedFormat?.rounds?.length ?? 0

  const [mapping, setMapping] = useState<ColumnMapping>(() => {
    const existing = state.columnMapping
    const rounds =
      existing.rounds.length === numRounds
        ? [...existing.rounds]
        : Array<number | null>(numRounds).fill(null)
    const header = state.parsedRows[0] ?? []
    const claimed = new Set<number>()

    const core = { ...existing }
    for (const field of REQUIRED_FIELDS) {
      // Only auto-detect while the field still holds its compiled-in
      // default. Once it's been changed (by the user or a prior
      // detection pass), leave it alone so remounting the step doesn't
      // silently override a manual choice.
      if (existing[field.key] !== DEFAULT_INDEX[field.key]) {
        claimed.add(existing[field.key])
        continue
      }
      const detected = detectColumn(header, field.candidates, claimed)
      if (detected !== null) {
        claimed.add(detected)
        core[field.key] = detected
      }
    }

    const position =
      existing.position !== null
        ? existing.position
        : detectColumn(header, POSITION_HEADER_NAMES, claimed)
    if (position !== null) claimed.add(position)

    const formatRounds = state.selectedFormat?.rounds ?? []
    for (let i = 0; i < rounds.length; i++) {
      if (rounds[i] !== null) {
        claimed.add(rounds[i] as number)
        continue
      }
      const roundName = formatRounds[i]
      if (!roundName) continue
      const detected = detectExactColumn(header, roundName, claimed)
      if (detected !== null) {
        claimed.add(detected)
        rounds[i] = detected
      }
    }

    return { ...core, position, rounds }
  })
```

Everything from `// Re-initialize rounds array if format changes` (original line 63) onward is unchanged.

- [ ] **Step 5: Add `data-testid` to the required-field selects**

In the same file, find the `REQUIRED_FIELDS.map` block in the JSX (originally lines 88–109) and update the destructuring and `SelectTrigger`:

```tsx
        {REQUIRED_FIELDS.map(({ key, label, testId }) => (
          <div key={key} className="grid gap-1.5">
            <Label>{label} column *</Label>
            <Select
              value={String(mapping[key])}
              onValueChange={(v) =>
                setMapping((m) => ({ ...m, [key]: Number(v) }))
              }
            >
              <SelectTrigger data-testid={testId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {header.map((col, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {col || `Column ${i + 1}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
```

- [ ] **Step 6: Run the unit tests and Playwright tests to verify they pass**

Run: `cd frontend && bun test tests/column-detection.test.ts && bunx playwright test --config playwright.config.cts -g "column mapping"`
Expected: PASS — all column-mapping tests green, including the two new ones and the pre-existing two.

- [ ] **Step 7: Run full frontend test suite and lint to check for regressions**

Run: `cd frontend && bun run lint && bunx playwright test --config playwright.config.cts`
Expected: PASS — no lint errors, all Playwright tests green.

Note on `"Upload wizard — round column auto-fill"`: that test's format has rounds named `["R1", "R2", "R3"]` and its CSV headers are literally `Name,Country,Score,R1,R2,R3`. After this change, `R1`/`R2`/`R3` will already be auto-detected by name on mount, before the test clicks anything — so round 0's select will show "R1" pre-selected rather than "Not mapped" when the test starts interacting with it. The test still passes (it re-selects "R1" and asserts rounds 1–2 show "R2"/"R3", which hold true whether set by auto-detect or by the manual cascade), but if it fails, check for a genuine regression rather than assuming a flake — that CSV happens to exercise both mechanisms at once.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/test-ids.ts frontend/src/components/Upload/steps/Step3ColumnMapping.tsx frontend/tests/upload.spec.ts
git commit -m "feat(frontend): auto-detect player name/country/score/position columns by header name"
```

---

### Task 3: Round column name auto-detect

**Files:**
- Modify: `frontend/tests/upload.spec.ts` (new describe block)

**Interfaces:**
- Consumes: `detectExactColumn` wiring already added to `Step3ColumnMapping.tsx`'s initializer in Task 2, Step 4 (the `formatRounds` / `rounds[i]` loop). No further production code changes are needed for this task — it verifies behavior already implemented in Task 2.

- [ ] **Step 1: Write the failing Playwright test**

In `frontend/tests/upload.spec.ts`, add a new describe block after `"Upload wizard — round column auto-fill"`:

```ts
test.describe("Upload wizard — round column name auto-detect", () => {
  let formatId: string | undefined
  let formatName: string | undefined

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()

    formatName = `Round Name Detect Format ${Date.now()}`
    const format = await FormatsService.createFormat({
      requestBody: { name: formatName, rounds: ["Picture Round", "R2", "R3"] },
    })
    formatId = format.id
  })

  test.afterAll(async () => {
    if (formatId) {
      await FormatsService.deleteFormat({ id: formatId })
    }
  })

  test("auto-selects a round column whose header exactly matches the round name", async ({
    page,
  }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeNew).click()
    await page.getByLabel("Quiz name *").fill("Round Detect Quiz")

    await page.getByTestId(Labels.formatSelect).click()
    await page.getByRole("option", { name: formatName }).click()

    await page.getByRole("button", { name: "Next →" }).click()

    await page
      .getByLabel("Or paste data directly")
      .fill(
        "Name,Country,Score,Picture Round\nAlice,Ireland,50,10\nBob,England,40,15",
      )
    await page.getByRole("button", { name: "Next →" }).click()

    await expect(page.getByTestId("round-column-0")).toContainText(
      "Picture Round",
    )
    await expect(page.getByTestId("round-column-1")).toContainText(
      "Not mapped",
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails or passes**

Run: `cd frontend && bunx playwright test --config playwright.config.cts -g "round column name auto-detect"`
Expected: Since Task 2 already implemented the round-detection loop in the initializer, this should PASS immediately, confirming the behavior end-to-end. If it fails, re-check Task 2 Step 4's round loop before proceeding — do not add new production code in this task beyond fixing a bug in the existing wiring.

- [ ] **Step 3: Commit**

```bash
git add frontend/tests/upload.spec.ts
git commit -m "test(frontend): verify round column auto-detect by exact name match"
```
