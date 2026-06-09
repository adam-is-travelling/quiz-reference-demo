import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import {
  createFileRoute,
  Link as RouterLink,
  redirect,
} from "@tanstack/react-router"
import { Pencil, Trash2 } from "lucide-react"
import { Suspense, useState } from "react"
import type { EventResultWithPlayer } from "@/client"
import { EventsService } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MetadataEditDialog } from "@/components/Events/MetadataEditDialog"
import useCustomToast from "@/hooks/useCustomToast"
import { Labels } from "@/test-ids"

export const Route = createFileRoute("/_layout/admin_/events_/$id")({
  component: AdminEventDetail,
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

function ResultRow({
  result,
  eventId,
}: {
  result: EventResultWithPlayer
  eventId: string
}) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [editing, setEditing] = useState(false)
  const [score, setScore] = useState(String(result.score))

  const updateMutation = useMutation({
    mutationFn: () =>
      EventsService.updateEventResult({
        eventId,
        resultId: result.id,
        requestBody: {
          score: Number(score),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin", "event", eventId, "results"],
      })
      showSuccessToast("Result updated")
      setEditing(false)
    },
    onError: () => showErrorToast("Failed to update result"),
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      EventsService.deleteEventResult({ id: eventId, resultId: result.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin", "event", eventId, "results"],
      })
      showSuccessToast("Result removed")
    },
    onError: () => showErrorToast("Failed to remove result"),
  })

  return (
    <tr className="border-b">
      <td className="py-3 px-4">{result.final_rank ?? "—"}</td>
      <td className="py-3 px-4">
        {result.player_slug ? (
          <RouterLink
            to="/quizzer/$slug"
            params={{ slug: result.player_slug }}
            className="hover:underline"
          >
            {result.player_display_name}
          </RouterLink>
        ) : (
          result.player_display_name
        )}
      </td>
      <td className="py-3 px-4">
        {editing ? (
          <Input
            type="number"
            step="0.01"
            value={score}
            onChange={(e) => setScore(e.target.value)}
            className="w-24"
          />
        ) : (
          result.score
        )}
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <Button
                size="sm"
                onClick={() => updateMutation.mutate()}
                disabled={updateMutation.isPending}
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setScore(String(result.score))
                  setEditing(false)
                }}
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing(true)}
              >
                <Pencil className="h-3 w-3" />
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                data-testid={Labels.resultDeleteButton}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </>
          )}
        </div>
      </td>
    </tr>
  )
}

function ResultsTable({ eventId }: { eventId: string }) {
  const { data } = useSuspenseQuery({
    queryKey: ["admin", "event", eventId, "results"],
    queryFn: () => EventsService.readEventResultsWithPlayers({ id: eventId }),
  })

  if (data.data.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No results submitted.</p>
    )
  }

  return (
    <div className="rounded-md border">
      <table className="w-full">
        <thead className="bg-muted">
          <tr>
            <th className="py-3 px-4 text-left text-sm font-medium">Rank</th>
            <th className="py-3 px-4 text-left text-sm font-medium">Player</th>
            <th className="py-3 px-4 text-left text-sm font-medium">Score</th>
            <th className="py-3 px-4" />
          </tr>
        </thead>
        <tbody>
          {data.data.map((result) => (
            <ResultRow key={result.id} result={result} eventId={eventId} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EventDetailContent({ id }: { id: string }) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const { data: event } = useSuspenseQuery({
    queryKey: ["admin", "event", id],
    queryFn: () => EventsService.readEvent({ id }),
  })

  const approveMutation = useMutation({
    mutationFn: () => EventsService.approveEvent({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "event", id] })
      queryClient.invalidateQueries({ queryKey: ["admin", "events"] })
      queryClient.invalidateQueries({ queryKey: ["events"] })
      showSuccessToast("Event approved and published")
    },
    onError: () => showErrorToast("Approval failed"),
  })

  const dateRange =
    event.start_date === event.end_date
      ? event.start_date
      : `${event.start_date} – ${event.end_date}`

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold tracking-tight">{event.name}</h1>
            <Badge
              variant={event.status === "pending" ? "destructive" : "default"}
            >
              {event.status}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            {dateRange} · {event.organizer_name}
          </p>
        </div>
        <div className="flex gap-2">
          {event.status === "pending" && (
            <Button
              onClick={() => approveMutation.mutate()}
              disabled={approveMutation.isPending}
            >
              {approveMutation.isPending ? "Approving…" : "Approve"}
            </Button>
          )}
          <MetadataEditDialog event={event} />
        </div>
      </div>

      {event.description && (
        <p className="text-sm text-muted-foreground">{event.description}</p>
      )}

      <section>
        <h2 className="text-lg font-semibold mb-3">Results</h2>
        <Suspense
          fallback={
            <div className="animate-pulse h-40 w-full rounded bg-muted" />
          }
        >
          <ResultsTable eventId={id} />
        </Suspense>
      </section>
    </div>
  )
}

function AdminEventDetail() {
  const { id } = Route.useParams()

  return (
    <Suspense
      fallback={<div className="animate-pulse h-64 w-full rounded bg-muted" />}
    >
      <EventDetailContent id={id} />
    </Suspense>
  )
}
