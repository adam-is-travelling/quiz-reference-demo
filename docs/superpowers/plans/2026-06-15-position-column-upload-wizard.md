# Position Column in Upload Wizard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `final_rank` through the upload wizard so users can map a CSV column to position, with a fallback to row order when not mapped.

**Architecture:** Add `position: number | null` to the `ColumnMapping` type. Step 3 gains an optional selector using the existing `__none__`/column-index pattern from round columns. Step 5 reads the mapped column value (or `i + 1`) and includes `final_rank` in every submitted result.

**Tech Stack:** React, TypeScript, shadcn/ui Select, TanStack Query, Playwright (E2E), pytest (backend integration)

---

## File Map

| File | Change |
|------|--------|
| `frontend/src/test-ids.ts` | Add `columnMappingPosition` label |
| `frontend/src/components/Upload/types.ts` | Add `position: number \| null` to `ColumnMapping`; set `null` in `INITIAL_STATE` |
| `frontend/src/components/Upload/steps/Step3ColumnMapping.tsx` | Add optional Position selector with test-id |
| `frontend/src/components/Upload/steps/Step5Preview.tsx` | Derive `final_rank` per row; add Position column to preview table |
| `frontend/tests/upload.spec.ts` | Playwright tests for Step 3 Position selector |
| `backend/tests/api/routes/test_quizzes.py` | Tie-scenario test verifying DB round-trip |

---

### Task 1: Backend — tie-scenario test

The backend already stores `final_rank` as provided. This task adds an explicit test proving tied ranks (1, 2, 2, 4) survive the API → DB → API round-trip unchanged.

**Files:**
- Modify: `backend/tests/api/routes/test_quizzes.py`

- [ ] **Step 1: Add the test**

Open `backend/tests/api/routes/test_quizzes.py`. Add this test after `test_delete_result_preserves_remaining_ranks`:

```python
def test_submit_results_with_tied_ranks(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    quiz = create_random_event(db)
    players = [create_random_player(db) for _ in range(4)]

    client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=superuser_token_headers,
        json={
            "mode": "replace",
            "results": [
                {"player_id": str(players[0].id), "final_rank": 1, "score": 50.0},
                {"player_id": str(players[1].id), "final_rank": 2, "score": 40.0},
                {"player_id": str(players[2].id), "final_rank": 2, "score": 38.0},
                {"player_id": str(players[3].id), "final_rank": 4, "score": 30.0},
            ],
        },
    )

    response = client.get(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    stored_ranks = sorted(r["final_rank"] for r in response.json()["data"])
    assert stored_ranks == [1, 2, 2, 4]
```

- [ ] **Step 2: Run the test**

```bash
cd backend
uv run python -m pytest tests/api/routes/test_quizzes.py::test_submit_results_with_tied_ranks -v
```

Expected: `PASSED` — the backend already supports this; the test confirms it.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/api/routes/test_quizzes.py
git commit -m "test: verify tied final_rank values survive DB round-trip"
```

---

### Task 2: Add `position` to `ColumnMapping` type

**Files:**
- Modify: `frontend/src/components/Upload/types.ts`

- [ ] **Step 1: Update `ColumnMapping` and `INITIAL_STATE`**

In `frontend/src/components/Upload/types.ts`, replace the `ColumnMapping` type and `INITIAL_STATE.columnMapping`:

```ts
export type ColumnMapping = {
  player_name: number
  country: number
  score: number
  position: number | null
  rounds: (number | null)[]
}
```

Update `INITIAL_STATE`:

```ts
export const INITIAL_STATE: WizardState = {
  step: 0,
  eventMode: "new",
  existingEventId: null,
  existingEventName: null,
  submitMode: "append",
  eventMeta: emptyEventMeta(),
  rawCsv: "",
  parsedRows: [],
  columnMapping: { player_name: 0, country: 1, score: 2, position: null, rounds: [] },
  parsedResults: [],
  resolutions: [],
  eventId: null,
  selectedFormat: null,
}
```

- [ ] **Step 2: Add test-id for the Position selector trigger**

In `frontend/src/test-ids.ts`, add `columnMappingPosition`:

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
  columnMappingPosition: "column-mapping-position",
  homeGreeting: "home-greeting",
  homeRecentQuizzes: "home-recent-quizzes",
  homeRecentPlayers: "home-recent-players",
  homeAdminLoginLink: "home-admin-login-link",
} as const
```

