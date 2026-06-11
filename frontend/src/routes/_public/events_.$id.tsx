import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Trash2 } from "lucide-react"
import { Suspense, useState } from "react"
import type { QuizEventPublic } from "@/client"
import { EventsService } from "@/client"
import { EventResultsTable } from "@/components/Events/EventResultsTable"
import { MetadataEditDialog } from "@/components/Events/MetadataEditDialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"

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

function AdminControls({ event }: { event: QuizEventPublic }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const deleteMutation = useMutation({
    mutationFn: () => EventsService.deleteEvent({ id: event.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] })
      showSuccessToast("Event deleted")
      navigate({ to: "/events" })
    },
    onError: () => showErrorToast("Failed to delete event"),
  })

  return (
    <div className="flex gap-2">
      <MetadataEditDialog event={event} />
      <Button
        variant="destructive"
        size="sm"
        onClick={() => setConfirmOpen(true)}
      >
        <Trash2 className="h-4 w-4 mr-1" />
        Delete
      </Button>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete event?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete the event and all its results. This
            cannot be undone.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function EventMeta({ id }: { id: string }) {
  const { data: event } = useSuspenseQuery(getEventQueryOptions(id))
  const { user } = useAuth()
  const fmt = event.format as {
    questions?: number
    rounds?: number
    categories?: string[]
  } | null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{event.name}</h1>
          <p className="text-muted-foreground">
            {event.start_date === event.end_date
              ? event.start_date
              : `${event.start_date} – ${event.end_date}`}
            {event.organizer_name && ` · Organised by ${event.organizer_name}`}
          </p>
        </div>
        {user?.is_superuser && <AdminControls event={event} />}
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
