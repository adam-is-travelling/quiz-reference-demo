import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { useForm } from "react-hook-form"

import {
  CompetitionsService,
  FormatsService,
  OrganizationsService,
  QuizzesService,
} from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Labels } from "@/test-ids"
import type { QuizMeta, WizardState } from "../types"
import { emptyQuizMeta } from "../types"

interface Props {
  state: WizardState
  update: (patch: Partial<WizardState>) => void
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: "new" | "existing"
  onChange: (m: "new" | "existing") => void
}) {
  return (
    <div className="flex rounded-md border overflow-hidden self-start">
      <button
        type="button"
        data-testid={Labels.uploadModeToggleNew}
        onClick={() => onChange("new")}
        className={`px-4 py-1.5 text-sm ${mode === "new" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
      >
        New quiz
      </button>
      <button
        type="button"
        data-testid={Labels.uploadModeToggleExisting}
        onClick={() => onChange("existing")}
        className={`px-4 py-1.5 text-sm ${mode === "existing" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
      >
        Existing quiz
      </button>
    </div>
  )
}

function ExistingQuizPicker({
  value,
  onChange,
}: {
  value: string | null
  onChange: (
    id: string,
    name: string,
    formatId: string | null | undefined,
    formatObj: import("@/client").QuizFormatPublic | null | undefined,
  ) => void
}) {
  const { data } = useQuery({
    queryFn: () => QuizzesService.readQuizzes({ skip: 0, limit: 200 }),
    queryKey: ["quizzes", "all"],
  })

  return (
    <div className="grid gap-1.5">
      <Label>Select quiz</Label>
      <select
        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid={Labels.uploadExistingQuizSelect}
        value={value ?? ""}
        onChange={(e) => {
          const quiz = data?.data.find(
            (candidate) => candidate.id === e.target.value,
          )
          if (quiz) onChange(quiz.id, quiz.name, quiz.format_id, quiz.format)
        }}
      >
        <option value="" disabled>
          — choose a quiz —
        </option>
        {data?.data.map((quiz) => (
          <option key={quiz.id} value={quiz.id}>
            {quiz.name} ({quiz.start_date})
          </option>
        ))}
      </select>
    </div>
  )
}

export function Step1QuizMeta({ state, update }: Props) {
  const { data: orgs } = useQuery({
    queryFn: () =>
      OrganizationsService.readOrganizations({ skip: 0, limit: 100 }),
    queryKey: ["organizations"],
  })
  const { data: competitionList } = useQuery({
    queryFn: () =>
      CompetitionsService.readCompetitions({ skip: 0, limit: 100 }),
    queryKey: ["competitions"],
  })
  const { data: formatsList } = useQuery({
    queryFn: () => FormatsService.readFormats({ skip: 0, limit: 100 }),
    queryKey: ["formats"],
  })

  const [isMultiDay, setIsMultiDay] = useState(
    state.quizMeta.start_date !== state.quizMeta.end_date,
  )
  const [selectedOrgId, setSelectedOrgId] = useState<string>(
    state.quizMeta.organization_id || "__none__",
  )
  const [selectedFormatId, setSelectedFormatId] = useState<string>(
    state.quizMeta.format_id || "__none__",
  )
  const [selectedCompetitionId, setSelectedCompetitionId] = useState<string>(
    state.quizMeta.competition_id || "__none__",
  )

  const orgCompetitions =
    selectedOrgId !== "__none__"
      ? (competitionList?.data.filter(
          (s) => s.organization_id === selectedOrgId,
        ) ?? [])
      : []

  const { register, handleSubmit, setValue } = useForm<QuizMeta>({
    defaultValues: state.quizMeta,
    shouldUnregister: true,
  })

  const onSubmit = (data: QuizMeta) => {
    // format_id is a controlled Select (not a react-hook-form field), so with
    // shouldUnregister it would be stripped from `data`. Derive both the id and
    // the format object from selectedFormatId so quizMeta.format_id and
    // selectedFormat can never disagree (a mismatch makes the wizard send
    // round_scores for a quiz created without a format → backend 422).
    const format_id = selectedFormatId !== "__none__" ? selectedFormatId : ""
    const formatObj = format_id
      ? (formatsList?.data.find((f) => f.id === format_id) ?? null)
      : null
    const payload = {
      ...data,
      format_id,
      end_date: isMultiDay ? data.end_date : data.start_date,
    }
    update({ quizMeta: payload, selectedFormat: formatObj, step: 2 })
  }

  const handleModeChange = (mode: "new" | "existing") => {
    update({
      quizMode: mode,
      existingQuizId: null,
      existingQuizName: null,
      quizMeta: emptyQuizMeta(),
      selectedFormat: null,
    })
  }

  return (
    <div className="flex flex-col gap-4 max-w-xl">
      <ModeToggle mode={state.quizMode} onChange={handleModeChange} />

      {state.quizMode === "existing" ? (
        <div className="flex flex-col gap-4">
          <ExistingQuizPicker
            value={state.existingQuizId}
            onChange={(id, name, _formatId, formatObj) =>
              update({
                existingQuizId: id,
                existingQuizName: name,
                selectedFormat: formatObj ?? null,
              })
            }
          />
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => update({ step: 0 })}>
              ← Back
            </Button>
            <Button
              onClick={() => update({ step: 2 })}
              disabled={!state.existingQuizId}
            >
              Next →
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="name">Quiz name *</Label>
            <Input id="name" {...register("name", { required: true })} />
          </div>

          {isMultiDay ? (
            <div className="flex items-end gap-2">
              <div className="grid gap-1.5">
                <Label htmlFor="start_date">Start date *</Label>
                <Input
                  id="start_date"
                  type="date"
                  className="w-44"
                  {...register("start_date", { required: true })}
                />
              </div>
              <span className="flex h-9 items-center text-muted-foreground">
                –
              </span>
              <div className="grid gap-1.5">
                <Label htmlFor="end_date">End date *</Label>
                <Input
                  id="end_date"
                  type="date"
                  className="w-44"
                  {...register("end_date", { required: true })}
                />
              </div>
            </div>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="start_date">Date *</Label>
              <Input
                id="start_date"
                type="date"
                className="w-44"
                {...register("start_date", { required: true })}
              />
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isMultiDay}
              onChange={(e) => {
                setIsMultiDay(e.target.checked)
              }}
            />
            Multi-day quiz
          </label>

          <div className="grid gap-1.5">
            <Label htmlFor="description">Description</Label>
            <textarea
              id="description"
              rows={3}
              className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
              {...register("description")}
            />
          </div>

          <div className="flex gap-3">
            <div className="grid flex-1 gap-1.5">
              <Label>Organization</Label>
              <Select
                value={selectedOrgId}
                onValueChange={(v) => {
                  setSelectedOrgId(v)
                  setSelectedCompetitionId("__none__")
                  setValue("competition_id", "")
                  if (v === "__none__") {
                    setValue("organization_id", "")
                    setValue("organizer_name", null)
                  } else {
                    const org = orgs?.data.find((o) => o.id === v)
                    setValue("organization_id", v)
                    setValue("organizer_name", org?.name ?? null)
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No Organization</SelectItem>
                  {orgs?.data.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {orgCompetitions.length > 0 && (
              <div className="grid flex-1 gap-1.5">
                <Label>Competition (optional)</Label>
                <Select
                  value={selectedCompetitionId}
                  onValueChange={(v) => {
                    setSelectedCompetitionId(v)
                    setValue("competition_id", v === "__none__" ? "" : v)
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {orgCompetitions.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label>Format (optional)</Label>
            <Select
              value={selectedFormatId}
              onValueChange={(v) => {
                setSelectedFormatId(v)
                setValue("format_id", v === "__none__" ? "" : v)
              }}
            >
              <SelectTrigger data-testid={Labels.formatSelect}>
                <SelectValue placeholder="No Format" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No Format</SelectItem>
                {formatsList?.data.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-3">
            <Button
              variant="outline"
              type="button"
              onClick={() => update({ step: 0 })}
            >
              ← Back
            </Button>
            <Button type="submit">Next →</Button>
          </div>
        </form>
      )}
    </div>
  )
}
