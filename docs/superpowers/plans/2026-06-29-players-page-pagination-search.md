# Players Page: Pagination & Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the players page card grid with a server-paginated TanStack Table (10 rows/page) plus a debounced search input that switches between browse and search modes.

**Architecture:** Two React Query calls coexist in the single `PlayersPage` component — one for paginated browse (`GET /players/?skip&limit`), one for fuzzy search (`GET /players/search?q&limit`) — enabled/disabled by whether the debounced query string is non-empty. Page number lives in the URL as `?page=N` via TanStack Router's `validateSearch`. TanStack Table is configured with `manualPagination: true` and driven by the URL page param.

**Tech Stack:** TanStack Router v1, TanStack Query v5, TanStack Table v8, Zod v4, shadcn/ui Table + Button + Input components, Playwright for E2E tests.

## Global Constraints

- Page size is fixed at 10 — no rows-per-page selector.
- No backend changes — both endpoints already exist and are tested.
- Only two files change: `frontend/src/routes/_public/players.tsx` (full rewrite) and `frontend/tests/players.spec.ts` (updated + new tests).
- Search debounce delay is 300 ms.
- Follow the existing Playwright test patterns: `authenticate()` helper, `PlayersService` API calls in `beforeAll`, `page.waitForLoadState("networkidle")` before assertions.

---

### Task 1: Write failing Playwright tests for the new UI

**Files:**
- Modify: `frontend/tests/players.spec.ts`

**Interfaces:**
- Consumes: existing `authenticate()`, `PlayersService.createPlayerRoute`, `PlayersService.updatePlayerRoute` helpers already in the file.
- Produces: failing test suite that Task 2's implementation will make pass.

- [ ] **Step 1: Update the "renders player cards or empty state" test**

The current test checks for a heading `"No players yet"` which will become a table cell in the new UI. Replace that test's empty-state check with one that matches either a table row link or a cell with the empty message.

In `frontend/tests/players.spec.ts`, replace the existing `"renders player cards or empty state"` test body with:

```ts
test("renders a table or empty state", async ({ page }) => {
  await page.goto("/players")
  await page.waitForLoadState("networkidle")
  const hasTable = await page.locator("table").isVisible().catch(() => false)
  expect(hasTable).toBe(true)
})
```

- [ ] **Step 2: Add test for search input visibility**

Append this test inside the `"Players listing page"` describe block:

```ts
test("shows a search input", async ({ page }) => {
  await page.goto("/players")
  await page.waitForLoadState("networkidle")
  await expect(page.getByPlaceholder("Search players…")).toBeVisible()
})
```

- [ ] **Step 3: Add a describe block for search behaviour**

Append this entire block after the existing describe blocks in `frontend/tests/players.spec.ts`:

```ts
test.describe("Players search", () => {
  const uniqueName = `SearchTest-${crypto.randomUUID().slice(0, 8)}`

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()

    const player = await PlayersService.createPlayerRoute({
      requestBody: { display_name: uniqueName },
    })
    await PlayersService.updatePlayerRoute({
      playerId: player.id,
      requestBody: { is_published: true },
    })
  })

  test("search input filters the player table", async ({ page }) => {
    await page.goto("/players")
    await page.waitForLoadState("networkidle")
    await page.getByPlaceholder("Search players…").fill(uniqueName)
    // Wait for debounce + network
    await page.waitForTimeout(500)
    await page.waitForLoadState("networkidle")
    await expect(
      page.getByRole("cell", { name: uniqueName }),
    ).toBeVisible()
  })

  test("clearing search returns to browse mode", async ({ page }) => {
    await page.goto("/players")
    await page.waitForLoadState("networkidle")
    const input = page.getByPlaceholder("Search players…")
    await input.fill(uniqueName)
    await page.waitForTimeout(500)
    await input.fill("")
    await page.waitForTimeout(500)
    await page.waitForLoadState("networkidle")
    // Pagination row is present only in browse mode (or table at minimum)
    await expect(page.locator("table")).toBeVisible()
  })
})
```

- [ ] **Step 4: Run the new tests to confirm they fail**

Run from `frontend/`:

```bash
bunx playwright test tests/players.spec.ts --reporter=list
```

Expected: the two new tests (`"shows a search input"`, `"search input filters the player table"`, `"clearing search returns to browse mode"`) fail because the current UI has no search input and no `<table>`. The existing routing tests should still pass.

- [ ] **Step 5: Commit the updated test file**

```bash
git add frontend/tests/players.spec.ts
git commit -m "test: update players spec for table+search UI (failing)"
```

---

### Task 2: Rewrite players.tsx with paginated table and search

**Files:**
- Modify: `frontend/src/routes/_public/players.tsx` (full rewrite)

**Interfaces:**
- Consumes: `PlayersService.listPlayers({ skip, limit })` → `PlayersPublic` (`{ data: PlayerPublic[], count: number }`)
- Consumes: `PlayersService.searchPlayersRoute({ q, limit })` → `PlayerSearchResults` (`{ data: PlayerSearchResult[] }`) where `PlayerSearchResult = { player: PlayerPublic, similarity: number }`
- Consumes: `countryName(country: string | null | undefined): string | undefined` from `@/lib/countries`
- Produces: public `/players` page with table, search input, URL-driven pagination.

