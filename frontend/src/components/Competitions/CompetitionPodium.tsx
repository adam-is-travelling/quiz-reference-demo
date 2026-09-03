import { Link } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"

import type {
  PodiumFinisher,
  PodiumPublic,
  PodiumStanding,
  QuizPodium,
} from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { PlayerLinks } from "@/components/Common/PlayerLinks"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" }

function PlayerName({
  slug,
  name,
}: {
  slug: string | null | undefined
  name: string
}) {
  return slug ? (
    <Link
      to={"/players/$slug" as any}
      params={{ slug } as any}
      className="hover:underline"
    >
      {name}
    </Link>
  ) : (
    <span>{name}</span>
  )
}

function FinisherCell({ finisher }: { finisher: PodiumFinisher | undefined }) {
  if (!finisher) return <span className="text-muted-foreground">—</span>
  return (
    <span className="whitespace-nowrap">
      {MEDALS[finisher.place]}{" "}
      <PlayerLinks players={finisher.participants ?? []} />
    </span>
  )
}

function placeColumn(place: number, header: string): ColumnDef<QuizPodium> {
  return {
    id: `place_${place}`,
    header,
    enableSorting: false,
    cell: ({ row }) => (
      <FinisherCell
        finisher={row.original.finishers.find((f) => f.place === place)}
      />
    ),
  }
}

function buildPodiumQuizColumns(
  quizActions?: (quiz: QuizPodium) => React.ReactNode,
): ColumnDef<QuizPodium>[] {
  const columns: ColumnDef<QuizPodium>[] = [
    {
      accessorKey: "quiz_name",
      header: "Quiz",
      cell: ({ row }) =>
        row.original.quiz_slug ? (
          <Link
            to="/quizzes/$slug"
            params={{ slug: row.original.quiz_slug }}
            className="font-medium hover:underline"
          >
            {row.original.quiz_name}
          </Link>
        ) : (
          <span className="font-medium">{row.original.quiz_name}</span>
        ),
    },
    {
      accessorKey: "start_date",
      header: "Date",
      cell: ({ row }) => {
        const { start_date, end_date } = row.original
        return start_date === end_date
          ? start_date
          : `${start_date} – ${end_date}`
      },
    },
    placeColumn(1, "1st"),
    placeColumn(2, "2nd"),
    placeColumn(3, "3rd"),
  ]
  if (quizActions) {
    columns.push({
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => quizActions(row.original),
    })
  }
  return columns
}

function PodiumStandingsTable({ standings }: { standings: PodiumStanding[] }) {
  if (standings.length === 0) {
    return <p className="text-muted-foreground">No podium results yet.</p>
  }
  return (
    <div className="rounded-md border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Player</TableHead>
            <TableHead className="text-right">🥇</TableHead>
            <TableHead className="text-right">🥈</TableHead>
            <TableHead className="text-right">🥉</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {standings.map((s) => (
            <TableRow key={s.player_id}>
              <TableCell className="font-medium">
                <PlayerName slug={s.player_slug} name={s.player_display_name} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {s.gold}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {s.silver}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {s.bronze}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function CompetitionPodium({
  podium,
  quizActions,
}: {
  podium: PodiumPublic
  /**
   * Optional per-row slot rendered in a trailing column of the Quizzes table.
   * Callers decide what goes in it (and who may see it); this component stays
   * generic and simply renders the node. Omitted -> no extra column at all.
   */
  quizActions?: (quiz: QuizPodium) => React.ReactNode
}) {
  const columns = buildPodiumQuizColumns(quizActions)
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-lg font-semibold mb-4">Quizzes</h2>
        {podium.quizzes.length === 0 ? (
          <p className="text-muted-foreground">No quizzes published yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <DataTable columns={columns} data={podium.quizzes} />
          </div>
        )}
      </div>
      <div data-testid="podium-standings">
        <h2 className="text-lg font-semibold mb-4">Podium standings</h2>
        <PodiumStandingsTable standings={podium.standings} />
      </div>
    </div>
  )
}
