import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute, Link, redirect } from "@tanstack/react-router"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { Suspense } from "react"
import type { EventPublic } from "@/client"
import { EventsService } from "@/client"
import { EventDialog } from "@/components/Admin/EventDialog"
import { EventLocation } from "@/components/Events/EventLocation"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import useCustomToast from "@/hooks/useCustomToast"
import { formatDateRange } from "@/lib/dates"

export const Route = createFileRoute("/_layout/admin_/events")({
  component: AdminEvents,
  beforeLoad: async () => {
    const { UsersService } = await import("@/client")
    const user = await UsersService.readUserMe()
    if (!user.is_superuser) {
      throw redirect({ to: "/" })
    }
  },
  head: () => ({
    meta: [{ title: "Events - Admin" }],
  }),
})

function EventRow({ event }: { event: EventPublic }) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const deleteMutation = useMutation({
    mutationFn: () => EventsService.deleteEvent({ id: event.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] })
      showSuccessToast("Event deleted")
    },
    onError: () => showErrorToast("Failed to delete event"),
  })

  return (
    <tr className="border-b">
      <td className="py-3 px-4 font-medium">
        <Link
          to="/events/$slug"
          params={{ slug: event.slug }}
          className="hover:underline"
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
        {event.organization_name ?? "—"}
      </td>
      <td className="py-3 px-4 text-muted-foreground">
        {event.quiz_count ?? 0}
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <EventDialog
            event={event}
            trigger={
              <Button variant="outline" size="sm">
                <Pencil className="h-3 w-3" />
              </Button>
            }
          />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete event?</AlertDialogTitle>
                <AlertDialogDescription>
                  Deleting "{event.name}" will remove it. Its quizzes will be
                  kept but will no longer be attached to any event.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deleteMutation.mutate()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </td>
    </tr>
  )
}

function EventTableContent() {
  const { data } = useSuspenseQuery({
    queryKey: ["events"],
    queryFn: () => EventsService.readEvents({ skip: 0, limit: 100 }),
  })

  if (data.data.length === 0) {
    return (
      <p className="text-muted-foreground text-sm py-4">
        No events yet. Create one to get started.
      </p>
    )
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
            <th className="py-3 px-4" />
          </tr>
        </thead>
        <tbody>
          {data.data.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AdminEvents() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Events</h1>
          <p className="text-muted-foreground">
            Manage gatherings that group quizzes together.
          </p>
        </div>
        <EventDialog
          trigger={
            <Button>
              <Plus className="h-4 w-4 mr-1" />
              New Event
            </Button>
          }
        />
      </div>

      <Suspense
        fallback={
          <div className="animate-pulse h-40 w-full rounded bg-muted" />
        }
      >
        <EventTableContent />
      </Suspense>
    </div>
  )
}
