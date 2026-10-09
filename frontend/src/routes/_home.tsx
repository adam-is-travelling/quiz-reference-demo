import { createFileRoute } from "@tanstack/react-router"

import { SiteLayout } from "@/components/Common/SiteLayout"

export const Route = createFileRoute("/_home")({
  component: SiteLayout,
})
