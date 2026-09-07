import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { TofinoPort } from '../api/types'
import { ToastProvider } from '../lib/toast'
import { TofinoPortsPage } from './TofinoPortsPage'

const tofino = {
  id: 't-carrie',
  name: 'Carrie',
  version: 1,
  notes: '',
  active: true,
}

function port(overrides: Partial<TofinoPort> & { fp_port: string }): TofinoPort {
  return {
    id: `p-${overrides.fp_port}`,
    tofino_id: 't-carrie',
    tofino_name: 'Carrie',
    dev_port: 132,
    pipe: '2/4',
    speed_gbps: 0,
    cable_label: '',
    peer_port_id: null,
    peer_port_tofino_id: null,
    peer_nic_id: null,
    peer_nic_server_id: null,
    peer_text: '',
    peer_label: '',
    comment: '',
    sort_order: 1,
    updated_by_display_name: null,
    updated_at: 0,
    ...overrides,
  }
}

const ports: TofinoPort[] = [
  port({
    fp_port: '1/0',
    dev_port: 132,
    speed_gbps: 100,
    cable_label: 'A22',
    peer_port_id: 'p-2/0',
    peer_port_tofino_id: 't-donnie',
    peer_label: 'Donnie 2/0',
    comment: 'Tofino2 loop',
  }),
  port({ fp_port: '4/0', dev_port: 156, pipe: '2/28' }),
]

/** Serves the three endpoints the page queries. */
function mockApi(isAdmin: boolean) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = String(input)
    const body = url.includes('/tofino-ports')
      ? { ports }
      : url.includes('/tofinos')
        ? { tofinos: [tofino] }
        : url.includes('/servers')
          ? { servers: [] }
          : { user: { id: 'u1', is_admin: isAdmin } }
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
        <MemoryRouter initialEntries={['/tofinos/t-carrie']}>
          <Routes>
            <Route path="/tofinos/:tofinoId" element={<TofinoPortsPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TofinoPortsPage', () => {
  it('lists the port map with its hardware facts and peers', async () => {
    mockApi(false)
    renderPage()

    expect(
      await screen.findByRole('heading', { level: 2, name: /Carrie/ }),
    ).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Carrie' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByText('2 ports documented, 1 connected')).toBeInTheDocument()

    // Read-only hardware facts.
    expect(screen.getAllByText('1/0')).toHaveLength(2)
    expect(screen.getAllByText('132')).toHaveLength(2)
    expect(screen.getAllByText('2/28')).toHaveLength(2)
    // Documented values.
    expect(screen.getAllByText('100 Gbit/s')).toHaveLength(2)
    expect(screen.getAllByText('A22')).toHaveLength(2)
    expect(
      within(screen.getByRole('table')).getByText('Tofino2 loop'),
    ).toBeInTheDocument()
    // A linked port jumps to the other Tofino's port map.
    expect(screen.getByRole('link', { name: 'Donnie 2/0' })).toHaveAttribute(
      'href',
      '/tofinos/t-donnie',
    )
    expect(
      screen.getByRole('button', {
        name: 'Carrie port 1/0: connected to Donnie 2/0',
      }),
    ).toBeInTheDocument()
  })

  it('offers editing only to admins', async () => {
    mockApi(false)
    const { unmount } = renderPage()
    expect(
      await screen.findByRole('heading', { level: 2, name: /Carrie/ }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Edit port 1/0')).not.toBeInTheDocument()
    expect(screen.queryByText('Import Markdown')).not.toBeInTheDocument()
    unmount()

    vi.restoreAllMocks()
    mockApi(true)
    renderPage()
    expect(await screen.findByLabelText('Edit port 1/0')).toBeInTheDocument()
    expect(screen.getByText('Import Markdown')).toBeInTheDocument()
    expect(screen.getByText('Add port')).toBeInTheDocument()
  })
})
