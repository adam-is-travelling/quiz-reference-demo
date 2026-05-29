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
import { useForm } from "react-hook-form"
import type {
  EventResultWithPlayer,
  QuizEventPublic,
  QuizEventUpdate,
} from "@/client"
import { EventsService } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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

function MetadataEditDialog({ event }: { event: QuizEventPublic }) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [open, setOpen] = useState(false)
  const [isMultiDay, setIsMultiDay] = useState(
    event.start_date !== event.end_date,
  )
  const { register, handleSubmit, setValue, getValues } = useForm({
    defaultValues: {
      name: event.name,
      start_date: event.start_date,
      end_date: event.end_date,
      organizer_name: event.organizer_name,
      description: event.description ?? "",
    },
    shouldUnregister: true,
  })

  const mutation = useMutation({
    mutationFn: (data: QuizEventUpdate) =>
      EventsService.updateEvent({ id: event.id, requestBody: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "event", event.id] })
      queryClient.invalidateQueries({ queryKey: ["admin", "events"] })
      showSuccessToast("Event updated")
      setOpen(false)
    },
    onError: () => showErrorToast("Failed to update event"),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="h-4 w-4 mr-1" />
          Edit Metadata
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Event Metadata</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={handleSubmit((data) =>
            mutation.mutate({
              ...data,
              end_date: isMultiDay ? data.end_date : data.start_date,
            }),
          )}
          className="flex flex-col gap-4 pt-2"
        >
          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input {...register("name")} />
          </div>

          <div className="grid gap-1.5">
            <Label>{isMultiDay ? "Start Date" : "Date"}</Label>
            <Input type="date" {...register("start_date")} />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isMultiDay}
              onChange={(e) => {
                setIsMultiDay(e.target.checked)
                if (!e.target.checked) {
                  setValue("end_date", getValues("start_date"))
                }
              }}
            />
            Multi-day event
          </label>

          {isMultiDay && (
            <div className="grid gap-1.5">
              <Label>End Date</Label>
              <Input type="date" {...register("end_date")} />
            </div>
          )}

          <div className="grid gap-1.5">
            <Label>Organizer Name</Label>
            <Input {...register("organizer_name")} />
          </div>
          <div className="grid gap-1.5">
            <Label>Description</Label>
            <textarea
              {...register("description")}
              rows={3}
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

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
  const [tiebreaker, setTiebreaker] = useState(String(result.tiebreaker_rank))

  const updateMutation = useMutation({
    mutationFn: () =>
      EventsService.updateEventResult({
        eventId,
        resultId: result.id,
        requestBody: {
          score: Number(score),
          tiebreaker_rank: Number(tiebreaker),
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
        {editing ? (
          <Input
            type="number"
            value={tiebreaker}
            onChange={(e) => setTiebreaker(e.target.value)}
            className="w-20"
          />
        ) : (
          result.tiebreaker_rank
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
                  setTiebreaker(String(result.tiebreaker_rank))
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
            <th className="py-3 px-4 text-left text-sm font-medium">
              Tiebreaker
            </th>
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
