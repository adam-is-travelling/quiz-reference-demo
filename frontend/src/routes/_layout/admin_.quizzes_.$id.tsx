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
import type { QuizFormatPublic, QuizResultWithPlayer } from "@/client"
import { QuizzesService } from "@/client"
import { MetadataEditDialog } from "@/components/Events/MetadataEditDialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import useCustomToast from "@/hooks/useCustomToast"
import { Labels } from "@/test-ids"

export const Route = createFileRoute("/_layout/admin_/quizzes_/$id")({
  component: AdminQuizDetail,
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

function ResultRow({
  result,
  quizId,
  numRounds,
}: {
  result: QuizResultWithPlayer
  quizId: string
  numRounds: number
}) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [editing, setEditing] = useState(false)
  const [score, setScore] = useState(String(result.score))
  const [rank, setRank] = useState(String(result.final_rank ?? ""))

  const updateMutation = useMutation({
    mutationFn: () =>
      QuizzesService.updateQuizResult({
        quizId,
        resultId: result.id,
        requestBody: {
          score: Number(score),
          final_rank: rank !== "" ? Number(rank) : null,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin", "quiz", quizId, "results"],
      })
      showSuccessToast("Result updated")
      setEditing(false)
    },
    onError: () => showErrorToast("Failed to update result"),
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      QuizzesService.deleteQuizResult({ id: quizId, resultId: result.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin", "quiz", quizId, "results"],
      })
      showSuccessToast("Result removed")
    },
    onError: () => showErrorToast("Failed to remove result"),
  })

  return (
    <tr className="border-b">
      <td className="py-3 px-4">
        {editing ? (
          <Input
            type="number"
            value={rank}
            onChange={(e) => setRank(e.target.value)}
            className="w-20"
          />
        ) : (
          result.final_rank ?? "—"
        )}
      </td>
      <td className="py-3 px-4">
        {result.player_slug ? (
          <RouterLink
            to="/players/$slug"
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
      {Array.from({ length: numRounds }, (_, i) => (
        <td key={i} className="py-3 px-4 tabular-nums">
          {result.round_scores?.[i] != null ? result.round_scores[i] : "—"}
        </td>
      ))}
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
                  setRank(String(result.final_rank ?? ""))
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

function ResultsTable({
  quizId,
  format,
}: {
  quizId: string
  format?: QuizFormatPublic | null
}) {
  const { data } = useSuspenseQuery({
    queryKey: ["admin", "quiz", quizId, "results"],
    queryFn: () => QuizzesService.readQuizResultsWithPlayers({ id: quizId }),
  })

  const rounds = format?.rounds ?? []
  const numRounds = rounds.length

  if (data.data.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No results submitted.</p>
    )
  }

  return (
    <div className="rounded-md border overflow-x-auto">
      <table className="w-full">
        <thead className="bg-muted">
          <tr>
            <th className="py-3 px-4 text-left text-sm font-medium">Rank</th>
            <th className="py-3 px-4 text-left text-sm font-medium">Player</th>
            <th className="py-3 px-4 text-left text-sm font-medium">Score</th>
            {rounds.map((roundName, i) => (
              <th
                key={i}
                className="py-3 px-4 text-left text-sm font-medium max-w-[4rem]"
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="block truncate cursor-default">
                      {roundName}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{roundName}</TooltipContent>
                </Tooltip>
              </th>
            ))}
            <th className="py-3 px-4" />
          </tr>
        </thead>
        <tbody>
          {data.data.map((result) => (
            <ResultRow
              key={result.id}
              result={result}
              quizId={quizId}
              numRounds={numRounds}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function QuizDetailContent({ id }: { id: string }) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const { data: quiz } = useSuspenseQuery({
    queryKey: ["admin", "quiz", id],
    queryFn: () => QuizzesService.readQuiz({ id }),
  })

  const approveMutation = useMutation({
    mutationFn: () => QuizzesService.approveQuiz({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "quiz", id] })
      queryClient.invalidateQueries({ queryKey: ["admin", "quizzes"] })
      queryClient.invalidateQueries({ queryKey: ["quizzes"] })
      showSuccessToast("Quiz approved and published")
    },
    onError: () => showErrorToast("Approval failed"),
  })

  const rejectMutation = useMutation({
    mutationFn: () => QuizzesService.rejectQuiz({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "quiz", id] })
      queryClient.invalidateQueries({ queryKey: ["admin", "quizzes"] })
      showSuccessToast("Quiz rejected")
    },
    onError: () => showErrorToast("Failed to reject quiz"),
  })

  const setPendingMutation = useMutation({
    mutationFn: () => QuizzesService.setQuizPending({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "quiz", id] })
      queryClient.invalidateQueries({ queryKey: ["admin", "quizzes"] })
      showSuccessToast("Quiz returned to pending")
    },
    onError: () => showErrorToast("Failed to return quiz to pending"),
  })

  const dateRange =
    quiz.start_date === quiz.end_date
      ? quiz.start_date
      : `${quiz.start_date} – ${quiz.end_date}`

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold tracking-tight">{quiz.name}</h1>
            <Badge
              variant={
                quiz.status === "pending"
                  ? "destructive"
                  : quiz.status === "rejected"
                    ? "secondary"
                    : "default"
              }
            >
              {quiz.status}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            {dateRange}
            {quiz.organizer_name && ` · ${quiz.organizer_name}`}
          </p>
        </div>
        <div className="flex gap-2">
          {quiz.status === "pending" && (
            <>
              <Button
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending}
              >
                {approveMutation.isPending ? "Approving…" : "Approve"}
              </Button>
              <Button
                variant="destructive"
                onClick={() => rejectMutation.mutate()}
                disabled={rejectMutation.isPending}
              >
                {rejectMutation.isPending ? "Rejecting…" : "Reject"}
              </Button>
            </>
          )}
          {quiz.status === "rejected" && (
            <Button
              variant="outline"
              onClick={() => setPendingMutation.mutate()}
              disabled={setPendingMutation.isPending}
            >
              {setPendingMutation.isPending
                ? "Returning…"
                : "Return to Pending"}
            </Button>
          )}
          <MetadataEditDialog event={quiz} />
        </div>
      </div>

      {quiz.description && (
        <p className="text-sm text-muted-foreground">{quiz.description}</p>
      )}

      <section>
        <h2 className="text-lg font-semibold mb-3">Results</h2>
        <Suspense
          fallback={
            <div className="animate-pulse h-40 w-full rounded bg-muted" />
          }
        >
          <ResultsTable quizId={id} format={quiz.format} />
        </Suspense>
      </section>
    </div>
  )
}

function AdminQuizDetail() {
  const { id } = Route.useParams()

  return (
    <Suspense
      fallback={<div className="animate-pulse h-64 w-full rounded bg-muted" />}
    >
      <QuizDetailContent id={id} />
    </Suspense>
  )
}
