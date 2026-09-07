import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Cpu,
  ExternalLink,
  Network,
  Pencil,
  Server as ServerIcon,
} from 'lucide-react'
import { useMe, useServers, useTofinoPorts, useTofinos } from '../api/queries'
import type {
  NicView,
  ServerWithNics,
  Tofino,
  TofinoPort,
} from '../api/types'
import { Card, Skeleton } from '../components/Card'
import { EditTofinoPortModal } from '../components/EditTofinoPortModal'
import { FieldLabel, Select } from '../components/Select'
import { Tooltip } from '../components/Tooltip'
import { cn } from '../lib/cn'
import {
  buildTopology,
  type TopologyConnection,
} from '../lib/topology'
import { formatSpeed } from '../lib/format'
import { endpointRailCenter } from '../lib/managementTopologyLayout'
import {
  createUsageColorMap,
  usageColor,
  usageKey,
  usageName,
} from '../lib/usageColors'

type Endpoint = {
  id: string
  connectionId: string
  tofinoPortId: string | null
  label: string
  details: { label: string; value: string }[]
  title: string
  color: string
}

type NodeSpec = {
  nodeId: string
  width: number
  height: number
  endpoints: Endpoint[]
}

type NodeLayout = NodeSpec & {
  x: number
  y: number
}

/** Room for a four-character front-panel label (e.g. 32/0) plus edit button. */
const TOFINO_ENDPOINT_WIDTH = 76

type NodeInteractionProps = {
  emphasis: 'selected' | 'related' | 'dimmed' | null
  isPinned: boolean
  onPin: (nodeId: string) => void
  onActiveNodeChange: (nodeId: string | null) => void
  onEndpointPin: (endpoint: Endpoint) => void
  onEndpointEdit?: (endpoint: Endpoint) => void
  onActiveConnectionChange: (connectionId: string | null) => void
}

function rowWidth(nodes: NodeSpec[], gap: number): number {
  return (
    nodes.reduce((total, node) => total + node.width, 0) +
    Math.max(nodes.length - 1, 0) * gap
  )
}

function placeRow(
  nodes: NodeSpec[],
  y: number,
  gap: number,
): NodeLayout[] {
  let x = 20
  return nodes.map((node) => {
    const layout = { ...node, x, y }
    x += node.width + gap
    return layout
  })
}

function endpointPoint(
  node: NodeLayout,
  endpointId: string,
  edge: 'top' | 'bottom',
): { x: number; y: number } | null {
  const index = node.endpoints.findIndex((endpoint) => endpoint.id === endpointId)
  if (index < 0) {
    return null
  }
  return {
    x: node.x + endpointRailCenter(node.width, node.endpoints.length, index),
    y: edge === 'top' ? node.y : node.y + node.height,
  }
}

function connectionPath(
  connection: TopologyConnection,
  from: { x: number; y: number },
  to: { x: number; y: number },
  index: number,
): string {
  if (connection.kind === 'tofino') {
    const curveY = from.y + 100 + (index % 4) * 24
    return `M ${from.x} ${from.y} Q ${(from.x + to.x) / 2} ${curveY} ${to.x} ${to.y}`
  }
  if (
    connection.fromNodeId.startsWith('server:') &&
    connection.toNodeId.startsWith('server:')
  ) {
    const curveY = from.y - 70 - (index % 4) * 20
    return `M ${from.x} ${from.y} Q ${(from.x + to.x) / 2} ${curveY} ${to.x} ${to.y}`
  }
  return `M ${from.x} ${from.y} C ${from.x} 300 ${to.x} 365 ${to.x} ${to.y}`
}

function connectionTitle(connection: TopologyConnection): string {
  return [
    `${connection.fromLabel} ↔ ${connection.toLabel}`,
    connection.cableLabel ? `cable ${connection.cableLabel}` : '',
    connection.speedGbps ? formatSpeed(connection.speedGbps) : '',
    `Usage: ${usageName(usageKey(connection.usage))}`,
    connection.comment,
  ]
    .filter(Boolean)
    .join(' · ')
}

