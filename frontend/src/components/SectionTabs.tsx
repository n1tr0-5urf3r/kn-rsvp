import type { LucideIcon } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { cn } from '../lib/cn'

export type SectionTab = {
  to: string
  label: string
  description: string
  icon: LucideIcon
  end?: boolean
  activeWhen?: (pathname: string) => boolean
}

export function SectionTabs({
  label,
  tabs,
}: {
  label: string
  tabs: SectionTab[]
}) {
  const location = useLocation()

  return (
    <nav
      aria-label={label}
      className="mt-4 rounded-3xl border-2 border-primary/15 bg-white/90 p-2 shadow-soft dark:border-blush/15 dark:bg-berry-900/92"
    >
      <p className="px-2 pb-2 pt-1 text-[0.65rem] font-black uppercase tracking-[0.18em] text-berry-700/55 dark:text-rose-100/55">
        {label}
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const pathActive = tab.end
            ? location.pathname === tab.to
            : location.pathname === tab.to ||
              location.pathname.startsWith(`${tab.to}/`)
          const active = pathActive || (tab.activeWhen?.(location.pathname) ?? false)
          return (
            <Link
              key={tab.to}
              to={tab.to}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'group flex min-h-16 items-center gap-3 rounded-2xl border-2 px-3 py-2.5 text-left transition',
                active
                  ? 'border-primary bg-primary text-white shadow-button dark:border-blush dark:bg-blush dark:text-berry-950'
                  : 'border-transparent bg-surface/70 text-berry-700 hover:border-primary/25 hover:bg-primary/10 dark:bg-berry-950/45 dark:text-rose-100 dark:hover:border-blush/25 dark:hover:bg-white/10',
              )}
            >
              <span
                className={cn(
                  'grid size-9 shrink-0 place-items-center rounded-xl transition',
                  active
                    ? 'bg-white/18 dark:bg-berry-950/12'
                    : 'bg-primary/10 text-primary group-hover:bg-primary/15 dark:bg-blush/12 dark:text-blush',
                )}
              >
                <Icon className="size-4.5" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block font-display text-sm font-black">
                  {tab.label}
                </span>
                <span
                  className={cn(
                    'mt-0.5 block text-[0.68rem] font-bold leading-tight',
                    active ? 'opacity-80' : 'opacity-55',
                  )}
                >
                  {tab.description}
                </span>
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
