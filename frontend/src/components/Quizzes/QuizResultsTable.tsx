import type { ColumnDef } from "@tanstack/react-table"
import { useMemo } from "react"

import type { QuizFormatPublic, QuizResultWithPlayer } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { PlayerLinks } from "@/components/Common/PlayerLinks"
import { SquadCell } from "@/components/Quizzes/SquadCell"
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

/**
 * Which columns this quiz needs. Derived from the rows, but passed in as
 * booleans rather than the rows themselves so the built columns keep their
 * identity across a refetch that changes neither. That matters: react-table
 * renders a function cell as a component, so a new column identity remounts
 * every cell — which would close an open squad panel, or discard a
 * half-typed search, every time a save invalidated the results query.
 */
type ColumnShape = { hasTeams: boolean; hasPairs: boolean }

function buildColumns(
  { hasTeams, hasPairs }: ColumnShape,
  format?: QuizFormatPublic | null,
  lineup: LineupEditing = {},
): ColumnDef<QuizResultWithPlayer>[] {
  const rounds = format?.rounds ?? []

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
    // Only a team row collapses: a squad belongs to a team, and an individual
    // or pairs quiz keeps exactly the read-only cell it had. SquadCell owns
    // the peek, the panel and the admin editor, so this stays a one-liner.
    cell: ({ row }) =>
      row.original.team_name ? (
        <SquadCell
          result={row.original}
          quizId={quizId}
          quizSlug={quizSlug}
          canEdit={canEditLineups}
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
  // Only which columns exist depends on the rows, so derive that first and
  // keep it out of the memo below. A save invalidates the results query and
  // hands back a new `data` array on every edit; if the columns depended on
  // it they would be rebuilt each time, remounting every cell and closing the
  // very panel the admin was editing in.
  const hasTeams = data.some((row) => Boolean(row.team_name))
  // Only consulted when there are no teams, so pin it to false when there
  // are. Otherwise adding a squad's second member would flip it, rebuild the
  // columns and remount the cell — closing the panel the admin is editing in.
  // Participant counts cannot change this way in an individual or pairs quiz.
  const hasPairs =
    !hasTeams && data.some((row) => (row.participants?.length ?? 0) > 1)

  // Memoized because react-table's flexRender treats a function cell as a
  // component: a fresh closure identity each render remounts the cell's
  // subtree, discarding the squad panel's open state and half-typed search.
  const columns = useMemo(
    () =>
      buildColumns({ hasTeams, hasPairs }, format, {
        quizId,
        quizSlug,
        canEditLineups,
      }),
    [hasTeams, hasPairs, format, quizId, quizSlug, canEditLineups],
  )
  return (
    <div className="overflow-x-auto">
      <DataTable columns={columns} data={data} initialSorting={RANK_SORT} />
    </div>
  )
}
