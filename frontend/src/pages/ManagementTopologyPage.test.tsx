import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ManagementPort,
  ManagementSwitch,
  NicView,
  ServerWithNics,
} from '../api/types'
import { ToastProvider } from '../lib/toast'
import { BrandingProvider } from '../lib/branding'
import { ManagementTopologyPage } from './ManagementTopologyPage'

function managementPort(
  id: string,
  switchId: string,
  switchName: string,
  name: string,
  overrides: Partial<ManagementPort>,
): ManagementPort {
  return {
    id,
    switch_id: switchId,
    switch_name: switchName,
    name,
    ifname: name,
    ifindex: null,
    speed_gbps: 1,
    cable_label: '',
    peer_port_id: null,
    peer_port_switch_id: null,
    peer_nic_id: null,
    peer_nic_server_id: null,
    peer_tofino_id: null,
    peer_server_id: null,
    peer_text: '',
    peer_label: '',
    comment: '',
    sort_order: 0,
    updated_by_display_name: null,
    updated_at: 0,
    vlans: [],
    ...overrides,
  }
}

function nic(id: string, serverId: string, name: string): NicView {
  return {
    id,
    server_id: serverId,
    name,
    pci_address: '',
    nic_type: '',
    speed_gbps: 1,
    ifname: name,
    mac: '',
    numa_node: null,
    kind: 'pf',
    usage: 'Management',
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
  }
}

function server(id: string, name: string, nics: NicView[] = []): ServerWithNics {
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
    sort_order: 0,
    nics,
  }
}

const switches: ManagementSwitch[] = [
  {
    id: 'sw-a',
    name: 'hp-1',
    mgmt_ip: '10.10.0.2',
    model: 'HP',
    notes: '',
    active: true,
    sort_order: 0,
    created_at: 0,
    updated_at: 0,
  },
  {
    id: 'sw-b',
    name: 'hp-2',
    mgmt_ip: '10.10.0.3',
    model: 'HP',
    notes: '',
    active: true,
    sort_order: 1,
    created_at: 0,
    updated_at: 0,
  },
]

const ports = [
  managementPort('p-host', 'sw-a', 'hp-1', '7', {
    peer_nic_id: 'nic-chucky-mgmt',
    peer_nic_server_id: 'srv-chucky',
  }),
  managementPort('p-ortef', 'sw-a', 'hp-1', '20', {
    peer_nic_id: 'nic-ortef-mgmt',
    peer_nic_server_id: 'srv-ortef',
  }),
  managementPort('p-tofino', 'sw-a', 'hp-1', '9', {
    peer_tofino_id: 'tof-carrie',
  }),
  managementPort('p-trunk-a', 'sw-a', 'hp-1', '23', {
    peer_port_id: 'p-trunk-b',
    peer_port_switch_id: 'sw-b',
  }),
  managementPort('p-trunk-b', 'sw-b', 'hp-2', '24', {
    peer_port_id: 'p-trunk-a',
    peer_port_switch_id: 'sw-a',
  }),
  managementPort('p-wsi', 'sw-b', 'hp-2', '1', {
    peer_text: 'WSI Uplink',
  }),
]

