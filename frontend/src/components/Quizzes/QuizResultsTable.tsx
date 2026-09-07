import type { ColumnDef } from "@tanstack/react-table"
import { useMemo } from "react"

import type { QuizFormatPublic, QuizResultWithPlayer } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { PlayerLinks } from "@/components/Common/PlayerLinks"
import { TeamLineupEditor } from "@/components/Quizzes/TeamLineupEditor"
import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { countryName, teamLabel } from "@/lib/countries"

/**
 * Where the squad column is allowed to offer inline editing. Absent (or with
 * `canEditLineups` false) the column stays read-only, which is what every
 * signed-out or non-superuser visitor gets.
 */
interface LineupEditing {
  quizId?: string
  quizSlug?: string
  canEditLineups?: boolean
}

function buildColumns(
  data: QuizResultWithPlayer[],
  format?: QuizFormatPublic | null,
  lineup: LineupEditing = {},
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

  const { quizId, quizSlug, canEditLineups } = lineup

  const playerColumn: ColumnDef<QuizResultWithPlayer> = {
    id: "player_display_name",
    accessorFn: (row) => row.participants?.[0]?.player_display_name ?? "",
    header: hasTeams ? "Squad" : hasPairs ? "Players" : "Player",
    // Only a team row gets the editor: a squad belongs to a team, and an
    // individual or pairs quiz keeps exactly the read-only cell it had.
    cell: ({ row }) =>
      canEditLineups && quizId && quizSlug && row.original.team_name ? (
        <TeamLineupEditor
          quizSlug={quizSlug}
          quizId={quizId}
          result={row.original}
        />
      ) : (row.original.participants ?? []).length > 0 ? (
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
  quizId,
  quizSlug,
  canEditLineups = false,
}: {
  data: QuizResultWithPlayer[]
  format?: QuizFormatPublic | null
  quizId?: string
  quizSlug?: string
  canEditLineups?: boolean
}) {
  // Memoized because react-table's flexRender treats a function cell as a
  // component: a fresh closure identity each render remounts the cell's
  // subtree, which would throw away the lineup editor's half-typed search and
  // in-flight state — including when a refetch is triggered by another row.
  const columns = useMemo(
    () => buildColumns(data, format, { quizId, quizSlug, canEditLineups }),
    [data, format, quizId, quizSlug, canEditLineups],
  )
  return (
    <div className="overflow-x-auto">
      <DataTable columns={columns} data={data} initialSorting={RANK_SORT} />
    </div>
  )
}
