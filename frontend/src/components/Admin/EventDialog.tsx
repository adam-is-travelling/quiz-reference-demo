import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { z } from "zod"
import type { EventPublic } from "@/client"
import { ApiError, EventsService, OrganizationsService } from "@/client"
import { Button } from "@/components/ui/button"
import { CountrySelect } from "@/components/ui/CountrySelect"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import useCustomToast from "@/hooks/useCustomToast"

const fields = {
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  organization_id: z.string().min(1, "Organization is required"),
  start_date: z.string().min(1, "Start date is required"),
  end_date: z.string().min(1, "End date is required"),
  is_online: z.boolean(),
  venue: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  slug: z.string().optional(),
}

const schema = z
  .object(fields)
  .refine((d) => d.end_date >= d.start_date, {
    message: "End date must not be before start date",
    path: ["end_date"],
  })
  .refine((d) => d.is_online || Boolean(d.country), {
    message: "An in-person event requires a country",
    path: ["country"],
  })

// On the edit path the Slug field is visible and must not be submitted empty —
// clearing it and saving would otherwise leave the slug silently unchanged.
const editSchema = z
  .object({ ...fields, slug: z.string().min(1, "Slug is required") })
  .refine((d) => d.end_date >= d.start_date, {
    message: "End date must not be before start date",
    path: ["end_date"],
  })
  .refine((d) => d.is_online || Boolean(d.country), {
    message: "An in-person event requires a country",
    path: ["country"],
  })

type FormValues = z.infer<typeof schema>

interface Props {
  event?: EventPublic
  trigger: React.ReactNode
}

export function EventDialog({ event, trigger }: Props) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [open, setOpen] = useState(false)
  const isEdit = event !== undefined

  const { data: orgs } = useQuery({
    queryKey: ["organizations"],
    queryFn: () =>
      OrganizationsService.readOrganizations({ skip: 0, limit: 100 }),
  })

  const defaultValues: FormValues = {
    name: event?.name ?? "",
    description: event?.description ?? "",
    organization_id: event?.organization_id ?? "",
    start_date: event?.start_date ?? "",
    end_date: event?.end_date ?? "",
    is_online: event?.is_online ?? false,
    venue: event?.venue ?? "",
    city: event?.city ?? "",
    country: event?.country ?? "",
    slug: event?.slug ?? "",
  }

  const {
    register,
    handleSubmit,
    reset,
    setError,
    setValue,
    watch,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(isEdit ? editSchema : schema),
    defaultValues,
  })

  const isOnline = watch("is_online")

  useEffect(() => {
    if (isOnline) {
      setValue("venue", "")
      setValue("city", "")
      setValue("country", "")
    }
  }, [isOnline, setValue])

  const mutation = useMutation({
    mutationFn: (data: FormValues) => {
      if (isEdit) {
        return EventsService.updateEvent({
          id: event.id,
          requestBody: {
            name: data.name,
            description: data.description || null,
            organization_id: data.organization_id,
            start_date: data.start_date,
            end_date: data.end_date,
            is_online: data.is_online,
            venue: data.is_online ? null : data.venue || null,
            city: data.is_online ? null : data.city || null,
            country: data.is_online ? null : data.country || null,
            slug: data.slug,
          },
        })
      }
      return EventsService.createEvent({
        requestBody: {
          name: data.name,
          description: data.description || null,
          organization_id: data.organization_id,
          start_date: data.start_date,
          end_date: data.end_date,
          is_online: data.is_online,
          venue: data.is_online ? null : data.venue || null,
          city: data.is_online ? null : data.city || null,
          country: data.is_online ? null : data.country || null,
        },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] })
      showSuccessToast(isEdit ? "Event updated" : "Event created")
      setOpen(false)
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.status === 409) {
        const detail = (error.body as { detail?: string })?.detail
        setError("slug", {
          type: "server",
          message: detail || "Slug is already in use",
        })
        return
      }
      showErrorToast(
        isEdit ? "Failed to update event" : "Failed to create event",
      )
    },
  })

  const handleOpenChange = (v: boolean) => {
    setOpen(v)
    if (v) reset(defaultValues)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Event" : "New Event"}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={handleSubmit((data) => mutation.mutate(data))}
          className="flex flex-col gap-4 pt-2"
        >
          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input {...register("name")} />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label>Description</Label>
            <textarea
              {...register("description")}
              rows={2}
              className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          {isEdit && (
            <div className="grid gap-1.5">
              <Label>Slug</Label>
              <Input {...register("slug")} />
              {errors.slug && (
                <p className="text-sm text-destructive">
                  {errors.slug.message}
                </p>
              )}
            </div>
          )}

          <div className="grid gap-1.5">
            <Label>Organization</Label>
            <select
              {...register("organization_id")}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="" disabled>
                — choose an organization —
              </option>
              {orgs?.data.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
            {errors.organization_id && (
              <p className="text-sm text-destructive">
                {errors.organization_id.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label>Start Date</Label>
              <Input type="date" {...register("start_date")} />
              {errors.start_date && (
                <p className="text-sm text-destructive">
                  {errors.start_date.message}
                </p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label>End Date</Label>
              <Input type="date" {...register("end_date")} />
              {errors.end_date && (
                <p className="text-sm text-destructive">
                  {errors.end_date.message}
                </p>
              )}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...register("is_online")} />
            Online event
          </label>

          <fieldset disabled={isOnline} className="flex flex-col gap-4">
            <div className="grid gap-1.5">
              <Label>Venue</Label>
              <Input {...register("venue")} />
            </div>
            <div className="grid gap-1.5">
              <Label>City</Label>
              <Input {...register("city")} />
            </div>
            <div className="grid gap-1.5">
              <Label>Country</Label>
              <Controller
                name="country"
                control={control}
                render={({ field }) => (
                  <CountrySelect
                    value={field.value}
                    onChange={(code) => field.onChange(code ?? "")}
                  />
                )}
              />
              {errors.country && (
                <p className="text-sm text-destructive">
                  {errors.country.message}
                </p>
              )}
            </div>
          </fieldset>

          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending
              ? isEdit
                ? "Saving…"
                : "Creating…"
              : isEdit
                ? "Save"
                : "Create"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
