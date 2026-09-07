import type { ManagementPort, PortVlan, ServerWithNics, Tofino } from '../api/types'
import { vlanDisplayLabel, vlanFilterKey } from './vlanColors'

export type MgmtNodeKind = 'switch' | 'server' | 'tofino' | 'text'

/**
 * Where a node sits in the topology layout, independent of its `kind`:
 *  - `uplink`: the switch fabric's uplinks to the outside world,
 *    rendered senior to (above) the switch row.
 *  - `switch`: a management switch.
 *  - `central`: an optional infrastructure gateway, rendered in its own row
 *    between the switches and everything else.
 *  - `other`: everything else (regular servers, Tofinos, free-text ends).
 */
export type MgmtNodeRank = 'uplink' | 'switch' | 'central' | 'other'

export type MgmtVlanMembership = {
  /** Stable across tagged/untagged -- use this to match a VLAN filter. */
  key: string
  vlanId: number
  tagged: boolean
  /** "{name} ({id})" or just "{id}" when the VLAN has no name. */
  label: string
}

export type MgmtConnection = {
  id: string
  fromNodeId: string
  fromLabel: string
  fromEndpointId: string
  fromEndpointLabel: string
  toNodeId: string
  toKind: MgmtNodeKind
  toLabel: string
  toEndpointId: string
  toEndpointLabel: string
  /** True when this endpoint is a whole-server IPMI/BMC port, not a NIC --
   * kept as its own endpoint, never merged with a regular NIC link. */
  toEndpointIsIpmi: boolean
  cableLabel: string
  comment: string
  /** `comment` is "IPMI" (case-insensitive) -- drives the IPMI filter. */
  isIpmi: boolean
  /** A switch-fabric uplink to the outside world. */
  isUplink: boolean
  /** Every VLAN this port is a member of, tagged and untagged alike. Empty
   * for connections that don't originate from a switch port. */
  vlans: MgmtVlanMembership[]
  /** The untagged membership if there is one, else the lowest-numbered
   * tagged VLAN, else null. Used as the connection's default line colour. */
  primaryVlan: MgmtVlanMembership | null
}

export type MgmtNode = {
  id: string
  kind: MgmtNodeKind
  label: string
  rank: MgmtNodeRank
  /** Configured display order among switch nodes. Meaningless for other kinds. */
  switchOrder: number
}

export type ManagementTopologyPreferences = {
  switchOrder?: readonly string[]
  uplinkLabels?: readonly string[]
  preferredUplink?: string | null
  centralNode?: string | null
}

export type MgmtTopologySearchResult = {
  /** Nodes whose own label matches the query. */
  matchingNodeIds: string[]
  /** Matching nodes plus both ends of every related connection. */
  relatedNodeIds: string[]
  /** Connections matching directly or attached to a matching node. */
  connectionIds: string[]
}

export type MgmtUplinkTrace = {
  /** Ordered route, including a repeated switch for a one-armed gateway. */
  nodeIds: string[]
  /** Ordered physical links used by the route. */
  connectionIds: string[]
  uplinkNodeId: string
  /** True when the route was deliberately resolved through a central router. */
  viaCentral: boolean
}

function switchOrderFor(name: string, order: readonly string[]): number {
  const normalized = name.trim().toLowerCase()
  const index = order.findIndex((prefix) => normalized.startsWith(prefix.trim().toLowerCase()))
  return index === -1 ? order.length : index
}

function isUplinkLabel(label: string, configuredLabels: readonly string[]): boolean {
  const normalized = label.trim().toLowerCase()
  if (configuredLabels.length === 0) {
    return normalized.includes('uplink')
  }
  return configuredLabels.some((candidate) => candidate.trim().toLowerCase() === normalized)
}

function isCentralLabel(label: string, configuredLabel?: string | null): boolean {
  return Boolean(
    configuredLabel && label.trim().toLowerCase() === configuredLabel.trim().toLowerCase(),
  )
}

function vlanMembership(vlan: PortVlan): MgmtVlanMembership {
  return {
    key: vlanFilterKey(vlan.vlan_id),
    vlanId: vlan.vlan_id,
    tagged: vlan.tagged,
    label: vlanDisplayLabel(vlan.vlan_id, vlan.name),
  }
}

