import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

// Solid medal fills with fixed text colours, so each reads the same in light
// and dark mode.
const MEDAL_BADGES: Record<number, { label: string; className: string }> = {
  1: { label: "1st", className: "bg-yellow-400 text-yellow-950" },
  2: { label: "2nd", className: "bg-zinc-300 text-zinc-900" },
  3: { label: "3rd", className: "bg-amber-700 text-amber-50" },
}

/** A result's final rank: a gold/silver/bronze badge for the podium, plain
 * text otherwise. */
export function RankBadge({ rank }: { rank: number | null | undefined }) {
  if (!rank) return <span className="text-muted-foreground">—</span>
  const medal = MEDAL_BADGES[rank]
  if (!medal) return <span className="text-muted-foreground">{rank}</span>
  return (
    <Badge className={cn("border-transparent", medal.className)}>
      {medal.label}
    </Badge>
  )
}
