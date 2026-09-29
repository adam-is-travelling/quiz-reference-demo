import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Fragment, Suspense } from "react"

import type { EventPublic } from "@/client"
import { EventsService } from "@/client"
import { EventLocation } from "@/components/Events/EventLocation"
import { formatDateRange } from "@/lib/dates"
import { groupEventsBySeries } from "@/lib/groupEventsBySeries"

function getEventsQueryOptions() {
  return {
    queryFn: () => EventsService.readEvents({ skip: 0, limit: 100 }),
    queryKey: ["events"],
  }
}

export const Route = createFileRoute("/_public/events")({
  component: EventsPage,
  head: () => ({ meta: [{ title: "Events" }] }),
})

function EventRow({
  event,
  indent = false,
}: {
  event: EventPublic
  indent?: boolean
}) {
  return (
    <tr className="border-b hover:bg-muted/50 transition-colors">
      <td className={indent ? "py-3 px-4 pl-8" : "py-3 px-4"}>
        <Link
          to="/events/$slug"
          params={{ slug: event.slug }}
          className="font-medium hover:underline"
        >
          {event.name}
        </Link>
      </td>
      <td className="py-3 px-4 text-muted-foreground">
        {formatDateRange(event.start_date, event.end_date)}
      </td>
      <td className="py-3 px-4 text-muted-foreground">
        <EventLocation
          event={{ ...event, is_online: Boolean(event.is_online) }}
        />
      </td>
      <td className="py-3 px-4 text-muted-foreground">
        {event.organization_slug ? (
          <Link
            to="/organizations/$slug"
            params={{ slug: event.organization_slug }}
            className="hover:underline"
          >
            {event.organization_name}
          </Link>
        ) : (
          (event.organization_name ?? "—")
        )}
      </td>
      <td className="py-3 px-4 text-muted-foreground">{event.quiz_count}</td>
    </tr>
  )
}

function EventListContent() {
  const { data } = useSuspenseQuery(getEventsQueryOptions())

  if (data.data.length === 0) {
    return <p className="text-muted-foreground py-4">No events yet.</p>
  }

  return (
    <div className="rounded-md border">
      <table className="w-full">
        <thead className="bg-muted">
          <tr>
            <th className="py-3 px-4 text-left text-sm font-medium">Name</th>
            <th className="py-3 px-4 text-left text-sm font-medium">Dates</th>
            <th className="py-3 px-4 text-left text-sm font-medium">
              Location
            </th>
            <th className="py-3 px-4 text-left text-sm font-medium">
              Organization
            </th>
            <th className="py-3 px-4 text-left text-sm font-medium">Quizzes</th>
          </tr>
        </thead>
        <tbody>
          {groupEventsBySeries(data.data).map((item) =>
            item.kind === "event" ? (
              <EventRow key={item.event.id} event={item.event} />
            ) : (
              <Fragment key={item.seriesId}>
                <tr className="border-b bg-muted/40">
                  <td colSpan={5} className="py-2 px-4 text-sm font-semibold">
                    <Link
                      to="/events/recurring/$slug"
                      params={{ slug: item.seriesSlug }}
                      className="hover:underline"
                    >
                      {item.seriesName}
                    </Link>
                  </td>
                </tr>
                {item.events.map((event) => (
                  <EventRow key={event.id} event={event} indent />
                ))}
              </Fragment>
            ),
          )}
        </tbody>
      </table>
    </div>
  )
}

function EventsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Events</h1>
        <p className="text-muted-foreground">
          Public events that consist of multiple competitions and other quizzes.
          Usually these take place in person, but can be run online as well
        </p>
      </div>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <EventListContent />
      </Suspense>
    </div>
  )
}