function primaryVlanOf(vlans: MgmtVlanMembership[]): MgmtVlanMembership | null {
  const untagged = vlans.find((vlan) => !vlan.tagged)
  if (untagged) {
    return untagged
  }
  const tagged = vlans.filter((vlan) => vlan.tagged).sort((a, b) => a.vlanId - b.vlanId)
  return tagged[0] ?? null
}

/** Every distinct VLAN referenced by any connection, for filter chips / legends. */
export function collectVlanLegend(
  connections: readonly MgmtConnection[],
): { key: string; label: string }[] {
  const byKey = new Map<string, string>()
  for (const connection of connections) {
    for (const vlan of connection.vlans) {
      if (!byKey.has(vlan.key)) {
        byKey.set(vlan.key, vlan.label)
      }
    }
  }
  return [...byKey.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
}

/**
 * Freetext search across the user-visible topology metadata. A hostname match
 * expands to all of that node's physical links; a port/cable/VLAN/comment
 * match expands to both devices at the ends of the matching link.
 */
export function searchManagementTopology(
  nodes: readonly MgmtNode[],
  connections: readonly MgmtConnection[],
  rawQuery: string,
): MgmtTopologySearchResult {
  const query = rawQuery.trim().toLocaleLowerCase()
  if (!query) {
    return { matchingNodeIds: [], relatedNodeIds: [], connectionIds: [] }
  }

  const matchingNodeIds = new Set(
    nodes
      .filter((node) => node.label.toLocaleLowerCase().includes(query))
      .map((node) => node.id),
  )
  const relatedNodeIds = new Set(matchingNodeIds)
  const connectionIds = new Set<string>()

  for (const connection of connections) {
    const searchable = [
      connection.fromLabel,
      connection.fromEndpointLabel,
      connection.toLabel,
      connection.toEndpointLabel,
      connection.cableLabel,
      connection.comment,
      ...connection.vlans.flatMap((vlan) => [vlan.label, String(vlan.vlanId)]),
    ]
      .join(' ')
      .toLocaleLowerCase()
    const attachedToMatch =
      matchingNodeIds.has(connection.fromNodeId) ||
      matchingNodeIds.has(connection.toNodeId)
    if (!attachedToMatch && !searchable.includes(query)) {
      continue
    }
    connectionIds.add(connection.id)
    relatedNodeIds.add(connection.fromNodeId)
    relatedNodeIds.add(connection.toNodeId)
  }

  return {
    matchingNodeIds: [...matchingNodeIds],
    relatedNodeIds: [...relatedNodeIds],
    connectionIds: [...connectionIds],
  }
}

type GraphPath = { nodeIds: string[]; connectionIds: string[] }

function shortestPath(
  connections: readonly MgmtConnection[],
  startNodeId: string,
  targetNodeId: string,
  blockedNodeIds: ReadonlySet<string> = new Set(),
  allowedTransitNodeIds: ReadonlySet<string> | null = null,
): GraphPath | null {
  if (startNodeId === targetNodeId) {
    return { nodeIds: [startNodeId], connectionIds: [] }
  }

  const adjacency = new Map<string, { nodeId: string; connectionId: string }[]>()
  const addStep = (from: string, nodeId: string, connectionId: string) => {
    const steps = adjacency.get(from) ?? []
    steps.push({ nodeId, connectionId })
    adjacency.set(from, steps)
  }
  for (const connection of connections) {
    addStep(connection.fromNodeId, connection.toNodeId, connection.id)
    addStep(connection.toNodeId, connection.fromNodeId, connection.id)
  }

  const previous = new Map<string, { nodeId: string; connectionId: string }>()
  const visited = new Set([startNodeId])
  const queue = [startNodeId]
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]
    for (const step of adjacency.get(current) ?? []) {
      if (
        visited.has(step.nodeId) ||
        (blockedNodeIds.has(step.nodeId) && step.nodeId !== targetNodeId) ||
        (allowedTransitNodeIds !== null &&
          step.nodeId !== targetNodeId &&
          !allowedTransitNodeIds.has(step.nodeId))
      ) {
        continue
      }
      visited.add(step.nodeId)
      previous.set(step.nodeId, { nodeId: current, connectionId: step.connectionId })
      if (step.nodeId === targetNodeId) {
        const nodeIds = [targetNodeId]
        const connectionIds: string[] = []
        let cursor = targetNodeId
        while (cursor !== startNodeId) {
          const hop = previous.get(cursor)
          if (!hop) {
            return null
          }
          connectionIds.unshift(hop.connectionId)
          nodeIds.unshift(hop.nodeId)
          cursor = hop.nodeId
        }
        return { nodeIds, connectionIds }
      }
      queue.push(step.nodeId)
    }
  }
  return null
}

