import { describe, expect, it } from 'vitest'
import type { ManagementPort, NicView, PortVlan, ServerWithNics, Tofino } from '../api/types'
import {
  buildManagementTopology as buildTopology,
  collectVlanLegend,
  searchManagementTopology,
  traceManagementUplink as traceUplink,
  type ManagementTopologyPreferences,
  type MgmtConnection,
  type MgmtNode,
} from './managementTopology'

const LAB_PREFERENCES: ManagementTopologyPreferences = {
  switchOrder: ['ubnt', 'hp-1', 'mikrotik', 'hp-3', 'hp-2'],
  uplinkLabels: ['WSI Uplink', 'ZDV Uplink'],
  preferredUplink: 'WSI',
  centralNode: 'Ortef',
}

function buildManagementTopology(
  ports: ManagementPort[],
  servers: ServerWithNics[],
  tofinos: Tofino[],
) {
  return buildTopology(ports, servers, tofinos, LAB_PREFERENCES)
}

function traceManagementUplink(
  nodes: readonly MgmtNode[],
  connections: readonly MgmtConnection[],
  startNodeId: string,
) {
  return traceUplink(nodes, connections, startNodeId, LAB_PREFERENCES)
}

function vlan(vlanId: number, tagged: boolean, name = ''): PortVlan {
  return { vlan_id: vlanId, vlan_db_id: `db-${vlanId}`, name, purpose: '', tagged }
}

