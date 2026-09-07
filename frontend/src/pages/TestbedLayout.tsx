import { Boxes, Cpu, Network, Server } from 'lucide-react'
import { Outlet } from 'react-router-dom'
import { SectionTabs, type SectionTab } from '../components/SectionTabs'

const tabs: SectionTab[] = [
  {
    to: '/servers',
    label: 'Servers',
    description: 'Hosts and network interfaces',
    icon: Server,
  },
  {
    to: '/tofinos',
    label: 'Tofinos',
    description: 'Switch ports and cabling',
    icon: Cpu,
  },
  {
    to: '/topology',
    label: 'Topology',
    description: 'End-to-end testbed links',
    icon: Network,
  },
]

export function TestbedLayout() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 font-display text-2xl font-black">
          <Boxes className="size-6 text-primary dark:text-blush" aria-hidden="true" />
          Testbed
        </h1>
        <p className="mt-1 text-sm font-bold text-berry-700/70 dark:text-rose-100/70">
          Servers, programmable switches, and their physical connectivity.
        </p>
        <SectionTabs label="Testbed sections" tabs={tabs} />
      </div>
      <Outlet />
    </div>
  )
}
