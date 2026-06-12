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
import { Suspense } from "react"
import type { QuizPublic, QuizStatus } from "@/client"
import { QuizzesService } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import useCustomToast from "@/hooks/useCustomToast"
import { Labels } from "@/test-ids"

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

  const rejectMutation = useMutation({
    mutationFn: () => QuizzesService.rejectQuiz({ id: quiz.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "quizzes"] })
      showSuccessToast("Quiz rejected")
    },
    onError: () => showErrorToast("Failed to reject quiz"),
  })

  const dateRange =
    quiz.start_date === quiz.end_date
      ? quiz.start_date
      : `${quiz.start_date} – ${quiz.end_date}`

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
        </div>
      </td>
    </tr>
  )
}

function QuizzesTableContent({ status }: { status?: QuizStatus }) {
  const { data } = useSuspenseQuery({
    queryKey: ["admin", "quizzes", status ?? "all"],
    queryFn: () => QuizzesService.readQuizzes({ status, skip: 0, limit: 100 }),
  })
  const quizzes = data.data

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
    <div className="rounded-md border">
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
