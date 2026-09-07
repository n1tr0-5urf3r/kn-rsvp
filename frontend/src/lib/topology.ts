import type { ServerWithNics, TofinoPort } from '../api/types'

export type TopologyConnection = {
  id: string
  kind: 'tofino' | 'server'
  fromNodeId: string
  toNodeId: string
  fromEndpointId: string
  toEndpointId: string
  fromEndpointLabel: string
  toEndpointLabel: string
  toEndpointDetail: string
  fromLabel: string
  toLabel: string
  speedGbps: number
  cableLabel: string
  comment: string
  /** Comment-derived grouping label shown as "Usage" in the topology. */
  usage: string
}

export type TopologyBundle = {
  id: string
  kind: 'tofino' | 'server'
  fromNodeId: string
  toNodeId: string
  connections: TopologyConnection[]
}

export type ExternalConnection = {
  id: string
  tofinoId: string
  fromLabel: string
  toLabel: string
  cableLabel: string
  comment: string
  usage: string
}

export function buildTopology(
  ports: TofinoPort[],
  servers: ServerWithNics[],
): {
  bundles: TopologyBundle[]
  external: ExternalConnection[]
} {
  const portById = new Map(ports.map((port) => [port.id, port]))
  const nicById = new Map(
    servers.flatMap((server) =>
      server.nics.map((nic) => [nic.id, { nic, server }] as const),
    ),
  )
  const seenPortLinks = new Set<string>()
  const seenNicLinks = new Set<string>()
  const connections: TopologyConnection[] = []
  const external: ExternalConnection[] = []

  for (const port of ports) {
    const fromNodeId = `tofino:${port.tofino_id}`
    const fromLabel = `${port.tofino_name} ${port.fp_port}`
    if (port.peer_port_id && port.peer_port_tofino_id) {
      const linkKey = [port.id, port.peer_port_id].sort().join(':')
      if (seenPortLinks.has(linkKey)) {
        continue
      }
      seenPortLinks.add(linkKey)
      const peer = portById.get(port.peer_port_id)
      connections.push({
        id: `port:${linkKey}`,
        kind: 'tofino',
        fromNodeId,
        toNodeId: `tofino:${port.peer_port_tofino_id}`,
        fromEndpointId: port.id,
        toEndpointId: port.peer_port_id,
        fromEndpointLabel: port.fp_port,
        toEndpointLabel: peer?.fp_port ?? port.peer_label,
        toEndpointDetail: peer?.pipe ?? '',
        fromLabel,
        toLabel:
          peer ? `${peer.tofino_name} ${peer.fp_port}` : port.peer_label,
        speedGbps: port.speed_gbps,
        cableLabel: port.cable_label,
        comment: port.comment,
        usage: port.comment.trim() || peer?.comment.trim() || '',
      })
    } else if (port.peer_nic_id && port.peer_nic_server_id) {
      const target = nicById.get(port.peer_nic_id)
      connections.push({
        id: `nic:${port.id}:${port.peer_nic_id}`,
        kind: 'server',
        fromNodeId,
        toNodeId: `server:${port.peer_nic_server_id}`,
        fromEndpointId: port.id,
        toEndpointId: port.peer_nic_id,
        fromEndpointLabel: port.fp_port,
        toEndpointLabel: target?.nic.name ?? port.peer_label,
        toEndpointDetail: target
          ? `${target.nic.pci_address.replace(/^0000:/, '')}${
              target.nic.ifname ? ` · ${target.nic.ifname}` : ''
            }`
          : '',
        fromLabel,
        toLabel: target
          ? `${target.server.name} ${target.nic.name}`
          : port.peer_label,
        speedGbps: port.speed_gbps,
        cableLabel: port.cable_label,
        comment: port.comment,
        usage:
          target?.nic.claim?.comment?.trim() || port.comment.trim() || '',
      })
    } else if (port.peer_text) {
      external.push({
        id: `external:${port.id}`,
        tofinoId: port.tofino_id,
        fromLabel,
        toLabel: port.peer_text,
        cableLabel: port.cable_label,
        comment: port.comment,
        usage: port.comment.trim(),
      })
    }
  }

  for (const server of servers) {
    for (const nic of server.nics) {
      if (!nic.peer_nic_id || !nic.peer_nic_server_id) {
        continue
      }
      const linkKey = [nic.id, nic.peer_nic_id].sort().join(':')
      if (seenNicLinks.has(linkKey)) {
        continue
      }
      seenNicLinks.add(linkKey)
      const target = nicById.get(nic.peer_nic_id)
      if (!target) {
        continue
      }
      connections.push({
        id: `server-nic:${linkKey}`,
        kind: 'server',
        fromNodeId: `server:${server.id}`,
        toNodeId: `server:${target.server.id}`,
        fromEndpointId: nic.id,
        toEndpointId: target.nic.id,
        fromEndpointLabel: nic.name,
        toEndpointLabel: target.nic.name,
        toEndpointDetail: `${target.nic.pci_address.replace(/^0000:/, '')}${
          target.nic.ifname ? ` · ${target.nic.ifname}` : ''
        }`,
        fromLabel: `${server.name} ${nic.name}`,
        toLabel: `${target.server.name} ${target.nic.name}`,
        speedGbps: Math.min(nic.speed_gbps, target.nic.speed_gbps),
        cableLabel:
          nic.claim?.cable_label || target.nic.claim?.cable_label || '',
        comment: nic.claim?.comment || target.nic.claim?.comment || '',
        usage:
          nic.claim?.comment?.trim() ||
          target.nic.claim?.comment?.trim() ||
          nic.usage.trim() ||
          target.nic.usage.trim(),
      })
    }
  }

  const bundlesByKey = new Map<string, TopologyBundle>()
  for (const connection of connections) {
    const nodePair = [connection.fromNodeId, connection.toNodeId].sort()
    const key = `${connection.kind}:${nodePair.join(':')}`
    const existing = bundlesByKey.get(key)
    if (existing) {
      existing.connections.push(connection)
    } else {
      bundlesByKey.set(key, {
        id: key,
        kind: connection.kind,
        fromNodeId: connection.fromNodeId,
        toNodeId: connection.toNodeId,
        connections: [connection],
      })
    }
  }

  return {
    bundles: [...bundlesByKey.values()],
    external,
  }
}