function preferredUplinks(
  nodes: readonly MgmtNode[],
  preferredLabel?: string | null,
): MgmtNode[] {
  const preferred = preferredLabel?.trim().toLocaleLowerCase() ?? ''
  return nodes
    .filter((node) => node.rank === 'uplink')
    .sort((a, b) => {
      const aPreferred = preferred !== '' && a.label.toLocaleLowerCase().includes(preferred)
      const bPreferred = preferred !== '' && b.label.toLocaleLowerCase().includes(preferred)
      return Number(bPreferred) - Number(aPreferred) || a.label.localeCompare(b.label)
    })
}

function shortestPathToPreferredUplink(
  connections: readonly MgmtConnection[],
  nodes: readonly MgmtNode[],
  startNodeId: string,
  allowedTransitNodeIds: ReadonlySet<string>,
  preferredLabel?: string | null,
): (GraphPath & { uplinkNodeId: string }) | null {
  const uplinks = preferredUplinks(nodes, preferredLabel)
  const preferred = preferredLabel?.trim().toLocaleLowerCase() ?? ''
  const preferredMatches = preferred
    ? uplinks.filter((node) => node.label.toLocaleLowerCase().includes(preferred))
    : []
  const pathsTo = (candidates: readonly MgmtNode[]) =>
    candidates.map((uplink) => {
      const path = shortestPath(
        connections,
        startNodeId,
        uplink.id,
        new Set(),
        allowedTransitNodeIds,
      )
      return path ? { ...path, uplinkNodeId: uplink.id } : null
    })
    .filter((path): path is GraphPath & { uplinkNodeId: string } => path !== null)
    .sort((a, b) => a.connectionIds.length - b.connectionIds.length)[0] ?? null
  return pathsTo(preferredMatches) ?? pathsTo(uplinks)
}

/**
 * Resolve a host's route to the preferred uplink. Internal devices are routed
 * through an optional central infrastructure gateway. If that modeled route
 * is incomplete, fall back to the best connected physical uplink.
 */