function mockApi() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = String(input)
    const body = url.includes('/api/v1/config')
      ? {
          app_name: 'RSVP',
          app_subtitle: 'Test lab',
          app_tagline: 'Reserve hardware.',
          logo_url: null,
          favicon_url: '/favicon.svg',
          repository_url: 'https://github.com/n1tr0-5urf3r/kn-rsvp',
          topology_switch_order: ['hp-1', 'hp-2'],
          topology_uplink_labels: ['WSI Uplink'],
          topology_preferred_uplink: 'WSI',
          topology_central_node: 'Ortef',
        }
      : url.includes('/management-switch-ports')
      ? { ports }
      : url.includes('/management-switches')
        ? { switches }
        : url.includes('/servers')
          ? {
              servers: [
                server('srv-chucky', 'Chucky', [
                  nic('nic-chucky-mgmt', 'srv-chucky', 'eno1'),
                ]),
                server('srv-ortef', 'Ortef', [
                  nic('nic-ortef-mgmt', 'srv-ortef', 'eno1'),
                ]),
              ],
            }
          : {
              tofinos: [
                {
                  id: 'tof-carrie',
                  name: 'Carrie',
                  version: 1,
                  notes: null,
                  active: true,
                  mgmt_peer_label: null,
                },
              ],
            }
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
        <BrandingProvider>
          <MemoryRouter>
            <ManagementTopologyPage />
          </MemoryRouter>
        </BrandingProvider>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ManagementTopologyPage', () => {
  it('searches a hostname and traces it through Ortef to WSI', async () => {
    const user = userEvent.setup()
    const beginElement = vi.fn()
    const svgPrototype = SVGElement.prototype as SVGElement & {
      beginElement?: () => void
    }
    svgPrototype.beginElement = beginElement
    mockApi()
    try {
      renderPage()

      const search = await screen.findByRole('searchbox', {
        name: 'Search management topology',
      })
      await user.type(search, 'chuck')

      expect(screen.getByText('1 direct match')).toBeInTheDocument()
      expect(
        document.querySelector('[data-topology-node-id="server:srv-ortef"]'),
      ).toHaveStyle({ width: '88px' })
      expect(
        document.querySelector('[data-topology-node-id="tofino:tof-carrie"]'),
      ).toHaveStyle({ width: '88px' })
      expect(
        document.querySelector('[data-topology-node-id="switch:sw-a"]'),
      ).not.toHaveStyle({ width: '88px' })
      const traceButton = screen.getByRole('button', { name: 'Chucky' })
      await user.click(traceButton)

      const status = screen.getByRole('status')
      expect(status).toHaveTextContent('Tracing Chucky to uplink')
      expect(status).toHaveTextContent(
        'Chucky → hp-1 → Ortef → hp-1 → hp-2 → WSI Uplink',
      )
      expect(status).toHaveTextContent('routed through central gateway')
      expect(document.querySelector('[data-trace-packet="true"]')).toBeInTheDocument()
      expect(document.querySelector('[data-trace-packet="true"] animateMotion'))
        .toHaveAttribute('begin', 'indefinite')
      expect(document.querySelector('[data-trace-packet="true"] animateMotion'))
        .toHaveAttribute('repeatCount', 'indefinite')
      expect(beginElement).toHaveBeenCalledTimes(1)

      // Initiating the same trace again must restart the packet at Chucky's
      // port instead of leaving the existing animation mid-route.
      await user.click(screen.getByRole('button', { name: 'Trace Chucky to uplink' }))
      expect(beginElement).toHaveBeenCalledTimes(2)

      expect(
        document.querySelector('[data-topology-node-id="tofino:tof-carrie"]'),
      ).toHaveStyle({ width: '88px' })
      expect(
        document.querySelector('[data-topology-node-id="server:srv-ortef"]'),
      ).not.toHaveStyle({ width: '88px' })
    } finally {
      delete svgPrototype.beginElement
    }
  })

  it('pins node links and opens the port editor from a topology endpoint', async () => {
    const user = userEvent.setup()
    mockApi()
    renderPage()

    await screen.findByRole('searchbox', {
      name: 'Search management topology',
    })
    const hostConnection = document.querySelector('[data-connection-id="nic:p-host"]')
    const ortefConnection = document.querySelector('[data-connection-id="nic:p-ortef"]')

    await user.click(
      screen.getByRole('button', { name: 'Pin Chucky connections' }),
    )
    expect(hostConnection).toHaveAttribute('data-highlighted', 'true')
    expect(ortefConnection).toHaveAttribute('data-highlighted', 'false')
    expect(
      screen.getByRole('button', { name: 'Unpin Chucky connections' }),
    ).toHaveAttribute('aria-pressed', 'true')

    await user.click(
      screen.getByRole('button', {
        name: 'Pin connection at hp-1 7',
      }),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit hp-1 7' }))
    expect(screen.getByRole('dialog', { name: 'Edit hp-1 7' })).toBeInTheDocument()
    expect(hostConnection).toHaveAttribute('data-highlighted', 'true')
    expect(ortefConnection).toHaveAttribute('data-highlighted', 'false')

    await user.click(screen.getByRole('button', { name: 'Close dialog' }))
    const canvas = screen.getByRole('img', {
      name: 'Management topology diagram',
    }).parentElement
    expect(canvas).not.toBeNull()
    await user.click(canvas!)
    expect(hostConnection).toHaveAttribute('data-highlighted', 'false')
    expect(ortefConnection).toHaveAttribute('data-highlighted', 'false')
  })

  it('previews one connection for a port hover and all connections for a switch hover', async () => {
    const user = userEvent.setup()
    mockApi()
    renderPage()

    await screen.findByRole('searchbox', {
      name: 'Search management topology',
    })
    const hostConnection = document.querySelector('[data-connection-id="nic:p-host"]')
    const ortefConnection = document.querySelector('[data-connection-id="nic:p-ortef"]')
    const trunkConnection = document.querySelector(
      '[data-connection-id="sp:p-trunk-a:p-trunk-b"]',
    )

    const port = screen.getByRole('button', {
      name: 'Pin connection at hp-1 7',
    })
    await user.hover(port)
    expect(hostConnection).toHaveAttribute('data-highlighted', 'true')
    expect(ortefConnection).toHaveAttribute('data-highlighted', 'false')
    expect(trunkConnection).toHaveAttribute('data-highlighted', 'false')
    await user.unhover(port)

    await user.hover(
      screen.getByRole('button', { name: 'Pin hp-1 connections' }),
    )
    expect(hostConnection).toHaveAttribute('data-highlighted', 'true')
    expect(ortefConnection).toHaveAttribute('data-highlighted', 'true')
    expect(trunkConnection).toHaveAttribute('data-highlighted', 'true')
  })

  it('compacts unrelated non-switch nodes while a server is pinned', async () => {
    const user = userEvent.setup()
    mockApi()
    renderPage()

    await screen.findByRole('searchbox', {
      name: 'Search management topology',
    })
    await user.click(
      screen.getByRole('button', { name: 'Pin Chucky connections' }),
    )

    expect(
      document.querySelector('[data-topology-node-id="server:srv-chucky"]'),
    ).not.toHaveStyle({ width: '88px' })
    expect(
      document.querySelector('[data-topology-node-id="server:srv-ortef"]'),
    ).toHaveStyle({ width: '88px' })
    expect(
      document.querySelector('[data-topology-node-id="tofino:tof-carrie"]'),
    ).toHaveStyle({ width: '88px' })
    expect(
      document.querySelector('[data-topology-node-id="text:p-wsi"]'),
    ).toHaveStyle({ width: '88px' })
    expect(
      document.querySelector('[data-topology-node-id="switch:sw-a"]'),
    ).not.toHaveStyle({ width: '88px' })

    await user.click(
      screen.getByRole('button', { name: 'Unpin Chucky connections' }),
    )
    expect(
      document.querySelector('[data-topology-node-id="server:srv-ortef"]'),
    ).not.toHaveStyle({ width: '88px' })
    expect(
      document.querySelector('[data-topology-node-id="tofino:tof-carrie"]'),
    ).not.toHaveStyle({ width: '88px' })
    expect(
      document.querySelector('[data-topology-node-id="text:p-wsi"]'),
    ).not.toHaveStyle({ width: '88px' })
  })

  it('uses the same compaction for Tofino, external, and switch selections', async () => {
    const user = userEvent.setup()
    mockApi()
    renderPage()

    await screen.findByRole('searchbox', {
      name: 'Search management topology',
    })

    await user.click(
      screen.getByRole('button', { name: 'Pin Carrie connections' }),
    )
    expect(
      document.querySelector('[data-topology-node-id="tofino:tof-carrie"]'),
    ).not.toHaveStyle({ width: '88px' })
    expect(
      document.querySelector('[data-topology-node-id="server:srv-chucky"]'),
    ).toHaveStyle({ width: '88px' })

    await user.click(
      screen.getByRole('button', { name: 'Unpin Carrie connections' }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Pin WSI Uplink connections' }),
    )
    expect(
      document.querySelector('[data-topology-node-id="text:p-wsi"]'),
    ).not.toHaveStyle({ width: '88px' })
    expect(
      document.querySelector('[data-topology-node-id="tofino:tof-carrie"]'),
    ).toHaveStyle({ width: '88px' })

    await user.click(
      screen.getByRole('button', { name: 'Unpin WSI Uplink connections' }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Pin hp-1 connections' }),
    )
    expect(
      document.querySelector('[data-topology-node-id="switch:sw-a"]'),
    ).not.toHaveStyle({ width: '88px' })
    expect(
      document.querySelector('[data-topology-node-id="text:p-wsi"]'),
    ).toHaveStyle({ width: '88px' })
  })
})
