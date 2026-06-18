# Round Column Auto-Fill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When round 0's column is selected for the first time on Step 3 of the upload wizard, automatically fill remaining round columns with the next consecutive CSV column indices.

**Architecture:** Single-file logic change in `Step3ColumnMapping.tsx` — extend the existing `onValueChange` handler with a guard that triggers only when round index is 0 and all rounds are currently null. Playwright test scaffolds a real format via the API, navigates the full wizard, and asserts that round selectors 1..N-1 reflect the expected columns without user interaction.

**Tech Stack:** React (state update via `setMapping`), Playwright (E2E), Bun (test runner)

## Global Constraints

- TDD: write and run the failing test before writing the implementation.
- Do not change the backend or OpenAPI client.
- Auto-fill only fires when `i === 0`, the chosen column is not `__none__`, and every element of `m.rounds` is currently `null`.
- Auto-filled columns that would exceed `header.length - 1` are left as `null`.

---

### Task 1: Add test IDs and write the failing Playwright test

**Files:**
- Modify: `frontend/src/test-ids.ts`
- Modify: `frontend/src/components/Upload/steps/Step1EventMeta.tsx`
- Modify: `frontend/src/components/Upload/steps/Step3ColumnMapping.tsx`
- Modify: `frontend/tests/upload.spec.ts`

**Interfaces:**
- Produces:
  - `Labels.formatSelect` → `"format-select"` (string constant)
  - `data-testid="format-select"` on the Format `SelectTrigger` in Step 1
  - `data-testid="round-column-{i}"` on each round `SelectTrigger` in Step 3
  - A new failing Playwright test: `"selecting round 0 auto-fills subsequent rounds consecutively"`

---

- [ ] **Step 1: Add `formatSelect` to `Labels`**

