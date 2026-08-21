import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Suspense } from "react"

import { EventsService } from "@/client"
import { EventLocation } from "@/components/Events/EventLocation"
import { formatDateRange } from "@/lib/dates"

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
          {data.data.map((event) => (
            <tr
              key={event.id}
              className="border-b hover:bg-muted/50 transition-colors"
            >
              <td className="py-3 px-4">
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
              <td className="py-3 px-4 text-muted-foreground">
                {event.quiz_count}
              </td>
            </tr>
          ))}
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
        <p className="text-muted-foreground">Quiz events and gatherings</p>
      </div>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <EventListContent />
      </Suspense>
    </div>
  )
}
