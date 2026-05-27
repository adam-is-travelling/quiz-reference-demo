import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link as RouterLink, redirect } from "@tanstack/react-router"
import { Suspense } from "react"

import { EventsService } from "@/client"
import type { EventStatus, QuizEventPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export const Route = createFileRoute("/_layout/admin/events")({
  component: AdminEvents,
  beforeLoad: async () => {
    const { UsersService } = await import("@/client")
    const user = await UsersService.readUserMe()
    if (!user.is_superuser) {
      throw redirect({ to: "/" })
    }
  },
  head: () => ({
    meta: [{ title: "Event Review - Admin" }],
  }),
})

function EventRow({ event }: { event: QuizEventPublic }) {
  const dateRange =
    event.start_date === event.end_date
      ? event.start_date
      : `${event.start_date} – ${event.end_date}`

  return (
    <tr className="border-b">
      <td className="py-3 px-4 font-medium">
        <RouterLink
          to="/admin/events/$id"
          params={{ id: event.id }}
          className="hover:underline"
        >
          {event.name}
        </RouterLink>
      </td>
      <td className="py-3 px-4">{dateRange}</td>
      <td className="py-3 px-4">{event.organizer_name}</td>
      <td className="py-3 px-4">
        <Badge variant={event.status === "pending" ? "destructive" : "default"}>
          {event.status}
        </Badge>
      </td>
      <td className="py-3 px-4">
        <Button variant="outline" size="sm" asChild>
          <RouterLink to="/admin/events/$id" params={{ id: event.id }}>
            Review
          </RouterLink>
        </Button>
      </td>
    </tr>
  )
}

function EventsTableContent({ status }: { status?: EventStatus }) {
  const { data } = useSuspenseQuery({
    queryKey: ["admin", "events", status ?? "all"],
    queryFn: () => EventsService.readEvents({ status, skip: 0, limit: 100 }),
  })
  const events = data.data

  if (events.length === 0) {
    return (
      <p className="text-muted-foreground text-sm py-4">
        {status === "pending" ? "No events pending review." : "No events yet."}
      </p>
    )
  }

  return (
    <div className="rounded-md border">
      <table className="w-full">
        <thead className="bg-muted">
          <tr>
            <th className="py-3 px-4 text-left text-sm font-medium">Name</th>
            <th className="py-3 px-4 text-left text-sm font-medium">Date</th>
            <th className="py-3 px-4 text-left text-sm font-medium">Organizer</th>
            <th className="py-3 px-4 text-left text-sm font-medium">Status</th>
            <th className="py-3 px-4" />
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AdminEvents() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Event Review</h1>
        <p className="text-muted-foreground">
          Approve submitted events and manage results.
        </p>
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-3">Pending Review</h2>
        <Suspense fallback={<div className="animate-pulse h-24 w-full rounded bg-muted" />}>
          <EventsTableContent status="pending" />
        </Suspense>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">All Events</h2>
        <Suspense fallback={<div className="animate-pulse h-24 w-full rounded bg-muted" />}>
          <EventsTableContent />
        </Suspense>
      </section>
    </div>
  )
}
