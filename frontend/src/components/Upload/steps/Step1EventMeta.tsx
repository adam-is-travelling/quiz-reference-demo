import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { useForm } from "react-hook-form"

import {
  EventsService,
  FormatsService,
  OrganizationsService,
  SeriesService,
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
import type { EventMeta, WizardState } from "../types"
import { emptyEventMeta } from "../types"

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
        New event
      </button>
      <button
        type="button"
        data-testid={Labels.uploadModeToggleExisting}
        onClick={() => onChange("existing")}
        className={`px-4 py-1.5 text-sm ${mode === "existing" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
      >
        Existing event
      </button>
    </div>
  )
}

function ExistingEventPicker({
  value,
  onChange,
}: {
  value: string | null
  onChange: (id: string, name: string, formatId: string | null | undefined, formatObj: import("@/client").QuizFormatPublic | null | undefined) => void
}) {
  const { data } = useQuery({
    queryFn: () => EventsService.readEvents({ skip: 0, limit: 200 }),
    queryKey: ["events", "all"],
  })

  return (
    <div className="grid gap-1.5">
      <Label>Select event</Label>
      <select
        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid={Labels.uploadExistingEventSelect}
        value={value ?? ""}
        onChange={(e) => {
          const event = data?.data.find((ev) => ev.id === e.target.value)
          if (event) onChange(event.id, event.name, event.format_id, event.format)
        }}
      >
        <option value="" disabled>
          — choose an event —
        </option>
        {data?.data.map((ev) => (
          <option key={ev.id} value={ev.id}>
            {ev.name} ({ev.start_date})
          </option>
        ))}
      </select>
    </div>
  )
}

export function Step1EventMeta({ state, update }: Props) {
  const { data: orgs } = useQuery({
    queryFn: () =>
      OrganizationsService.readOrganizations({ skip: 0, limit: 100 }),
    queryKey: ["organizations"],
  })
  const { data: seriesList } = useQuery({
    queryFn: () => SeriesService.readSeries({ skip: 0, limit: 100 }),
    queryKey: ["series"],
  })
  const { data: formatsList } = useQuery({
    queryFn: () => FormatsService.readFormats({ skip: 0, limit: 100 }),
    queryKey: ["formats"],
  })

  const [isMultiDay, setIsMultiDay] = useState(
    state.eventMeta.start_date !== state.eventMeta.end_date,
  )
  const [selectedOrgId, setSelectedOrgId] = useState<string>(
    state.eventMeta.organization_id || "__none__",
  )
  const [selectedFormatId, setSelectedFormatId] = useState<string>(
    state.eventMeta.format_id || "__none__",
  )

  const { register, handleSubmit, setValue } = useForm<EventMeta>({
    defaultValues: state.eventMeta,
    shouldUnregister: true,
  })

  const onSubmit = (data: EventMeta) => {
    const payload = {
      ...data,
      end_date: isMultiDay ? data.end_date : data.start_date,
    }
    const formatObj =
      selectedFormatId !== "__none__"
        ? formatsList?.data.find((f) => f.id === selectedFormatId) ?? null
        : null
    update({ eventMeta: payload, selectedFormat: formatObj, step: 2 })
  }

  const handleModeChange = (mode: "new" | "existing") => {
    update({
      eventMode: mode,
      existingEventId: null,
      existingEventName: null,
      eventMeta: emptyEventMeta(),
      selectedFormat: null,
    })
  }

  return (
    <div className="flex flex-col gap-4 max-w-xl">
      <ModeToggle mode={state.eventMode} onChange={handleModeChange} />

      {state.eventMode === "existing" ? (
        <div className="flex flex-col gap-4">
          <ExistingEventPicker
            value={state.existingEventId}
            onChange={(id, name, _formatId, formatObj) =>
              update({
                existingEventId: id,
                existingEventName: name,
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
              disabled={!state.existingEventId}
            >
              Next →
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="name">Event name *</Label>
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
            Multi-day event
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

          <div className="grid gap-1.5">
            <Label>Series (optional)</Label>
            <Select onValueChange={(v) => setValue("series_id", v)}>
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                {seriesList?.data.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label>Organization</Label>
            <Select
              value={selectedOrgId}
              onValueChange={(v) => {
                setSelectedOrgId(v)
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

          <div className="grid gap-1.5">
            <Label>Format (optional)</Label>
            <Select
              value={selectedFormatId}
              onValueChange={(v) => {
                setSelectedFormatId(v)
                setValue("format_id", v === "__none__" ? "" : v)
              }}
            >
              <SelectTrigger>
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
