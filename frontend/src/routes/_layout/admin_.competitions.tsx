import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute, Link, redirect } from "@tanstack/react-router"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { Suspense } from "react"
import type { RecurringSeriesPublic } from "@/client"
import { SeriesService } from "@/client"
import { CompetitionDialog } from "@/components/Admin/CompetitionDialog"
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
import { competitionListQueryKey } from "@/lib/seriesMatrix"
import { Labels } from "@/test-ids"

export const Route = createFileRoute("/_layout/admin_/competitions")({
  component: AdminCompetitions,
  beforeLoad: async () => {
    const { UsersService } = await import("@/client")
    const user = await UsersService.readUserMe()
    if (!user.is_superuser) {
      throw redirect({ to: "/" })
    }
  },
  head: () => ({
    meta: [{ title: "Competitions - Admin" }],
  }),
})

function CompetitionRow({
  competition,
}: {
  competition: RecurringSeriesPublic
}) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const deleteMutation = useMutation({
    mutationFn: () => SeriesService.deleteSeries({ id: competition.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["competitions"] })
      showSuccessToast("Competition deleted")
    },
    onError: () => showErrorToast("Failed to delete competition"),
  })

  return (
    <tr className="border-b">
      <td className="py-3 px-4 font-medium">
        {competition.type === "event" ? (
          <Link
            to="/events/recurring/$slug"
            params={{ slug: competition.slug }}
            className="hover:underline"
          >
            {competition.name}
          </Link>
        ) : (
          <Link
            to="/competitions/$slug"
            params={{ slug: competition.slug }}
            className="hover:underline"
          >
            {competition.name}
          </Link>
        )}
      </td>
      <td className="py-3 px-4 text-muted-foreground">
        {competition.description ?? "—"}
      </td>
      <td className="py-3 px-4 text-muted-foreground">
        {competition.organization_name ?? "—"}
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          {competition.type === "quiz" && (
            <Button variant="outline" size="sm" asChild>
              <Link
                to="/upload"
                search={{ competition: competition.slug }}
                title="Upload a result in this competition"
                aria-label={`Upload a result in ${competition.name}`}
              >
                <Plus className="h-3 w-3" />
              </Link>
            </Button>
          )}
          <CompetitionDialog
            competition={competition}
            trigger={
              <Button
                variant="outline"
                size="sm"
                aria-label={`Edit ${competition.name}`}
              >
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
                aria-label={`Delete ${competition.name}`}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete competition?</AlertDialogTitle>
                <AlertDialogDescription>
                  Deleting "{competition.name}" will remove it from any
                  associated quizzes. This cannot be undone.
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

const SECTIONS = {
  quiz: {
    heading: "Quiz competitions",
    newLabel: "New Quiz Competition",
    empty: "No quiz competitions yet.",
    testId: Labels.adminQuizCompetitionsTable,
  },
  event: {
    heading: "Recurring events",
    newLabel: "New Recurring Event",
    empty: "No recurring events yet.",
    testId: Labels.adminRecurringEventsTable,
  },
} as const

function CompetitionTable({ type }: { type: "quiz" | "event" }) {
  // One list of every type, split here, so both tables share a cache entry.
  const { data } = useSuspenseQuery({
    queryKey: competitionListQueryKey(),
    queryFn: () => SeriesService.readSeriesList({ skip: 0, limit: 100 }),
  })
  const rows = data.data.filter((competition) => competition.type === type)

  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground text-sm py-4">
        {SECTIONS[type].empty}
      </p>
    )
  }

  return (
    <div className="rounded-md border" data-testid={SECTIONS[type].testId}>
      <table className="w-full">
        <thead className="bg-muted">
          <tr>
            <th className="py-3 px-4 text-left text-sm font-medium">Name</th>
            <th className="py-3 px-4 text-left text-sm font-medium">
              Description
            </th>
            <th className="py-3 px-4 text-left text-sm font-medium">
              Organization
            </th>
            <th className="py-3 px-4" />
          </tr>
        </thead>
        <tbody>
          {rows.map((competition) => (
            <CompetitionRow key={competition.id} competition={competition} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CompetitionSection({ type }: { type: "quiz" | "event" }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">{SECTIONS[type].heading}</h2>
        <CompetitionDialog
          defaultType={type}
          trigger={
            <Button>
              <Plus className="h-4 w-4 mr-1" />
              {SECTIONS[type].newLabel}
            </Button>
          }
        />
      </div>
      <Suspense
        fallback={
          <div className="animate-pulse h-40 w-full rounded bg-muted" />
        }
      >
        <CompetitionTable type={type} />
      </Suspense>
    </section>
  )
}

function AdminCompetitions() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Competitions</h1>
        <p className="text-muted-foreground">
          Manage quiz competitions and tournaments.
        </p>
      </div>
      <CompetitionSection type="quiz" />
      <CompetitionSection type="event" />
    </div>
  )
}