export function traceManagementUplink(
  nodes: readonly MgmtNode[],
  connections: readonly MgmtConnection[],
  startNodeId: string,
  preferences: ManagementTopologyPreferences = {},
): MgmtUplinkTrace | null {
  const start = nodes.find((node) => node.id === startNodeId)
  if (!start) {
    return null
  }
  if (start.rank === 'uplink') {
    return {
      nodeIds: [start.id],
      connectionIds: [],
      uplinkNodeId: start.id,
      viaCentral: false,
    }
  }

  const blockedUplinks = new Set(
    nodes.filter((node) => node.rank === 'uplink').map((node) => node.id),
  )
  // Physical routes may enter/leave an endpoint, but only switches are valid
  // transit nodes. Without this guard, a multi-homed server can incorrectly
  // look like a shorter trunk between two switches.
  const switchTransitNodeIds = new Set(
    nodes.filter((node) => node.kind === 'switch').map((node) => node.id),
  )
  // IPMI/BMC links are out-of-band management attachments, not interfaces a
  // traced route may use towards an uplink. Exclude both explicit IPMI
  // comments and whole-server endpoints before doing any path calculation so
  // a physically shorter BMC link can never win the route search.
  const routableConnections = connections.filter(
    (connection) => !connection.isIpmi && !connection.toEndpointIsIpmi,
  )
  const direct = shortestPathToPreferredUplink(
    routableConnections,
    nodes,
    start.id,
    switchTransitNodeIds,
    preferences.preferredUplink,
  )
  const uplinks = preferredUplinks(nodes, preferences.preferredUplink)
  const preferred = preferences.preferredUplink?.trim().toLocaleLowerCase() ?? ''
  const preferredMatches = preferred
    ? uplinks.filter((node) => node.label.toLocaleLowerCase().includes(preferred))
    : []
  const preferredUplinkIds = new Set(
    (preferredMatches.length > 0 ? preferredMatches : uplinks).map((node) => node.id),
  )
  const uplinkVlanIds = new Set(
    routableConnections
      .filter(
        (connection) =>
          preferredUplinkIds.has(connection.fromNodeId) ||
          preferredUplinkIds.has(connection.toNodeId),
      )
      .flatMap((connection) => connection.vlans.map((vlan) => vlan.vlanId)),
  )
  const alreadyOnUplinkVlan = routableConnections
    .filter(
      (connection) =>
        connection.fromNodeId === start.id || connection.toNodeId === start.id,
    )
    .some((connection) =>
      connection.vlans.some(
        (vlan) => !vlan.tagged && uplinkVlanIds.has(vlan.vlanId),
      ),
    )
  const shouldRouteViaCentral =
    start.rank === 'central' ||
    (start.kind !== 'switch' && !alreadyOnUplinkVlan)

  if (!shouldRouteViaCentral) {
    return direct ? { ...direct, viaCentral: false } : null
  }

  const centralNodes = nodes.filter((node) => node.rank === 'central')
  const centralRoutes = centralNodes
    .map((central) => {
      const inbound = shortestPath(
        routableConnections,
        start.id,
        central.id,
        blockedUplinks,
        switchTransitNodeIds,
      )
      const outbound = shortestPathToPreferredUplink(
        routableConnections,
        nodes,
        central.id,
        switchTransitNodeIds,
        preferences.preferredUplink,
      )
      if (!inbound || !outbound) {
        return null
      }
      return {
        nodeIds: [...inbound.nodeIds, ...outbound.nodeIds.slice(1)],
        connectionIds: [...inbound.connectionIds, ...outbound.connectionIds],
        uplinkNodeId: outbound.uplinkNodeId,
        viaCentral: start.id !== central.id,
      }
    })
    .filter((route): route is MgmtUplinkTrace => route !== null)
    .sort((a, b) => a.connectionIds.length - b.connectionIds.length)

  if (centralRoutes[0]) {
    return centralRoutes[0]
  }

  return direct ? { ...direct, viaCentral: false } : null
}

/**
 * Flattens management-switch port links into deduplicated connections plus the
 * set of nodes they touch (switches, and the servers / Tofinos / free-text ends
 * they cable to). Switch↔switch links are mirrored, so they are deduped by the
 * sorted port-id pair -- exactly like the Tofino topology builder.
 */
