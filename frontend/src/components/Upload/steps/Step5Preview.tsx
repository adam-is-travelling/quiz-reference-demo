import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"

import { EventsService } from "@/client"
import { Button } from "@/components/ui/button"
import useCustomToast from "@/hooks/useCustomToast"
import { Labels } from "@/test-ids"
import type { WizardState } from "../types"

interface Props {
  state: WizardState
  update: (patch: Partial<WizardState>) => void
}

function buildEventMeta(meta: WizardState["eventMeta"]) {
  const format =
    meta.format_rounds || meta.format_questions
      ? {
          rounds: parseInt(meta.format_rounds || "0", 10),
          questions: parseInt(meta.format_questions || "0", 10),
          categories: meta.format_categories
            ? meta.format_categories.split(",").map((s) => s.trim()).filter(Boolean)
            : [],
        }
      : undefined

  return {
    name: meta.name,
    start_date: meta.start_date,
    end_date: meta.end_date,
    organizer_name: meta.organizer_name,
    description: meta.description || undefined,
    series_id: meta.series_id || undefined,
    organization_id: meta.organization_id || undefined,
    format,
  }
}

export function Step5Preview({ state, update }: Props) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const parseRows = state.parsedRows.slice(1).map((row) => ({
    player_name: row[state.columnMapping.player_name] ?? "",
    country: row[state.columnMapping.country] ?? "",
    score: parseFloat(row[state.columnMapping.score] ?? "0"),
    tiebreaker_rank: parseInt(row[state.columnMapping.tiebreaker_rank] ?? "1", 10),
  }))

  const submitMutation = useMutation({
    mutationFn: async () => {
      const results = state.resolutions.map((r, i) => ({
        player_id: r.player_id ?? undefined,
        player_create: r.player_create ?? undefined,
        score: parseRows[i]?.score ?? 0,
        tiebreaker_rank: parseRows[i]?.tiebreaker_rank ?? 1,
      }))

      if (state.eventMode === "existing") {
        await EventsService.submitResults({
          id: state.existingEventId!,
          requestBody: { results, mode: state.submitMode },
        })
      } else {
        const event = await EventsService.createEvent({
          requestBody: buildEventMeta(state.eventMeta),
        })
        await EventsService.submitResults({
          id: event.id,
          requestBody: { results, mode: "replace" },
        })
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] })
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
            <span className="font-medium">Event:</span> {state.existingEventName}
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
          <span className="font-medium">Results:</span> {state.resolutions.length} entries
        </p>
        <p className="text-muted-foreground">
          {state.resolutions.filter((r) => r.player_create).length} new players will be created.
        </p>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted">
            <tr>
              <th className="px-3 py-2 text-left">Player</th>
              <th className="px-3 py-2 text-left">Score</th>
              <th className="px-3 py-2 text-left">Tiebreaker</th>
            </tr>
          </thead>
          <tbody>
            {state.resolutions.map((r, i) => {
              const row = parseRows[i]
              const name = r.player_create?.display_name ?? parseRows[i]?.player_name ?? "—"
              return (
                <tr key={i} className="border-t">
                  <td className="px-3 py-1.5">
                    {name}
                    {r.player_create && (
                      <span className="ml-1 text-muted-foreground">(new)</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums">{row?.score}</td>
                  <td className="px-3 py-1.5 tabular-nums">{row?.tiebreaker_rank}</td>
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
        <Button onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending}>
          {submitMutation.isPending ? "Submitting…" : "Submit for review"}
        </Button>
      </div>
    </div>
  )
}
