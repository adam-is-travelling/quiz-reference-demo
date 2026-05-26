import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { CalendarDays } from "lucide-react"
import { Suspense } from "react"

import { EventsService } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { eventColumns } from "@/components/Events/columns"

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

function EventsContent() {
  const { data: events } = useSuspenseQuery(getEventsQueryOptions())

  if (events.data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-16">
        <div className="rounded-full bg-muted p-4 mb-4">
          <CalendarDays className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">No events yet</h3>
        <p className="text-muted-foreground">
          Published results will appear here.
        </p>
      </div>
    )
  }

  return <DataTable columns={eventColumns} data={events.data} />
}

function EventsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Events</h1>
        <p className="text-muted-foreground">
          Browse published quiz competition results
        </p>
      </div>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <EventsContent />
      </Suspense>
    </div>
  )
}
