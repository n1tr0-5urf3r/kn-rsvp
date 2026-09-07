import { Database, Network, Router } from 'lucide-react'
import { Outlet } from 'react-router-dom'
import { SectionTabs, type SectionTab } from '../components/SectionTabs'

const tabs: SectionTab[] = [
  {
    to: '/management',
    label: 'Switches',
    description: 'Ports and faceplates',
    icon: Router,
    end: true,
    activeWhen: (pathname) => pathname.startsWith('/management/switches/'),
  },
  {
    to: '/management/topology',
    label: 'Topology',
    description: 'VLAN paths and uplinks',
    icon: Network,
  },
  {
    to: '/management/vlans',
    label: 'VLAN database',
    description: 'IDs, names, and purposes',
    icon: Database,
  },
]

export function ManagementLayout() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 font-display text-2xl font-black">
          <Router className="size-6 text-primary dark:text-blush" aria-hidden="true" />
          Management
        </h1>
        <p className="mt-1 text-sm font-bold text-berry-700/70 dark:text-rose-100/70">
          Infrastructure / management switches, ports, and VLANs — admin-only.
        </p>
        <SectionTabs label="Management sections" tabs={tabs} />
      </div>
      <Outlet />
    </div>
  )
}
