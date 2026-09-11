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
import { MetadataEditDialog } from "@/components/Quizzes/MetadataEditDialog"
import { QuizResultsTable } from "@/components/Quizzes/QuizResultsTable"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"

function getQuizQueryOptions(slug: string) {
  return {
    queryFn: () => QuizzesService.readQuiz({ id: slug }),
    queryKey: ["quizzes", slug],
  }
}

function getQuizResultsQueryOptions(slug: string) {
  return {
    queryFn: () => QuizzesService.readQuizResultsWithPlayers({ id: slug }),
    queryKey: ["quizzes", slug, "results"],
  }
}

export const Route = createFileRoute("/_public/quizzes_/$slug")({
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
      <MetadataEditDialog
        quiz={quiz}
        onSlugChange={(newSlug) =>
          navigate({ to: "/quizzes/$slug", params: { slug: newSlug } })
        }
      />
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

function QuizMeta({ slug }: { slug: string }) {
  const { data: quiz } = useSuspenseQuery(getQuizQueryOptions(slug))
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

function QuizResults({ slug }: { slug: string }) {
  const { data } = useSuspenseQuery(getQuizResultsQueryOptions(slug))
  const { data: quiz } = useSuspenseQuery(getQuizQueryOptions(slug))
  // Same ["currentUser"] query QuizMeta reads for AdminControls, so this is a
  // cache hit rather than a second request.
  const { user } = useAuth()

  if (data.data.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center">
        No results published yet.
      </p>
    )
  }

  return (
    <QuizResultsTable
      data={data.data}
      format={quiz.format}
      quizId={quiz.id}
      // The route param, not quiz.slug: this is the value the results query
      // above is keyed by, so it is the key an edit must invalidate. The two
      // are the same string for every link in the app, but the route also
      // resolves a bare quiz id.
      quizSlug={slug}
      canEditLineups={Boolean(user?.is_superuser)}
    />
  )
}

function QuizDetailPage() {
  const { slug } = Route.useParams()

  return (
    <div className="flex flex-col gap-8">
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <QuizMeta slug={slug} />
      </Suspense>
      <div>
        <h2 className="text-lg font-semibold mb-4">Results</h2>
        <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
          <QuizResults slug={slug} />
        </Suspense>
      </div>
    </div>
  )
}
