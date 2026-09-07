import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ManagementLayout } from './ManagementLayout'
import { TestbedLayout } from './TestbedLayout'

describe('section layouts', () => {
  it('keeps the icon-led Testbed navigation visible on detail pages', () => {
    render(
      <MemoryRouter initialEntries={['/tofinos/carrie']}>
        <Routes>
          <Route element={<TestbedLayout />}>
            <Route path="/tofinos/:tofinoId" element={<p>Tofino details</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(
      screen.getByRole('navigation', { name: 'Testbed sections' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^Servers/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^Tofinos/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: /^Topology/ })).toBeInTheDocument()
  })

  it('keeps Management navigation visible and marks Switches on a switch detail', () => {
    render(
      <MemoryRouter initialEntries={['/management/switches/hp-1']}>
        <Routes>
          <Route path="/management" element={<ManagementLayout />}>
            <Route path="switches/:switchId" element={<p>Switch details</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(
      screen.getByRole('navigation', { name: 'Management sections' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^Switches/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByText('Switch details')).toBeInTheDocument()
  })
})
