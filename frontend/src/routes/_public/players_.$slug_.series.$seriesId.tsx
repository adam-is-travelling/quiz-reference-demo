import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import {
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
import { z } from "zod"

import { PlayersService } from "@/client"
import { historyColumns } from "@/components/Players/historyColumns"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const PAGE_SIZE = 50

const searchSchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
})

export const Route = createFileRoute(
  "/_public/players_/$slug_/series/$seriesId",
)({
  component: SeriesHistoryPage,
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: "Series results" }] }),
})

const columns = historyColumns

function SeriesHistoryPage() {
  const { slug, seriesId } = Route.useParams()
  const { page } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  const playerQuery = useQuery({
    queryKey: ["players", "slug", slug],
    queryFn: () => PlayersService.getPlayerBySlugRoute({ slug }),
  })
  const player = playerQuery.data

  const historyQuery = useQuery({
    queryKey: ["players", player?.id, "series-history", seriesId, page],
    queryFn: () =>
      PlayersService.getPlayerSeriesHistoryRoute({
        playerId: player!.id,
        seriesId: seriesId === "none" ? undefined : seriesId,
        skip: (page - 1) * PAGE_SIZE,
        limit: PAGE_SIZE,
      }),
    enabled: !!player,
    placeholderData: keepPreviousData,
  })

  const rows = historyQuery.data?.data ?? []
  const totalCount = historyQuery.data?.count ?? 0
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const showPagination = totalCount > PAGE_SIZE
  const seriesLabel =
    seriesId === "none" ? "Other" : (historyQuery.data?.series_name ?? "Series")

  const table = useReactTable({
    data: rows,
    columns,
    pageCount,
    state: { pagination: { pageIndex: page - 1, pageSize: PAGE_SIZE } },
    onPaginationChange: (updater) => {
      const next =
        typeof updater === "function"
          ? updater({ pageIndex: page - 1, pageSize: PAGE_SIZE })
          : updater
      navigate({ search: (prev) => ({ ...prev, page: next.pageIndex + 1 }) })
    },
    manualPagination: true,
    getCoreRowModel: getCoreRowModel(),
  })

  const playerNotFound =
    playerQuery.isError || (!playerQuery.isPending && !player)

  if (playerNotFound) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground">Player not found.</p>
        <Link
          to="/players"
          search={{ page: 1 }}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Back to players
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        {player && (
          <Link
            to="/players/$slug"
            params={{ slug }}
            className="text-sm text-muted-foreground hover:underline"
          >
            ← {player.display_name}
          </Link>
        )}
        <h1 className="text-2xl font-bold tracking-tight">{seriesLabel}</h1>
        <p className="text-muted-foreground">
          All results {player ? `for ${player.display_name}` : ""} in this
          series
        </p>
      </div>

      {historyQuery.isPending ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : historyQuery.isError ? (
        <p className="text-muted-foreground">
          Couldn't load results. Please try again.
        </p>
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
                      No results.
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
