import type { ColumnDef } from "@tanstack/react-table"

import type { QuizFormatPublic, QuizResultWithPlayer } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { PlayerLinks } from "@/components/Common/PlayerLinks"
import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { countryName, teamLabel } from "@/lib/countries"

function buildColumns(
  data: QuizResultWithPlayer[],
  format?: QuizFormatPublic | null,
): ColumnDef<QuizResultWithPlayer>[] {
  const rounds = format?.rounds ?? []
  const hasTeams = data.some((row) => Boolean(row.team_name))
  const hasPairs = data.some((row) => (row.participants?.length ?? 0) > 1)

  const rankColumn: ColumnDef<QuizResultWithPlayer> = {
    accessorKey: "final_rank",
    header: "Rank",
    cell: ({ row }) => {
      const rank = row.original.final_rank
      if (rank === 1) return <Badge variant="default">1st</Badge>
      if (rank === 2) return <Badge variant="secondary">2nd</Badge>
      if (rank === 3) return <Badge variant="secondary">3rd</Badge>
      return <span className="text-muted-foreground">{rank}</span>
    },
  }

  const teamColumn: ColumnDef<QuizResultWithPlayer> = {
    id: "team",
    accessorFn: (row) => row.team_name ?? "",
    header: "Team",
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="font-medium">{row.original.team_name}</span>
        <span className="text-muted-foreground text-xs">
          {teamLabel(row.original)}
        </span>
      </div>
    ),
  }

  const playerColumn: ColumnDef<QuizResultWithPlayer> = {
    id: "player_display_name",
    accessorFn: (row) => row.participants?.[0]?.player_display_name ?? "",
    header: hasTeams ? "Squad" : hasPairs ? "Players" : "Player",
    cell: ({ row }) =>
      (row.original.participants ?? []).length > 0 ? (
        <PlayerLinks players={row.original.participants ?? []} />
      ) : (
        <span className="text-muted-foreground text-xs">No squad recorded</span>
      ),
  }

  const countryColumn: ColumnDef<QuizResultWithPlayer> = {
    id: "country",
    accessorFn: (row) =>
      (row.participants ?? []).map((p) => p.country ?? "").join(" / "),
    header: "Country",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {(row.original.participants ?? [])
          .map((p) => countryName(p.country) || "—")
          .join(" / ")}
      </span>
    ),
  }

  const scoreColumn: ColumnDef<QuizResultWithPlayer> = {
    accessorKey: "score",
    header: format ? "Total" : "Score",
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.score}</span>
    ),
  }

  const base: ColumnDef<QuizResultWithPlayer>[] = [
    rankColumn,
    playerColumn,
    scoreColumn,
  ]

  // A teams quiz names the team and its affiliation, so the per-participant
  // country column would only repeat it row by row; an individual or pairs
  // quiz keeps the country column exactly where it has always been.
  if (hasTeams) {
    base.splice(1, 0, teamColumn)
  } else {
    base.splice(2, 0, countryColumn)
  }

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

const RANK_SORT: [{ id: string; desc: boolean }] = [
  { id: "final_rank", desc: false },
]

export function QuizResultsTable({
  data,
  format,
}: {
  data: QuizResultWithPlayer[]
  format?: QuizFormatPublic | null
}) {
  const columns = buildColumns(data, format)
  return (
    <div className="overflow-x-auto">
      <DataTable columns={columns} data={data} initialSorting={RANK_SORT} />
    </div>
  )
}