function port(
  id: string,
  switchId: string,
  switchName: string,
  name: string,
  overrides: Partial<ManagementPort> = {},
): ManagementPort {
  return {
    id,
    switch_id: switchId,
    switch_name: switchName,
    name,
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

function nic(id: string, name: string, overrides: Partial<NicView> = {}): NicView {
  return {
    id,
    server_id: 'server-1',
    name,
    pci_address: '0000:01:00.0',
    nic_type: '',
    speed_gbps: 1,
    ifname: name,
    mac: '',
    numa_node: null,
    kind: 'pf',
    usage: '',
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

describe('buildManagementTopology', () => {
  it('expands every VLAN membership, tagged and untagged, into filterable keys', () => {
    const ports = [
      port('p1', 'sw-1', 'ubnt', '1', {
        peer_text: 'Traffic generator',
        vlans: [vlan(10, false, 'mgmt'), vlan(20, true, 'storage'), vlan(30, true)],
      }),
    ]
    const { connections } = buildManagementTopology(ports, [], [])
    expect(connections).toHaveLength(1)
    const [connection] = connections
    expect(connection.vlans.map((v) => v.key).sort()).toEqual(
      ['vlan:10', 'vlan:20', 'vlan:30'].sort(),
    )
    expect(connection.vlans.find((v) => v.vlanId === 20)?.label).toBe('storage (20)')
    expect(connection.vlans.find((v) => v.vlanId === 30)?.label).toBe('30')
    // Untagged wins as the primary/default colour even though it isn't first.
    expect(connection.primaryVlan?.vlanId).toBe(10)
    expect(connection.primaryVlan?.tagged).toBe(false)

    const legend = collectVlanLegend(connections)
    expect(legend.map((v) => v.key).sort()).toEqual(['vlan:10', 'vlan:20', 'vlan:30'].sort())
  })

  it('falls back to the lowest tagged VLAN as primary when there is no untagged membership', () => {
    const ports = [
      port('p1', 'sw-1', 'ubnt', '1', {
        peer_text: 'Trunk only',
        vlans: [vlan(30, true), vlan(20, true)],
      }),
    ]
    const { connections } = buildManagementTopology(ports, [], [])
    expect(connections[0].primaryVlan?.vlanId).toBe(20)
    expect(connections[0].primaryVlan?.tagged).toBe(true)
  })

  it('marks a whole-server peer as a distinct IPMI endpoint, separate from regular NIC links', () => {
    const ortef = server('srv-ortef', 'Ortef', [nic('nic-eno1', 'eno1')])
    const ports = [
      port('p-eno1', 'sw-1', 'hp-1', '20', {
        peer_nic_id: 'nic-eno1',
        peer_nic_server_id: 'srv-ortef',
      }),
      port('p-ipmi', 'sw-1', 'hp-1', '19', {
        peer_server_id: 'srv-ortef',
        comment: 'IPMI',
      }),
    ]
    const { connections, nodes } = buildManagementTopology(ports, [ortef], [])
    const nicConnection = connections.find((c) => c.id === 'nic:p-eno1')
    const ipmiConnection = connections.find((c) => c.id === 'srv:p-ipmi')
    expect(nicConnection?.toEndpointIsIpmi).toBe(false)
    expect(nicConnection?.toEndpointId).toBe('nic-eno1')
    expect(ipmiConnection?.toEndpointIsIpmi).toBe(true)
    expect(ipmiConnection?.toEndpointId).not.toBe(nicConnection?.toEndpointId)
    expect(ipmiConnection?.toEndpointLabel).toBe('IPMI')
    expect(ipmiConnection?.isIpmi).toBe(true)

    // Both connections land on the same server node -- two distinct endpoints.
    const serverNode = nodes.find((n) => n.id === 'server:srv-ortef')
    expect(serverNode?.rank).toBe('central')
  })

  it('does not import ordinary claimed testbed NIC cables', () => {
    const chucky = server('srv-chucky', 'Chucky', [
      nic('nic-82-1', '82.1', {
        server_id: 'srv-chucky',
        claim: {
          user_id: null,
          user_display_name: '',
          cable_label: 'A23',
          comment: 'Tofino link',
          connected_to: 'Carrie 23/0',
          updated_at: 0,
        },
      }),
    ])

    const topology = buildManagementTopology([], [chucky], [])

    expect(topology.connections).toEqual([])
    expect(topology.nodes).toEqual([])
  })

  it('renders WSI/ZDV uplinks as senior to the switch row', () => {
    const ports = [
      port('p1', 'sw-hp2', 'hp-2 (HP 2920-24G)', '1', { peer_text: 'WSI Uplink' }),
      port('p2', 'sw-hp2', 'hp-2 (HP 2920-24G)', '2', { peer_text: 'ZDV Uplink' }),
      port('p3', 'sw-hp2', 'hp-2 (HP 2920-24G)', '3', { peer_text: 'Some other host' }),
    ]
    const { connections, nodes } = buildManagementTopology(ports, [], [])
    const wsi = connections.find((c) => c.toLabel === 'WSI Uplink')
    const zdv = connections.find((c) => c.toLabel === 'ZDV Uplink')
    const other = connections.find((c) => c.toLabel === 'Some other host')
    expect(wsi?.isUplink).toBe(true)
    expect(zdv?.isUplink).toBe(true)
    expect(other?.isUplink).toBe(false)
    expect(nodes.find((n) => n.label === 'WSI Uplink')?.rank).toBe('uplink')
    expect(nodes.find((n) => n.label === 'Some other host')?.rank).toBe('other')
  })

  it('orders switches by rack: ubnt/hp-1, mikrotik/hp-3, then hp-2 last', () => {
    const ports = [
      port('p1', 'sw-hp2', 'hp-2 (HP 2920-24G)', '1', { peer_text: 'x' }),
      port('p2', 'sw-ubnt', 'ubnt (Ubiquity ES-16-XG)', '1', { peer_text: 'y' }),
      port('p3', 'sw-hp1', 'hp-1 (HP 2920-24G)', '1', { peer_text: 'z' }),
      port('p4', 'sw-mkt', 'mikrotik-1', '1', { peer_text: 'w' }),
      port('p5', 'sw-hp3', 'hp-3 (HP 2920-24G)', '1', { peer_text: 'v' }),
    ]
    const { nodes } = buildManagementTopology(ports, [], [])
    const switches = nodes
      .filter((n) => n.kind === 'switch')
      .sort((a, b) => a.switchOrder - b.switchOrder)
      .map((n) => n.label)
    expect(switches).toEqual([
      'ubnt (Ubiquity ES-16-XG)',
      'hp-1 (HP 2920-24G)',
      'mikrotik-1',
      'hp-3 (HP 2920-24G)',
      'hp-2 (HP 2920-24G)',
    ])
  })

  it('marks Ortef central regardless of which port links to it', () => {
    const ortef = server('srv-ortef', 'Ortef', [])
    const other = server('srv-other', 'Chucky', [])
    const ports = [
      port('p1', 'sw-1', 'ubnt', '1', { peer_server_id: 'srv-ortef', comment: 'IPMI' }),
      port('p2', 'sw-1', 'ubnt', '2', { peer_server_id: 'srv-other', comment: 'IPMI' }),
    ]
    const { nodes } = buildManagementTopology(ports, [ortef, other], [])
    expect(nodes.find((n) => n.label === 'Ortef')?.rank).toBe('central')
    expect(nodes.find((n) => n.label === 'Chucky')?.rank).toBe('other')
  })

  it('deduplicates mirrored switch<->switch links', () => {
    const ports = [
      port('p1', 'sw-a', 'A', '1', { peer_port_id: 'p2', peer_port_switch_id: 'sw-b' }),
      port('p2', 'sw-b', 'B', '1', { peer_port_id: 'p1', peer_port_switch_id: 'sw-a' }),
    ]
    const { connections } = buildManagementTopology(ports, [], [])
    expect(connections).toHaveLength(1)
  })

  it('resolves a Tofino management peer', () => {
    const tofino: Tofino = {
      id: 'tof-1',
      name: 'Carrie',
      version: 1,
      notes: null,
      active: true,
      mgmt_peer_label: null,
    }
    const ports = [port('p1', 'sw-1', 'ubnt', '5', { peer_tofino_id: 'tof-1' })]
    const { connections, nodes } = buildManagementTopology(ports, [], [tofino])
    expect(connections[0]).toMatchObject({ toKind: 'tofino', toLabel: 'Carrie', toEndpointLabel: 'mgmt' })
    expect(nodes.find((n) => n.kind === 'tofino')?.label).toBe('Carrie')
  })

  it('searches hostnames and expands a match to all directly related links', () => {
    const chucky = server('srv-chucky', 'Chucky')
    const ports = [
      port('p1', 'sw-1', 'hp-1', '7', {
        peer_server_id: 'srv-chucky',
        comment: 'IPMI',
        cable_label: 'R1-C07',
        vlans: [vlan(2, false, 'WSI')],
      }),
      port('p2', 'sw-1', 'hp-1', '8', { peer_text: 'Unrelated' }),
    ]
    const topology = buildManagementTopology(ports, [chucky], [])

    const hostname = searchManagementTopology(
      topology.nodes,
      topology.connections,
      'chuck',
    )
    expect(hostname.matchingNodeIds).toEqual(['server:srv-chucky'])
    expect(hostname.connectionIds).toEqual(['srv:p1'])
    expect(hostname.relatedNodeIds).toEqual(
      expect.arrayContaining(['server:srv-chucky', 'switch:sw-1']),
    )

    const cable = searchManagementTopology(
      topology.nodes,
      topology.connections,
      'r1-c07',
    )
    expect(cable.matchingNodeIds).toEqual([])
    expect(cable.connectionIds).toEqual(['srv:p1'])
    expect(cable.relatedNodeIds).toEqual(
      expect.arrayContaining(['server:srv-chucky', 'switch:sw-1']),
    )
  })

  it('traces an internal host through Ortef NAT to the preferred WSI uplink', () => {
    const chucky = server('srv-chucky', 'Chucky', [
      nic('nic-host', 'eno1', { server_id: 'srv-chucky' }),
    ])
    const ortef = server('srv-ortef', 'Ortef', [
      nic('nic-ortef', 'eno1', { server_id: 'srv-ortef' }),
    ])
    const ports = [
      port('p-host', 'sw-a', 'hp-1', '7', {
        peer_nic_id: 'nic-host',
        peer_nic_server_id: 'srv-chucky',
      }),
      port('p-ortef', 'sw-a', 'hp-1', '20', {
        peer_nic_id: 'nic-ortef',
        peer_nic_server_id: 'srv-ortef',
      }),
      port('p-trunk-a', 'sw-a', 'hp-1', '23', {
        peer_port_id: 'p-trunk-b',
        peer_port_switch_id: 'sw-b',
      }),
      port('p-trunk-b', 'sw-b', 'hp-2', '24', {
        peer_port_id: 'p-trunk-a',
        peer_port_switch_id: 'sw-a',
      }),
      port('p-wsi', 'sw-b', 'hp-2', '1', { peer_text: 'WSI Uplink' }),
      port('p-zdv', 'sw-b', 'hp-2', '2', { peer_text: 'ZDV Uplink' }),
    ]
    const topology = buildManagementTopology(ports, [chucky, ortef], [])
    const trace = traceManagementUplink(
      topology.nodes,
      topology.connections,
      'server:srv-chucky',
    )

    expect(trace?.viaCentral).toBe(true)
    expect(trace?.nodeIds).toEqual([
      'server:srv-chucky',
      'switch:sw-a',
      'server:srv-ortef',
      'switch:sw-a',
      'switch:sw-b',
      'text:p-wsi',
    ])
    expect(trace?.connectionIds).toEqual([
      'nic:p-host',
      'nic:p-ortef',
      'nic:p-ortef',
      'sp:p-trunk-a:p-trunk-b',
      'txt:p-wsi',
    ])
  })

  it('falls back to a direct physical uplink trace when no central router is modeled', () => {
    const host = server('srv-host', 'Host', [
      nic('nic-host', 'eno1', { server_id: 'srv-host' }),
    ])
    const ports = [
      port('p-host', 'sw-a', 'hp-1', '7', {
        peer_nic_id: 'nic-host',
        peer_nic_server_id: 'srv-host',
      }),
      port('p-wsi', 'sw-a', 'hp-1', '23', { peer_text: 'WSI Uplink' }),
    ]
    const topology = buildManagementTopology(ports, [host], [])
    const trace = traceManagementUplink(
      topology.nodes,
      topology.connections,
      'server:srv-host',
    )

    expect(trace).toMatchObject({
      nodeIds: ['server:srv-host', 'switch:sw-a', 'text:p-wsi'],
      viaCentral: false,
    })
  })

  it('does not force switches or endpoints already on the WSI VLAN through Ortef', () => {
    const host = server('srv-host', 'Host', [
      nic('nic-host', 'eno1', { server_id: 'srv-host' }),
    ])
    const ortef = server('srv-ortef', 'Ortef', [
      nic('nic-ortef', 'eno1', { server_id: 'srv-ortef' }),
    ])
    const ports = [
      port('p-host', 'sw-a', 'hp-1', '7', {
        peer_nic_id: 'nic-host',
        peer_nic_server_id: 'srv-host',
        vlans: [vlan(2, false, 'WSI')],
      }),
      port('p-ortef', 'sw-a', 'hp-1', '20', {
        peer_nic_id: 'nic-ortef',
        peer_nic_server_id: 'srv-ortef',
        vlans: [vlan(1, false, 'TB')],
      }),
      port('p-trunk-a', 'sw-a', 'hp-1', '23', {
        peer_port_id: 'p-trunk-b',
        peer_port_switch_id: 'sw-b',
        vlans: [vlan(2, true, 'WSI')],
      }),
      port('p-trunk-b', 'sw-b', 'hp-2', '24', {
        peer_port_id: 'p-trunk-a',
        peer_port_switch_id: 'sw-a',
        vlans: [vlan(2, true, 'WSI')],
      }),
      port('p-wsi', 'sw-b', 'hp-2', '1', {
        peer_text: 'WSI Uplink',
        vlans: [vlan(2, false, 'WSI')],
      }),
    ]
    const topology = buildManagementTopology(ports, [host, ortef], [])

    expect(
      traceManagementUplink(topology.nodes, topology.connections, 'server:srv-host'),
    ).toMatchObject({
      nodeIds: ['server:srv-host', 'switch:sw-a', 'switch:sw-b', 'text:p-wsi'],
      viaCentral: false,
    })
    expect(
      traceManagementUplink(topology.nodes, topology.connections, 'switch:sw-a'),
    ).toMatchObject({
      nodeIds: ['switch:sw-a', 'switch:sw-b', 'text:p-wsi'],
      viaCentral: false,
    })
  })

  it('routes through Ortef when the WSI VLAN is only tagged on the endpoint port', () => {
    const host = server('srv-host', 'Host', [
      nic('nic-host', 'eno1', { server_id: 'srv-host' }),
    ])
    const ortef = server('srv-ortef', 'Ortef', [
      nic('nic-ortef', 'eno1', { server_id: 'srv-ortef' }),
    ])
    const ports = [
      port('p-host', 'sw-a', 'hp-1', '7', {
        peer_nic_id: 'nic-host',
        peer_nic_server_id: 'srv-host',
        vlans: [vlan(10, false, 'Management'), vlan(2, true, 'WSI')],
      }),
      port('p-ortef', 'sw-a', 'hp-1', '20', {
        peer_nic_id: 'nic-ortef',
        peer_nic_server_id: 'srv-ortef',
        vlans: [vlan(10, false, 'Management')],
      }),
      port('p-trunk-a', 'sw-a', 'hp-1', '23', {
        peer_port_id: 'p-trunk-b',
        peer_port_switch_id: 'sw-b',
        vlans: [vlan(2, true, 'WSI')],
      }),
      port('p-trunk-b', 'sw-b', 'hp-2', '24', {
        peer_port_id: 'p-trunk-a',
        peer_port_switch_id: 'sw-a',
        vlans: [vlan(2, true, 'WSI')],
      }),
      port('p-wsi', 'sw-b', 'hp-2', '1', {
        peer_text: 'WSI Uplink',
        vlans: [vlan(2, false, 'WSI')],
      }),
    ]
    const topology = buildManagementTopology(ports, [host, ortef], [])

    expect(
      traceManagementUplink(topology.nodes, topology.connections, 'server:srv-host'),
    ).toMatchObject({
      nodeIds: [
        'server:srv-host',
        'switch:sw-a',
        'server:srv-ortef',
        'switch:sw-a',
        'switch:sw-b',
        'text:p-wsi',
      ],
      viaCentral: true,
    })
  })

  it('uses switch trunks instead of treating a multi-homed server as transit', () => {
    const bridge = server('srv-bridge', 'Bridge', [
      nic('nic-a', 'eth0', { server_id: 'srv-bridge' }),
      nic('nic-b', 'eth1', { server_id: 'srv-bridge' }),
    ])
    const ports = [
      port('p-bridge-a', 'sw-a', 'A', '1', {
        peer_nic_id: 'nic-a',
        peer_nic_server_id: 'srv-bridge',
      }),
      port('p-bridge-b', 'sw-b', 'B', '1', {
        peer_nic_id: 'nic-b',
        peer_nic_server_id: 'srv-bridge',
      }),
      port('p-ac', 'sw-a', 'A', '24', {
        peer_port_id: 'p-ca',
        peer_port_switch_id: 'sw-c',
      }),
      port('p-ca', 'sw-c', 'C', '23', {
        peer_port_id: 'p-ac',
        peer_port_switch_id: 'sw-a',
      }),
      port('p-cb', 'sw-c', 'C', '24', {
        peer_port_id: 'p-bc',
        peer_port_switch_id: 'sw-b',
      }),
      port('p-bc', 'sw-b', 'B', '23', {
        peer_port_id: 'p-cb',
        peer_port_switch_id: 'sw-c',
      }),
      port('p-wsi', 'sw-b', 'B', '24', { peer_text: 'WSI Uplink' }),
    ]
    const topology = buildManagementTopology(ports, [bridge], [])
    const trace = traceManagementUplink(
      topology.nodes,
      topology.connections,
      'switch:sw-a',
    )

    expect(trace?.nodeIds).toEqual([
      'switch:sw-a',
      'switch:sw-c',
      'switch:sw-b',
      'text:p-wsi',
    ])
    expect(trace?.nodeIds).not.toContain('server:srv-bridge')
  })

  it('never uses an IPMI attachment as Ortef\'s interface towards the uplink', () => {
    const host = server('srv-host', 'Host', [
      nic('nic-host', 'eno1', { server_id: 'srv-host' }),
    ])
    const ortef = server('srv-ortef', 'Ortef', [
      nic('nic-ortef', 'eno1', { server_id: 'srv-ortef' }),
    ])
    const ports = [
      port('p-host', 'sw-a', 'hp-1', '7', {
        peer_nic_id: 'nic-host',
        peer_nic_server_id: 'srv-host',
      }),
      port('p-ortef', 'sw-a', 'hp-1', '20', {
        peer_nic_id: 'nic-ortef',
        peer_nic_server_id: 'srv-ortef',
      }),
      port('p-ortef-ipmi', 'sw-b', 'hp-2', '19', {
        peer_server_id: 'srv-ortef',
        comment: 'IPMI',
      }),
      port('p-trunk-a', 'sw-a', 'hp-1', '23', {
        peer_port_id: 'p-trunk-b',
        peer_port_switch_id: 'sw-b',
      }),
      port('p-trunk-b', 'sw-b', 'hp-2', '24', {
        peer_port_id: 'p-trunk-a',
        peer_port_switch_id: 'sw-a',
      }),
      port('p-wsi', 'sw-b', 'hp-2', '1', { peer_text: 'WSI Uplink' }),
    ]
    const topology = buildManagementTopology(ports, [host, ortef], [])
    const trace = traceManagementUplink(
      topology.nodes,
      topology.connections,
      'server:srv-host',
    )

    expect(trace?.connectionIds).toEqual([
      'nic:p-host',
      'nic:p-ortef',
      'nic:p-ortef',
      'sp:p-trunk-a:p-trunk-b',
      'txt:p-wsi',
    ])
    expect(trace?.connectionIds).not.toContain('srv:p-ortef-ipmi')
  })

  it('does not invent an uplink trace for an IPMI-only endpoint', () => {
    const host = server('srv-host', 'Host')
    const ports = [
      port('p-host-ipmi', 'sw-a', 'hp-1', '7', {
        peer_server_id: 'srv-host',
        comment: 'IPMI',
      }),
      port('p-wsi', 'sw-a', 'hp-1', '23', { peer_text: 'WSI Uplink' }),
    ]
    const topology = buildManagementTopology(ports, [host], [])

    expect(
      traceManagementUplink(topology.nodes, topology.connections, 'server:srv-host'),
    ).toBeNull()
  })
})
