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
import { Trash2 } from "lucide-react"
import { Suspense, useEffect, useState } from "react"
import type { QuizPublic, QuizStatus } from "@/client"
import { QuizzesService } from "@/client"
import { TablePager } from "@/components/Common/TablePager"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import useCustomToast from "@/hooks/useCustomToast"
import { formatDateRange } from "@/lib/dates"
import { Labels } from "@/test-ids"

const PAGE_SIZE = 10

type SectionStatus = "pending" | "rejected" | "approved"

export const Route = createFileRoute("/_layout/admin_/quizzes")({
  component: AdminQuizzes,
  beforeLoad: async () => {
    const { UsersService } = await import("@/client")
    const user = await UsersService.readUserMe()
    if (!user.is_superuser) {
      throw redirect({ to: "/" })
    }
  },
  head: () => ({
    meta: [{ title: "Quiz Review - Admin" }],
  }),
})

function statusBadgeVariant(status: QuizStatus) {
  if (status === "pending") return "destructive"
  if (status === "rejected") return "secondary"
  return "default"
}

function QuizRow({ quiz }: { quiz: QuizPublic }) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const deleteMutation = useMutation({
    mutationFn: () => QuizzesService.deleteQuiz({ id: quiz.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "quizzes"] })
      setConfirmOpen(false)
      showSuccessToast("Quiz deleted")
    },
    onError: () => showErrorToast("Failed to delete quiz"),
  })

  const rejectMutation = useMutation({
    mutationFn: () => QuizzesService.rejectQuiz({ id: quiz.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "quizzes"] })
      showSuccessToast("Quiz rejected")
    },
    onError: () => showErrorToast("Failed to reject quiz"),
  })

  const dateRange = formatDateRange(quiz.start_date, quiz.end_date)

  return (
    <tr className="border-b">
      <td className="py-3 px-4 font-medium">
        <RouterLink
          to="/admin/quizzes/$id"
          params={{ id: quiz.id }}
          className="hover:underline"
        >
          {quiz.name}
        </RouterLink>
      </td>
      <td className="py-3 px-4">{dateRange}</td>
      <td className="py-3 px-4">{quiz.organizer_name ?? "—"}</td>
      <td className="py-3 px-4">
        <Badge variant={statusBadgeVariant(quiz.status)}>{quiz.status}</Badge>
      </td>
      <td className="py-3 px-4">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <RouterLink to="/admin/quizzes/$id" params={{ id: quiz.id }}>
              Review
            </RouterLink>
          </Button>
          {quiz.status === "pending" && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => rejectMutation.mutate()}
              disabled={rejectMutation.isPending}
            >
              {rejectMutation.isPending ? "Rejecting…" : "Reject"}
            </Button>
          )}
          {/* Deleting is offered only once a quiz has been rejected — an
              unreviewed or live quiz should not be one click from removal.
              The endpoint itself still accepts any quiz (superusers delete
              approved ones from the public quiz page). */}
          {quiz.status === "rejected" && (
            <Button
              variant="destructive"
              size="sm"
              data-testid={Labels.quizDeleteButton}
              aria-label={`Delete ${quiz.name}`}
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Delete
            </Button>
          )}
        </div>
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete quiz?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              This will permanently delete "{quiz.name}" and all its results.
              This cannot be undone.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                data-testid={Labels.quizDeleteConfirm}
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </td>
    </tr>
  )
}

function QuizzesTableContent({ status }: { status: SectionStatus }) {
  // Pending / Rejected / Approved render together, so each section keeps its
  // own page. Deliberately component state rather than a URL param: the
  // position is not worth sharing, and it keeps this route's URL clean.
  const [page, setPage] = useState(1)

  const { data } = useSuspenseQuery({
    queryKey: ["admin", "quizzes", status, page],
    queryFn: () =>
      QuizzesService.readQuizzes({
        status,
        skip: (page - 1) * PAGE_SIZE,
        limit: PAGE_SIZE,
      }),
  })
  const quizzes = data.data
  const pageCount = Math.max(1, Math.ceil(data.count / PAGE_SIZE))

  // Deleting the only row on the last page (or a quiz changing status) can
  // leave this section pointing past the end. Fall back to the last real page
  // rather than showing an empty table with no way forward.
  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount)
    }
  }, [page, pageCount])

  if (quizzes.length === 0) {
    return (
      <p className="text-muted-foreground text-sm py-4">
        {status === "pending"
          ? "No quizzes pending review."
          : status === "rejected"
            ? "No rejected quizzes."
            : "No quizzes yet."}
      </p>
    )
  }

  return (
    // Three identical tables share this page; the id lets tests address one.
    <div className="rounded-md border" data-testid={`quizzes-table-${status}`}>
      <table className="w-full">
        <thead className="bg-muted">
          <tr>
            <th className="py-3 px-4 text-left text-sm font-medium">Name</th>
            <th className="py-3 px-4 text-left text-sm font-medium">Date</th>
            <th className="py-3 px-4 text-left text-sm font-medium">
              Organizer
            </th>
            <th className="py-3 px-4 text-left text-sm font-medium">Status</th>
            <th className="py-3 px-4" />
          </tr>
        </thead>
        <tbody>
          {quizzes.map((quiz) => (
            <QuizRow key={quiz.id} quiz={quiz} />
          ))}
        </tbody>
      </table>
      {data.count > PAGE_SIZE && (
        <TablePager
          page={page}
          pageCount={pageCount}
          onPageChange={setPage}
          label={status}
        />
      )}
    </div>
  )
}

function AdminQuizzes() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1
          className="text-2xl font-bold tracking-tight"
          data-testid={Labels.adminQuizzesPageHeading}
        >
          Quiz Review
        </h1>
        <p className="text-muted-foreground">
          Approve submitted quizzes and manage results.
        </p>
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-3">Pending Review</h2>
        <Suspense
          fallback={
            <div className="animate-pulse h-24 w-full rounded bg-muted" />
          }
        >
          <QuizzesTableContent status="pending" />
        </Suspense>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Rejected</h2>
        <Suspense
          fallback={
            <div className="animate-pulse h-24 w-full rounded bg-muted" />
          }
        >
          <QuizzesTableContent status="rejected" />
        </Suspense>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Approved Quizzes</h2>
        <Suspense
          fallback={
            <div className="animate-pulse h-24 w-full rounded bg-muted" />
          }
        >
          <QuizzesTableContent status="approved" />
        </Suspense>
      </section>
    </div>
  )
}
