import { Link } from "@tanstack/react-router"

import { cn } from "@/lib/utils"

interface LogoProps {
  variant?: "full" | "icon"
  className?: string
  asLink?: boolean
}

const FULL = "[quiz-reference]"
const ICON = "[q]"

export function Logo({
  variant = "full",
  className,
  asLink = true,
}: LogoProps) {
  const wordmark = "font-mono font-semibold tracking-tight whitespace-nowrap"

  const content = (
    <span
      className={cn(
        wordmark,
        variant === "full" ? "text-lg" : "text-sm",
        className,
      )}
    >
      {variant === "full" ? FULL : ICON}
    </span>
  )

  if (!asLink) {
    return content
  }

  return <Link to="/">{content}</Link>
}
