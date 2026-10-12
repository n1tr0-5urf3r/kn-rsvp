import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NicView, ServerWithNics } from '../api/types'
import { ToastProvider } from '../lib/toast'
import { ServersPage } from './ServersPage'

function nic(
  id: string,
  serverId: string,
  comment: string,
  owner = '',
): NicView {
  return {
    id,
    server_id: serverId,
    name: `${serverId}-nic`,
    pci_address: '0000:81:00.0',
    nic_type: 'ConnectX-6 Dx',
    speed_gbps: 100,
    ifname: 'ens1f0',
    mac: '',
    numa_node: 0,
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
    claim: {
      user_id: null,
      user_display_name: owner,
      connected_to: null,
      cable_label: null,
      comment,
      updated_at: 0,
    },
  }
}

const servers: ServerWithNics[] = ['Pennywise', 'Chucky'].map(
  (name, index) => {
    const id = name.toLowerCase()
    return {
      id,
      name,
      description: null,
      cpu_model: '',
      cpu_sockets: null,
      cpu_cores: null,
      cpu_threads: null,
      cpu_mhz: null,
      memory_gb: null,
      reservable: false,
      sort_order: index,
      // Only Pennywise's NIC has an owner.
      nics: [
        nic(`${id}-nic`, id, 'Fabric uplink', index === 0 ? 'Robin' : ''),
      ],
    }
  },
)

function mockApi() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = String(input)
    const body = url.includes('/servers')
      ? { servers }
      : {
          user: {
            id: 'user-1',
            display_name: 'Test User',
            is_admin: false,
          },
        }
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(body)),
      json: () => Promise.resolve(body),
    } as Response)
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ServersPage', () => {
  it('shows every named server map above the detailed NIC tables', async () => {
    const user = userEvent.setup()
    mockApi()
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter>
            <ServersPage />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    )

    const overview = await screen.findByRole('heading', {
      name: 'Server & NIC overview',
    })
    const details = screen.getByRole('heading', {
      name: 'Detailed NIC inventory',
    })

    expect(
      overview.compareDocumentPosition(details) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      screen.getByLabelText('Pennywise PCI adapter map'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Chucky PCI adapter map')).toBeInTheDocument()
    const commentGroup = screen.getByRole('button', {
      name: 'Comment group: Fabric uplink',
    })
    expect(commentGroup).toBeInTheDocument()
    expect(screen.getAllByText('Pennywise')).toHaveLength(2)
    expect(screen.getAllByText('Chucky')).toHaveLength(2)

    await user.hover(commentGroup)
    expect(
      screen.getByRole('button', { name: /Pennywise NIC pennywise-nic/ }),
    ).toHaveAttribute('data-comment-highlighted', 'true')
    expect(
      screen.getByRole('button', { name: /Chucky NIC chucky-nic/ }),
    ).toHaveAttribute('data-comment-highlighted', 'true')
  })

  it('narrows the overview and tables to free NICs', async () => {
    const user = userEvent.setup()
    mockApi()
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter>
            <ServersPage />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    )

    await screen.findByLabelText('Pennywise PCI adapter map')
    await user.click(screen.getByRole('checkbox', { name: 'Only free NICs' }))

    expect(
      screen.queryByLabelText('Pennywise PCI adapter map'),
    ).not.toBeInTheDocument()
    expect(screen.getByLabelText('Chucky PCI adapter map')).toBeInTheDocument()
    expect(
      screen.getAllByText('No free NICs match the current filter.'),
    ).toHaveLength(2)
  })
})
