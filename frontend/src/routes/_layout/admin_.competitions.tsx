import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { Suspense } from "react"
import type { CompetitionPublic } from "@/client"
import { CompetitionsService } from "@/client"
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

function CompetitionRow({ competition }: { competition: CompetitionPublic }) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const deleteMutation = useMutation({
    mutationFn: () =>
      CompetitionsService.deleteCompetition({ id: competition.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["competitions"] })
      showSuccessToast("Competition deleted")
    },
    onError: () => showErrorToast("Failed to delete competition"),
  })

  return (
    <tr className="border-b">
      <td className="py-3 px-4 font-medium">{competition.name}</td>
      <td className="py-3 px-4 text-muted-foreground">
        {competition.description ?? "—"}
      </td>
      <td className="py-3 px-4 text-muted-foreground">
        {competition.organization_name ?? "—"}
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <CompetitionDialog
            competition={competition}
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

function CompetitionTableContent() {
  const { data } = useSuspenseQuery({
    queryKey: ["competitions"],
    queryFn: () =>
      CompetitionsService.readCompetitions({ skip: 0, limit: 100 }),
  })

  if (data.data.length === 0) {
    return (
      <p className="text-muted-foreground text-sm py-4">
        No competitions yet. Create one to get started.
      </p>
    )
  }

  return (
    <div className="rounded-md border">
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
          {data.data.map((competition) => (
            <CompetitionRow key={competition.id} competition={competition} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AdminCompetitions() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Competitions</h1>
          <p className="text-muted-foreground">
            Manage quiz competitions and tournaments.
          </p>
        </div>
        <CompetitionDialog
          trigger={
            <Button>
              <Plus className="h-4 w-4 mr-1" />
              New Competition
            </Button>
          }
        />
      </div>

      <Suspense
        fallback={
          <div className="animate-pulse h-40 w-full rounded bg-muted" />
        }
      >
        <CompetitionTableContent />
      </Suspense>
    </div>
  )
}
