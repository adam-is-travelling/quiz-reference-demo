import { cn } from "@/lib/utils"

/**
 * Appended to the name of a quiz that decides who reaches the championship
 * rather than being part of it. A qualifier's finishers earn no medals in
 * podium standings and no win or podium on a player's profile, so every
 * surface that names a quiz says which ones they are — quietly, as an aside
 * to the name rather than a label competing with it.
 *
 * Callers pass the size that suits their context; the muted colour and
 * regular weight are the point and stay fixed.
 */
export function QualifierSuffix({ className }: { className?: string }) {
  return (
    <span className={cn("font-normal text-muted-foreground", className)}>
      {" (Qualification)"}
    </span>
  )
}
