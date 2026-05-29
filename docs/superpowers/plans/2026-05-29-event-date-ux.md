# Event Date UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two-field start/end date UI with a single date defaulting to today, plus an opt-in "Multi-day event" checkbox that reveals the end date field.

**Architecture:** Frontend-only change across two files. `types.ts` gets a `today()` helper and updated `INITIAL_STATE` defaults. `Step1EventMeta.tsx` gets a checkbox toggle; the admin `MetadataEditDialog` gets the same treatment initialised from the existing event's dates.

**Tech Stack:** React 19, react-hook-form, TypeScript, bun test (unit tests)

---

### Task 1: Add `today()` helper and update `INITIAL_STATE` default dates

**Files:**
- Modify: `frontend/src/components/Upload/types.ts`
- Test: `frontend/tests/date-utils.test.ts`

The `INITIAL_STATE` constant in `types.ts` currently initialises `start_date` and `end_date` to `""`. This task exports a `today()` helper, writes tests for it, then updates `INITIAL_STATE` to use it.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/date-utils.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { today } from "../src/components/Upload/types"

describe("today", () => {
  test("returns a string in YYYY-MM-DD format", () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test("returns today's date in local time", () => {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, "0")
    const d = String(now.getDate()).padStart(2, "0")
    expect(today()).toBe(`${y}-${m}-${d}`)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && ~/.bun/bin/bun test tests/date-utils.test.ts
```

Expected: error — `today` is not exported from `types.ts`.

- [ ] **Step 3: Add `today()` to `types.ts` and update `INITIAL_STATE`**

Open `frontend/src/components/Upload/types.ts`. Add `today()` as the first export before the type declarations, then update `INITIAL_STATE`:

```ts
import type { ParsedResultWithCandidates, PlayerCreate } from "@/client"

export function today(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export type EventMeta = {
  name: string
  start_date: string
  end_date: string
  organizer_name: string
  description: string
  series_id: string
  organization_id: string
  format_questions: string
  format_rounds: string
  format_categories: string
}

export type ColumnMapping = {
  player_name: number
  country: number
  score: number
  tiebreaker_rank: number
}

export type Resolution = {
  player_id: string | null
  player_create: PlayerCreate | null
}

export type WizardState = {
  step: 0 | 1 | 2 | 3 | 4 | 5
  eventMode: "new" | "existing"
  existingEventId: string | null
  existingEventName: string | null
  submitMode: "append" | "replace"
  eventMeta: EventMeta
  rawCsv: string
  parsedRows: string[][]
  columnMapping: ColumnMapping
  parsedResults: ParsedResultWithCandidates[]
  resolutions: Resolution[]
  eventId: string | null
}

export const INITIAL_STATE: WizardState = {
  step: 0,
  eventMode: "new",
  existingEventId: null,
  existingEventName: null,
  submitMode: "append",
  eventMeta: {
    name: "",
    start_date: today(),
    end_date: today(),
    organizer_name: "",
    description: "",
    series_id: "",
    organization_id: "",
    format_questions: "",
    format_rounds: "",
    format_categories: "",
  },
  rawCsv: "",
  parsedRows: [],
  columnMapping: { player_name: 0, country: 1, score: 2, tiebreaker_rank: 3 },
  parsedResults: [],
  resolutions: [],
  eventId: null,
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd frontend && ~/.bun/bin/bun test tests/date-utils.test.ts
```

Expected: `2 pass, 0 fail`

- [ ] **Step 5: Run the full unit test suite**

```bash
cd frontend && ~/.bun/bin/bun run test:unit
```

Expected: all tests pass (countries tests + new date-utils tests)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Upload/types.ts frontend/tests/date-utils.test.ts
git commit -m "feat: add today() helper and default event dates to today"
```

---

### Task 2: Single-date + multi-day checkbox in the upload wizard

**Files:**
- Modify: `frontend/src/components/Upload/steps/Step1EventMeta.tsx`

The current form has two side-by-side date inputs (start_date, end_date), both required. Replace them with a single date input and a "Multi-day event" checkbox that reveals the end date.

- [ ] **Step 1: Read the current file**

Open `frontend/src/components/Upload/steps/Step1EventMeta.tsx` and confirm the current structure matches what is described below before making any edits.

Current state of relevance:
- Top of file: `const EMPTY_EVENT_META: EventMeta = { name: "", start_date: "", end_date: "", ... }`
- `useForm` destructures: `const { register, handleSubmit, setValue } = useForm<EventMeta>(...)`
- Date section: two inputs in a `grid-cols-2` div
- `handleModeChange` resets to `eventMeta: EMPTY_EVENT_META`
- `onSubmit` just calls `update({ eventMeta: data, step: 2 })`

- [ ] **Step 2: Replace the file contents**

The complete new file content for `frontend/src/components/Upload/steps/Step1EventMeta.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { useForm } from "react-hook-form"

import { EventsService, OrganizationsService, SeriesService } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Labels } from "@/test-ids"
import { today } from "../types"
import type { EventMeta, WizardState } from "../types"

interface Props {
  state: WizardState
  update: (patch: Partial<WizardState>) => void
}

function emptyEventMeta(): EventMeta {
  const t = today()
  return {
    name: "",
    start_date: t,
    end_date: t,
    organizer_name: "",
    description: "",
    series_id: "",
    organization_id: "",
    format_questions: "",
    format_rounds: "",
    format_categories: "",
  }
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: "new" | "existing"
  onChange: (m: "new" | "existing") => void
}) {
  return (
    <div className="flex rounded-md border overflow-hidden self-start">
      <button
        type="button"
        data-testid={Labels.uploadModeToggleNew}
        onClick={() => onChange("new")}
        className={`px-4 py-1.5 text-sm ${mode === "new" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
      >
        New event
      </button>
      <button
        type="button"
        data-testid={Labels.uploadModeToggleExisting}
        onClick={() => onChange("existing")}
        className={`px-4 py-1.5 text-sm ${mode === "existing" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
      >
        Existing event
      </button>
    </div>
  )
}

function ExistingEventPicker({
  value,
  onChange,
}: {
  value: string | null
  onChange: (id: string, name: string) => void
}) {
  const { data } = useQuery({
    queryFn: () => EventsService.readEvents({ skip: 0, limit: 200 }),
    queryKey: ["events", "all"],
  })

  return (
    <div className="grid gap-1.5">
      <Label>Select event</Label>
      <select
        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid={Labels.uploadExistingEventSelect}
        value={value ?? ""}
        onChange={(e) => {
          const event = data?.data.find((ev) => ev.id === e.target.value)
          if (event) onChange(event.id, event.name)
        }}
      >
        <option value="" disabled>
          — choose an event —
        </option>
        {data?.data.map((ev) => (
          <option key={ev.id} value={ev.id}>
            {ev.name} ({ev.start_date})
          </option>
        ))}
      </select>
    </div>
  )
}

export function Step1EventMeta({ state, update }: Props) {
  const { data: orgs } = useQuery({
    queryFn: () =>
      OrganizationsService.readOrganizations({ skip: 0, limit: 100 }),
    queryKey: ["organizations"],
  })
  const { data: seriesList } = useQuery({
    queryFn: () => SeriesService.readSeries({ skip: 0, limit: 100 }),
    queryKey: ["series"],
  })

  const [isMultiDay, setIsMultiDay] = useState(
    state.eventMeta.start_date !== state.eventMeta.end_date,
  )

  const { register, handleSubmit, setValue, getValues } = useForm<EventMeta>({
    defaultValues: state.eventMeta,
  })

  const onSubmit = (data: EventMeta) => {
    const payload = {
      ...data,
      end_date: isMultiDay ? data.end_date : data.start_date,
    }
    update({ eventMeta: payload, step: 2 })
  }

  const handleModeChange = (mode: "new" | "existing") => {
    update({
      eventMode: mode,
      existingEventId: null,
      existingEventName: null,
      eventMeta: emptyEventMeta(),
    })
  }

  return (
    <div className="flex flex-col gap-4 max-w-xl">
      <ModeToggle mode={state.eventMode} onChange={handleModeChange} />

      {state.eventMode === "existing" ? (
        <div className="flex flex-col gap-4">
          <ExistingEventPicker
            value={state.existingEventId}
            onChange={(id, name) =>
              update({ existingEventId: id, existingEventName: name })
            }
          />
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => update({ step: 0 })}>
              ← Back
            </Button>
            <Button
              onClick={() => update({ step: 2 })}
              disabled={!state.existingEventId}
            >
              Next →
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="name">Event name *</Label>
            <Input id="name" {...register("name", { required: true })} />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="start_date">
              {isMultiDay ? "Start date *" : "Date *"}
            </Label>
            <Input
              id="start_date"
              type="date"
              {...register("start_date", { required: true })}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isMultiDay}
              onChange={(e) => {
                setIsMultiDay(e.target.checked)
                if (!e.target.checked) {
                  setValue("end_date", getValues("start_date"))
                }
              }}
            />
            Multi-day event
          </label>

          {isMultiDay && (
            <div className="grid gap-1.5">
              <Label htmlFor="end_date">End date *</Label>
              <Input
                id="end_date"
                type="date"
                {...register("end_date", { required: isMultiDay })}
              />
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="organizer_name">Organiser name *</Label>
            <Input
              id="organizer_name"
              {...register("organizer_name", { required: true })}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="description">Description</Label>
            <textarea
              id="description"
              rows={3}
              className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
              {...register("description")}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Series (optional)</Label>
            <Select onValueChange={(v) => setValue("series_id", v)}>
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                {seriesList?.data.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label>Organization (optional)</Label>
            <Select onValueChange={(v) => setValue("organization_id", v)}>
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                {orgs?.data.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="format_rounds">Rounds</Label>
              <Input
                id="format_rounds"
                type="number"
                {...register("format_rounds")}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="format_questions">Questions</Label>
              <Input
                id="format_questions"
                type="number"
                {...register("format_questions")}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="format_categories">Categories</Label>
              <Input
                id="format_categories"
                placeholder="comma-separated"
                {...register("format_categories")}
              />
            </div>
          </div>

          <div className="flex gap-3">
            <Button
              variant="outline"
              type="button"
              onClick={() => update({ step: 0 })}
            >
              ← Back
            </Button>
            <Button type="submit">Next →</Button>
          </div>
        </form>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Type-check**

```bash
cd frontend && ~/.bun/bin/bun run build 2>&1 | head -40
```

Expected: no TypeScript errors (build output may show other unrelated warnings but zero type errors)

- [ ] **Step 4: Lint**

```bash
cd frontend && ~/.bun/bin/bun run lint
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Upload/steps/Step1EventMeta.tsx
git commit -m "feat: single-date default with multi-day checkbox in upload wizard"
```

---

### Task 3: Single-date + multi-day checkbox in the admin MetadataEditDialog

**Files:**
- Modify: `frontend/src/routes/_layout/admin_.events_.$id.tsx` (only the `MetadataEditDialog` component, lines 48–123)

The `MetadataEditDialog` currently has two side-by-side date inputs. Apply the same checkbox pattern, initialising `isMultiDay` from the existing event's dates.

- [ ] **Step 1: Read the current MetadataEditDialog**

Open `frontend/src/routes/_layout/admin_.events_.$id.tsx` and locate `MetadataEditDialog` (starts at line 48). Confirm:
- `useForm` destructures only `register` and `handleSubmit`
- The date section (lines 94–103) is a `grid-cols-2` div with two inputs

- [ ] **Step 2: Replace only the `MetadataEditDialog` component**

Replace the entire `MetadataEditDialog` function (lines 48–123) with:

```tsx
function MetadataEditDialog({ event }: { event: QuizEventPublic }) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [open, setOpen] = useState(false)
  const [isMultiDay, setIsMultiDay] = useState(
    event.start_date !== event.end_date,
  )
  const { register, handleSubmit, setValue, getValues } = useForm({
    defaultValues: {
      name: event.name,
      start_date: event.start_date,
      end_date: event.end_date,
      organizer_name: event.organizer_name,
      description: event.description ?? "",
    },
  })

  const mutation = useMutation({
    mutationFn: (data: QuizEventUpdate) =>
      EventsService.updateEvent({ id: event.id, requestBody: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "event", event.id] })
      queryClient.invalidateQueries({ queryKey: ["admin", "events"] })
      showSuccessToast("Event updated")
      setOpen(false)
    },
    onError: () => showErrorToast("Failed to update event"),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="h-4 w-4 mr-1" />
          Edit Metadata
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Event Metadata</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={handleSubmit((data) =>
            mutation.mutate({
              ...data,
              end_date: isMultiDay ? data.end_date : data.start_date,
            })
          )}
          className="flex flex-col gap-4 pt-2"
        >
          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input {...register("name")} />
          </div>

          <div className="grid gap-1.5">
            <Label>{isMultiDay ? "Start Date" : "Date"}</Label>
            <Input type="date" {...register("start_date")} />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isMultiDay}
              onChange={(e) => {
                setIsMultiDay(e.target.checked)
                if (!e.target.checked) {
                  setValue("end_date", getValues("start_date"))
                }
              }}
            />
            Multi-day event
          </label>

          {isMultiDay && (
            <div className="grid gap-1.5">
              <Label>End Date</Label>
              <Input type="date" {...register("end_date")} />
            </div>
          )}

          <div className="grid gap-1.5">
            <Label>Organizer Name</Label>
            <Input {...register("organizer_name")} />
          </div>
          <div className="grid gap-1.5">
            <Label>Description</Label>
            <textarea
              {...register("description")}
              rows={3}
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: Type-check**

```bash
cd frontend && ~/.bun/bin/bun run build 2>&1 | head -40
```

Expected: no TypeScript errors

- [ ] **Step 4: Lint**

```bash
cd frontend && ~/.bun/bin/bun run lint
```

Expected: no errors

- [ ] **Step 5: Run unit tests**

```bash
cd frontend && ~/.bun/bin/bun run test:unit
```

Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add frontend/src/routes/_layout/admin_.events_.\$id.tsx
git commit -m "feat: single-date default with multi-day checkbox in admin event edit"
```
