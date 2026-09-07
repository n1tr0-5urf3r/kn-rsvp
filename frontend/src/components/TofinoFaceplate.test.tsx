import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { TofinoPort } from '../api/types'
import { TofinoFaceplate } from './TofinoFaceplate'

function port(
  fpPort: string,
  overrides: Partial<TofinoPort> = {},
): TofinoPort {
  return {
    id: `port-${fpPort}`,
    tofino_id: 'carrie',
    tofino_name: 'Carrie',
    fp_port: fpPort,
    dev_port: 132,
    pipe: '2/4',
    speed_gbps: 100,
    cable_label: '',
    peer_port_id: null,
    peer_port_tofino_id: null,
    peer_nic_id: null,
    peer_nic_server_id: null,
    peer_text: '',
    peer_label: '',
    comment: '',
    sort_order: 0,
    updated_by_display_name: null,
    updated_at: 0,
    ...overrides,
  }
}

describe('TofinoFaceplate', () => {
  it('maps documented ports to cages with connection details', () => {
    const { container } = render(
      <TofinoFaceplate
        tofinoName="Carrie"
        ports={[
          port('1/0', {
            peer_port_id: 'donnie-2',
            peer_port_tofino_id: 'donnie',
            peer_label: 'Donnie 2/0',
            cable_label: 'A22',
            comment: 'Fabric uplink',
          }),
          port('2/0', { comment: 'Fabric uplink' }),
          port('3/0', { comment: 'Packet generator' }),
        ]}
      />,
    )

    const first = screen.getByRole('button', {
      name: 'Carrie port 1/0: connected to Donnie 2/0',
    })
    const sameComment = screen.getByRole('button', {
      name: 'Carrie port 2/0: not connected',
    })
    const otherComment = screen.getByRole('button', {
      name: 'Carrie port 3/0: not connected',
    })
    expect(first).toHaveStyle({
      borderColor: '#c2284a',
      backgroundColor: '#c2284a33',
    })
    expect(first.style.borderColor).toBe(sameComment.style.borderColor)
    expect(first.style.borderColor).not.toBe(otherComment.style.borderColor)
    expect(first).toHaveAttribute('data-comment-group', 'Fabric uplink')
    expect(screen.getByText('Donnie 2/0')).toBeInTheDocument()
    expect(screen.getByText('A22')).toBeInTheDocument()
    expect(screen.getAllByText('Peer')).not.toHaveLength(0)
    expect(screen.getAllByText('Usage')).not.toHaveLength(0)
    expect(
      document.querySelector('[data-comment-legend="Fabric uplink"]'),
    ).toBeInTheDocument()
    expect(screen.getByTitle('Port 32/0 is not documented')).toBeInTheDocument()

    const cage = (number: number) =>
      container.querySelector<HTMLElement>(`[data-cage-number="${number}"]`)
    expect(cage(1)).toHaveStyle({ gridColumn: '1', gridRow: '1' })
    expect(cage(2)).toHaveStyle({ gridColumn: '1', gridRow: '2' })
    expect(cage(3)).toHaveStyle({ gridColumn: '2', gridRow: '1' })
    expect(cage(4)).toHaveStyle({ gridColumn: '2', gridRow: '2' })
  })

  it('supports filtered highlighting and admin click-to-edit', async () => {
    const user = userEvent.setup()
    const onPortClick = vi.fn()
    const first = port('1/0')
    const second = port('2/0')
    render(
      <TofinoFaceplate
        tofinoName="Carrie"
        ports={[first, second]}
        visiblePortIds={new Set([first.id])}
        onPortClick={onPortClick}
      />,
    )

    const dimmed = screen.getByRole('button', {
      name: /Carrie port 2\/0: not connected/,
    })
    expect(dimmed).toHaveClass('opacity-25')
    await user.click(dimmed)
    expect(onPortClick).toHaveBeenCalledWith(second)
  })
})
