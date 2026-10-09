import { Link } from "@tanstack/react-router"
import {
  Building2,
  CalendarDays,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  GitMerge,
  Home,
  LayoutList,
  List,
  LogOut,
  type LucideIcon,
  Menu,
  Settings,
  Users,
} from "lucide-react"
import { useState } from "react"
import type { UserPublic } from "@/client"
import { Appearance } from "@/components/Common/Appearance"
import { Logo } from "@/components/Common/Logo"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import useAuth, { isLoggedIn } from "@/hooks/useAuth"
import { getInitials } from "@/utils"

type NavItem = { title: string; path: string; icon?: LucideIcon }

// Public sections, in the same order for everyone.
const BROWSE: NavItem[] = [
  { title: "Players", path: "/players" },
  { title: "Quizzes", path: "/quizzes" },
  { title: "Organizations", path: "/organizations" },
  { title: "Competitions", path: "/competitions" },
  { title: "Events", path: "/events" },
]

// "/" is the shared home page, not an admin-only view — organizers and plain
// members land there too, so only a superuser sees it called a dashboard for
// admins.
function dashboardItem(user: UserPublic | undefined | null): NavItem {
  return {
    title: user?.is_superuser ? "Admin Dashboard" : "Dashboard",
    path: "/",
    icon: Home,
  }
}

// Admin/organizer pages. Plain members get none, so no Manage menu at all.
function manageItems(user: UserPublic | undefined | null): NavItem[] {
  if (!user?.is_superuser && !user?.is_organizer) return []

  const items: NavItem[] = [
    dashboardItem(user),
    { title: "Upload Results", path: "/upload", icon: ClipboardList },
  ]
  if (user.is_superuser) {
    items.push(
      { title: "Review Quizzes", path: "/admin/quizzes", icon: ClipboardCheck },
      { title: "Formats", path: "/admin/formats", icon: LayoutList },
      { title: "Competitions", path: "/admin/competitions", icon: List },
      { title: "Events", path: "/admin/events", icon: CalendarDays },
      { title: "Organizations", path: "/admin/organizations", icon: Building2 },
      { title: "Player Merges", path: "/admin/players/merges", icon: GitMerge },
      { title: "Users", path: "/admin", icon: Users },
    )
  }
  return items
}

const browseLinkClass =
  "text-sm font-medium text-muted-foreground hover:text-foreground transition-colors aria-[current=page]:text-foreground"

function UserInfo({ user }: { user: UserPublic }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <Avatar className="size-8">
        <AvatarFallback className="bg-zinc-600 text-white">
          {getInitials(user.full_name || "User")}
        </AvatarFallback>
      </Avatar>
      <div className="flex flex-col items-start min-w-0">
        <p className="text-sm font-medium truncate w-full">{user.full_name}</p>
        <p className="text-xs text-muted-foreground truncate w-full">
          {user.email}
        </p>
      </div>
    </div>
  )
}

function ManageMenu({ items }: { items: NavItem[] }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" data-testid="nav-manage">
          Manage
          <ChevronDown className="size-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {items.map((item) => (
          <DropdownMenuItem key={item.path} asChild>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <Link to={item.path as any}>
              {item.icon && <item.icon />}
              {item.title}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function UserMenu({ user }: { user: UserPublic }) {
  const { logout } = useAuth()

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
          data-testid="user-menu"
        >
          <Avatar className="size-8">
            <AvatarFallback className="bg-zinc-600 text-white">
              {getInitials(user.full_name || "User")}
            </AvatarFallback>
          </Avatar>
          <span className="sr-only">Account menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="font-normal">
          <UserInfo user={user} />
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings">
            <Settings />
            User Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => logout()}>
          <LogOut />
          Log Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function MobileSection({
  title,
  testId,
  children,
}: {
  title: string
  testId?: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-1" data-testid={testId}>
      <h2 className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  )
}

const mobileLinkClass =
  "flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent aria-[current=page]:bg-accent aria-[current=page]:font-medium [&_svg]:size-4 [&_svg]:text-muted-foreground"

function MobileMenu({
  user,
  manage,
}: {
  user: UserPublic | undefined | null
  manage: NavItem[]
}) {
  const [open, setOpen] = useState(false)
  const { logout } = useAuth()
  const close = () => setOpen(false)
  const loggedIn = isLoggedIn()

  const mobileLink = (item: NavItem) => (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <Link
      key={item.path}
      to={item.path as any}
      onClick={close}
      className={mobileLinkClass}
      activeOptions={{ exact: item.path === "/" || item.path === "/admin" }}
    >
      {item.icon && <item.icon />}
      {item.title}
    </Link>
  )

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          data-testid="mobile-menu-button"
        >
          <Menu />
          <span className="sr-only">Open menu</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            <Logo asLink={false} />
          </SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-6 px-2 pb-6">
          <MobileSection title="Browse" testId="mobile-browse">
            {BROWSE.map(mobileLink)}
          </MobileSection>
          {manage.length > 0 && (
            <MobileSection title="Manage">
              {manage.map(mobileLink)}
            </MobileSection>
          )}
          <MobileSection title="Account">
            {loggedIn && user ? (
              <>
                <div className="px-2 py-2">
                  <UserInfo user={user} />
                </div>
                {manage.length === 0 && mobileLink(dashboardItem(user))}
                {mobileLink({
                  title: "User Settings",
                  path: "/settings",
                  icon: Settings,
                })}
                <button
                  type="button"
                  className={mobileLinkClass}
                  onClick={() => {
                    close()
                    logout()
                  }}
                >
                  <LogOut />
                  Log Out
                </button>
              </>
            ) : (
              <Link to="/login" onClick={close} className={mobileLinkClass}>
                Log In
              </Link>
            )}
          </MobileSection>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function TopNav() {
  const { user } = useAuth()
  const loggedIn = isLoggedIn()
  const manage = loggedIn ? manageItems(user) : []

  return (
    <nav
      className="sticky top-0 z-40 border-b bg-background"
      data-testid="public-nav"
    >
      <div className="container mx-auto max-w-7xl px-4 h-16 flex items-center gap-6">
        <div className="flex items-center gap-2">
          <MobileMenu user={user} manage={manage} />
          <Link to="/" className="shrink-0" data-testid="nav-logo">
            <Logo asLink={false} />
          </Link>
        </div>

        <div
          className="hidden md:flex flex-1 items-center gap-6"
          data-testid="nav-browse"
        >
          {BROWSE.map((item) => (
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            <Link
              key={item.path}
              to={item.path as any}
              className={browseLinkClass}
            >
              {item.title}
            </Link>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {loggedIn && manage.length > 0 && (
            <div className="hidden md:block">
              <ManageMenu items={manage} />
            </div>
          )}
          {loggedIn && manage.length === 0 && (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="hidden md:inline-flex"
            >
              <Link to="/">Dashboard</Link>
            </Button>
          )}
          <Appearance />
          {loggedIn && user && (
            <div className="hidden md:block">
              <UserMenu user={user} />
            </div>
          )}
          {!loggedIn && (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="hidden md:inline-flex"
            >
              <Link to="/login">Log In</Link>
            </Button>
          )}
        </div>
      </div>
    </nav>
  )
}
