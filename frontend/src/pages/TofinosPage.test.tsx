import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { TofinoPort } from '../api/types'
import { ToastProvider } from '../lib/toast'
import { TofinosPage } from './TofinosPage'

const tofinos = [
  { id: 'carrie', name: 'Carrie', version: 1, notes: '', active: true },
  { id: 'pazuzu', name: 'Pazuzu', version: 1, notes: '', active: true },
  { id: 'donnie', name: 'Donnie', version: 2, notes: '', active: true },
  { id: 'frank', name: 'Frank', version: 2, notes: '', active: true },
]

const donniePort: TofinoPort = {
  id: 'donnie-port-3',
  tofino_id: 'donnie',
  tofino_name: 'Donnie',
  fp_port: '3/0',
  dev_port: 152,
  pipe: '1/24',
  speed_gbps: 400,
  cable_label: '',
  peer_port_id: null,
  peer_port_tofino_id: null,
  peer_nic_id: null,
  peer_nic_server_id: null,
  peer_text: '',
  peer_label: '',
  comment: '',
  sort_order: 3,
  updated_by_display_name: null,
  updated_at: 0,
}

function mockApi({ admin = false, ports = [] as TofinoPort[] } = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = String(input)
    const body = url.includes('/tofino-ports')
      ? { ports }
      : url.includes('/tofinos')
        ? { tofinos }
        : url.includes('/servers')
          ? { servers: [] }
          : {
              user: {
                id: 'user-1',
                display_name: 'Test Admin',
                is_admin: admin,
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

describe('TofinosPage', () => {
  it('stacks every front panel in the requested order with detail links', async () => {
    mockApi()
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter>
            <TofinosPage />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    )

    expect(
      await screen.findByText('Front-panel overview of every switch.'),
    ).toBeInTheDocument()
    const faceplates = await screen.findAllByLabelText(/front-panel port map/)
    expect(
      faceplates.map((faceplate) => faceplate.getAttribute('aria-label')),
    ).toEqual([
      'Donnie front-panel port map',
      'Frank front-panel port map',
      'Pazuzu front-panel port map',
      'Carrie front-panel port map',
    ])
    expect(
      screen
        .getAllByRole('link', { name: /Details/ })
        .map((link) => link.getAttribute('href')),
    ).toEqual([
      '/tofinos/donnie',
      '/tofinos/frank',
      '/tofinos/pazuzu',
      '/tofinos/carrie',
    ])
  })

  it('opens the selected port editor from the overview for admins', async () => {
    const user = userEvent.setup()
    mockApi({ admin: true, ports: [donniePort] })
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter>
            <TofinosPage />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    )

    const portButton = await screen.findByRole('button', {
      name: 'Donnie port 3/0: not connected; activate to edit',
    })
    await user.click(portButton)

    expect(
      screen.getByRole('dialog', { name: 'Donnie 3/0' }),
    ).toBeInTheDocument()
    expect(screen.getAllByText('152')).toHaveLength(2)
    expect(screen.getByDisplayValue('400')).toBeInTheDocument()
  })

  it('highlights a hovered or pinned comment group across all Tofinos', async () => {
    const user = userEvent.setup()
    const ports = [
      { ...donniePort, comment: 'Fabric uplink' },
      {
        ...donniePort,
        id: 'carrie-port-3',
        tofino_id: 'carrie',
        tofino_name: 'Carrie',
        comment: 'Fabric uplink',
      },
      {
        ...donniePort,
        id: 'frank-port-3',
        tofino_id: 'frank',
        tofino_name: 'Frank',
        comment: 'Packet generator',
      },
    ]
    mockApi({ ports })
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter>
            <TofinosPage />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    )

    const donnie = await screen.findByRole('button', {
      name: 'Donnie port 3/0: not connected',
    })
    const carrie = screen.getByRole('button', {
      name: 'Carrie port 3/0: not connected',
    })
    const frank = screen.getByRole('button', {
      name: 'Frank port 3/0: not connected',
    })
    const fabricLegends = screen.getAllByRole('button', {
      name: 'Comment group: Fabric uplink',
    })

    await user.hover(fabricLegends[0])
    expect(donnie).toHaveAttribute('data-comment-highlighted', 'true')
    expect(carrie).toHaveAttribute('data-comment-highlighted', 'true')
    expect(frank).toHaveAttribute('data-comment-highlighted', 'false')

    await user.unhover(fabricLegends[0])
    expect(donnie).not.toHaveAttribute('data-comment-highlighted')

    await user.click(fabricLegends[0])
    expect(donnie).toHaveAttribute('data-comment-highlighted', 'true')
    expect(carrie).toHaveAttribute('data-comment-highlighted', 'true')
    expect(frank).toHaveAttribute('data-comment-highlighted', 'false')
    for (const legend of fabricLegends) {
      expect(legend).toHaveAttribute('aria-pressed', 'true')
    }

    await user.click(fabricLegends[0])
    expect(donnie).not.toHaveAttribute('data-comment-highlighted')
  })
})
