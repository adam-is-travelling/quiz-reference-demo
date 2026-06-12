import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Trash2 } from "lucide-react"
import { Suspense, useState } from "react"
import type { QuizPublic } from "@/client"
import { QuizzesService } from "@/client"
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

function getQuizQueryOptions(id: string) {
  return {
    queryFn: () => QuizzesService.readQuiz({ id }),
    queryKey: ["quizzes", id],
  }
}

function getQuizResultsQueryOptions(id: string) {
  return {
    queryFn: () => QuizzesService.readQuizResultsWithPlayers({ id }),
    queryKey: ["quizzes", id, "results"],
  }
}

export const Route = createFileRoute("/_public/quizzes_/$id")({
  component: QuizDetailPage,
  head: () => ({ meta: [{ title: "Quiz" }] }),
})

function AdminControls({ quiz }: { quiz: QuizPublic }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const deleteMutation = useMutation({
    mutationFn: () => QuizzesService.deleteQuiz({ id: quiz.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quizzes"] })
      showSuccessToast("Quiz deleted")
      navigate({ to: "/quizzes" })
    },
    onError: () => showErrorToast("Failed to delete quiz"),
  })

  return (
    <div className="flex gap-2">
      <MetadataEditDialog event={quiz} />
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
            <DialogTitle>Delete quiz?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete the quiz and all its results. This
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

function QuizMeta({ id }: { id: string }) {
  const { data: quiz } = useSuspenseQuery(getQuizQueryOptions(id))
  const { user } = useAuth()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{quiz.name}</h1>
          <p className="text-muted-foreground">
            {quiz.start_date === quiz.end_date
              ? quiz.start_date
              : `${quiz.start_date} – ${quiz.end_date}`}
            {quiz.organizer_name && ` · Organised by ${quiz.organizer_name}`}
          </p>
        </div>
        {user?.is_superuser && <AdminControls quiz={quiz} />}
      </div>
      {quiz.description && (
        <p className="text-sm text-muted-foreground">{quiz.description}</p>
      )}
      {quiz.format?.name && (
        <p className="text-sm text-muted-foreground">{quiz.format.name}</p>
      )}
    </div>
  )
}

function QuizResults({ id }: { id: string }) {
  const { data } = useSuspenseQuery(getQuizResultsQueryOptions(id))
  const { data: quiz } = useSuspenseQuery(getQuizQueryOptions(id))

  if (data.data.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center">
        No results published yet.
      </p>
    )
  }

  return <EventResultsTable data={data.data} format={quiz.format} />
}

function QuizDetailPage() {
  const { id } = Route.useParams()

  return (
    <div className="flex flex-col gap-8">
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <QuizMeta id={id} />
      </Suspense>
      <div>
        <h2 className="text-lg font-semibold mb-4">Results</h2>
        <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
          <QuizResults id={id} />
        </Suspense>
      </div>
    </div>
  )
}
