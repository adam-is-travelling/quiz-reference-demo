import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Suspense } from "react"

import { CompetitionsService } from "@/client"
import { CompetitionPodium } from "@/components/Competitions/CompetitionPodium"

function getCompetitionQueryOptions(id: string) {
  return {
    queryFn: () => CompetitionsService.readCompetition({ id }),
    queryKey: ["competitions", id],
  }
}

function getCompetitionPodiumQueryOptions(id: string) {
  return {
    queryFn: () => CompetitionsService.readCompetitionPodium({ id }),
    queryKey: ["competitions", id, "podium"],
  }
}

export const Route = createFileRoute("/_public/competitions_/$id")({
  component: CompetitionDetailPage,
})

function CompetitionDetail({ id }: { id: string }) {
  const { data: competition } = useSuspenseQuery(getCompetitionQueryOptions(id))
  const { data: podium } = useSuspenseQuery(
    getCompetitionPodiumQueryOptions(id),
  )

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {competition.name}
        </h1>
        {competition.description && (
          <p className="text-muted-foreground">{competition.description}</p>
        )}
        {competition.organization_id && competition.organization_name && (
          <p className="text-sm text-muted-foreground mt-1">
            Organised by{" "}
            <Link
              to="/organizations/$id"
              params={{ id: competition.organization_id }}
              className="hover:underline text-foreground"
            >
              {competition.organization_name}
            </Link>
          </p>
        )}
      </div>
      <CompetitionPodium podium={podium} />
    </div>
  )
}

function CompetitionDetailPage() {
  const { id } = Route.useParams()
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
      <CompetitionDetail id={id} />
    </Suspense>
  )
}
