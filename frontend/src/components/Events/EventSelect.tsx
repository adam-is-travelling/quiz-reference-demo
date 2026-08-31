import { useQuery } from "@tanstack/react-query"

import { type EventPublic, EventsService } from "@/client"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const UNKNOWN_ORGANIZER = "Unknown organizer"

export interface EventGroup {
  organizationId: string
  organizationName: string
  events: EventPublic[]
}

/**
 * Group events by the organizer that owns them, preserving the order the API
 * returned them in both between and within groups. Quizzes may be attached to
 * an event from any organizer, so `pinnedOrgId` — normally the organizer on the
 * quiz being edited — only floats that group to the front; it never filters.
 */
export function groupEventsByOrganizer(
  events: EventPublic[],
  pinnedOrgId?: string,
): EventGroup[] {
  const groups: EventGroup[] = []
  const byOrgId = new Map<string, EventGroup>()

  for (const event of events) {
    let group = byOrgId.get(event.organization_id)
    if (!group) {
      group = {
        organizationId: event.organization_id,
        organizationName: event.organization_name ?? UNKNOWN_ORGANIZER,
        events: [],
      }
      byOrgId.set(event.organization_id, group)
      groups.push(group)
    }
    group.events.push(event)
  }

  const pinned = pinnedOrgId ? byOrgId.get(pinnedOrgId) : undefined
  if (!pinned) return groups
  return [pinned, ...groups.filter((g) => g !== pinned)]
}

interface EventSelectProps {
  /** Organizer on the quiz. Floats its events to the top; does not filter. */
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

  const groups = groupEventsByOrganizer(eventList?.data ?? [], organizationId)

  return (
    <div className="grid flex-1 gap-1.5">
      <Label>Event (optional)</Label>
      <Select
        value={value || "__none__"}
        onValueChange={(v) => onChange(v === "__none__" ? "" : v)}
      >
        <SelectTrigger>
          <SelectValue placeholder="No Event" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">None</SelectItem>
          {groups.map((group) => (
            <SelectGroup key={group.organizationId}>
              <SelectLabel>{group.organizationName}</SelectLabel>
              {group.events.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
