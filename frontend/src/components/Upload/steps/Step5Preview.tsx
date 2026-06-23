import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"

import { QuizzesService } from "@/client"
import { Button } from "@/components/ui/button"
import useCustomToast from "@/hooks/useCustomToast"
import { Labels } from "@/test-ids"
import type { WizardState } from "../types"

interface Props {
  state: WizardState
  update: (patch: Partial<WizardState>) => void
}

function buildEventMeta(meta: WizardState["eventMeta"]) {
  return {
    name: meta.name,
    start_date: meta.start_date,
    end_date: meta.end_date,
    organizer_name: meta.organizer_name || undefined,
    description: meta.description || undefined,
    series_id: meta.series_id || undefined,
    organization_id: meta.organization_id || undefined,
    format_id: meta.format_id || undefined,
  }
}

export function Step5Preview({ state, update }: Props) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const parseRows = state.parsedRows.slice(1).map((row) => ({
    player_name: row[state.columnMapping.player_name] ?? "",
    country: row[state.columnMapping.country] ?? "",
    score: parseFloat(row[state.columnMapping.score] || "0"),
  }))

  const submitMutation = useMutation({
    mutationFn: async () => {
      const results = state.resolutions.map((r, i) => {
        const row = state.parsedRows[i + 1]
        const roundScores = state.columnMapping.rounds.map((colIdx) =>
          colIdx !== null && row ? parseFloat(row[colIdx] || "0") : null,
        )
        const hasRoundData =
          state.selectedFormat && roundScores.some((s) => s !== null)
        const posStr =
          state.columnMapping.position !== null && row
            ? row[state.columnMapping.position]
            : null
        const parsed = posStr !== null ? parseInt(posStr, 10) : Number.NaN
        const final_rank = !Number.isNaN(parsed) && parsed >= 1 ? parsed : i + 1
        return {
          player_id: r.player_id ?? undefined,
          player_create: r.player_create ?? undefined,
          final_rank,
          score: parseRows[i]?.score ?? 0,
          round_scores: hasRoundData ? roundScores : undefined,
        }
      })

      if (state.eventMode === "existing") {
        await QuizzesService.submitResults({
          id: state.existingEventId!,
          requestBody: { results, mode: state.submitMode },
        })
      } else {
        const quiz = await QuizzesService.createQuiz({
          requestBody: buildEventMeta(state.eventMeta),
        })
        await QuizzesService.submitResults({
          id: quiz.id,
          requestBody: { results, mode: "replace" },
        })
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quizzes"] })
      showSuccessToast("Results submitted for review.")
      navigate({ to: "/" })
    },
    onError: () => {
      showErrorToast("Submission failed. Please try again.")
    },
  })

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      <div className="rounded-lg border p-4 flex flex-col gap-2 text-sm">
        {state.eventMode === "existing" ? (
          <p>
            <span className="font-medium">Event:</span>{" "}
            {state.existingEventName}
          </p>
        ) : (
          <>
            <p>
              <span className="font-medium">Event:</span> {state.eventMeta.name}
            </p>
            <p>
              <span className="font-medium">Dates:</span>{" "}
              {state.eventMeta.start_date} – {state.eventMeta.end_date}
            </p>
            <p>
              <span className="font-medium">Organiser:</span>{" "}
              {state.eventMeta.organizer_name}
            </p>
          </>
        )}
        <p>
          <span className="font-medium">Results:</span>{" "}
          {state.resolutions.length} entries
        </p>
        <p className="text-muted-foreground">
          {state.resolutions.filter((r) => r.player_create).length} new players
          will be created.
        </p>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted">
            <tr>
              <th className="px-3 py-2 text-left">Pos</th>
              <th className="px-3 py-2 text-left">Player</th>
              <th className="px-3 py-2 text-left">Score</th>
            </tr>
          </thead>
          <tbody>
            {state.resolutions.map((r, i) => {
              const row = parseRows[i]
              const rawRow = state.parsedRows[i + 1]
              const posStr =
                state.columnMapping.position !== null && rawRow
                  ? rawRow[state.columnMapping.position]
                  : null
              const parsedPos =
                posStr !== null ? parseInt(posStr, 10) : Number.NaN
              const pos = String(
                !Number.isNaN(parsedPos) && parsedPos >= 1 ? parsedPos : i + 1,
              )
              const name =
                r.player_create?.display_name ??
                parseRows[i]?.player_name ??
                "—"
              return (
                <tr key={i} className="border-t">
                  <td className="px-3 py-1.5 tabular-nums">{pos}</td>
                  <td className="px-3 py-1.5">
                    {name}
                    {r.player_create && (
                      <span className="ml-1 text-muted-foreground">(new)</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums">{row?.score}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {state.eventMode === "existing" && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">Submit mode</p>
          <div
            className="flex rounded-md border overflow-hidden self-start"
            data-testid={Labels.submitModeToggle}
          >
            {(["append", "replace"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => update({ submitMode: m })}
                className={`px-4 py-1.5 text-sm capitalize ${
                  state.submitMode === m
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {state.submitMode === "append"
              ? "New results will be added alongside existing ones."
              : "Existing results will be cleared before uploading."}
          </p>
        </div>
      )}

      <div className="flex gap-3">
        <Button variant="outline" onClick={() => update({ step: 4 })}>
          ← Back
        </Button>
        <Button
          onClick={() => submitMutation.mutate()}
          disabled={submitMutation.isPending}
        >
          {submitMutation.isPending ? "Submitting…" : "Submit for review"}
        </Button>
      </div>
    </div>
  )
}