export function buildManagementTopology(
  ports: ManagementPort[],
  servers: ServerWithNics[],
  tofinos: Tofino[],
  preferences: ManagementTopologyPreferences = {},
): { connections: MgmtConnection[]; nodes: MgmtNode[] } {
  const portById = new Map(ports.map((port) => [port.id, port]))
  const nicById = new Map(
    servers.flatMap((server) =>
      server.nics.map((nic) => [nic.id, { nic, server }] as const),
    ),
  )
  const tofinoById = new Map(tofinos.map((tofino) => [tofino.id, tofino]))
  const seenPortLinks = new Set<string>()
  const connections: MgmtConnection[] = []
  const nodes = new Map<string, MgmtNode>()

  const addNode = (
    id: string,
    kind: MgmtNodeKind,
    label: string,
    rank: MgmtNodeRank = 'other',
  ) => {
    if (!nodes.has(id)) {
      nodes.set(id, {
        id,
        kind,
        label,
        rank,
        switchOrder: kind === 'switch' ? switchOrderFor(label, preferences.switchOrder ?? []) : 0,
      })
    }
  }

  for (const port of ports) {
    const fromNodeId = `switch:${port.switch_id}`
    addNode(fromNodeId, 'switch', port.switch_name, 'switch')
    const vlans = port.vlans.map(vlanMembership)
    const isIpmi = port.comment.trim().toLowerCase() === 'ipmi'
    const base = {
      fromNodeId,
      fromLabel: port.switch_name,
      fromEndpointId: port.id,
      fromEndpointLabel: port.name,
      cableLabel: port.cable_label,
      comment: port.comment,
      isIpmi,
      vlans,
      primaryVlan: primaryVlanOf(vlans),
    }

    if (port.peer_port_id && port.peer_port_switch_id) {
      const linkKey = [port.id, port.peer_port_id].sort().join(':')
      if (seenPortLinks.has(linkKey)) {
        continue
      }
      seenPortLinks.add(linkKey)
      const peer = portById.get(port.peer_port_id)
      const toNodeId = `switch:${port.peer_port_switch_id}`
      addNode(toNodeId, 'switch', peer?.switch_name ?? port.peer_label, 'switch')
      connections.push({
        ...base,
        id: `sp:${linkKey}`,
        toNodeId,
        toKind: 'switch',
        toLabel: peer?.switch_name ?? port.peer_label,
        toEndpointId: port.peer_port_id,
        toEndpointLabel: peer?.name ?? '',
        toEndpointIsIpmi: false,
        isUplink: false,
      })
    } else if (port.peer_nic_id && port.peer_nic_server_id) {
      const target = nicById.get(port.peer_nic_id)
      const toNodeId = `server:${port.peer_nic_server_id}`
      const toLabel = target?.server.name ?? port.peer_label
      addNode(toNodeId, 'server', toLabel, isCentralLabel(toLabel, preferences.centralNode) ? 'central' : 'other')
      connections.push({
        ...base,
        id: `nic:${port.id}`,
        toNodeId,
        toKind: 'server',
        toLabel,
        toEndpointId: port.peer_nic_id,
        toEndpointLabel: target?.nic.name ?? '',
        toEndpointIsIpmi: false,
        isUplink: false,
      })
    } else if (port.peer_tofino_id) {
      const tofino = tofinoById.get(port.peer_tofino_id)
      const toNodeId = `tofino:${port.peer_tofino_id}`
      addNode(toNodeId, 'tofino', tofino?.name ?? port.peer_label)
      connections.push({
        ...base,
        id: `tof:${port.id}`,
        toNodeId,
        toKind: 'tofino',
        toLabel: tofino?.name ?? port.peer_label,
        toEndpointId: port.peer_tofino_id,
        toEndpointLabel: 'mgmt',
        toEndpointIsIpmi: false,
        isUplink: false,
      })
    } else if (port.peer_server_id) {
      const server = servers.find((s) => s.id === port.peer_server_id)
      const toNodeId = `server:${port.peer_server_id}`
      const toLabel = server?.name ?? port.peer_label
      const uplink = isUplinkLabel(toLabel, preferences.uplinkLabels ?? [])
      addNode(
        toNodeId,
        'server',
        toLabel,
        isCentralLabel(toLabel, preferences.centralNode) ? 'central' : uplink ? 'uplink' : 'other',
      )
      connections.push({
        ...base,
        id: `srv:${port.id}`,
        toNodeId,
        toKind: 'server',
        toLabel,
        toEndpointId: `ipmi:${port.id}`,
        toEndpointLabel: 'IPMI',
        toEndpointIsIpmi: true,
        isUplink: uplink,
      })
    } else if (port.peer_text) {
      const toNodeId = `text:${port.id}`
      const uplink = isUplinkLabel(port.peer_text, preferences.uplinkLabels ?? [])
      addNode(toNodeId, 'text', port.peer_text, uplink ? 'uplink' : 'other')
      connections.push({
        ...base,
        id: `txt:${port.id}`,
        toNodeId,
        toKind: 'text',
        toLabel: port.peer_text,
        toEndpointId: `text:${port.id}`,
        toEndpointLabel: '',
        toEndpointIsIpmi: false,
        isUplink: uplink,
      })
    }
  }

  return { connections, nodes: [...nodes.values()] }
}
