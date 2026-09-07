import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '../../lib/cn'

const tabs = [
  { to: '/admin/devices', label: 'Devices' },
  { to: '/admin/tofinos', label: 'Tofinos' },
  { to: '/admin/caldav', label: 'CalDAV' },
  { to: '/admin/settings', label: 'Settings' },
]

export function AdminLayout() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-black">Admin</h1>
        <nav
          aria-label="Admin sections"
          className="mt-3 flex flex-wrap gap-1 rounded-3xl border-2 border-white/80 bg-white/90 p-1.5 shadow-soft dark:border-white/10 dark:bg-berry-900/92"
        >
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                cn(
                  'flex min-h-10 items-center rounded-2xl px-4 text-sm font-black text-berry-700 transition',
                  isActive
                    ? 'bg-primary text-white shadow-button dark:bg-blush dark:text-berry-950'
                    : 'hover:bg-primary/10 dark:text-rose-100 dark:hover:bg-white/10',
                )
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <Outlet />
    </div>
  )
}