- [ ] **Step 3: Type-check**

```bash
cd frontend
bun run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no new type errors. (The selector in Step 3 doesn't exist yet, but the type change itself is backward-compatible.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Upload/types.ts frontend/src/test-ids.ts
git commit -m "feat: add position field to ColumnMapping type and test-id"
```

---

### Task 3: Write failing Playwright tests for Step 3

These tests verify the Position selector exists in Step 3 and that Next → is enabled without mapping it. They will fail until Task 4 adds the selector.

**Files:**
- Modify: `frontend/tests/upload.spec.ts`

- [ ] **Step 1: Add the test describe block**

Append to `frontend/tests/upload.spec.ts`:

```ts
test.describe("Upload wizard — column mapping", () => {
  async function navigateToStep3(page: import("@playwright/test").Page) {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeNew).click()
    await page.getByLabel("Quiz name *").fill("Test Quiz")
    await page.getByRole("button", { name: "Next →" }).click()
    await page.getByLabel("Or paste data directly").fill(
      "Position,Name,Country,Score\n1,Alice,Ireland,50\n2,Bob,England,40",
    )
    await page.getByRole("button", { name: "Next →" }).click()
  }

  test("Position column selector label is visible in Step 3", async ({
    page,
  }) => {
    await navigateToStep3(page)
    await expect(page.getByText("Position column (optional)")).toBeVisible()
  })

  test("Next button is enabled in Step 3 when Position is not mapped", async ({
    page,
  }) => {
    await navigateToStep3(page)
    await expect(page.getByTestId(Labels.columnMappingPosition)).toBeVisible()
    await expect(page.getByRole("button", { name: "Next →" })).toBeEnabled()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd frontend
bunx playwright test tests/upload.spec.ts --grep "column mapping" 2>&1 | tail -20
```

Expected: both tests `FAILED` — "Position column (optional)" text does not yet exist.

- [ ] **Step 3: Commit**

```bash
git add frontend/tests/upload.spec.ts
git commit -m "test: add failing Playwright tests for Step 3 position column"
```

---

### Task 4: Implement Position selector in Step 3

**Files:**
- Modify: `frontend/src/components/Upload/steps/Step3ColumnMapping.tsx`

- [ ] **Step 1: Add the Position selector**

In `Step3ColumnMapping.tsx`, after the `REQUIRED_FIELDS` section's `grid gap-4` div (the closing `</div>` after the `.map()` over `REQUIRED_FIELDS`) and before the `{numRounds > 0 && ...}` block, add:

```tsx
<div className="grid gap-1.5">
  <Label>Position column (optional)</Label>
  <Select
    value={
      mapping.position !== null && mapping.position !== undefined
        ? String(mapping.position)
        : "__none__"
    }
    onValueChange={(v) =>
      setMapping((m) => ({
        ...m,
        position: v === "__none__" ? null : Number(v),
      }))
    }
  >
    <SelectTrigger data-testid={Labels.columnMappingPosition}>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="__none__">Not mapped (use row order)</SelectItem>
      {header.map((col, i) => (
        <SelectItem key={i} value={String(i)}>
          {col || `Column ${i + 1}`}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
</div>
```

Also add the `Labels` import at the top of the file (alongside existing imports):

```tsx
import { Labels } from "@/test-ids"
```

And update the `useState` initializer for `mapping` to spread in `position` from the existing state:

```tsx
const [mapping, setMapping] = useState<ColumnMapping>(() => {
  const existing = state.columnMapping
  const rounds =
    existing.rounds.length === numRounds
      ? existing.rounds
      : Array<number | null>(numRounds).fill(null)
  return { ...existing, rounds }
})
```

(The spread `...existing` already captures `position` since `ColumnMapping` now includes it — no further change needed here if you already do `{ ...existing, rounds }`.)

- [ ] **Step 2: Run the Playwright tests**

```bash
cd frontend
bunx playwright test tests/upload.spec.ts --grep "column mapping" 2>&1 | tail -20
```

