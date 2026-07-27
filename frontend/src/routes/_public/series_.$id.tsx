import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Suspense } from "react"

import { SeriesService } from "@/client"
import { SeriesPodium } from "@/components/Series/SeriesPodium"

function getSeriesQueryOptions(id: string) {
  return {
    queryFn: () => SeriesService.readSeriesItem({ id }),
    queryKey: ["series", id],
  }
}

function getSeriesPodiumQueryOptions(id: string) {
  return {
    queryFn: () => SeriesService.readSeriesPodium({ id }),
    queryKey: ["series", id, "podium"],
  }
}

export const Route = createFileRoute("/_public/series_/$id")({
  component: SeriesDetailPage,
})

function SeriesDetail({ id }: { id: string }) {
  const { data: series } = useSuspenseQuery(getSeriesQueryOptions(id))
  const { data: podium } = useSuspenseQuery(getSeriesPodiumQueryOptions(id))

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{series.name}</h1>
        {series.description && (
          <p className="text-muted-foreground">{series.description}</p>
        )}
        {series.organization_id && series.organization_name && (
          <p className="text-sm text-muted-foreground mt-1">
            Organised by{" "}
            <Link
              to="/organizations/$id"
              params={{ id: series.organization_id }}
              className="hover:underline text-foreground"
            >
              {series.organization_name}
            </Link>
          </p>
        )}
      </div>
      <SeriesPodium podium={podium} />
    </div>
  )
}

function SeriesDetailPage() {
  const { id } = Route.useParams()
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
      <SeriesDetail id={id} />
    </Suspense>
  )
}
