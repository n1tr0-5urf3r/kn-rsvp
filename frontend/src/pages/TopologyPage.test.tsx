import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { NicView, ServerWithNics, Tofino, TofinoPort } from '../api/types'
import { ToastProvider } from '../lib/toast'
import { TopologyPage } from './TopologyPage'

function mockApi({
  ports = [],
  tofinos = [],
  servers = [],
  isAdmin = false,
}: {
  ports?: TofinoPort[]
  tofinos?: Tofino[]
  servers?: ServerWithNics[]
  isAdmin?: boolean
} = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = String(input)
    const body = url.includes('/auth/me')
      ? { user: { id: 'u1', is_admin: isAdmin } }
      : url.includes('/tofino-ports')
        ? { ports }
        : url.includes('/tofinos')
          ? { tofinos }
          : { servers }
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(body)),
      json: () => Promise.resolve(body),
    } as Response)
  })
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter>
          <TopologyPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

function nic(id: string, name: string): NicView {
  return {
    id,
    server_id: 'server-1',
    name,
    pci_address: `0000:81:00.${id === 'nic-1' ? '0' : '1'}`,
    nic_type: 'ConnectX-6',
    speed_gbps: 100,
    ifname: name,
    mac: '',
    numa_node: 0,
    kind: 'pf',
    usage: 'DPDK',
    peer_port_id: id === 'nic-1' ? 'p1' : 'p2',
    peer_port_tofino_id: 'tof-1',
    peer_port_label: `Carrie ${id === 'nic-1' ? '1/0' : '2/0'}`,
    peer_nic_id: null,
    peer_nic_server_id: null,
    peer_nic_label: null,
    peer_mgmt_port_id: null,
    peer_mgmt_switch_id: null,
    peer_mgmt_port_label: null,
    sort_order: id === 'nic-1' ? 0 : 1,
    claim: null,
  }
}

