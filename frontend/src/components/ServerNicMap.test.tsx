import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { NicView, ServerWithNics } from '../api/types'
import { pciAddressFamily, ServerNicMap } from './ServerNicMap'

function nic(
  id: string,
  pciAddress: string,
  name: string,
  overrides: Partial<NicView> = {},
): NicView {
  return {
    id,
    server_id: 'pennywise',
    name,
    pci_address: pciAddress,
    nic_type: 'ConnectX-6 Dx',
    speed_gbps: 100,
    ifname: name,
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
    claim: null,
    ...overrides,
  }
}

const nics = [
  nic('nic-0', '0000:81:00.0', 'ens1f0'),
  nic('nic-1', '0000:81:00.1', 'ens1f1', {
    peer_port_id: 'port-1',
    peer_port_tofino_id: 'carrie',
    peer_port_label: 'Carrie 1/0',
  }),
  nic('nic-2', '0000:82:00.0', 'ens2f0'),
]

const server: ServerWithNics = {
  id: 'pennywise',
  name: 'Pennywise',
  description: null,
  cpu_model: '',
  cpu_sockets: null,
  cpu_cores: null,
  cpu_threads: null,
  cpu_mhz: null,
  memory_gb: null,
  reservable: true,
  sort_order: 0,
  nics,
}

describe('ServerNicMap', () => {
  it('normalizes PCI functions into their shared adapter family', () => {
    expect(pciAddressFamily('0000:81:00.0')).toBe('0000:81:00')
    expect(pciAddressFamily('81:00.7')).toBe('81:00')
    expect(pciAddressFamily('onboard')).toBe('onboard')
  })

  it('groups functions vertically and supports click-to-edit', async () => {
    const user = userEvent.setup()
    const onNicClick = vi.fn()
    render(
      <ServerNicMap
        server={server}
        nics={nics}
        onNicClick={onNicClick}
      />,
    )

    expect(screen.getByRole('heading', { name: 'PCI 81:00' })).toBeInTheDocument()
    expect(screen.getByText('2 fn')).toBeInTheDocument()
    const linkedNic = screen.getByRole('button', {
      name: /Pennywise NIC ens1f1, PCI function \.1: Carrie 1\/0/,
    })
    await user.click(linkedNic)
    expect(onNicClick).toHaveBeenCalledWith(nics[1])
  })

  it('uses the claim Comment to color and highlight NICs', () => {
    const documentedNics = [
      nic('nic-a', '0000:81:00.0', 'ens1f0', {
        claim: {
          user_id: null,
          user_display_name: '',
          connected_to: null,
          cable_label: null,
          comment: 'Fabric uplink',
          updated_at: 0,
        },
      }),
      nic('nic-b', '0000:81:00.1', 'ens1f1', {
        claim: {
          user_id: null,
          user_display_name: '',
          connected_to: null,
          cable_label: null,
          comment: 'Fabric uplink',
          updated_at: 0,
        },
      }),
      nic('nic-c', '0000:82:00.0', 'ens2f0', {
        claim: {
          user_id: null,
          user_display_name: '',
          connected_to: null,
          cable_label: null,
          comment: 'Packet generator',
          updated_at: 0,
        },
      }),
    ]

    render(
      <ServerNicMap
        server={{ ...server, nics: documentedNics }}
        nics={documentedNics}
        activeCommentKey="Fabric uplink"
      />,
    )

    const first = screen.getByRole('button', {
      name: /Pennywise NIC ens1f0/,
    })
    const sameComment = screen.getByRole('button', {
      name: /Pennywise NIC ens1f1/,
    })
    const otherComment = screen.getByRole('button', {
      name: /Pennywise NIC ens2f0/,
    })

    expect(first.style.borderColor).toBe(sameComment.style.borderColor)
    expect(first.style.borderColor).not.toBe(otherComment.style.borderColor)
    expect(first).toHaveAttribute('data-comment-highlighted', 'true')
    expect(sameComment).toHaveAttribute('data-comment-highlighted', 'true')
    expect(otherComment).toHaveAttribute('data-comment-highlighted', 'false')
  })
})
