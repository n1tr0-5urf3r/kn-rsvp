import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { ManagementPort, PortVlan } from '../api/types'
import { createUsageColorMap, FACEPLATE_COMMENT_COLORS } from '../lib/usageColors'
import { ManagementFaceplate } from './ManagementFaceplate'

function port(
  id: string,
  switchName: string,
  vlanId: number,
): ManagementPort {
  return {
    id,
    switch_id: switchName,
    switch_name: switchName,
    name: id,
    ifname: '',
    ifindex: null,
    speed_gbps: 1,
    cable_label: '',
    peer_port_id: null,
    peer_port_switch_id: null,
    peer_nic_id: null,
    peer_nic_server_id: null,
    peer_tofino_id: null,
    peer_server_id: null,
    peer_text: 'peer',
    peer_label: 'peer',
    comment: '',
    sort_order: 0,
    updated_by_display_name: null,
    updated_at: 0,
    vlans: [
      {
        vlan_id: vlanId,
        vlan_db_id: `vlan-${vlanId}`,
        name: '',
        purpose: '',
        tagged: false,
      },
    ],
  }
}

function member(vlanId: number, tagged: boolean, name = ''): PortVlan {
  return {
    vlan_id: vlanId,
    vlan_db_id: `vlan-${vlanId}`,
    name,
    purpose: '',
    tagged,
  }
}

describe('ManagementFaceplate', () => {
  it('uses a shared VLAN palette supplied by the switch overview', () => {
    const sharedColors = new Map([
      ['VLAN 10', '#112233'],
      ['VLAN 20', '#445566'],
    ])
    const first = port('1', 'Switch A', 10)
    const second = port('2', 'Switch B', 10)

    const { container, rerender } = render(
      <ManagementFaceplate
        switchName="Switch A"
        ports={[first]}
        vlanColors={sharedColors}
      />,
    )
    expect(screen.getByRole('button', { name: /Switch A port 1/ })).toHaveStyle({
      borderColor: '#112233',
    })
    expect(container.querySelector('[data-faceplate-controls]')).toHaveAttribute(
      'aria-hidden',
      'true',
    )

    rerender(
      <ManagementFaceplate
        switchName="Switch B"
        ports={[second]}
        vlanColors={sharedColors}
      />,
    )
    expect(screen.getByRole('button', { name: /Switch B port 2/ })).toHaveStyle({
      borderColor: '#112233',
    })
  })

  it('renders tagged-only ports neutrally instead of using a VLAN colour', () => {
    const taggedOnly = port('3', 'Ubuntu', 2)
    taggedOnly.vlans = [member(2, true, 'WSI'), member(10, true, 'Management')]
    const sharedColors = createUsageColorMap(
      ['', 'VLAN 2', 'VLAN 10'],
      FACEPLATE_COMMENT_COLORS,
    )

    render(
      <ManagementFaceplate
        switchName="Ubuntu"
        ports={[taggedOnly]}
        vlanColors={sharedColors}
      />,
    )

    expect(screen.getByRole('button', { name: /Ubuntu port 3/ })).toHaveStyle({
      borderColor: '#8b8792',
    })
  })

  it('includes tagged and untagged members and keeps a clicked VLAN selected', async () => {
    const user = userEvent.setup()
    const tagged = port('1', 'Switch A', 10)
    tagged.vlans = [member(10, false), member(20, true, 'storage')]
    const untagged = port('2', 'Switch A', 20)
    untagged.vlans = [member(20, false, 'storage')]
    const unrelated = port('3', 'Switch A', 30)

    render(
      <ManagementFaceplate
        switchName="Switch A"
        ports={[tagged, untagged, unrelated]}
      />,
    )

    const vlan20 = screen.getByRole('button', {
      name: 'VLAN filter: storage (20)',
    })
    const taggedPort = screen.getByRole('button', { name: /Switch A port 1/ })
    const untaggedPort = screen.getByRole('button', { name: /Switch A port 2/ })
    const unrelatedPort = screen.getByRole('button', { name: /Switch A port 3/ })

    await user.hover(vlan20)
    expect(taggedPort).not.toHaveClass('opacity-20')
    expect(untaggedPort).not.toHaveClass('opacity-20')
    expect(unrelatedPort).toHaveClass('opacity-20')
    await user.unhover(vlan20)
    expect(unrelatedPort).not.toHaveClass('opacity-20')

    await user.click(vlan20)
    await user.unhover(vlan20)
    expect(vlan20).toHaveAttribute('aria-pressed', 'true')
    expect(taggedPort).not.toHaveClass('opacity-20')
    expect(untaggedPort).not.toHaveClass('opacity-20')
    expect(unrelatedPort).toHaveClass('opacity-20')

    await user.click(vlan20)
    await user.unhover(vlan20)
    expect(vlan20).toHaveAttribute('aria-pressed', 'false')
    expect(unrelatedPort).not.toHaveClass('opacity-20')
  })

  it('presents port details as labeled fields and VLAN badges', () => {
    const detailed = port('1', 'Switch A', 10)
    detailed.ifname = 'xe-0/0/1'
    detailed.ifindex = 7
    detailed.speed_gbps = 10
    detailed.peer_label = 'Pennywise b5.0'
    detailed.cable_label = 'M-017'
    detailed.comment = 'Management uplink'
    detailed.vlans = [
      member(10, false, 'management'),
      member(20, true, 'storage'),
    ]

    render(<ManagementFaceplate switchName="Switch A" ports={[detailed]} />)

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('Switch A 1')
    expect(screen.getByText('Interface')).toBeInTheDocument()
    expect(screen.getByText('xe-0/0/1 · if7')).toBeInTheDocument()
    expect(screen.getByText('Pennywise b5.0')).toBeInTheDocument()
    expect(screen.getByText('M-017')).toBeInTheDocument()
    expect(screen.getByText('Management uplink')).toBeInTheDocument()
    expect(tooltip).toHaveTextContent('management (10)U')
    expect(tooltip).toHaveTextContent('storage (20)T')
  })
})
