import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Suspense } from "react"

import { EventsService } from "@/client"
import { EventResultsTable } from "@/components/Events/EventResultsTable"

function getEventQueryOptions(id: string) {
  return {
    queryFn: () => EventsService.readEvent({ id }),
    queryKey: ["events", id],
  }
}

function getEventResultsQueryOptions(id: string) {
  return {
    queryFn: () => EventsService.readEventResultsWithPlayers({ id }),
    queryKey: ["events", id, "results"],
  }
}

export const Route = createFileRoute("/_public/events_/$id")({
  component: EventDetailPage,
  head: () => ({ meta: [{ title: "Event" }] }),
})

function EventMeta({ id }: { id: string }) {
  const { data: event } = useSuspenseQuery(getEventQueryOptions(id))
  const fmt = event.format as {
    questions?: number
    rounds?: number
    categories?: string[]
  } | null

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{event.name}</h1>
        <p className="text-muted-foreground">
          {event.start_date === event.end_date
            ? event.start_date
            : `${event.start_date} – ${event.end_date}`}
          {" · "}
          Organised by {event.organizer_name}
        </p>
      </div>
      {event.description && (
        <p className="text-sm text-muted-foreground">{event.description}</p>
      )}
      {fmt && (
        <div className="flex gap-4 text-sm text-muted-foreground">
          {fmt.rounds && <span>{fmt.rounds} rounds</span>}
          {fmt.questions && <span>{fmt.questions} questions</span>}
          {fmt.categories?.length ? (
            <span>{fmt.categories.join(", ")}</span>
          ) : null}
        </div>
      )}
    </div>
  )
}

function EventResults({ id }: { id: string }) {
  const { data } = useSuspenseQuery(getEventResultsQueryOptions(id))

  if (data.data.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center">
        No results published yet.
      </p>
    )
  }

  return <EventResultsTable data={data.data} />
}

function EventDetailPage() {
  const { id } = Route.useParams()

  return (
    <div className="flex flex-col gap-8">
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <EventMeta id={id} />
      </Suspense>
      <div>
        <h2 className="text-lg font-semibold mb-4">Results</h2>
        <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
          <EventResults id={id} />
        </Suspense>
      </div>
    </div>
  )
}