function tofinoPort(id: string, fpPort: string, nicId: string): TofinoPort {
  return {
    id,
    tofino_id: 'tof-1',
    tofino_name: 'Carrie',
    fp_port: fpPort,
    dev_port: id === 'p1' ? 0 : 4,
    pipe: id === 'p1' ? '0/0' : '0/4',
    speed_gbps: 100,
    cable_label: id.toUpperCase(),
    peer_port_id: null,
    peer_port_tofino_id: null,
    peer_nic_id: nicId,
    peer_nic_server_id: 'server-1',
    peer_text: '',
    peer_label: `Pennywise ${nicId}`,
    comment: 'DPDK',
    sort_order: id === 'p1' ? 0 : 1,
    updated_by_display_name: null,
    updated_at: 0,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TopologyPage', () => {
  it('renders at viewport width without a separate expansion control', async () => {
    mockApi()
    renderPage()

    const heading = await screen.findByRole('heading', {
      name: 'Topology rendering',
    })
    expect(
      heading.closest('.w-\\[calc\\(100vw-1rem\\)\\]'),
    ).not.toBeNull()
    expect(
      screen.queryByRole('button', { name: /topology to .* width/i }),
    ).not.toBeInTheDocument()
  })

  it('separates endpoint hover, node hover, pinning, and port editing', async () => {
    const user = userEvent.setup()
    const ports = [
      tofinoPort('p1', '1/0', 'nic-1'),
      tofinoPort('p2', '2/0', 'nic-2'),
    ]
    mockApi({
      ports,
      isAdmin: true,
      tofinos: [
        {
          id: 'tof-1',
          name: 'Carrie',
          version: 1,
          notes: null,
          active: true,
          mgmt_peer_label: null,
        },
      ],
      servers: [
        {
          id: 'server-1',
          name: 'Pennywise',
          description: null,
          cpu_model: '',
          cpu_sockets: null,
          cpu_cores: null,
          cpu_threads: null,
          cpu_mhz: null,
          memory_gb: null,
          reservable: false,
          sort_order: 0,
          nics: [nic('nic-1', 'ens1f0'), nic('nic-2', 'ens1f1')],
        },
      ],
    })
    renderPage()

    await screen.findByRole('heading', { name: 'Topology rendering' })
    const firstConnection = document.querySelector(
      '[data-connection-id="nic:p1:nic-1"]',
    )
    const secondConnection = document.querySelector(
      '[data-connection-id="nic:p2:nic-2"]',
    )
    const firstPort = screen.getByRole('button', {
      name: 'Pin connection at Carrie port 1/0',
    })

    await user.hover(firstPort)
    expect(firstConnection).toHaveAttribute('data-highlighted', 'true')
    expect(secondConnection).toHaveAttribute('data-highlighted', 'false')
    await user.unhover(firstPort)

    await user.hover(
      screen.getByRole('button', { name: 'Pin Carrie connections' }),
    )
    expect(firstConnection).toHaveAttribute('data-highlighted', 'true')
    expect(secondConnection).toHaveAttribute('data-highlighted', 'true')
    await user.unhover(
      screen.getByRole('button', { name: 'Pin Carrie connections' }),
    )

    await user.click(firstPort)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(firstConnection).toHaveAttribute('data-highlighted', 'true')
    expect(secondConnection).toHaveAttribute('data-highlighted', 'false')

    await user.click(screen.getByRole('button', { name: 'Edit Carrie port 1/0' }))
    expect(screen.getByRole('dialog', { name: 'Carrie 1/0' })).toBeInTheDocument()
  })

  it('hides port editing from users without edit permission', async () => {
    mockApi({
      ports: [tofinoPort('p1', '1/0', 'nic-1')],
      tofinos: [
        {
          id: 'tof-1',
          name: 'Carrie',
          version: 1,
          notes: null,
          active: true,
          mgmt_peer_label: null,
        },
      ],
      servers: [
        {
          id: 'server-1',
          name: 'Pennywise',
          description: null,
          cpu_model: '',
          cpu_sockets: null,
          cpu_cores: null,
          cpu_threads: null,
          cpu_mhz: null,
          memory_gb: null,
          reservable: false,
          sort_order: 0,
          nics: [nic('nic-1', 'ens1f0')],
        },
      ],
    })
    renderPage()

    await screen.findByRole('heading', { name: 'Topology rendering' })
    expect(
      screen.queryByRole('button', { name: 'Edit Carrie port 1/0' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('pencil to edit')).not.toBeInTheDocument()
  })

  it('omits devices that have no visible structured links', async () => {
    mockApi({
      ports: [tofinoPort('p1', '1/0', 'nic-1')],
      tofinos: [
        {
          id: 'tof-1',
          name: 'Carrie',
          version: 1,
          notes: null,
          active: true,
          mgmt_peer_label: null,
        },
        {
          id: 'tof-idle',
          name: 'Idle switch',
          version: 1,
          notes: null,
          active: true,
          mgmt_peer_label: null,
        },
      ],
      servers: [
        {
          id: 'server-1',
          name: 'Pennywise',
          description: null,
          cpu_model: '',
          cpu_sockets: null,
          cpu_cores: null,
          cpu_threads: null,
          cpu_mhz: null,
          memory_gb: null,
          reservable: false,
          sort_order: 0,
          nics: [nic('nic-1', 'ens1f0')],
        },
        {
          id: 'server-idle',
          name: 'Idle server',
          description: null,
          cpu_model: '',
          cpu_sockets: null,
          cpu_cores: null,
          cpu_threads: null,
          cpu_mhz: null,
          memory_gb: null,
          reservable: false,
          sort_order: 1,
          nics: [],
        },
      ],
    })
    renderPage()

    expect(
      await screen.findByRole('button', { name: 'Pin Carrie connections' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Pin Idle switch connections' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Pin Idle server connections' }),
    ).not.toBeInTheDocument()
  })
})
