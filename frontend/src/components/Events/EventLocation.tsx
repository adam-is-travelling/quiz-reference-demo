import { countryName } from "@/lib/countries"

type LocationFields = {
  is_online: boolean
  venue?: string | null
  city?: string | null
  country?: string | null
}

export function formatEventLocation(event: LocationFields): string {
  if (event.is_online) return "Online"
  const parts = [
    event.venue,
    event.city,
    event.country ? countryName(event.country) : null,
  ].filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join(", ") : "—"
}

export function EventLocation({ event }: { event: LocationFields }) {
  return <span>{formatEventLocation(event)}</span>
}