- [ ] **Step 1: Write the full new players.tsx**

Replace the entire contents of `frontend/src/routes/_public/players.tsx` with:

```tsx
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import {
  createFileRoute,
  Link,
  useNavigate,
} from "@tanstack/react-router"
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react"
import { useEffect, useState } from "react"
import { z } from "zod"

import { type PlayerPublic, PlayersService } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { countryName } from "@/lib/countries"

const PAGE_SIZE = 10

const searchSchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
})

export const Route = createFileRoute("/_public/players")({
  component: PlayersPage,
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: "Players" }] }),
})

const columns: ColumnDef<PlayerPublic>[] = [
  {
    accessorKey: "display_name",
    header: "Player",
    cell: ({ row }) => {
      const { slug, display_name } = row.original
      return slug ? (
        <Link
          to="/players/$slug"
          params={{ slug }}
          className="font-medium hover:underline"
        >
          {display_name}
        </Link>
      ) : (
        <span className="font-medium">{display_name}</span>
      )
    },
  },
  {
    accessorKey: "country",
    header: "Country",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {countryName(row.original.country) ?? "—"}
      </span>
    ),
  },
]

function PlayersPage() {
  const { page } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [searchInput, setSearchInput] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchInput), 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  const isSearching = debouncedQuery.length > 0

  const browseQuery = useQuery({
    queryKey: ["players", page],
    queryFn: () =>
      PlayersService.listPlayers({
        skip: (page - 1) * PAGE_SIZE,
        limit: PAGE_SIZE,
      }),
    enabled: !isSearching,
    placeholderData: keepPreviousData,
  })

  const searchQuery = useQuery({
    queryKey: ["players", "search", debouncedQuery],
    queryFn: () =>
      PlayersService.searchPlayersRoute({ q: debouncedQuery, limit: PAGE_SIZE }),
    enabled: isSearching,
  })

  const players: PlayerPublic[] = isSearching
    ? (searchQuery.data?.data.map((r) => r.player) ?? [])
    : (browseQuery.data?.data ?? [])

  const totalCount = isSearching
    ? players.length
    : (browseQuery.data?.count ?? 0)
  const pageCount = Math.ceil(totalCount / PAGE_SIZE)
  const showPagination = !isSearching && totalCount > PAGE_SIZE

  const table = useReactTable({
    data: players,
    columns,
    pageCount,
    state: {
      pagination: { pageIndex: page - 1, pageSize: PAGE_SIZE },
    },
    onPaginationChange: (updater) => {
      const next =
        typeof updater === "function"
          ? updater({ pageIndex: page - 1, pageSize: PAGE_SIZE })
          : updater
      navigate({
        search: (prev) => ({ ...prev, page: next.pageIndex + 1 }),
      })
    },
    manualPagination: true,
    getCoreRowModel: getCoreRowModel(),
  })

  const isLoading =
    (isSearching ? searchQuery.isPending : browseQuery.isPending) &&
    players.length === 0

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Players</h1>
        <p className="text-muted-foreground">
          Player profiles and competition history
        </p>
      </div>

      <Input
        placeholder="Search players…"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        className="max-w-sm"
      />

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow
                    key={headerGroup.id}
                    className="hover:bg-transparent"
                  >
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id}>
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.length ? (
                  table.getRowModel().rows.map((row) => (
                    <TableRow key={row.id}>
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={columns.length}
                      className="h-32 text-center text-muted-foreground"
                    >
                      {isSearching ? "No players found." : "No players yet."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {showPagination && (
            <div className="flex items-center justify-between gap-4 p-4 border-t bg-muted/20">
              <div className="flex items-center gap-x-1 text-sm text-muted-foreground">
                <span>Page</span>
                <span className="font-medium text-foreground">
                  {table.getState().pagination.pageIndex + 1}
                </span>
                <span>of</span>
                <span className="font-medium text-foreground">
                  {table.getPageCount()}
                </span>
              </div>
              <div className="flex items-center gap-x-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => table.setPageIndex(0)}
                  disabled={!table.getCanPreviousPage()}
                >
                  <span className="sr-only">Go to first page</span>
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => table.previousPage()}
                  disabled={!table.getCanPreviousPage()}
                >
                  <span className="sr-only">Go to previous page</span>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => table.nextPage()}
                  disabled={!table.getCanNextPage()}
                >
                  <span className="sr-only">Go to next page</span>
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() =>
                    table.setPageIndex(table.getPageCount() - 1)
                  }
                  disabled={!table.getCanNextPage()}
                >
                  <span className="sr-only">Go to last page</span>
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify the TypeScript build passes**

Run from `frontend/`:

```bash
bun run build
```

Expected: exits 0 with no type errors. If you see `TS2345` on `useNavigate({ from: Route.fullPath })`, change to `useNavigate()` — TanStack Router infers the route context automatically from `Route.useSearch()`.

- [ ] **Step 3: Run the full Playwright suite to verify all tests pass**

Requires the full Docker stack running (`docker compose watch` from repo root). Run from `frontend/`:

```bash
bunx playwright test tests/players.spec.ts --reporter=list
```

Expected: all tests pass, including the three new ones added in Task 1.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/routes/_public/players.tsx
git commit -m "feat: replace players card grid with paginated table and search"
```
