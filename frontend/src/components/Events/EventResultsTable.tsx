import { Link } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"

import type { EventResultWithPlayer } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { Badge } from "@/components/ui/badge"

const columns: ColumnDef<EventResultWithPlayer>[] = [
  {
    accessorKey: "final_rank",
    header: "Rank",
    cell: ({ row }) => {
      const rank = row.original.final_rank
      if (rank === 1) return <Badge variant="default">1st</Badge>
      if (rank === 2) return <Badge variant="secondary">2nd</Badge>
      if (rank === 3) return <Badge variant="secondary">3rd</Badge>
      return <span className="text-muted-foreground">{rank}</span>
    },
  },
  {
    accessorKey: "player_display_name",
    header: "Player",
    cell: ({ row }) => {
      const { player_slug, player_display_name } = row.original
      return player_slug ? (
        <Link
          to={"/quizzer/$slug" as any}
          params={{ slug: player_slug } as any}
          className="font-medium hover:underline"
        >
          {player_display_name}
        </Link>
      ) : (
        <span className="font-medium">{player_display_name}</span>
      )
    },
  },
  {
    accessorKey: "score",
    header: "Score",
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.score}</span>
    ),
  },
]

export function EventResultsTable({ data }: { data: EventResultWithPlayer[] }) {
  return <DataTable columns={columns} data={data} />
}
