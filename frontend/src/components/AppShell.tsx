import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Boxes,
  CalendarDays,
  LayoutDashboard,
  LogOut,
  Monitor,
  Moon,
  Router,
  Shield,
  Sun,
  type LucideIcon,
} from 'lucide-react'
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useMe } from '../api/queries'
import { Button } from './Button'
import { LogoMark } from './LogoMark'
import { AppFooter } from './AppFooter'
import { cn } from '../lib/cn'
import { useTheme, type ThemeChoice } from '../lib/theme'

const themeOrder: ThemeChoice[] = ['system', 'light', 'dark']

type MainNavItem = {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  activePrefixes?: string[]
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const next = themeOrder[(themeOrder.indexOf(theme) + 1) % themeOrder.length]
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Theme: ${theme}. Switch to ${next}.`}
      title={`Theme: ${theme}`}
      className="grid size-11 place-items-center rounded-2xl bg-white text-berry-700 shadow-soft transition hover:text-primary dark:bg-berry-900 dark:text-rose-100 dark:hover:text-blush"
    >
      <Icon className="size-5" aria-hidden="true" />
    </button>
  )
}

export function AppShell() {
  const { data } = useMe()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const isAdmin = data?.user?.is_admin ?? false

  // Keep the header wide and stable across routes so all navigation items fit
  // without making the bar jump when a wide workspace (such as Calendar) opens.
  const headerWidth = 'max-w-[110rem]'
  const mainWidth = location.pathname.startsWith('/calendar')
    ? 'max-w-[110rem]'
    : 'max-w-7xl'

  const navItems: MainNavItem[] = [
    { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
    {
      to: '/servers',
      label: 'Testbed',
      icon: Boxes,
      activePrefixes: ['/servers', '/tofinos', '/topology'],
    },
    { to: '/calendar', label: 'Calendar', icon: CalendarDays },
    ...(isAdmin
      ? [
          { to: '/management', label: 'Infrastructure', icon: Router },
          {
            to: '/admin/devices',
            label: 'Admin',
            icon: Shield,
            activePrefixes: ['/admin'],
          },
        ]
      : []),
  ]

  useEffect(() => {
    const listener = () => {
      if (location.pathname !== '/login') {
        navigate('/login', { replace: true })
      }
    }
    window.addEventListener('rsvp:unauthorized', listener)
    return () => window.removeEventListener('rsvp:unauthorized', listener)
  }, [location.pathname, navigate])

  const logout = async () => {
    await api.logout()
    queryClient.clear()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-svh">
      <header className="sticky top-0 z-30 border-b border-white/50 bg-surface/82 backdrop-blur-xl dark:border-white/10 dark:bg-berry-950/82">
        <div
          className={cn(
            'mx-auto flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:flex-nowrap',
            headerWidth,
          )}
        >
          <LogoMark className="shrink-0" />
          <nav
            aria-label="Main navigation"
            className="order-last flex w-full items-center gap-1 overflow-x-auto rounded-3xl border-2 border-white/80 bg-white/90 p-1.5 shadow-soft [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:order-none lg:w-auto lg:min-w-0 lg:flex-1 dark:border-white/10 dark:bg-berry-900/92"
          >
            {navItems.map((item) => {
              const Icon = item.icon
              const sectionActive = item.activePrefixes?.some(
                (prefix) =>
                  location.pathname === prefix ||
                  location.pathname.startsWith(`${prefix}/`),
              ) ?? false
              const pathActive = item.end
                ? location.pathname === item.to
                : location.pathname === item.to ||
                  location.pathname.startsWith(`${item.to}/`)
              const active = sectionActive || pathActive
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-10 items-center gap-2 whitespace-nowrap rounded-2xl px-2.5 text-sm font-black text-berry-700 transition lg:px-3.5',
                    active
                      ? 'bg-primary text-white shadow-button dark:bg-blush dark:text-berry-950'
                      : 'hover:bg-primary/10 dark:text-rose-100 dark:hover:bg-white/10',
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {item.label}
                </Link>
              )
            })}
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden rounded-full bg-white px-4 py-2 text-sm font-bold text-berry-700 shadow-soft sm:inline dark:bg-berry-900 dark:text-rose-100">
              {data?.user?.display_name ?? '...'}
            </span>
            <ThemeToggle />
            <Button
              variant="ghost"
              onClick={logout}
              aria-label="Log out"
              className="min-h-11 px-3"
            >
              <LogOut className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Logout</span>
            </Button>
          </div>
        </div>
      </header>

      <main className={cn('mx-auto px-4 py-6 sm:px-6 md:py-8', mainWidth)}>
        <Outlet />
        <AppFooter />
      </main>
    </div>
  )
}
