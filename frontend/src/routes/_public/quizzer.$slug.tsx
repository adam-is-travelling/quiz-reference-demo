import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Suspense } from "react"

import { PlayersService } from "@/client"
import { PlayerProfile } from "@/components/Players/PlayerProfile"

function getPlayerQueryOptions(slug: string) {
  return {
    queryFn: () => PlayersService.getPlayerBySlugRoute({ slug }),
    queryKey: ["players", "slug", slug],
  }
}

function getPlayerHistoryQueryOptions(playerId: string) {
  return {
    queryFn: () => PlayersService.getPlayerHistoryRoute({ playerId }),
    queryKey: ["players", playerId, "history"],
  }
}

export const Route = createFileRoute("/_public/quizzer/$slug")({
  component: QuizzerPage,
  head: () => ({ meta: [{ title: "Quizzer" }] }),
})

function QuizzerContent({ slug }: { slug: string }) {
  const { data: player } = useSuspenseQuery(getPlayerQueryOptions(slug))
  const { data: history } = useSuspenseQuery(
    getPlayerHistoryQueryOptions(player.id),
  )

  return <PlayerProfile player={player} history={history} />
}

function QuizzerPage() {
  const { slug } = Route.useParams()
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
      <QuizzerContent slug={slug} />
    </Suspense>
  )
}
