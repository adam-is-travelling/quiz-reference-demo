import { useQuery } from "@tanstack/react-query"
import { useForm } from "react-hook-form"

import { OrganizationsService, SeriesService } from "@/client"
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
import type { EventMeta, WizardState } from "../types"

interface Props {
  state: WizardState
  update: (patch: Partial<WizardState>) => void
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

  const { register, handleSubmit, setValue } = useForm<EventMeta>({
    defaultValues: state.eventMeta,
  })

  const onSubmit = (data: EventMeta) => {
    update({ eventMeta: data, step: 2 })
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-4 max-w-xl"
    >
      <div className="grid gap-1.5">
        <Label htmlFor="name">Event name *</Label>
        <Input id="name" {...register("name", { required: true })} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="start_date">Start date *</Label>
          <Input
            id="start_date"
            type="date"
            {...register("start_date", { required: true })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="end_date">End date *</Label>
          <Input
            id="end_date"
            type="date"
            {...register("end_date", { required: true })}
          />
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="organizer_name">Organiser name *</Label>
        <Input
          id="organizer_name"
          {...register("organizer_name", { required: true })}
        />
      </div>

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
        <Label>Organization (optional)</Label>
        <Select onValueChange={(v) => setValue("organization_id", v)}>
          <SelectTrigger>
            <SelectValue placeholder="None" />
          </SelectTrigger>
          <SelectContent>
            {orgs?.data.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="format_rounds">Rounds</Label>
          <Input
            id="format_rounds"
            type="number"
            {...register("format_rounds")}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="format_questions">Questions</Label>
          <Input
            id="format_questions"
            type="number"
            {...register("format_questions")}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="format_categories">Categories</Label>
          <Input
            id="format_categories"
            placeholder="comma-separated"
            {...register("format_categories")}
          />
        </div>
      </div>

      <Button type="submit" className="self-start">
        Next →
      </Button>
    </form>
  )
}
