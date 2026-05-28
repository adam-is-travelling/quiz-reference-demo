import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Users } from "lucide-react"
import { Suspense } from "react"

import { PlayersService } from "@/client"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { countryName } from "@/lib/countries"

function getPlayersQueryOptions() {
  return {
    queryFn: () => PlayersService.listPlayers({ skip: 0, limit: 200 }),
    queryKey: ["players"],
  }
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

export const Route = createFileRoute("/_public/quizzers")({
  component: QuizzersPage,
  head: () => ({ meta: [{ title: "Quizzers" }] }),
})

function QuizzersContent() {
  const { data: players } = useSuspenseQuery(getPlayersQueryOptions())

  if (players.data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-16">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Users className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">No quizzers yet</h3>
      </div>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {players.data.map((player) => {
        const cardContent = (
          <>
            <Avatar className="h-9 w-9">
              {player.photo_url && <AvatarImage src={player.photo_url} />}
              <AvatarFallback className="text-xs">
                {getInitials(player.display_name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="font-medium text-sm truncate">
                {player.display_name}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {[countryName(player.country), player.club].filter(Boolean).join(" · ")}
              </p>
            </div>
          </>
        )

        const className =
          "flex items-center gap-3 p-3 rounded-lg border hover:border-foreground/20 transition-colors"

        return player.slug ? (
          <Link
            key={player.id}
            to="/quizzer/$slug"
            params={{ slug: player.slug }}
            className={className}
          >
            {cardContent}
          </Link>
        ) : (
          <div key={player.id} className={className}>
            {cardContent}
          </div>
        )
      })}
    </div>
  )
}

function QuizzersPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Quizzers</h1>
        <p className="text-muted-foreground">
          Player profiles and competition history
        </p>
      </div>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <QuizzersContent />
      </Suspense>
    </div>
  )
}
