import { createFileRoute, redirect } from "@tanstack/react-router"

import { SiteLayout } from "@/components/Common/SiteLayout"
import { isLoggedIn } from "@/hooks/useAuth"

export const Route = createFileRoute("/_layout")({
  component: SiteLayout,
  beforeLoad: async () => {
    if (!isLoggedIn()) {
      throw redirect({
        to: "/login",
      })
    }
  },
})