In `frontend/src/test-ids.ts`, add one entry:

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
  formatSelect: "format-select",
  homeGreeting: "home-greeting",
  homeRecentQuizzes: "home-recent-quizzes",
  homeRecentPlayers: "home-recent-players",
  homeAdminLoginLink: "home-admin-login-link",
} as const
```

- [ ] **Step 2: Add `data-testid` to the Format SelectTrigger in Step 1**

In `frontend/src/components/Upload/steps/Step1EventMeta.tsx`, find the Format `<Select>` block (around line 294) and add the test ID to its `SelectTrigger`:

```tsx
<div className="grid gap-1.5">
  <Label>Format (optional)</Label>
  <Select
    value={selectedFormatId}
    onValueChange={(v) => {
      setSelectedFormatId(v)
      setValue("format_id", v === "__none__" ? "" : v)
    }}
  >
    <SelectTrigger data-testid={Labels.formatSelect}>
      <SelectValue placeholder="No Format" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="__none__">No Format</SelectItem>
      {formatsList?.data.map((f) => (
        <SelectItem key={f.id} value={f.id}>
          {f.name}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
</div>
```

- [ ] **Step 3: Add `data-testid` to each round SelectTrigger in Step 3**

In `frontend/src/components/Upload/steps/Step3ColumnMapping.tsx`, find the round `SelectTrigger` (around line 152) and add the test ID:

```tsx
<SelectTrigger data-testid={`round-column-${i}`}>
  <SelectValue />
</SelectTrigger>
```

The full round mapping block (lines 129–167) now looks like:

```tsx
{numRounds > 0 && (
  <div className="grid gap-4">
    <p className="text-sm font-medium">Round column mapping (optional)</p>
    {state.selectedFormat!.rounds!.map((roundName, i) => (
      <div key={i} className="grid gap-1.5">
        <Label>
          Round {i + 1}
          {roundName ? ` — ${roundName}` : ""}
        </Label>
        <Select
          value={
            mapping.rounds[i] !== null && mapping.rounds[i] !== undefined
              ? String(mapping.rounds[i])
              : "__none__"
          }
          onValueChange={(v) =>
            setMapping((m) => {
              const rounds = [...m.rounds]
              rounds[i] = v === "__none__" ? null : Number(v)
              return { ...m, rounds }
            })
          }
        >
          <SelectTrigger data-testid={`round-column-${i}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Not mapped</SelectItem>
            {header.map((col, ci) => (
              <SelectItem key={ci} value={String(ci)}>
                {col || `Column ${ci + 1}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 4: Write the failing Playwright test**

Append a new `describe` block to `frontend/tests/upload.spec.ts`:

```ts
test.describe("Upload wizard — round column auto-fill", () => {
  let formatId: string
  let formatName: string

  test.beforeAll(async ({ request }) => {
    formatName = `Auto-fill Test Format ${Date.now()}`
    const resp = await request.post("/api/v1/formats/", {
      data: { name: formatName, rounds: ["R1", "R2", "R3"] },
    })
    const format = await resp.json()
    formatId = format.id
  })

  test.afterAll(async ({ request }) => {
    if (formatId) {
      await request.delete(`/api/v1/formats/${formatId}`)
    }
  })

  test("selecting round 0 auto-fills subsequent rounds consecutively", async ({
    page,
  }) => {
    await page.goto("/upload")
    await page.getByTestId(Labels.uploadModeNew).click()

    await page.getByLabel("Quiz name *").fill("Auto-fill Test Quiz")

    // Select the test format
    await page.getByTestId(Labels.formatSelect).click()
    await page.getByRole("option", { name: formatName }).click()

    await page.getByRole("button", { name: "Next →" }).click()

    // Step 2: paste a 6-column CSV
    await page
      .getByLabel("Or paste data directly")
      .fill(
        "Name,Country,Score,R1,R2,R3\nAlice,Ireland,50,10,20,20\nBob,England,40,15,10,15",
      )
    await page.getByRole("button", { name: "Next →" }).click()

    // Step 3: select R1 (column index 3) for round 0
    await page.getByTestId("round-column-0").click()
    await page.getByRole("option", { name: "R1" }).click()

    // Rounds 1 and 2 should auto-fill to R2 and R3
    await expect(page.getByTestId("round-column-1")).toContainText("R2")
    await expect(page.getByTestId("round-column-2")).toContainText("R3")
  })
})
```

- [ ] **Step 5: Run the test and confirm it fails**

From `frontend/`:

```bash
bunx playwright test tests/upload.spec.ts --grep "auto-fills subsequent rounds"
```

Expected: test FAILS on the assertions at the end (rounds 1 and 2 still show "Not mapped" because the auto-fill logic doesn't exist yet).

- [ ] **Step 6: Commit the test infrastructure**

```bash
git add frontend/src/test-ids.ts \
        frontend/src/components/Upload/steps/Step1EventMeta.tsx \
        frontend/src/components/Upload/steps/Step3ColumnMapping.tsx \
        frontend/tests/upload.spec.ts
git commit -m "test: add failing test for round column auto-fill"
```

---

### Task 2: Implement the auto-fill logic and make the test pass

**Files:**
- Modify: `frontend/src/components/Upload/steps/Step3ColumnMapping.tsx:144-149`

**Interfaces:**
- Consumes: `header` (string array from `state.parsedRows[0]`), `m.rounds` (current round mapping state), `i` (round index), `colIndex` (selected column number or null)

---

- [ ] **Step 1: Extend the round `onValueChange` handler**

In `frontend/src/components/Upload/steps/Step3ColumnMapping.tsx`, replace the existing `onValueChange` for round selectors (currently lines 144–149):

```tsx
onValueChange={(v) =>
  setMapping((m) => {
    const rounds = [...m.rounds]
    rounds[i] = v === "__none__" ? null : Number(v)
    return { ...m, rounds }
  })
}
```

with:

```tsx
onValueChange={(v) =>
  setMapping((m) => {
    const rounds = [...m.rounds]
    const colIndex = v === "__none__" ? null : Number(v)
    rounds[i] = colIndex
    if (i === 0 && colIndex !== null && m.rounds.every((r) => r === null)) {
      for (let j = 1; j < rounds.length; j++) {
        const auto = colIndex + j
        rounds[j] = auto < header.length ? auto : null
      }
    }
    return { ...m, rounds }
  })
}
```

- [ ] **Step 2: Run the Playwright test and confirm it passes**

```bash
bunx playwright test tests/upload.spec.ts --grep "auto-fills subsequent rounds"
```

Expected: PASS

- [ ] **Step 3: Run the full upload spec to check for regressions**

```bash
bunx playwright test tests/upload.spec.ts
```

Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Upload/steps/Step3ColumnMapping.tsx
git commit -m "feat: auto-fill consecutive round columns when round 0 is selected first"
```
