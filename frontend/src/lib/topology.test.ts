import { describe, expect, it } from 'vitest'
import type { NicView, ServerWithNics, TofinoPort } from '../api/types'
import { buildTopology } from './topology'

function port(
  id: string,
  tofinoId: string,
  tofinoName: string,
  fpPort: string,
  overrides: Partial<TofinoPort> = {},
): TofinoPort {
  return {
    id,
    tofino_id: tofinoId,
    tofino_name: tofinoName,
    fp_port: fpPort,
    dev_port: 0,
    pipe: '0/0',
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

function nic(id: string): NicView {
  return {
    id,
    server_id: 'server-1',
    name: 'ens1f0',
    pci_address: '0000:81:00.0',
    nic_type: 'ConnectX-6',
    speed_gbps: 100,
    ifname: 'ens1f0',
    mac: '',
    numa_node: 0,
    kind: 'pf',
    usage: 'DPDK',
    peer_port_id: 'a3',
    peer_port_tofino_id: 'a',
    peer_port_label: 'Carrie 3/0',
    peer_nic_id: null,
    peer_nic_server_id: null,
    peer_nic_label: null,
    peer_mgmt_port_id: null,
    peer_mgmt_switch_id: null,
    peer_mgmt_port_label: null,
    sort_order: 0,
    claim: {
      user_id: null,
      user_display_name: 'DPDK course',
      connected_to: null,
      cable_label: null,
      comment: 'Packet generator',
      updated_at: 0,
    },
  }
}

const server: ServerWithNics = {
  id: 'server-1',
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
  nics: [nic('nic-1')],
}

describe('buildTopology', () => {
  it('deduplicates mirrored switch links and bundles parallel links', () => {
    const ports = [
      port('a1', 'a', 'Carrie', '1/0', {
        peer_port_id: 'b1',
        peer_port_tofino_id: 'b',
        peer_label: 'Donnie 1/0',
      }),
      port('b1', 'b', 'Donnie', '1/0', {
        peer_port_id: 'a1',
        peer_port_tofino_id: 'a',
        peer_label: 'Carrie 1/0',
      }),
      port('a2', 'a', 'Carrie', '2/0', {
        peer_port_id: 'b2',
        peer_port_tofino_id: 'b',
        peer_label: 'Donnie 2/0',
      }),
      port('b2', 'b', 'Donnie', '2/0', {
        peer_port_id: 'a2',
        peer_port_tofino_id: 'a',
        peer_label: 'Carrie 2/0',
      }),
    ]

    const topology = buildTopology(ports, [server])
    expect(topology.bundles).toHaveLength(1)
    expect(topology.bundles[0].connections).toHaveLength(2)
  })

  it('maps server NIC and free-text endpoints separately', () => {
    const topology = buildTopology(
      [
        port('a3', 'a', 'Carrie', '3/0', {
          peer_nic_id: 'nic-1',
          peer_nic_server_id: 'server-1',
          peer_label: 'Pennywise ens1f0',
        }),
        port('a4', 'a', 'Carrie', '4/0', {
          peer_text: 'Traffic generator',
        }),
      ],
      [server],
    )

    expect(topology.bundles[0]).toMatchObject({
      kind: 'server',
      fromNodeId: 'tofino:a',
      toNodeId: 'server:server-1',
    })
    expect(topology.bundles[0].connections[0].toLabel).toBe(
      'Pennywise ens1f0',
    )
    expect(topology.bundles[0].connections[0]).toMatchObject({
      fromEndpointId: 'a3',
      fromEndpointLabel: '3/0',
      toEndpointId: 'nic-1',
      toEndpointLabel: 'ens1f0',
      toEndpointDetail: '81:00.0 · ens1f0',
      usage: 'Packet generator',
    })
    expect(topology.external[0].toLabel).toBe('Traffic generator')
  })

  it('uses Tofino port comments as switch-link usage groups', () => {
    const topology = buildTopology(
      [
        port('a1', 'a', 'Carrie', '1/0', {
          peer_port_id: 'b1',
          peer_port_tofino_id: 'b',
          peer_label: 'Donnie 1/0',
          comment: 'Fabric uplink',
        }),
        port('b1', 'b', 'Donnie', '1/0', {
          peer_port_id: 'a1',
          peer_port_tofino_id: 'a',
          peer_label: 'Carrie 1/0',
        }),
      ],
      [server],
    )

    expect(topology.bundles[0].connections[0].usage).toBe('Fabric uplink')
  })

  it('deduplicates symmetric server NIC links', () => {
    const first = {
      ...nic('nic-1'),
      peer_port_id: null,
      peer_port_tofino_id: null,
      peer_port_label: null,
      peer_nic_id: 'nic-2',
      peer_nic_server_id: 'server-2',
      peer_nic_label: 'Chucky 82.0',
    }
    const second = {
      ...nic('nic-2'),
      server_id: 'server-2',
      name: '82.0',
      peer_port_id: null,
      peer_port_tofino_id: null,
      peer_port_label: null,
      peer_nic_id: 'nic-1',
      peer_nic_server_id: 'server-1',
      peer_nic_label: 'Pennywise ens1f0',
    }
    const topology = buildTopology([], [
      { ...server, nics: [first] },
      { ...server, id: 'server-2', name: 'Chucky', nics: [second] },
    ])

    expect(topology.bundles).toHaveLength(1)
    expect(topology.bundles[0]).toMatchObject({
      kind: 'server',
      fromNodeId: 'server:server-1',
      toNodeId: 'server:server-2',
    })
    expect(topology.bundles[0].connections).toHaveLength(1)
    expect(topology.bundles[0].connections[0]).toMatchObject({
      fromLabel: 'Pennywise ens1f0',
      toLabel: 'Chucky 82.0',
      usage: 'Packet generator',
    })
  })
})
