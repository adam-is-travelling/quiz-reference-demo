import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, redirect } from "@tanstack/react-router"
import { useState } from "react"
import { PlayersService } from "@/client"
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

export const Route = createFileRoute("/_layout/admin_/players/merges")({
  component: AdminPlayerMerges,
  beforeLoad: async () => {
    const { UsersService } = await import("@/client")
    const user = await UsersService.readUserMe()
    if (!user.is_superuser) {
      throw redirect({ to: "/" })
    }
  },
  head: () => ({
    meta: [{ title: "Merge History - Admin" }],
  }),
})

function formatMergedAt(value: string | null | undefined): string {
  if (!value) return "—"
  return new Date(value).toLocaleString()
}

function AdminPlayerMerges() {
  const [page, setPage] = useState(0)

  const { data, isPending } = useQuery({
    queryKey: ["players", "merges", page],
    queryFn: () =>
      PlayersService.listPlayerMergesRoute({
        skip: page * PAGE_SIZE,
        limit: PAGE_SIZE,
      }),
  })

  const total = data?.count ?? 0
  const hasNext = (page + 1) * PAGE_SIZE < total

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Merge History</h1>
          <p className="text-muted-foreground">
            Audit log of player merges ({total} total)
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/admin/players/merge">New merge</Link>
        </Button>
      </div>

      {isPending ? (
        <div className="animate-pulse h-40 w-full rounded bg-muted" />
      ) : total === 0 ? (
        <p className="text-sm text-muted-foreground">No merges recorded yet.</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Performed by</TableHead>
                <TableHead>Source (deleted)</TableHead>
                <TableHead>Target (kept)</TableHead>
                <TableHead className="text-right">Results moved</TableHead>
                <TableHead className="text-right">Results deleted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.data ?? []).map((audit) => (
                <TableRow key={audit.id}>
                  <TableCell>{formatMergedAt(audit.merged_at)}</TableCell>
                  <TableCell>{audit.performed_by_email}</TableCell>
                  <TableCell>
                    {audit.source_display_name}
                    {audit.source_slug && (
                      <span className="text-muted-foreground text-xs">
                        {" "}
                        (/{audit.source_slug})
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{audit.target_display_name}</TableCell>
                  <TableCell className="text-right">
                    {audit.moved_results_count}
                  </TableCell>
                  <TableCell className="text-right">
                    {audit.deleted_conflicts_count}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {(page > 0 || hasNext) && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!hasNext}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