function EndpointRail({
  endpoints,
  placement,
  emptyLabel,
  onEndpointPin,
  onEndpointEdit,
  onActiveConnectionChange,
}: {
  endpoints: Endpoint[]
  placement: 'top' | 'bottom'
  emptyLabel: string
  onEndpointPin: (endpoint: Endpoint) => void
  onEndpointEdit?: (endpoint: Endpoint) => void
  onActiveConnectionChange: (connectionId: string | null) => void
}) {
  if (endpoints.length === 0) {
    return (
      <div
        className={`absolute inset-x-3 text-center text-[0.65rem] font-black uppercase tracking-wide opacity-40 ${
          placement === 'top' ? 'top-3' : 'bottom-3'
        }`}
      >
        {emptyLabel}
      </div>
    )
  }

  return (
    <div
      className={`absolute inset-x-3 grid gap-1 ${
        placement === 'top' ? 'top-2' : 'bottom-2'
      }`}
      style={{
        gridTemplateColumns: `repeat(${endpoints.length}, minmax(0, 1fr))`,
      }}
    >
      {endpoints.map((endpoint) => (
        <Tooltip
          key={endpoint.id}
          content={
            <span className="block min-w-64 max-w-72">
              <span className="block border-b border-berry-100 pb-2 font-display text-sm font-black dark:border-white/10">
                {endpoint.title}
              </span>
              <span className="mt-2 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-2 text-xs">
                {endpoint.details.map((detail) => (
                  <span key={detail.label} className="contents">
                    <span className="font-black uppercase tracking-wide opacity-50">
                      {detail.label}
                    </span>
                    <span className="break-words font-bold leading-relaxed">
                      {detail.value}
                    </span>
                  </span>
                ))}
              </span>
            </span>
          }
          placement={placement === 'top' ? 'top' : 'bottom'}
          align="center"
          className="min-w-0"
          triggerClassName="w-full justify-center"
          triggerTabIndex={-1}
        >
          <span
            className="inline-flex max-w-full overflow-hidden rounded-lg border-2 bg-berry-950 text-white transition hover:scale-105 hover:brightness-125"
            style={{ borderColor: endpoint.color }}
            onMouseEnter={() => onActiveConnectionChange(endpoint.connectionId)}
            onMouseLeave={() => onActiveConnectionChange(null)}
            onFocusCapture={() => onActiveConnectionChange(endpoint.connectionId)}
            onBlurCapture={() => onActiveConnectionChange(null)}
          >
            <button
              type="button"
              className="min-w-0 truncate px-1.5 py-1.5 text-center font-mono text-[0.65rem] font-black"
              aria-label={`Pin connection at ${endpoint.title}`}
              onClick={(event) => {
                event.stopPropagation()
                onEndpointPin(endpoint)
              }}
            >
              {endpoint.label}
            </button>
            {endpoint.tofinoPortId && onEndpointEdit ? (
              <button
                type="button"
                className="grid w-6 shrink-0 place-items-center border-l border-white/25 hover:bg-white/15"
                aria-label={`Edit ${endpoint.title}`}
                title={`Edit ${endpoint.title}`}
                onClick={(event) => {
                  event.stopPropagation()
                  onEndpointEdit(endpoint)
                }}
              >
                <Pencil className="size-3" aria-hidden="true" />
              </button>
            ) : null}
          </span>
        </Tooltip>
      ))}
    </div>
  )
}

