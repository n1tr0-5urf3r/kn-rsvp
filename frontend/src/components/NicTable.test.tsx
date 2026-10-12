import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { ServerWithNics } from '../api/types'
import {
  filterNics,
  hasAssignment,
  isManagementNic,
  NicTable,
} from './NicTable'

const server: ServerWithNics = {
  id: 'chucky',
  name: 'chucky',
  description: '',
  cpu_model: '',
  cpu_sockets: null,
  cpu_cores: null,
  cpu_threads: null,
  cpu_mhz: null,
  memory_gb: null,
  reservable: false,
  sort_order: 0,
  nics: [
    {
      id: 'nic-81-1',
      server_id: 'chucky',
      name: '81.1',
      ifname: 'enp129s0f1np1',
      pci_address: '0000:81:00.1',
      nic_type: 'ConnectX-6 Dx',
      speed_gbps: 100,
      mac: '00:11:22:33:44:55',
      numa_node: 1,
      kind: 'pf',
      usage: 'DPDK',
      peer_port_id: null,
      peer_port_tofino_id: null,
      peer_port_label: null,
      peer_nic_id: null,
      peer_nic_server_id: null,
      peer_nic_label: null,
      peer_mgmt_port_id: null,
      peer_mgmt_switch_id: null,
      peer_mgmt_port_label: null,
      sort_order: 0,
      claim: null,
    },
  ],
}

describe('filterNics', () => {
  const claim = (owner: string, comment = '') => ({
    user_id: null,
    user_display_name: owner,
    connected_to: '',
    cable_label: '',
    comment,
    updated_at: 0,
  })
  const nics = [
    { id: 'owned', usage: 'DPDK', claim: claim('Robin') },
    { id: 'cable-only', usage: '', claim: claim('', 'Uplink') },
    { id: 'unclaimed', usage: '', claim: null },
    { id: 'mgmt', usage: 'Management', claim: null },
  ]
  const ids = (options: { showManagement: boolean; onlyFree: boolean }) =>
    filterNics(nics, options).map((nic) => nic.id)

  it('keeps only NICs nobody owns when filtering for free ones', () => {
    expect(ids({ showManagement: false, onlyFree: true })).toEqual([
      'cable-only',
      'unclaimed',
    ])
    expect(ids({ showManagement: true, onlyFree: true })).toEqual([
      'cable-only',
      'unclaimed',
      'mgmt',
    ])
  })

  it('hides management NICs unless asked for them', () => {
    expect(ids({ showManagement: false, onlyFree: false })).toEqual([
      'owned',
      'cable-only',
      'unclaimed',
    ])
  })
})

describe('hasAssignment', () => {
  const bare = {
    claim: null,
    usage: '',
    peer_port_id: null,
    peer_nic_id: null,
    peer_mgmt_port_id: null,
  }

  it('counts a "used by" label, a link, or a claim row as something to free', () => {
    expect(hasAssignment(bare)).toBe(false)
    expect(hasAssignment({ ...bare, usage: '118 (springel-dpdk-3)' })).toBe(
      true,
    )
    expect(hasAssignment({ ...bare, peer_nic_id: 'nic-2' })).toBe(true)
    expect(
      hasAssignment({ ...bare, peer_mgmt_port_id: 'mgmt-port-1' }),
    ).toBe(true)
  })
})

describe('isManagementNic', () => {
  it('matches the Management usage label without depending on case or spacing', () => {
    expect(isManagementNic({ usage: 'Management' })).toBe(true)
    expect(isManagementNic({ usage: ' management ' })).toBe(true)
  })

  it('keeps NICs with other usage labels visible', () => {
    expect(isManagementNic({ usage: 'DPDK' })).toBe(false)
    expect(isManagementNic({ usage: '' })).toBe(false)
  })

  it('shows inventory name, interface, and PCI address separately', () => {
    render(
      <MemoryRouter>
        <NicTable server={server} />
      </MemoryRouter>,
    )

    expect(
      screen.getByRole('columnheader', { name: 'Name / alias' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'Interface' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'PCI address' }),
    ).toBeInTheDocument()

    const row = screen.getByRole('row', { name: /81\.1/ })
    expect(within(row).getByText('81.1')).toBeInTheDocument()
    expect(within(row).getByText('enp129s0f1np1')).toBeInTheDocument()
    expect(within(row).getByText('0000:81:00.1')).toBeInTheDocument()
  })

  it('opens the configuration dialog from the Configure action', () => {
    const onConfigure = vi.fn()
    render(
      <MemoryRouter>
        <NicTable server={server} isAdmin onConfigure={onConfigure} />
      </MemoryRouter>,
    )

    const row = screen.getByRole('row', { name: /81\.1/ })
    fireEvent.click(
      within(row).getByRole('button', { name: 'Configure 81.1' }),
    )

    expect(onConfigure).toHaveBeenCalledWith(server.nics[0])
  })

  it('shows usage and speed as plain values for admins', () => {
    render(
      <MemoryRouter>
        <NicTable server={server} isAdmin onConfigure={vi.fn()} />
      </MemoryRouter>,
    )

    const row = screen.getByRole('row', { name: /81\.1/ })
    expect(within(row).getByText('DPDK')).toBeInTheDocument()
    expect(within(row).getByText('100 Gbit/s')).toBeInTheDocument()
    expect(
      within(row).queryByRole('button', { name: /Edit (usage|speed)/ }),
    ).not.toBeInTheDocument()
  })

  it('treats a claim row without an owner as free', () => {
    const documented: ServerWithNics = {
      ...server,
      nics: [
        {
          ...server.nics[0],
          claim: {
            user_id: null,
            user_display_name: '',
            connected_to: '',
            cable_label: 'A12',
            comment: 'Debug host',
            updated_at: 0,
          },
        },
      ],
    }
    render(
      <MemoryRouter>
        <NicTable server={documented} isAdmin onConfigure={vi.fn()} />
      </MemoryRouter>,
    )

    const row = screen.getByRole('row', { name: /81\.1/ })
    expect(within(row).getByText('free')).toBeInTheDocument()
    expect(within(row).getByText('A12')).toBeInTheDocument()
    // The documented cable can still be removed.
    expect(
      within(row).getByRole('button', { name: 'Free 81.1' }),
    ).toBeInTheDocument()
  })

  it('offers Free NIC for a cabled NIC but not a bare one', () => {
    const cabled: ServerWithNics = {
      ...server,
      nics: [
        { ...server.nics[0], peer_port_id: 'port-1' },
        { ...server.nics[0], id: 'nic-81-2', name: '81.2', usage: '' },
      ],
    }
    render(
      <MemoryRouter>
        <NicTable server={cabled} isAdmin onConfigure={vi.fn()} />
      </MemoryRouter>,
    )

    expect(
      within(screen.getByRole('row', { name: /81\.1/ })).getByRole('button', {
        name: 'Free 81.1',
      }),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('row', { name: /81\.2/ })).queryByRole(
        'button',
        { name: /Free/ },
      ),
    ).not.toBeInTheDocument()
  })

  it('keeps the speed read-only for non-admins', () => {
    render(
      <MemoryRouter>
        <NicTable server={server} />
      </MemoryRouter>,
    )

    const row = screen.getByRole('row', { name: /81\.1/ })
    expect(within(row).getByText('100 Gbit/s')).toBeInTheDocument()
    expect(
      within(row).queryByRole('button', { name: /Edit speed/ }),
    ).not.toBeInTheDocument()
  })
})
