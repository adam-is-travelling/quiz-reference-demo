import { Link } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"

import type { EventResultWithPlayer, QuizFormatPublic } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

function buildColumns(
  format?: QuizFormatPublic | null,
): ColumnDef<EventResultWithPlayer>[] {
  const rounds = format?.rounds ?? []

  const base: ColumnDef<EventResultWithPlayer>[] = [
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
      header: format ? "Total" : "Score",
      cell: ({ row }) => (
        <span className="tabular-nums">{row.original.score}</span>
      ),
    },
  ]

  if (rounds.length > 0) {
    rounds.forEach((roundName, i) => {
      base.push({
        id: `round_${i}`,
        accessorFn: (row) => row.round_scores?.[i] ?? null,
        header: () => (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="block max-w-[4rem] truncate cursor-default">
                {roundName}
              </span>
            </TooltipTrigger>
            <TooltipContent>{roundName}</TooltipContent>
          </Tooltip>
        ),
        cell: ({ row }) => {
          const val = row.original.round_scores?.[i]
          return <span className="tabular-nums">{val != null ? val : "—"}</span>
        },
        sortUndefined: "last",
      })
    })
  }

  return base
}

export function EventResultsTable({
  data,
  format,
}: {
  data: EventResultWithPlayer[]
  format?: QuizFormatPublic | null
}) {
  const columns = buildColumns(format)
  return (
    <div className="overflow-x-auto">
      <DataTable columns={columns} data={data} />
    </div>
  )
}
