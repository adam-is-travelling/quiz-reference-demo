import { Outlet, useMatches } from "@tanstack/react-router"

import { Footer } from "@/components/Common/Footer"
import { TopNav } from "@/components/Common/TopNav"

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** Widen the page cap for routes whose tables need the room. */
    wideLayout?: boolean
  }
}

// Every page — public, dashboard and admin — shares this one shell, so the
// navigation never changes shape as you move between them. A route can opt
// into a wider cap with `staticData: { wideLayout: true }`: 88rem is one more
// round column (~110px) of a quiz results table than the usual 80rem.
export function SiteLayout() {
  const wide = useMatches({
    select: (matches) => matches.some((m) => m.staticData?.wideLayout),
  })
  return (
    <div className="min-h-screen flex flex-col">
      <TopNav wide={wide} />
      <main
        className={`flex-1 container mx-auto px-4 py-8 ${
          wide ? "max-w-[88rem]" : "max-w-7xl"
        }`}
      >
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}
