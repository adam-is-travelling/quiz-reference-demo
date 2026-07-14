# Admin Player Edit Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins (superusers) an inline "Edit" dialog on the public player profile page (`/players/$slug`) to update a player's name, countries (first = primary), city, club, bio, photo URL, and slug.

**Architecture:** Frontend-only change. A new `EditPlayerDialog` component (react-hook-form + zod + shadcn Dialog, following the existing `Admin/EditUser.tsx` pattern) is triggered from the `AdminControls` section of the player profile route. The existing `CountryMultiSelect` gains a one-click "make primary" star. The orphaned `/admin/players/$id` route is deleted. The backend `PATCH /players/{player_id}` endpoint already supports every field and is already superuser-only — do not touch the backend.

**Tech Stack:** React 18, TypeScript, TanStack Router + Query, react-hook-form, zod v4, shadcn/ui (Radix + Tailwind v4), Playwright E2E, Biome.

**Spec:** `docs/superpowers/specs/2026-07-14-player-edit-dialog-design.md`

## Global Constraints

- Frontend only. No backend, model, or migration changes.
- **Slug and display name are required in the form** — a player must never lose their public URL.
- Optional fields (city, club, bio, photo_url) submit as `null` when cleared, never as empty strings.
- Primary country = first element of the `countries` array (existing backend contract).
- All frontend commands run from `frontend/`. Verification per task: `bun run build` (type-check + build) and `bun run lint` (Biome).
- This repo has no component-test infrastructure: `bun test` covers pure functions only; UI behavior is tested via Playwright (Task 4). Task 4's E2E run requires the Docker stack (`docker compose watch` from repo root). Never run `docker compose down -v` or wipe volumes.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: `CountryMultiSelect` — one-click "make primary" star

**Files:**
- Modify: `frontend/src/components/ui/CountryMultiSelect.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: same public API (`value: string[]`, `onChange: (codes: string[]) => void`; first element = primary). New behavior only: each non-primary chip renders a `☆` button with `aria-label="Make <country name> primary"` that moves that country to position 0. Task 4's E2E test clicks `getByRole("button", { name: "Make Germany primary" })`.

- [ ] **Step 1: Replace the chip rendering**

The current chip body renders a static ★ on index 0 and nothing on the others. Replace the `{value.map(...)}` block in `frontend/src/components/ui/CountryMultiSelect.tsx` so non-primary chips get a promote button:

```tsx
        {value.map((code, i) => (
          <span
            key={code}
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
          >
            {i === 0 ? (
              <span className="text-amber-500" title="Primary">
                ★
              </span>
            ) : (
              <button
                type="button"
                aria-label={`Make ${countryName(code)} primary`}
                title="Make primary"
                onClick={() =>
                  onChange([code, ...value.filter((c) => c !== code)])
                }
                className="text-muted-foreground hover:text-amber-500"
              >
                ☆
              </button>
            )}
            {countryName(code)}
            <button
              type="button"
              aria-label={`Remove ${countryName(code)}`}
              onClick={() => onChange(value.filter((c) => c !== code))}
              className="text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </span>
        ))}
