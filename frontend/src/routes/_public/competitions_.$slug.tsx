import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Upload } from "lucide-react"
import { Suspense } from "react"

import { CompetitionsService } from "@/client"
import { CompetitionPodium } from "@/components/Competitions/CompetitionPodium"
import { Button } from "@/components/ui/button"
import useAuth from "@/hooks/useAuth"

function getCompetitionQueryOptions(slug: string) {
  return {
    queryFn: () => CompetitionsService.readCompetition({ id: slug }),
    queryKey: ["competitions", slug],
  }
}

function getCompetitionPodiumQueryOptions(slug: string) {
  return {
    queryFn: () => CompetitionsService.readCompetitionPodium({ id: slug }),
    queryKey: ["competitions", slug, "podium"],
  }
}

export const Route = createFileRoute("/_public/competitions_/$slug")({
  component: CompetitionDetailPage,
})

function CompetitionDetail({ slug }: { slug: string }) {
  const { data: competition } = useSuspenseQuery(
    getCompetitionQueryOptions(slug),
  )
  const { data: podium } = useSuspenseQuery(
    getCompetitionPodiumQueryOptions(slug),
  )
  const { user } = useAuth()
  const canUpload = Boolean(user?.is_superuser || user?.is_organizer)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {competition.name}
          </h1>
          {competition.description && (
            <p className="text-muted-foreground">{competition.description}</p>
          )}
          {competition.organization_slug && competition.organization_name && (
            <p className="text-sm text-muted-foreground mt-1">
              Organised by{" "}
              <Link
                to="/organizations/$slug"
                params={{ slug: competition.organization_slug }}
                className="hover:underline text-foreground"
              >
                {competition.organization_name}
              </Link>
            </p>
          )}
        </div>
        {canUpload && (
          <Button asChild>
            <Link to="/upload" search={{ competition: competition.slug }}>
              <Upload className="h-4 w-4 mr-1" />
              Upload result
            </Link>
          </Button>
        )}
      </div>
      <CompetitionPodium podium={podium} />
    </div>
  )
}

function CompetitionDetailPage() {
  const { slug } = Route.useParams()
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
      <CompetitionDetail slug={slug} />
    </Suspense>
  )
}
