import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
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
    accessorFn: (row) => row.countries?.[0] ?? "",
    id: "country",
    header: "Country",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {countryName(row.original.countries?.[0]) || "—"}
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

  const [countryInput, setCountryInput] = useState("")
  const [debouncedCountry, setDebouncedCountry] = useState("")

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedCountry(countryInput), 300)
    return () => clearTimeout(timer)
  }, [countryInput])

  const isSearching = debouncedQuery.length > 0 || debouncedCountry.length > 0

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
    queryKey: ["players", "search", debouncedQuery, debouncedCountry],
    queryFn: () =>
      PlayersService.searchPlayersRoute({
        q: debouncedQuery,
        country: debouncedCountry || undefined,
        limit: 50,
      }),
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

      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          placeholder="Search players…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="max-w-sm"
        />
        <Input
          placeholder="Search by country…"
          value={countryInput}
          onChange={(e) => setCountryInput(e.target.value)}
          className="max-w-sm"
        />
      </div>

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
                  onClick={() => table.setPageIndex(table.getPageCount() - 1)}
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
