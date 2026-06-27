import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Suspense } from "react"

import { QuizzesService, SeriesService } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { eventColumns } from "@/components/Events/columns"

function getSeriesQueryOptions(id: string) {
  return {
    queryFn: () => SeriesService.readSeriesItem({ id }),
    queryKey: ["series", id],
  }
}

function getSeriesQuizzesQueryOptions(seriesId: string) {
  return {
    queryFn: () =>
      QuizzesService.readQuizzes({ seriesId, skip: 0, limit: 100 }),
    queryKey: ["quizzes", { seriesId }],
  }
}

export const Route = createFileRoute("/_public/series_/$id")({
  component: SeriesDetailPage,
})

function SeriesDetail({ id }: { id: string }) {
  const { data: series } = useSuspenseQuery(getSeriesQueryOptions(id))
  const { data: events } = useSuspenseQuery(getSeriesQuizzesQueryOptions(id))

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
      <div>
        <h2 className="text-lg font-semibold mb-4">Events</h2>
        {events.data.length === 0 ? (
          <p className="text-muted-foreground">No events published yet.</p>
        ) : (
          <DataTable columns={eventColumns} data={events.data} />
        )}
      </div>
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