function TofinoNode({
  tofino,
  layout,
  totalPorts,
  totalLinkedPorts,
  isFiltered,
  emphasis,
  isPinned,
  onPin,
  onActiveNodeChange,
  onEndpointPin,
  onEndpointEdit,
  onActiveConnectionChange,
}: {
  tofino: Tofino
  layout: NodeLayout
  totalPorts: number
  totalLinkedPorts: number
  isFiltered: boolean
} & NodeInteractionProps) {
  const nodeId = `tofino:${tofino.id}`
  return (
    <article
      className={cn(
        'absolute z-10 cursor-pointer rounded-3xl border-2 border-primary/50 bg-white p-4 text-berry-950 shadow-soft transition hover:z-40 focus-within:z-40 dark:bg-berry-900 dark:text-berry-50',
        emphasis === 'dimmed' && 'opacity-20 grayscale',
        emphasis === 'related' && 'ring-2 ring-primary/30',
        emphasis === 'selected' && 'ring-4 ring-sun',
      )}
      style={{
        left: layout.x,
        top: layout.y,
        width: layout.width,
        height: layout.height,
      }}
      onMouseEnter={() => onActiveNodeChange(nodeId)}
      onMouseLeave={() => onActiveNodeChange(null)}
      onClick={(event) => {
        event.stopPropagation()
        onPin(nodeId)
      }}
    >
      <Link
        to={`/tofinos/${tofino.id}`}
        className="absolute right-3 top-3 grid size-7 place-items-center rounded-full bg-berry-100/80 transition hover:bg-primary hover:text-white dark:bg-white/10"
        aria-label={`Open ${tofino.name} details`}
        onClick={(event) => event.stopPropagation()}
      >
        <ExternalLink className="size-3.5" aria-hidden="true" />
      </Link>
      <button
        type="button"
        className="inline-flex items-center gap-2 transition hover:text-primary dark:hover:text-blush"
        aria-label={`${isPinned ? 'Unpin' : 'Pin'} ${tofino.name} connections`}
        aria-pressed={isPinned}
        onClick={(event) => {
          event.stopPropagation()
          onPin(nodeId)
        }}
      >
        <Cpu className="size-5 text-primary dark:text-blush" aria-hidden="true" />
        <span className="font-display text-lg font-black">{tofino.name}</span>
      </button>
      <p className="mt-1 text-[0.65rem] font-black uppercase tracking-wide opacity-60">
        Tofino {tofino.version} ·{' '}
        {isFiltered
          ? `${layout.endpoints.length} shown · ${totalLinkedPorts} linked total`
          : `${totalLinkedPorts} linked · ${Math.max(
              totalPorts - totalLinkedPorts,
              0,
            )} free`}
      </p>
      <EndpointRail
        endpoints={layout.endpoints}
        placement="bottom"
        emptyLabel="No linked ports"
        onEndpointPin={onEndpointPin}
        onEndpointEdit={onEndpointEdit}
        onActiveConnectionChange={onActiveConnectionChange}
      />
    </article>
  )
}

function ServerNode({
  server,
  layout,
  totalLinkedNics,
  isFiltered,
  emphasis,
  isPinned,
  onPin,
  onActiveNodeChange,
  onEndpointPin,
  onEndpointEdit,
  onActiveConnectionChange,
}: {
  server: ServerWithNics
  layout: NodeLayout
  totalLinkedNics: number
  isFiltered: boolean
} & NodeInteractionProps) {
  const nodeId = `server:${server.id}`
  return (
    <article
      className={cn(
        'absolute z-10 cursor-pointer rounded-3xl border-2 border-mint/55 bg-white p-4 pt-14 text-berry-950 shadow-soft transition hover:z-40 focus-within:z-40 dark:bg-berry-900 dark:text-berry-50',
        emphasis === 'dimmed' && 'opacity-20 grayscale',
        emphasis === 'related' && 'ring-2 ring-mint/30',
        emphasis === 'selected' && 'ring-4 ring-sun',
      )}
      style={{
        left: layout.x,
        top: layout.y,
        width: layout.width,
        height: layout.height,
      }}
      onMouseEnter={() => onActiveNodeChange(nodeId)}
      onMouseLeave={() => onActiveNodeChange(null)}
      onClick={(event) => {
        event.stopPropagation()
        onPin(nodeId)
      }}
    >
      <EndpointRail
        endpoints={layout.endpoints}
        placement="top"
        emptyLabel="No linked NICs"
        onEndpointPin={onEndpointPin}
        onEndpointEdit={onEndpointEdit}
        onActiveConnectionChange={onActiveConnectionChange}
      />
      <Link
        to={`/servers#server-${server.id}`}
        className="absolute bottom-3 right-3 grid size-7 place-items-center rounded-full bg-berry-100/80 transition hover:bg-mint hover:text-berry-950 dark:bg-white/10"
        aria-label={`Open ${server.name} details`}
        onClick={(event) => event.stopPropagation()}
      >
        <ExternalLink className="size-3.5" aria-hidden="true" />
      </Link>
      <button
        type="button"
        className="inline-flex items-center gap-2 transition hover:text-mint"
        aria-label={`${isPinned ? 'Unpin' : 'Pin'} ${server.name} connections`}
        aria-pressed={isPinned}
        onClick={(event) => {
          event.stopPropagation()
          onPin(nodeId)
        }}
      >
        <ServerIcon className="size-5 text-mint" aria-hidden="true" />
        <span className="truncate font-display text-lg font-black">
          {server.name}
        </span>
      </button>
      <p className="mt-1 text-[0.65rem] font-black uppercase tracking-wide opacity-60">
        {isFiltered
          ? `${layout.endpoints.length} shown · ${totalLinkedNics} linked total`
          : `${totalLinkedNics} linked · ${Math.max(
              server.nics.length - totalLinkedNics,
              0,
            )} free NICs`}
      </p>
    </article>
  )
}

