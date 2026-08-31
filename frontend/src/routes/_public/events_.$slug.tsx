import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Suspense } from "react"

import { EventsService } from "@/client"
import { CompetitionPodium } from "@/components/Competitions/CompetitionPodium"
import { AttachQuizDialog } from "@/components/Events/AttachQuizDialog"
import { EventLocation } from "@/components/Events/EventLocation"
import useAuth from "@/hooks/useAuth"
import { formatDateRange } from "@/lib/dates"

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

function EventDetail({ slug }: { slug: string }) {
  const { data: event } = useSuspenseQuery(getEventQueryOptions(slug))
  const { data: podium } = useSuspenseQuery(getEventPodiumQueryOptions(slug))
  const { user } = useAuth()

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-bold tracking-tight">{event.name}</h1>
          {user?.is_superuser && <AttachQuizDialog event={event} />}
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          <EventLocation
            event={{ ...event, is_online: Boolean(event.is_online) }}
          />
          {" · "}
          {formatDateRange(event.start_date, event.end_date)}
        </p>
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
      <CompetitionPodium podium={podium} />
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
