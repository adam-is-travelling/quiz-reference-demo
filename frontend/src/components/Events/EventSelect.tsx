import { useQuery } from "@tanstack/react-query"

import { EventsService } from "@/client"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface EventSelectProps {
  organizationId: string
  value: string
  onChange: (value: string) => void
}

export function EventSelect({
  organizationId,
  value,
  onChange,
}: EventSelectProps) {
  const { data: eventList } = useQuery({
    queryFn: () => EventsService.readEvents({ skip: 0, limit: 100 }),
    queryKey: ["events"],
  })

  const orgEvents = organizationId
    ? (eventList?.data.filter((e) => e.organization_id === organizationId) ??
      [])
    : []

  return (
    <div className="grid flex-1 gap-1.5">
      <Label>Event (optional)</Label>
      <Select
        value={value || "__none__"}
        onValueChange={(v) => onChange(v === "__none__" ? "" : v)}
        disabled={!organizationId}
      >
        <SelectTrigger>
          <SelectValue placeholder="No Event" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">None</SelectItem>
          {orgEvents.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
