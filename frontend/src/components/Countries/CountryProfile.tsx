import { Link } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import type { ReactNode } from "react"

import type {
  CountryPagePublic,
  CountryPlayer,
  CountryTeamAppearance,
  MedalCounts,
} from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { PlayerLinks } from "@/components/Common/PlayerLinks"
import { QualifierSuffix } from "@/components/Quizzes/QualifierSuffix"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDateRange } from "@/lib/dates"

const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" }

// Each medal keeps its count beside it, but the three may wrap onto separate
// lines — a half-width stat tile on a phone cannot fit all three at 2xl.
function MedalLine({ medals }: { medals: MedalCounts }) {
  return (
    <span className="inline-flex flex-wrap gap-x-3 tabular-nums">
      <span className="whitespace-nowrap">🥇 {medals.gold ?? 0}</span>
      <span className="whitespace-nowrap">🥈 {medals.silver ?? 0}</span>
      <span className="whitespace-nowrap">🥉 {medals.bronze ?? 0}</span>
    </span>
  )
}

function PlayerName({ player }: { player: CountryPlayer }) {
  if (!player.slug) return <span>{player.display_name}</span>
  return (
    <Link
      to={"/players/$slug" as any}
      params={{ slug: player.slug } as any}
      className="hover:underline"
    >
      {player.display_name}
    </Link>
  )
}

const nameColumn: ColumnDef<CountryPlayer> = {
  accessorKey: "display_name",
  header: "Player",
  cell: ({ row }) => <PlayerName player={row.original} />,
}

function countColumn(
  key: "gold" | "silver" | "bronze" | "quiz_count",
  header: string,
): ColumnDef<CountryPlayer> {
  return {
    accessorKey: key,
    header,
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original[key]}</span>
    ),
  }
}

const medalTableColumns: ColumnDef<CountryPlayer>[] = [
  nameColumn,
  countColumn("gold", "🥇"),
  countColumn("silver", "🥈"),
  countColumn("bronze", "🥉"),
]

const playerColumns: ColumnDef<CountryPlayer>[] = [
  nameColumn,
  countColumn("quiz_count", "Quizzes"),
  {
    id: "medals",
    header: "Medals",
    // Sortable as a single number with the same precedence as the server's
    // ordering: golds outrank any number of silvers, and so on.
    accessorFn: (p) =>
      (p.gold ?? 0) * 1_000_000 + (p.silver ?? 0) * 1_000 + (p.bronze ?? 0),
    cell: ({ row }) => (
      <MedalLine
        medals={{
          gold: row.original.gold,
          silver: row.original.silver,
          bronze: row.original.bronze,
        }}
      />
    ),
  },
]

function StatTile({
  id,
  label,
  children,
}: {
  id: string
  label: string
  children: ReactNode
}) {
  return (
    <Card data-testid={`country-stat-${id}`}>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold tabular-nums">{children}</p>
      </CardContent>
    </Card>
  )
}

function Place({ team }: { team: CountryTeamAppearance }) {
  const rank = team.final_rank
  if (rank == null) return <span className="text-muted-foreground">—</span>
  if (!team.is_qualifier && MEDALS[rank]) {
    return (
      <span>
        {MEDALS[rank]} {rank}
      </span>
    )
  }
  return <span className="tabular-nums">{rank}</span>
}

function NationalTeams({
  teams,
  medals,
}: {
  teams: CountryTeamAppearance[]
  medals: MedalCounts
}) {
  return (
    <section
      className="flex flex-col gap-3"
      data-testid="country-national-teams"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">National teams</h2>
        <MedalLine medals={medals} />
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Team</TableHead>
              <TableHead>Quiz</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Place</TableHead>
              <TableHead>Squad</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {teams.map((team) => (
              <TableRow key={team.result_id}>
                <TableCell className="font-medium">
                  {team.team_name ?? "—"}
                </TableCell>
                <TableCell>
                  {team.quiz_slug ? (
                    <Link
                      to={"/quizzes/$slug" as any}
                      params={{ slug: team.quiz_slug } as any}
                      className="hover:underline"
                    >
                      {team.quiz_name}
                    </Link>
                  ) : (
                    team.quiz_name
                  )}
                  {team.is_qualifier && <QualifierSuffix className="text-xs" />}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDateRange(team.start_date, team.end_date)}
                </TableCell>
                <TableCell>
                  <Place team={team} />
                </TableCell>
                <TableCell>
                  <PlayerLinks players={team.members ?? []} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

export function CountryProfile({ country }: { country: CountryPagePublic }) {
  const stats = country.stats
  const players = country.players ?? []
  const medalTable = country.medal_table ?? []
  const teams = country.national_teams ?? []
  const isEmpty = players.length === 0 && teams.length === 0

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-bold tracking-tight">{country.name}</h1>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile id="quizzers" label="Quizzers">
          {stats?.quizzer_count ?? 0}
        </StatTile>
        <StatTile id="competed" label="Competed">
          {stats?.competed_count ?? 0}
        </StatTile>
        <StatTile id="quizzes" label="Quizzes">
          {stats?.quiz_count ?? 0}
        </StatTile>
        <StatTile id="medals" label="Medals">
          <MedalLine medals={stats?.medals ?? {}} />
        </StatTile>
      </div>

      {isEmpty ? (
        <p className="text-muted-foreground">
          No quizzers have represented {country.name} yet.
        </p>
      ) : (
        <>
          {medalTable.length > 0 && (
            <section
              className="flex flex-col gap-3"
              data-testid="country-medal-table"
            >
              <h2 className="text-lg font-semibold">Medal table</h2>
              <DataTable columns={medalTableColumns} data={medalTable} />
            </section>
          )}

          {teams.length > 0 && (
            <NationalTeams
              teams={teams}
              medals={country.national_team_medals ?? {}}
            />
          )}

          {players.length > 0 && (
            <section
              className="flex flex-col gap-3"
              data-testid="country-players"
            >
              <h2 className="text-lg font-semibold">Players</h2>
              <DataTable columns={playerColumns} data={players} />
            </section>
          )}
        </>
      )}
    </div>
  )
}