```

Everything else in the file (the empty state, the `+ Add country…` select) stays unchanged.

- [ ] **Step 2: Verify type-check and lint**

Run (from `frontend/`):
```bash
bun run build && bun run lint
```
Expected: both succeed with no errors. (Behavioral verification comes from the Task 4 E2E test that promotes a country via the star.)

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/CountryMultiSelect.tsx
git commit -m "feat(frontend): one-click make-primary star in CountryMultiSelect

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `EditPlayerDialog` component

**Files:**
- Create: `frontend/src/components/Players/EditPlayerDialog.tsx`

**Interfaces:**
- Consumes: `PlayerPublic` and `PlayersService.updatePlayerRoute` from `@/client`; `CountryMultiSelect` from Task 1; existing `useCustomToast`, `handleError`, shadcn `Form`/`Dialog`/`Input`/`LoadingButton`.
- Produces: `export function EditPlayerDialog({ player }: { player: PlayerPublic })` — renders its own trigger button (`Edit`, Pencil icon) plus the controlled dialog. Task 3 imports it as `import { EditPlayerDialog } from "@/components/Players/EditPlayerDialog"`.

- [ ] **Step 1: Create the component**

Create `frontend/src/components/Players/EditPlayerDialog.tsx` with exactly this content:

```tsx
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Pencil } from "lucide-react"
import { useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { z } from "zod"

import { type PlayerPublic, PlayersService } from "@/client"
import { Button } from "@/components/ui/button"
import { CountryMultiSelect } from "@/components/ui/CountryMultiSelect"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

const formSchema = z.object({
  display_name: z.string().min(1, { message: "Name is required" }),
  slug: z.string().min(1, { message: "Slug is required" }),
  countries: z.array(z.string()),
  city: z.string(),
  club: z.string(),
  bio: z.string(),
  photo_url: z.union([
    z.url({ message: "Must be a valid URL" }),
    z.literal(""),
  ]),
})

type FormData = z.infer<typeof formSchema>

function playerFormValues(player: PlayerPublic): FormData {
  return {
    display_name: player.display_name,
    slug: player.slug ?? "",
    countries: player.countries ?? [],
    city: player.city ?? "",
    club: player.club ?? "",
    bio: player.bio ?? "",
    photo_url: player.photo_url ?? "",
  }
}

interface EditPlayerDialogProps {
  player: PlayerPublic
}

export function EditPlayerDialog({ player }: EditPlayerDialogProps) {
  const [isOpen, setIsOpen] = useState(false)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    defaultValues: playerFormValues(player),
  })

  const mutation = useMutation({
    mutationFn: (data: FormData) =>
      PlayersService.updatePlayerRoute({
        playerId: player.id,
        requestBody: {
          display_name: data.display_name,
          slug: data.slug,
          countries: data.countries,
          city: data.city || null,
          club: data.club || null,
          bio: data.bio || null,
          photo_url: data.photo_url || null,
        },
      }),
    onSuccess: (updated) => {
      showSuccessToast("Player updated")
      setIsOpen(false)
      queryClient.invalidateQueries({ queryKey: ["players"] })
      if (updated.slug && updated.slug !== player.slug) {
        navigate({ to: "/players/$slug", params: { slug: updated.slug } })
      }
    },
    onError: handleError.bind(showErrorToast),
  })

  const openDialog = () => {
    form.reset(playerFormValues(player))
    setIsOpen(true)
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <Button variant="outline" size="sm" onClick={openDialog}>
        <Pencil className="h-4 w-4 mr-1" />
        Edit
      </Button>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <Form {...form}>
          <form onSubmit={form.handleSubmit((data) => mutation.mutate(data))}>
            <DialogHeader>
              <DialogTitle>Edit Player</DialogTitle>
              <DialogDescription>
                Update player profile details visible to the public.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <FormField
                control={form.control}
                name="display_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Display Name <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="Display name" type="text" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-1.5">
                <FormLabel>Countries</FormLabel>
                <Controller
                  name="countries"
                  control={form.control}
                  render={({ field }) => (
                    <CountryMultiSelect
                      value={field.value ?? []}
                      onChange={field.onChange}
                    />
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  The starred country is the player&apos;s primary country.
                </p>
              </div>

              <FormField
                control={form.control}
                name="city"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>City</FormLabel>
                    <FormControl>
                      <Input placeholder="City" type="text" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="club"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Club</FormLabel>
                    <FormControl>
                      <Input placeholder="Club" type="text" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="bio"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bio</FormLabel>
                    <FormControl>
                      <textarea
                        {...field}
                        rows={4}
                        placeholder="Player bio…"
                        className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="photo_url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Photo URL</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="https://example.com/photo.jpg"
                        type="url"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="slug"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      URL Slug <span className="text-destructive">*</span>
                    </FormLabel>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground text-sm">
                        /quizzer/
                      </span>
                      <FormControl>
                        <Input
                          placeholder="evan-lynch"
                          className="font-mono"
                          {...field}
                        />
                      </FormControl>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Used in the player&apos;s public URL. Auto-generated on
                      creation; change only to correct errors.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button
                  variant="outline"
                  type="button"
                  disabled={mutation.isPending}
                >
                  Cancel
                </Button>
              </DialogClose>
              <LoadingButton type="submit" loading={mutation.isPending}>
                Save
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
```

Notes on why it looks this way (matches `Admin/EditUser.tsx` conventions):
- `handleError.bind(showErrorToast)` surfaces the backend `detail` (e.g. the 409 "slug already in use" message) as an error toast; the dialog stays open.
- `queryClient.invalidateQueries({ queryKey: ["players"] })` also invalidates `["players", "slug", <slug>]` and `["players", <id>, "history"]` by prefix — one invalidation covers the profile page.
- `form.reset(playerFormValues(player))` on open prevents stale defaults when the dialog is reopened after a save.
- If the slug changed, navigate to the new profile URL so the admin isn't stranded on a dead route.
- Countries uses a plain `Controller` + manual label (not `FormField`) because `CountryMultiSelect` is not a single labeled input; the schema has no validation on it (empty list is allowed).

- [ ] **Step 2: Verify type-check and lint**

Run (from `frontend/`):
```bash
bun run build && bun run lint
```
Expected: both succeed. If `z.url` errors, this zod version wants `z.string().url({ message: "Must be a valid URL" })` — use that form instead (check `Admin/EditUser.tsx`, which uses `z.email`, for the local convention).

- [ ] **Step 3: Commit**

```bash
git add src/components/Players/EditPlayerDialog.tsx
git commit -m "feat(frontend): add EditPlayerDialog component

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Wire Edit into the profile page; delete the orphaned admin route

**Files:**
- Modify: `frontend/src/routes/_public/players_.$slug.tsx` (the `AdminControls` component, lines ~43–106)
- Delete: `frontend/src/routes/_layout/admin_.players.$id.tsx`
- Regenerated: `frontend/src/routeTree.gen.ts` (by the TanStack Router vite plugin)

**Interfaces:**
- Consumes: `EditPlayerDialog` from Task 2.
- Produces: on `/players/$slug`, superusers always see an **Edit** button; **Delete** still only appears when `history.data.length === 0`. Task 4's E2E tests target `getByRole("button", { name: /edit/i })` on this page.

- [ ] **Step 1: Update `AdminControls`**

In `frontend/src/routes/_public/players_.$slug.tsx`:

Add the import:
```tsx
import { EditPlayerDialog } from "@/components/Players/EditPlayerDialog"
```

Then in `AdminControls`, remove the early return (`if (history.data.length > 0) return null`) and gate only the delete UI on history. The component's return becomes:

```tsx
  return (
    <>
      <EditPlayerDialog player={player} />

      {history.data.length === 0 && (
        <>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Delete
          </Button>

          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete player?</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                This will permanently delete{" "}
                <span className="font-medium text-foreground">
                  {player.display_name}
                </span>
                . This cannot be undone.
              </p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? "Deleting…" : "Delete"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </>
  )
```

The delete dialog content is unchanged — only the wrapping condition is new. The `flex justify-end` container in `PlayerContent` already lays the buttons out in a row (add `gap-2` to it: `className="flex justify-end gap-2"`).

- [ ] **Step 2: Delete the orphaned admin route and regenerate the route tree**

```bash
git rm src/routes/_layout/admin_.players.\$id.tsx
bunx vite build
```

`bunx vite build` runs the TanStack Router plugin, which rewrites `src/routeTree.gen.ts` without the deleted route. (This step must happen before `bun run build`, whose `tsc` pass would otherwise fail on the stale generated file.)

- [ ] **Step 3: Verify type-check and lint**

Run (from `frontend/`):
```bash
bun run build && bun run lint
```
Expected: both succeed; no references to the deleted route remain (`grep -rn "admin_/players" src/` returns only nothing or routeTree entries — there should be none).

- [ ] **Step 4: Commit**

```bash
git add src/routes/_public/players_.\$slug.tsx src/routeTree.gen.ts
git commit -m "feat(frontend): admin edit dialog on player profile; retire orphaned admin edit page

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: E2E tests

**Files:**
- Modify: `frontend/tests/players.spec.ts` — extend the existing `test.describe("Player profile page (superuser)")` block (ends ~line 144)

**Interfaces:**
- Consumes: the Edit button and dialog from Tasks 1–3; the block's existing `testPlayerSlug` fixture (created unpublished, no quiz results, superuser session via the chromium project's auth setup).
- Produces: regression coverage for the edit flow.

- [ ] **Step 1: Start the stack (if not running)**

From the repo root:
```bash
docker compose watch
```
Wait until backend is healthy (`docker compose logs backend` shows Uvicorn running). **Never run `docker compose down -v` or remove volumes.**

- [ ] **Step 2: Add the tests**

Inside `test.describe("Player profile page (superuser)", ...)` in `frontend/tests/players.spec.ts`, change `let testPlayerSlug: string` usage as follows — the slug test renames the player's slug, so it reassigns the shared variable. Append these tests after the existing "superuser sees delete button" test:

```ts
  test("superuser can edit name and set a primary country", async ({
    page,
  }) => {
    await page.goto(`/players/${testPlayerSlug}`)
    await page.getByRole("button", { name: /edit/i }).click()

    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("Display Name").fill("Edited Superuser Player")
    await dialog.locator("select").selectOption({ label: "Ireland" })
    await dialog.locator("select").selectOption({ label: "Germany" })
    await dialog
      .getByRole("button", { name: "Make Germany primary" })
      .click()
    await dialog.getByRole("button", { name: "Save" }).click()

    // Dialog closes and the profile reflects the new name and countries
    await expect(dialog).not.toBeVisible()
    await expect(
      page.getByRole("heading", { name: "Edited Superuser Player" }),
    ).toBeVisible()
    await expect(page.getByText("Germany")).toBeVisible()
    await expect(page.getByText("Ireland")).toBeVisible()
  })

  test("editing the slug navigates to the new profile URL", async ({
    page,
  }) => {
    const newSlug = `${testPlayerSlug}-renamed`
    await page.goto(`/players/${testPlayerSlug}`)
    await page.getByRole("button", { name: /edit/i }).click()

    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("URL Slug").fill(newSlug)
    await dialog.getByRole("button", { name: "Save" }).click()

    await expect(page).toHaveURL(`/players/${newSlug}`)
    testPlayerSlug = newSlug
  })

  test("slug cannot be cleared", async ({ page }) => {
    await page.goto(`/players/${testPlayerSlug}`)
    await page.getByRole("button", { name: /edit/i }).click()

    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("URL Slug").fill("")
    await dialog.getByRole("button", { name: "Save" }).click()

    // Validation error keeps the dialog open; URL unchanged
    await expect(dialog.getByText("Slug is required")).toBeVisible()
    await expect(page).toHaveURL(`/players/${testPlayerSlug}`)
  })

  test("anonymous user does not see the edit button", async ({ browser }) => {
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    })
    const page = await context.newPage()

    // Any published player profile will do; skip if none exist
    await page.goto("/players")
    await page.waitForLoadState("networkidle")
    const firstLink = page.locator("a[href^='/players/']").first()
    if ((await firstLink.count()) === 0) {
      await context.close()
      test.skip()
      return
    }
    await firstLink.click()
    await page.waitForLoadState("networkidle")
    await expect(
      page.getByRole("button", { name: /edit/i }),
    ).not.toBeVisible()

    await context.close()
  })
```

Ordering note: these tests run in declaration order within the describe block; the slug-rename test reassigns `testPlayerSlug` for the tests after it. Playwright runs tests in a file serially per worker by default, so this is safe.

- [ ] **Step 3: Run the players E2E suite**

From `frontend/`:
```bash
bunx playwright test tests/players.spec.ts --config playwright.config.cts
```
Expected: all tests pass, including the four new ones. If `getByLabel("Display Name")` fails to resolve, the shadcn `FormLabel`/`FormControl` id wiring is the first thing to check in `EditPlayerDialog`.

- [ ] **Step 4: Run lint and full type-check once more**

```bash
bun run build && bun run lint
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add tests/players.spec.ts
git commit -m "test(frontend): E2E coverage for admin player edit dialog

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
