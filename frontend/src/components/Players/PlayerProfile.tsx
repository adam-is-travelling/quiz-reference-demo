import { Link } from "@tanstack/react-router"

import type { PlayerHistoryGrouped, PlayerPublic } from "@/client"
import { CountryLink } from "@/components/Common/CountryLink"
import { DataTable } from "@/components/Common/DataTable"
import { historyColumns } from "@/components/Players/historyColumns"
import { PlayerFinishes } from "@/components/Players/PlayerFinishes"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { countryName } from "@/lib/countries"
import { playerSummary } from "@/lib/playerSummary"

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

interface PlayerProfileProps {
  player: PlayerPublic
  history: PlayerHistoryGrouped
}

export function PlayerProfile({ player, history }: PlayerProfileProps) {
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
          {player.countries && player.countries.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {player.countries.map((code, i) => (
                <CountryLink key={code} code={code} className="">
                  <Badge variant={i === 0 ? "default" : "secondary"}>
                    {countryName(code)}
                  </Badge>
                </CountryLink>
              ))}
            </div>
          )}
          <p className="text-muted-foreground">
            {[player.city, player.club].filter(Boolean).join(" · ")}
          </p>
          {player.bio && (
            <p className="text-sm text-muted-foreground mt-1">{player.bio}</p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <p className="text-lg" data-testid="player-summary">
          {playerSummary(
            history.total_quizzes,
            history.first_year,
            history.last_year,
          )}
        </p>

        <PlayerFinishes
          first={history.wins}
          second={history.second_places}
          third={history.third_places}
        />
      </div>

      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Competition History</h2>
          {history.total_quizzes > 0 && (
            <Link
              to="/players/$slug/all-quizzes"
              params={{ slug: player.slug ?? "" }}
              search={{ page: 1 }}
              className="text-sm font-medium text-primary hover:underline"
            >
              See all results →
            </Link>
          )}
        </div>
        {history.data.length === 0 ? (
          <p className="text-muted-foreground">No results yet.</p>
        ) : (
          history.data.map((group) => (
            <div
              key={group.competition_id ?? "none"}
              className="flex flex-col gap-3"
            >
              <h3 className="text-base font-medium">
                {group.competition_name ?? "Other"}
              </h3>
              <DataTable columns={historyColumns} data={group.results} />
              {group.total_count > 5 && (
                <Link
                  to="/players/$slug/competitions/$competitionSlug"
                  params={{
                    slug: player.slug ?? "",
                    competitionSlug: group.competition_slug ?? "__none__",
                  }}
                  search={{ page: 1 }}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  See all {group.total_count} results →
                </Link>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