function ConnectionLine({
  connection,
  color,
}: {
  connection: TopologyConnection
  color: string
}) {
  return (
    <li
      className="rounded-2xl border-l-4 bg-white/70 px-3 py-2 text-sm font-bold dark:bg-berry-950/50"
      style={{ borderColor: color }}
    >
      <span className="font-black">{connection.fromLabel}</span>
      <span className="mx-2 opacity-50">↔</span>
      <span className="font-black">{connection.toLabel}</span>
      <span className="mt-0.5 block text-xs opacity-65">
        {[
          connection.speedGbps ? formatSpeed(connection.speedGbps) : '',
          connection.cableLabel ? `cable ${connection.cableLabel}` : '',
          connection.toEndpointDetail,
          connection.comment,
        ]
          .filter(Boolean)
          .join(' · ') || 'No link details'}
      </span>
    </li>
  )
}

function portEndpoint(
  port: TofinoPort,
  color: string,
  usage: string,
  connectionId: string,
): Endpoint {
  return {
    id: port.id,
    connectionId,
    tofinoPortId: port.id,
    label: port.fp_port,
    details: [
      { label: 'Peer', value: port.peer_label || 'Not connected' },
      { label: 'Dev port', value: String(port.dev_port) },
      ...(port.pipe ? [{ label: 'Pipe', value: port.pipe }] : []),
      ...(port.speed_gbps
        ? [{ label: 'Speed', value: formatSpeed(port.speed_gbps) }]
        : []),
      ...(port.cable_label
        ? [{ label: 'Cable', value: port.cable_label }]
        : []),
      { label: 'Usage', value: usageName(usageKey(usage)) },
    ],
    title: `${port.tofino_name} port ${port.fp_port}`,
    color,
  }
}

function nicEndpoint(
  server: ServerWithNics,
  nic: NicView,
  color: string,
  usage: string,
  connectionId: string,
): Endpoint {
  return {
    id: nic.id,
    connectionId,
    tofinoPortId: null,
    label: nic.name,
    details: [
      {
        label: 'Peer',
        value: nic.peer_port_label || nic.peer_nic_label || 'Not connected',
      },
      ...(nic.pci_address ? [{ label: 'PCI', value: nic.pci_address }] : []),
      ...(nic.ifname ? [{ label: 'Interface', value: nic.ifname }] : []),
      ...(nic.nic_type ? [{ label: 'Type', value: nic.nic_type }] : []),
      ...(nic.speed_gbps
        ? [{ label: 'Speed', value: formatSpeed(nic.speed_gbps) }]
        : []),
      { label: 'Usage', value: usageName(usageKey(usage)) },
    ],
    title: `${server.name} NIC ${nic.name}`,
    color,
  }
}

