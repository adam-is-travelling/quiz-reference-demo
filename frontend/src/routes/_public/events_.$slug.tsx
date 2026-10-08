import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Suspense } from "react"

import type { EventPublic } from "@/client"
import { EventsService } from "@/client"
import { SeriesNav } from "@/components/Common/SeriesNav"
import { CompetitionPodium } from "@/components/Competitions/CompetitionPodium"
import { AttachQuizDialog } from "@/components/Events/AttachQuizDialog"
import { EventLocation } from "@/components/Events/EventLocation"
import { RemoveQuizButton } from "@/components/Events/RemoveQuizButton"
import useAuth from "@/hooks/useAuth"
import { formatDateRange } from "@/lib/dates"
import { findNeighbours } from "@/lib/seriesNeighbours"

function getEventQueryOptions(slug: string) {
  return {
    queryFn: () => EventsService.readEvent({ id: slug }),
    queryKey: ["events", slug],
  }
}

function getEventPodiumQueryOptions(slug: string) {
  return {
    queryFn: () => EventsService.readEventPodium({ id: slug }),
    queryKey: ["events", slug, "podium"],
  }
}

export const Route = createFileRoute("/_public/events_/$slug")({
  component: EventDetailPage,
})

function EventSeriesNav({ event }: { event: EventPublic }) {
  const seriesId = event.series_id
  const { data: editions } = useQuery({
    queryKey: ["events", "series", seriesId],
    queryFn: () =>
      EventsService.readEvents({ seriesId: seriesId!, skip: 0, limit: 100 }),
    enabled: Boolean(seriesId),
  })
  if (!event.series_slug || !event.series_name) return null
  const { previous, next } = findNeighbours(editions?.data ?? [], event.id)
  return (
    <SeriesNav
      series={{ name: event.series_name, slug: event.series_slug }}
      seriesTo="/events/recurring/$slug"
      itemTo="/events/$slug"
      previous={previous}
      next={next}
    />
  )
}

function EventDetail({ slug }: { slug: string }) {
  const { data: event } = useSuspenseQuery(getEventQueryOptions(slug))
  const { data: podium } = useSuspenseQuery(getEventPodiumQueryOptions(slug))
  const { user } = useAuth()

  return (
    <div className="flex flex-col gap-6">
      <div>
        {/* On a phone the admin button takes its own row above the title
            rather than squeezing it; beside it from md up. */}
        <div className="flex flex-col-reverse gap-3 md:flex-row md:items-start md:justify-between md:gap-4">
          <h1 className="text-2xl font-bold tracking-tight">{event.name}</h1>
          {user?.is_superuser && (
            <div className="self-end md:self-auto">
              <AttachQuizDialog event={event} />
            </div>
          )}
        </div>
        {/* Each part is an inline-block, so on a narrow screen the line
            wraps between parts rather than inside the date range. */}
        <p className="text-sm text-muted-foreground mt-1">
          <span className="inline-block">
            <EventLocation
              event={{ ...event, is_online: Boolean(event.is_online) }}
            />
          </span>
          {" · "}
          <span className="inline-block">
            {formatDateRange(event.start_date, event.end_date)}
          </span>
        </p>
        <EventSeriesNav event={event} />
        {event.description && (
          <p className="text-muted-foreground">{event.description}</p>
        )}
        {event.organization_slug && event.organization_name && (
          <p className="text-sm text-muted-foreground mt-1">
            Organised by{" "}
            <Link
              to="/organizations/$slug"
              params={{ slug: event.organization_slug }}
              className="hover:underline text-foreground"
            >
              {event.organization_name}
            </Link>
          </p>
        )}
      </div>
      <CompetitionPodium
        podium={podium}
        quizActions={
          user?.is_superuser
            ? (quiz) => <RemoveQuizButton event={event} quiz={quiz} />
            : undefined
        }
      />
    </div>
  )
}

function EventDetailPage() {
  const { slug } = Route.useParams()
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
      <EventDetail slug={slug} />
    </Suspense>
  )
}