Expected: both tests `PASSED`.

- [ ] **Step 3: Run the full upload test suite to check for regressions**

```bash
cd frontend
bunx playwright test tests/upload.spec.ts 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Upload/steps/Step3ColumnMapping.tsx
git commit -m "feat: add optional Position column selector to Step 3 column mapping"
```

---

### Task 5: Wire `final_rank` through Step 5 submission and preview

**Files:**
- Modify: `frontend/src/components/Upload/steps/Step5Preview.tsx`

- [ ] **Step 1: Derive `final_rank` and add it to the submission payload**

In `Step5Preview.tsx`, replace the `results` array inside `submitMutation.mutationFn`:

```ts
const results = state.resolutions.map((r, i) => {
  const row = state.parsedRows[i + 1]
  const roundScores = state.columnMapping.rounds.map((colIdx) =>
    colIdx !== null && row ? parseFloat(row[colIdx] || "0") : null,
  )
  const hasRoundData =
    state.selectedFormat && roundScores.some((s) => s !== null)
  const final_rank =
    state.columnMapping.position !== null && row
      ? parseInt(row[state.columnMapping.position] || "0", 10)
      : i + 1
  return {
    player_id: r.player_id ?? undefined,
    player_create: r.player_create ?? undefined,
    final_rank,
    score: parseRows[i]?.score ?? 0,
    round_scores: hasRoundData ? roundScores : undefined,
  }
})
```

- [ ] **Step 2: Add Position column to the preview table**

In the same file, replace the preview `<table>` block:

```tsx
<div className="rounded-lg border overflow-hidden">
  <table className="w-full text-xs">
    <thead className="bg-muted">
      <tr>
        <th className="px-3 py-2 text-left">Pos</th>
        <th className="px-3 py-2 text-left">Player</th>
        <th className="px-3 py-2 text-left">Score</th>
      </tr>
    </thead>
    <tbody>
      {state.resolutions.map((r, i) => {
        const row = parseRows[i]
        const rawRow = state.parsedRows[i + 1]
        const pos =
          state.columnMapping.position !== null && rawRow
            ? rawRow[state.columnMapping.position]
            : String(i + 1)
        const name =
          r.player_create?.display_name ??
          parseRows[i]?.player_name ??
          "—"
        return (
          <tr key={i} className="border-t">
            <td className="px-3 py-1.5 tabular-nums">{pos}</td>
            <td className="px-3 py-1.5">
              {name}
              {r.player_create && (
                <span className="ml-1 text-muted-foreground">(new)</span>
              )}
            </td>
            <td className="px-3 py-1.5 tabular-nums">{row?.score}</td>
          </tr>
        )
      })}
    </tbody>
  </table>
</div>
```

- [ ] **Step 3: Type-check and build**

```bash
cd frontend
bun run build 2>&1 | grep -E "error TS|Error" | head -20
```

Expected: no errors.

- [ ] **Step 4: Run the full backend test suite to verify no regressions**

```bash
cd backend
uv run python -m pytest tests/ -q 2>&1 | tail -10
```

Expected: `166 passed` (or more, including the new tie-scenario test from Task 1).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Upload/steps/Step5Preview.tsx
git commit -m "feat: include final_rank in upload wizard submission, add Position to preview table"
```

---

## Self-Review

**Spec coverage:**
- ✅ `position: number | null` added to `ColumnMapping` (Task 2)
- ✅ Optional Position selector in Step 3 with "Not mapped (use row order)" default (Task 4)
- ✅ Step 5 derives `final_rank` from mapped column or `i + 1` fallback (Task 5)
- ✅ Position column in Step 5 preview table (Task 5)
- ✅ Playwright test for Position selector visible in Step 3 (Task 3/4)
- ✅ Playwright test for Next enabled without mapping position (Task 3/4)
- ✅ Backend tie-scenario test `[1, 2, 2, 4]` round-trip (Task 1)

**Placeholder scan:** None found.

**Type consistency:** `ColumnMapping.position` typed as `number | null` in Task 2, read as `state.columnMapping.position` in Tasks 4 and 5. `Labels.columnMappingPosition` added in Task 2, used in Tasks 3 and 4. Consistent throughout.