export function TopologyPage() {
  const { data: me } = useMe()
  const { data: tofinosData, isLoading: tofinosLoading } = useTofinos()
  const { data: serversData, isLoading: serversLoading } = useServers()
  const { data: portsData, isLoading: portsLoading } = useTofinoPorts()
  const tofinos = useMemo(() => tofinosData?.tofinos ?? [], [tofinosData])
  const servers = useMemo(() => serversData?.servers ?? [], [serversData])
  const ports = useMemo(() => portsData?.ports ?? [], [portsData])
  const topology = useMemo(() => buildTopology(ports, servers), [ports, servers])
  const [usageFilter, setUsageFilter] = useState('all')
  const [kindFilter, setKindFilter] = useState<
    'all' | 'tofino' | 'server' | 'external'
  >('all')
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null)
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null)
  const [editPort, setEditPort] = useState<TofinoPort | null>(null)
  const isAdmin = me?.user?.is_admin ?? false

  if (tofinosLoading || serversLoading || portsLoading) {
    return <Skeleton className="h-[42rem]" />
  }

  const connections = topology.bundles.flatMap((bundle) => bundle.connections)
  const usageKeys = [
    ...new Set([
      ...connections.map((connection) => usageKey(connection.usage)),
      ...topology.external.map((connection) => usageKey(connection.usage)),
    ]),
  ].sort((left, right) =>
    usageName(left).localeCompare(usageName(right), undefined, {
      sensitivity: 'base',
    }),
  )
  const usageColors = createUsageColorMap(usageKeys)
  const colorForUsage = (usage: string) =>
    usageColor(usageColors, usage)
  const filteredConnections = connections.filter(
    (connection) =>
      (usageFilter === 'all' ||
        usageKey(connection.usage) === usageFilter) &&
      (kindFilter === 'all' || connection.kind === kindFilter),
  )
  const filteredExternal = topology.external.filter(
    (connection) =>
      (usageFilter === 'all' ||
        usageKey(connection.usage) === usageFilter) &&
      (kindFilter === 'all' || kindFilter === 'external'),
  )
  const selectedNodeConnectionIds = new Set(
    selectedNodeId
      ? filteredConnections
          .filter(
            (connection) =>
              connection.fromNodeId === selectedNodeId ||
              connection.toNodeId === selectedNodeId,
          )
          .map((connection) => connection.id)
      : [],
  )
  const emphasizedConnectionIds: ReadonlySet<string> | null = selectedConnectionId
    ? new Set([selectedConnectionId])
    : selectedNodeId
      ? selectedNodeConnectionIds
      : null
  const pinNode = (nodeId: string) => {
    setSelectedNodeId((current) => (current === nodeId ? null : nodeId))
    setSelectedConnectionId(null)
  }
  const pinEndpoint = (endpoint: Endpoint) => {
    setSelectedConnectionId((current) =>
      current === endpoint.connectionId ? null : endpoint.connectionId,
    )
    setSelectedNodeId(null)
  }
  const editEndpoint = (endpoint: Endpoint) => {
    if (!isAdmin || !endpoint.tofinoPortId) {
      return
    }
    const port = ports.find((candidate) => candidate.id === endpoint.tofinoPortId)
    if (port) {
      setEditPort(port)
    }
  }
  const clearSelection = () => {
    setSelectedNodeId(null)
    setSelectedConnectionId(null)
    setActiveNodeId(null)
    setActiveConnectionId(null)
  }
  const nodeEmphasis = (
    nodeId: string,
  ): NodeInteractionProps['emphasis'] => {
    if (selectedConnectionId) {
      const connection = filteredConnections.find(
        (candidate) => candidate.id === selectedConnectionId,
      )
      return connection?.fromNodeId === nodeId || connection?.toNodeId === nodeId
        ? 'related'
        : 'dimmed'
    }
    if (selectedNodeId) {
      if (nodeId === selectedNodeId) {
        return 'selected'
      }
      const related = filteredConnections.some(
        (connection) =>
          selectedNodeConnectionIds.has(connection.id) &&
          (connection.fromNodeId === nodeId || connection.toNodeId === nodeId),
      )
      return related ? 'related' : 'dimmed'
    }
    return null
  }
  const isFiltered = usageFilter !== 'all' || kindFilter !== 'all'
  const filteredConnectionByEndpoint = new Map<string, TopologyConnection>()
  for (const connection of filteredConnections) {
    filteredConnectionByEndpoint.set(connection.fromEndpointId, connection)
    filteredConnectionByEndpoint.set(connection.toEndpointId, connection)
  }
  const linkedPortIds = new Set(
    filteredConnections.flatMap((connection) => [
      ...(connection.fromNodeId.startsWith('tofino:')
        ? [connection.fromEndpointId]
        : []),
      ...(connection.toNodeId.startsWith('tofino:')
        ? [connection.toEndpointId]
        : []),
    ]),
  )
  const linkedNicIds = new Set(
    filteredConnections.flatMap((connection) => [
      ...(connection.fromNodeId.startsWith('server:')
        ? [connection.fromEndpointId]
        : []),
      ...(connection.toNodeId.startsWith('server:')
        ? [connection.toEndpointId]
        : []),
    ]),
  )
  const allLinkedPortIds = new Set(
    connections.flatMap((connection) => [
      ...(connection.fromNodeId.startsWith('tofino:')
        ? [connection.fromEndpointId]
        : []),
      ...(connection.toNodeId.startsWith('tofino:')
        ? [connection.toEndpointId]
        : []),
    ]),
  )
  const allLinkedNicIds = new Set(
    connections.flatMap((connection) => [
      ...(connection.fromNodeId.startsWith('server:')
        ? [connection.fromEndpointId]
        : []),
      ...(connection.toNodeId.startsWith('server:')
        ? [connection.toEndpointId]
        : []),
    ]),
  )
  const portsByTofino = new Map<string, TofinoPort[]>()
  for (const port of ports) {
    const group = portsByTofino.get(port.tofino_id) ?? []
    group.push(port)
    portsByTofino.set(port.tofino_id, group)
  }

  const visibleTofinos = tofinos.filter((tofino) =>
    (portsByTofino.get(tofino.id) ?? []).some((port) =>
      linkedPortIds.has(port.id),
    ),
  )
  const visibleServers = servers.filter((server) =>
    server.nics.some((nic) => linkedNicIds.has(nic.id)),
  )

  const tofinoSpecs: NodeSpec[] = visibleTofinos.map((tofino) => {
    const endpoints = (portsByTofino.get(tofino.id) ?? [])
      .filter((port) => linkedPortIds.has(port.id))
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((port) => {
        const connection = filteredConnectionByEndpoint.get(port.id)!
        const usage = connection.usage
        return portEndpoint(port, colorForUsage(usage), usage, connection.id)
      })
    return {
      nodeId: `tofino:${tofino.id}`,
      width: Math.max(220, endpoints.length * TOFINO_ENDPOINT_WIDTH + 24),
      height: 128,
      endpoints,
    }
  })
  const serverSpecs: NodeSpec[] = visibleServers.map((server) => {
    const endpoints = server.nics
      .filter((nic) => linkedNicIds.has(nic.id))
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((nic) => {
        const connection = filteredConnectionByEndpoint.get(nic.id)!
        const usage = connection.usage
        return nicEndpoint(server, nic, colorForUsage(usage), usage, connection.id)
      })
    return {
      nodeId: `server:${server.id}`,
      width: Math.max(240, endpoints.length * 104 + 24),
      height: 136,
      endpoints,
    }
  })

  const gap = 38
  const width = Math.max(
    1120,
    rowWidth(tofinoSpecs, gap) + 40,
    rowWidth(serverSpecs, gap) + 40,
  )
  const height = 650
  const tofinoLayouts = placeRow(tofinoSpecs, 48, gap)
  const serverLayouts = placeRow(serverSpecs, 470, gap)
  const layouts = new Map(
    [...tofinoLayouts, ...serverLayouts].map((layout) => [
      layout.nodeId,
      layout,
    ]),
  )
  const groupedConnections = new Map<string, TopologyConnection[]>()
  for (const connection of filteredConnections) {
    const key = usageKey(connection.usage)
    const group = groupedConnections.get(key) ?? []
    group.push(connection)
    groupedConnections.set(key, group)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 font-display text-xl font-black">
          <Network
            className="size-6 text-primary dark:text-blush"
            aria-hidden="true"
          />
          Testbed topology
        </h2>
        <p className="mt-1 text-sm font-bold text-berry-700/70 dark:text-rose-100/70">
          Every linked Tofino port and server NIC is shown as its own endpoint.
        </p>
      </div>

      <Card
        className="relative left-1/2 w-[calc(100vw-1rem)] max-w-none -translate-x-1/2 overflow-hidden p-0 sm:w-[calc(100vw-2rem)]"
      >
        <div className="border-b border-berry-100 px-5 py-4 dark:border-white/10">
          <div>
            <h2 className="font-display text-lg font-black">
              Topology rendering
            </h2>
            <p className="mt-1 text-xs font-bold opacity-60">
              The canvas uses the available browser width.
            </p>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
            <FieldLabel label="Usage">
              <Select
                value={usageFilter}
                onChange={(event) => {
                  setUsageFilter(event.target.value)
                  clearSelection()
                }}
              >
                <option value="all">All usage groups</option>
                {usageKeys.map((key) => (
                  <option key={key} value={key}>
                    {usageName(key)}
                  </option>
                ))}
              </Select>
            </FieldLabel>
            <FieldLabel label="Link type">
              <Select
                value={kindFilter}
                onChange={(event) =>
                  {
                    setKindFilter(
                    event.target.value as
                      | 'all'
                      | 'tofino'
                      | 'server'
                      | 'external',
                    )
                    clearSelection()
                  }
                }
              >
                <option value="all">All link types</option>
                <option value="tofino">Tofino ↔ Tofino</option>
                <option value="server">Links involving server NICs</option>
                <option value="external">Free-text endpoints</option>
              </Select>
            </FieldLabel>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-black">
            <span className="mr-1 opacity-60">Usage groups:</span>
            {usageKeys.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() =>
                  {
                    setUsageFilter((current) =>
                      current === key ? 'all' : key,
                    )
                    clearSelection()
                  }
                }
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition hover:bg-white/70 dark:hover:bg-white/10 ${
                  usageFilter === key
                    ? 'bg-white shadow-soft dark:bg-berry-950'
                    : 'border-transparent'
                }`}
                style={{
                  borderColor:
                    usageFilter === key
                      ? usageColors.get(key)
                      : 'transparent',
                }}
                aria-pressed={usageFilter === key}
              >
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: usageColors.get(key) }}
                />
                {usageName(key)}
              </button>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-4 text-xs font-black opacity-65">
            <span className="inline-flex items-center gap-2">
              <span className="w-8 border-t-2 border-dashed border-current" />
              Tofino port ↔ Tofino port
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-0.5 w-8 bg-current" />
              Links involving server NICs
            </span>
            <span>
              Hover a port for one link or a device for all links · click to pin
              {isAdmin ? ' · pencil to edit' : ''}
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <div
            className="relative"
            onClick={clearSelection}
            style={{
              width,
              height,
              backgroundImage:
                'radial-gradient(circle, color-mix(in srgb, currentColor 14%, transparent) 1px, transparent 1px)',
              backgroundSize: '20px 20px',
            }}
          >
            <span className="absolute left-5 top-3 text-xs font-black uppercase tracking-[0.2em] opacity-45">
              Tofino switches · linked ports
            </span>
            <span className="absolute bottom-7 left-5 text-xs font-black uppercase tracking-[0.2em] opacity-45">
              Servers · linked NICs
            </span>
            <svg
              className="absolute inset-0 size-full"
              viewBox={`0 0 ${width} ${height}`}
              aria-label="Individual topology connections"
            >
              {filteredConnections.map((connection, index) => {
                const fromNode = layouts.get(connection.fromNodeId)
                const toNode = layouts.get(connection.toNodeId)
                if (!fromNode || !toNode) {
                  return null
                }
                const from = endpointPoint(
                  fromNode,
                  connection.fromEndpointId,
                  connection.fromNodeId.startsWith('server:')
                    ? 'top'
                    : 'bottom',
                )
                const to = endpointPoint(
                  toNode,
                  connection.toEndpointId,
                  connection.toNodeId.startsWith('server:')
                    ? 'top'
                    : 'bottom',
                )
                if (!from || !to) {
                  return null
                }
                const color = colorForUsage(connection.usage)
                const path = connectionPath(connection, from, to, index)
                const pathId = `topology-connection-${index}`
                const persistentHighlight =
                  emphasizedConnectionIds?.has(connection.id) ?? false
                const hoverHighlight =
                  emphasizedConnectionIds === null &&
                  (activeConnectionId !== null
                    ? activeConnectionId === connection.id
                    : activeNodeId === connection.fromNodeId ||
                      activeNodeId === connection.toNodeId)
                const highlighted = persistentHighlight || hoverHighlight
                const deEmphasized = emphasizedConnectionIds !== null
                  ? !persistentHighlight
                  : (activeConnectionId !== null || activeNodeId !== null) &&
                    !hoverHighlight
                return (
                  <g
                    key={connection.id}
                    data-connection-id={connection.id}
                    data-highlighted={highlighted}
                    onMouseEnter={() => setActiveConnectionId(connection.id)}
                    onMouseLeave={() => setActiveConnectionId(null)}
                  >
                    <title>{connectionTitle(connection)}</title>
                    <path
                      id={pathId}
                      d={path}
                      fill="none"
                      stroke="transparent"
                      strokeWidth="15"
                      className="pointer-events-auto"
                    />
                    <path
                      d={path}
                      fill="none"
                      stroke={color}
                      strokeWidth={highlighted ? 4 : deEmphasized ? 1.5 : 2.5}
                      strokeLinecap="round"
                      strokeDasharray={
                        connection.kind === 'tofino' ? '8 5' : undefined
                      }
                      opacity={deEmphasized ? 0.1 : highlighted ? 1 : 0.72}
                      className="pointer-events-none transition-opacity"
                    />
                    {connection.cableLabel ? (
                      <text
                        dy="-5"
                        textAnchor="middle"
                        fill={color}
                        stroke="currentColor"
                        strokeWidth="4"
                        paintOrder="stroke"
                        opacity={deEmphasized ? 0.12 : highlighted ? 1 : 0.82}
                        className="pointer-events-none text-[10px] font-black"
                      >
                        <textPath
                          href={`#${pathId}`}
                          startOffset={`${34 + (index % 4) * 11}%`}
                        >
                          {connection.cableLabel}
                        </textPath>
                      </text>
                    ) : null}
                  </g>
                )
              })}
            </svg>

            {tofinoSpecs.length === 0 && serverSpecs.length === 0 ? (
              <div className="absolute inset-0 grid place-items-center text-sm font-black opacity-55">
                No structured links match these filters.
              </div>
            ) : null}

            {visibleTofinos.map((tofino) => {
              const layout = layouts.get(`tofino:${tofino.id}`)!
              return (
                <TofinoNode
                  key={tofino.id}
                  tofino={tofino}
                  layout={layout}
                  totalPorts={(portsByTofino.get(tofino.id) ?? []).length}
                  totalLinkedPorts={
                    (portsByTofino.get(tofino.id) ?? []).filter((port) =>
                      allLinkedPortIds.has(port.id),
                    ).length
                  }
                  isFiltered={isFiltered}
                  emphasis={nodeEmphasis(`tofino:${tofino.id}`)}
                  isPinned={selectedNodeId === `tofino:${tofino.id}`}
                  onPin={pinNode}
                  onActiveNodeChange={setActiveNodeId}
                  onEndpointPin={pinEndpoint}
                  onEndpointEdit={isAdmin ? editEndpoint : undefined}
                  onActiveConnectionChange={setActiveConnectionId}
                />
              )
            })}
            {visibleServers.map((server) => (
              <ServerNode
                key={server.id}
                server={server}
                layout={layouts.get(`server:${server.id}`)!}
                totalLinkedNics={
                  server.nics.filter((nic) => allLinkedNicIds.has(nic.id))
                    .length
                }
                isFiltered={isFiltered}
                emphasis={nodeEmphasis(`server:${server.id}`)}
                isPinned={selectedNodeId === `server:${server.id}`}
                onPin={pinNode}
                onActiveNodeChange={setActiveNodeId}
                onEndpointPin={pinEndpoint}
                onEndpointEdit={isAdmin ? editEndpoint : undefined}
                onActiveConnectionChange={setActiveConnectionId}
              />
            ))}
          </div>
        </div>
      </Card>

      {isAdmin && editPort ? (
        <EditTofinoPortModal
          port={editPort}
          ports={ports}
          servers={servers}
          onClose={() => setEditPort(null)}
        />
      ) : null}

      <Card>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-display text-lg font-black">
            Connections by usage
          </h2>
          <span className="text-xs font-black opacity-60">
            {filteredConnections.length + filteredExternal.length} shown
          </span>
        </div>
        {filteredConnections.length === 0 ? (
          <p className="mt-3 text-sm font-bold opacity-65">
            No structured links match these filters.
          </p>
        ) : (
          <div className="mt-4 space-y-5">
            {[...groupedConnections.entries()]
              .sort(([left], [right]) =>
                usageName(left).localeCompare(usageName(right), undefined, {
                  sensitivity: 'base',
                }),
              )
              .map(([key, group]) => (
                <section key={key}>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span
                      className="size-3 rounded-full"
                      style={{ backgroundColor: usageColors.get(key) }}
                    />
                    <h3 className="font-display text-sm font-black">
                      {usageName(key)}
                    </h3>
                    <span className="text-xs font-black opacity-50">
                      {group.length} link{group.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <ul className="grid gap-2 lg:grid-cols-2">
                    {group.map((connection) => (
                      <ConnectionLine
                        key={connection.id}
                        connection={connection}
                        color={colorForUsage(connection.usage)}
                      />
                    ))}
                  </ul>
                </section>
              ))}
          </div>
        )}

        {filteredExternal.length > 0 ? (
          <section className="mt-5 border-t border-berry-100 pt-4 dark:border-white/10">
            <h3 className="text-xs font-black uppercase tracking-wide opacity-65">
              Free-text endpoints
            </h3>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {filteredExternal.map((connection) => (
                <li
                  key={connection.id}
                  className="rounded-2xl border-l-4 bg-sun/10 px-3 py-2 text-sm font-bold"
                  style={{ borderColor: colorForUsage(connection.usage) }}
                >
                  {connection.fromLabel} ↔ {connection.toLabel}
                  <span className="mt-0.5 block text-xs opacity-60">
                    Usage: {usageName(usageKey(connection.usage))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </Card>
    </div>
  )
}
