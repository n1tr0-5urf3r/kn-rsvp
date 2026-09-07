import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../lib/theme'
import { AppShell } from './AppShell'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AppShell navigation', () => {
  it('groups the inventory pages under one active Testbed entry', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          user: {
            id: 'admin-1',
            username: 'admin',
            display_name: 'Admin',
            email: null,
            is_admin: true,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/tofinos']}>
            <Routes>
              <Route element={<AppShell />}>
                <Route path="/tofinos" element={<p>Tofinos page</p>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>,
    )

    const navigation = screen.getByRole('navigation', {
      name: 'Main navigation',
    })
    expect(within(navigation).getByRole('link', { name: 'Testbed' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(
      within(navigation).queryByRole('link', { name: 'Servers' }),
    ).not.toBeInTheDocument()
    expect(
      within(navigation).queryByRole('link', { name: 'Tofinos' }),
    ).not.toBeInTheDocument()
    expect(
      within(navigation).queryByRole('link', { name: 'Topology' }),
    ).not.toBeInTheDocument()
    expect(
      await within(navigation).findByRole('link', { name: 'Admin' }),
    ).toBeInTheDocument()
    expect(
      within(navigation).getByRole('link', { name: 'Infrastructure' }),
    ).toHaveAttribute('href', '/management')
  })
})
