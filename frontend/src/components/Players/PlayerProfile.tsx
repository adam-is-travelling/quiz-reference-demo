import { Link } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"

import type { PlayerHistory, PlayerPublic } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { countryName } from "@/lib/countries"

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

const historyColumns: ColumnDef<PlayerHistory["data"][number]>[] = [
  {
    accessorKey: "event_name",
    header: "Event",
    cell: ({ row }) => (
      <Link
        to="/events/$id"
        params={{ id: row.original.event_id }}
        className="font-medium hover:underline"
      >
        {row.original.event_name}
      </Link>
    ),
  },
  {
    accessorKey: "start_date",
    header: "Date",
    cell: ({ row }) => row.original.start_date,
  },
  {
    accessorKey: "score",
    header: "Score",
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.score}</span>
    ),
  },
  {
    accessorKey: "final_rank",
    header: "Rank",
    cell: ({ row }) => {
      const rank = row.original.final_rank
      if (!rank) return <span className="text-muted-foreground">—</span>
      if (rank === 1) return <Badge>1st</Badge>
      if (rank === 2) return <Badge variant="secondary">2nd</Badge>
      if (rank === 3) return <Badge variant="secondary">3rd</Badge>
      return <span className="text-muted-foreground">{rank}</span>
    },
  },
]

interface PlayerProfileProps {
  player: PlayerPublic
  history: PlayerHistory
}

export function PlayerProfile({ player, history }: PlayerProfileProps) {
  const wins = history.data.filter((h) => h.final_rank === 1).length
  const podiums = history.data.filter(
    (h) =>
      h.final_rank !== null && h.final_rank !== undefined && h.final_rank <= 3,
  ).length
  const totalEvents = history.data.length

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start gap-5">
        <Avatar className="h-20 w-20">
          {player.photo_url && <AvatarImage src={player.photo_url} />}
          <AvatarFallback className="text-2xl">
            {getInitials(player.display_name)}
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">
            {player.display_name}
          </h1>
          <p className="text-muted-foreground">
            {[countryName(player.country), player.city, player.club]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {player.bio && (
            <p className="text-sm text-muted-foreground mt-1">{player.bio}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Events", value: totalEvents },
          { label: "Wins", value: wins },
          { label: "Podiums", value: podiums },
        ].map(({ label, value }) => (
          <Card key={label}>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold tabular-nums">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4">Competition History</h2>
        {history.data.length === 0 ? (
          <p className="text-muted-foreground">No results yet.</p>
        ) : (
          <DataTable columns={historyColumns} data={history.data} />
        )}
      </div>
    </div>
  )
}
