import { Link } from "@tanstack/react-router"

import { cn } from "@/lib/utils"

interface LogoProps {
  variant?: "full" | "icon" | "responsive"
  className?: string
  asLink?: boolean
}

const FULL = "[quiz-reference]"
// The collapsed sidebar leaves room for little more than an icon.
const ICON = "[q]"

export function Logo({
  variant = "full",
  className,
  asLink = true,
}: LogoProps) {
  const wordmark = "font-mono font-semibold tracking-tight whitespace-nowrap"

  const content =
    variant === "responsive" ? (
      <>
        <span
          className={cn(
            wordmark,
            "text-lg group-data-[collapsible=icon]:hidden",
            className,
          )}
        >
          {FULL}
        </span>
        <span
          className={cn(
            wordmark,
            "text-sm hidden group-data-[collapsible=icon]:block",
            className,
          )}
        >
          {ICON}
        </span>
      </>
    ) : (
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
