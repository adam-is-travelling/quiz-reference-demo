import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Suspense } from "react"

import { EventsService, SeriesService } from "@/client"
import { CompetitionPodium } from "@/components/Competitions/CompetitionPodium"
import { EventLocation } from "@/components/Events/EventLocation"
import { SeriesMatrix } from "@/components/Events/SeriesMatrix"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { buildSeriesMatrix } from "@/lib/seriesMatrix"

export const Route = createFileRoute("/_public/events_/recurring/$slug")({
  component: EventSeriesPage,
  errorComponent: NotFound,
})

function NotFound() {
  return <p className="text-muted-foreground">Recurring event not found.</p>
}

function EventSeriesDetail({ slug }: { slug: string }) {
  const { data: series } = useSuspenseQuery({
    queryKey: ["series", slug],
    queryFn: () => SeriesService.readSeries({ id: slug }),
  })
  const { data: editions } = useSuspenseQuery({
    queryKey: ["events", "series", series.id],
    queryFn: () =>
      EventsService.readEvents({ seriesId: series.id, skip: 0, limit: 100 }),
  })
  const { data: podium } = useSuspenseQuery({
    queryKey: ["series", slug, "podium"],
    queryFn: () => SeriesService.readSeriesPodium({ id: slug }),
  })

  if (series.type !== "event") return <NotFound />

  const ordered = [...editions.data].sort((a, b) =>
    a.start_date.localeCompare(b.start_date),
  )
  const matrix = buildSeriesMatrix(editions.data, podium.quizzes)

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{series.name}</h1>
        {series.description && (
          <p className="text-muted-foreground">{series.description}</p>
        )}
        {series.organization_slug && series.organization_name && (
          <p className="text-sm text-muted-foreground mt-1">
            Organised by{" "}
            <Link
              to="/organizations/$slug"
              params={{ slug: series.organization_slug }}
              className="hover:underline text-foreground"
            >
              {series.organization_name}
            </Link>
          </p>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4">Editions</h2>
        {ordered.length === 0 ? (
          <p className="text-muted-foreground">No editions yet.</p>
        ) : (
          <div
            className="rounded-md border overflow-x-auto"
            data-testid="series-editions"
          >
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Year</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">Quizzes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ordered.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="tabular-nums">
                      {event.start_date.slice(0, 4)}
                    </TableCell>
                    <TableCell>
                      <Link
                        to="/events/$slug"
                        params={{ slug: event.slug }}
                        className="font-medium hover:underline"
                      >
                        {event.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <EventLocation
                        event={{
                          ...event,
                          is_online: Boolean(event.is_online),
                        }}
                      />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {event.quiz_count}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4">Held here</h2>
        <SeriesMatrix matrix={matrix} />
      </div>

      <div data-testid="podium-standings">
        <h2 className="text-lg font-semibold mb-4">Podium standings</h2>
        <CompetitionPodium podium={podium} standingsOnly />
      </div>
    </div>
  )
}

function EventSeriesPage() {
  const { slug } = Route.useParams()
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
      <EventSeriesDetail slug={slug} />
    </Suspense>
  )
}
