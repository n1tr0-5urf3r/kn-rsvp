import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Cpu,
  ExternalLink,
  Network,
  Pencil,
  Radio,
  Route,
  Search,
  Server as ServerIcon,
  X,
} from 'lucide-react'
import {
  useManagementPorts,
  useManagementSwitches,
  useServers,
  useTofinos,
} from '../api/queries'
import type { ManagementPort } from '../api/types'
import { Card, Skeleton } from '../components/Card'
import { EditManagementPortModal } from '../components/EditManagementPortModal'
import { Tooltip } from '../components/Tooltip'
import { cn } from '../lib/cn'
import {
  buildManagementTopology,
  collectVlanLegend,
  searchManagementTopology,
  traceManagementUplink,
  type MgmtConnection,
  type MgmtNode,
} from '../lib/managementTopology'
import {
  ENDPOINT_RAIL_GAP,
  NODE_BORDER_WIDTH,
  endpointRailCenter,
} from '../lib/managementTopologyLayout'
import { createUsageColorMap } from '../lib/usageColors'
import { useBranding } from '../lib/branding'

type Endpoint = {
  id: string
  connectionId: string
  managementPortId: string | null
  label: string
  title: string
  peer: string
  cableLabel: string
  comment: string
  vlans: {
    key: string
    label: string
    tagged: boolean
    color: string
  }[]
  color: string
  dimmed: boolean
  edge: 'top' | 'bottom'
}

type NodeSpec = {
  nodeId: string
  node: MgmtNode
  width: number
  height: number
  collapsed: boolean
  touched: boolean
  topEndpoints: Endpoint[]
  bottomEndpoints: Endpoint[]
}

type NodeLayout = NodeSpec & { x: number; y: number }

function TracePacket({
  duration,
  path,
  runId,
}: {
  duration: string
  path: string
  runId: number
}) {
  const animationRef = useRef<SVGAnimateMotionElement | null>(null)

  useEffect(() => {
    // SMIL's default `begin="0s"` is relative to the parent SVG's timeline.
    // Since this animation is inserted after the topology has rendered, that
    // can place a new packet partway through its route. Start it explicitly so
    // every trace begins at the first point in the path: the selected port.
    animationRef.current?.beginElement()
  }, [path, runId])

  return (
    <circle
      data-trace-packet="true"
      r="5"
      fill="currentColor"
      className="pointer-events-none text-primary drop-shadow-[0_0_5px_currentColor] motion-reduce:hidden dark:text-blush"
      stroke="white"
      strokeWidth="2"
    >
      <animateMotion
        ref={animationRef}
        path={path}
        begin="indefinite"
        restart="always"
        dur={duration}
        repeatCount="indefinite"
      />
    </circle>
  )
}

type ActiveFilter =
  | { type: 'vlan'; key: string; label: string }
  | { type: 'ipmi' }
  | null

type NodeEmphasis =
  | 'match'
  | 'related'
  | 'trace'
  | 'selected'
  | 'dimmed'
  | null

const KIND_ICON: Record<MgmtNode['kind'], typeof Cpu> = {
  switch: Network,
  server: ServerIcon,
  tofino: Cpu,
  text: Radio,
}

const KIND_LABEL: Record<MgmtNode['kind'], string> = {
  switch: 'Switch',
  server: 'Server',
  tofino: 'Tofino',
  text: 'External',
}

const KIND_BORDER: Record<MgmtNode['kind'], string> = {
  switch: 'border-primary/50',
  server: 'border-mint/55',
  tofino: 'border-sky/60',
  text: 'border-sun/60',
}

const PAD = 24
const NODE_GAP = 32
const ROW_GAP = 112
const DUAL_HEIGHT = 132
const SINGLE_HEIGHT = 104
const COLLAPSED_WIDTH = 88
const COLLAPSED_HEIGHT = 56

/** Row a node belongs to, purely from its rank/kind -- independent of layout. */
function rowIndexForNode(node: MgmtNode): number {
  if (node.rank === 'uplink') {
    return 0
  }
  if (node.kind === 'switch') {
    return 1
  }
  if (node.rank === 'central') {
    return 2
  }
  return 3
}

/** Whether a node's rail can face either direction (switches, and a gateway which
 * both receives from the switches above and may forward a free-text link
 * further down). Everything else only ever needs one rail. */
function isDualRail(node: MgmtNode): boolean {
  return node.kind === 'switch' || node.rank === 'central'
}

function connectionMatchesFilter(
  connection: MgmtConnection,
  filter: ActiveFilter,
): boolean {
  if (!filter) {
    return true
  }
  if (filter.type === 'ipmi') {
    return connection.isIpmi
  }
  return connection.vlans.some((vlan) => vlan.key === filter.key)
}

/** The VLAN membership driving a connection's line style: the actively
 * filtered one when it applies to this port, else the port's primary VLAN. */
function activeMembership(connection: MgmtConnection, filter: ActiveFilter) {
  if (filter?.type === 'vlan') {
    return connection.vlans.find((vlan) => vlan.key === filter.key) ?? connection.primaryVlan
  }
  return connection.primaryVlan
}

function connectionColor(
  connection: MgmtConnection,
  filter: ActiveFilter,
  colors: ReadonlyMap<string, string>,
): string {
  const membership = activeMembership(connection, filter)
  return (membership && colors.get(membership.key)) || '#8b8792'
}

function connectionDashed(connection: MgmtConnection, filter: ActiveFilter): boolean {
  return activeMembership(connection, filter)?.tagged ?? false
}

function connectionEdge(
  connection: MgmtConnection,
  nodeId: string,
  rowIndexByNodeId: ReadonlyMap<string, number>,
): 'top' | 'bottom' {
  const fromRow = rowIndexByNodeId.get(connection.fromNodeId) ?? 1
  const toRow = rowIndexByNodeId.get(connection.toNodeId) ?? 1
  const isFrom = nodeId === connection.fromNodeId
  if (fromRow === toRow) {
    // Same-row links (switch <-> switch): both ends arc off the top.
    return 'top'
  }
  if (isFrom) {
    return fromRow < toRow ? 'bottom' : 'top'
  }
  return toRow > fromRow ? 'top' : 'bottom'
}

function connectionPathD(
  connection: MgmtConnection,
  index: number,
  from: NodeLayout,
  to: NodeLayout,
  rowIndexByNodeId: ReadonlyMap<string, number>,
  reverse = false,
): string {
  const fromEdge = connectionEdge(
    connection,
    connection.fromNodeId,
    rowIndexByNodeId,
  )
  const toEdge = connectionEdge(
    connection,
    connection.toNodeId,
    rowIndexByNodeId,
  )
  const connectionFrom = endpointPoint(from, connection.fromEndpointId, fromEdge)
  const connectionTo = endpointPoint(to, connection.toEndpointId, toEdge)
  const start = reverse ? connectionTo : connectionFrom
  const end = reverse ? connectionFrom : connectionTo
  const sameRow = fromEdge === 'top' && toEdge === 'top' && from.y === to.y
  if (sameRow) {
    const arcY = start.y - 46 - (index % 3) * 16
    return `M ${start.x} ${start.y} C ${start.x} ${arcY}, ${end.x} ${arcY}, ${end.x} ${end.y}`
  }
  const middleY = (start.y + end.y) / 2
  return `M ${start.x} ${start.y} C ${start.x} ${middleY}, ${end.x} ${middleY}, ${end.x} ${end.y}`
}

function buildEndpoints(
  nodeId: string,
  connections: readonly MgmtConnection[],
  colors: ReadonlyMap<string, string>,
  filter: ActiveFilter,
  rowIndexByNodeId: ReadonlyMap<string, number>,
  emphasizedConnectionIds: ReadonlySet<string> | null,
): Endpoint[] {
  const endpoints: Endpoint[] = []
  for (const connection of connections) {
    const isFrom = connection.fromNodeId === nodeId
    const isTo = connection.toNodeId === nodeId
    if (!isFrom && !isTo) {
      continue
    }
    const id = isFrom ? connection.fromEndpointId : connection.toEndpointId
    const rawLabel = isFrom ? connection.fromEndpointLabel : connection.toEndpointLabel
    const selfLabel = isFrom ? connection.fromLabel : connection.toLabel
    const otherLabel = isFrom ? connection.toLabel : connection.fromLabel
    const otherEndpointLabel = isFrom
      ? connection.toEndpointLabel
      : connection.fromEndpointLabel
    const isIpmiEndpoint = isTo && connection.toEndpointIsIpmi
    endpoints.push({
      id,
      connectionId: connection.id,
      managementPortId:
        (isFrom && connection.fromNodeId.startsWith('switch:')) ||
        (isTo && connection.toKind === 'switch')
          ? id
          : null,
      label: rawLabel || (isIpmiEndpoint ? 'IPMI' : '—'),
      title: `${selfLabel} ${rawLabel}`.trim(),
      peer: `${otherLabel}${otherEndpointLabel ? ` ${otherEndpointLabel}` : ''}`,
      cableLabel: connection.cableLabel,
      comment: connection.comment,
      vlans: connection.vlans
        .slice()
        .sort((a, b) => a.vlanId - b.vlanId)
        .map((vlan) => ({
          key: vlan.key,
          label: vlan.label,
          tagged: vlan.tagged,
          color: colors.get(vlan.key) ?? '#8b8792',
        })),
      color: connectionColor(connection, filter, colors),
      dimmed:
        (filter !== null && !connectionMatchesFilter(connection, filter)) ||
        (emphasizedConnectionIds !== null &&
          !emphasizedConnectionIds.has(connection.id)),
      edge: connectionEdge(connection, nodeId, rowIndexByNodeId),
    })
  }
  return endpoints
}

function buildNodeSpec(
  node: MgmtNode,
  connections: readonly MgmtConnection[],
  colors: ReadonlyMap<string, string>,
  filter: ActiveFilter,
  touched: boolean,
  collapsed: boolean,
  rowIndexByNodeId: ReadonlyMap<string, number>,
  emphasizedConnectionIds: ReadonlySet<string> | null,
): NodeSpec {
  if (collapsed) {
    return {
      nodeId: node.id,
      node,
      width: COLLAPSED_WIDTH,
      height: COLLAPSED_HEIGHT,
      collapsed: true,
      touched,
      topEndpoints: [],
      bottomEndpoints: [],
    }
  }
  const all = buildEndpoints(
    node.id,
    connections,
    colors,
    filter,
    rowIndexByNodeId,
    emphasizedConnectionIds,
  )
  const dual = isDualRail(node)
  const topEndpoints = dual || rowIndexForNode(node) !== 0 ? all.filter((e) => e.edge === 'top') : []
  const bottomEndpoints = dual || rowIndexForNode(node) === 0 ? all.filter((e) => e.edge === 'bottom') : []
  const cellWidth = node.kind === 'switch' ? 56 : 92
  const minWidth = node.kind === 'switch' ? 168 : node.kind === 'text' ? 140 : 196
  const cols = Math.max(topEndpoints.length, bottomEndpoints.length, 0)
  const width = Math.max(minWidth, cols * cellWidth + 32)
  const height = dual ? DUAL_HEIGHT : SINGLE_HEIGHT
  return {
    nodeId: node.id,
    node,
    width,
    height,
    collapsed: false,
    touched,
    topEndpoints,
    bottomEndpoints,
  }
}

function endpointPoint(
  layout: NodeLayout,
  endpointId: string,
  edge: 'top' | 'bottom',
): { x: number; y: number } {
  const list = edge === 'top' ? layout.topEndpoints : layout.bottomEndpoints
  const y =
    edge === 'top'
      ? layout.y + NODE_BORDER_WIDTH
      : layout.y + layout.height - NODE_BORDER_WIDTH
  if (layout.collapsed || list.length === 0) {
    return { x: layout.x + layout.width / 2, y }
  }
  const index = Math.max(
    list.findIndex((endpoint) => endpoint.id === endpointId),
    0,
  )
  return { x: layout.x + endpointRailCenter(layout.width, list.length, index), y }
}

function EndpointRail({
  endpoints,
  placement,
  onEndpointPin,
  onEndpointEdit,
  onActiveConnectionChange,
}: {
  endpoints: Endpoint[]
  placement: 'top' | 'bottom'
  onEndpointPin: (endpoint: Endpoint) => void
  onEndpointEdit: (endpoint: Endpoint) => void
  onActiveConnectionChange: (connectionId: string | null) => void
}) {
  if (endpoints.length === 0) {
    return null
  }
  return (
    <div
      className={cn(
        'absolute inset-x-3 z-20 grid',
        placement === 'top'
          ? 'top-0 -translate-y-1/2'
          : 'bottom-0 translate-y-1/2',
      )}
      style={{
        columnGap: ENDPOINT_RAIL_GAP,
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
              <span className="mt-2 grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-2 gap-y-2 text-xs">
                <span className="font-black uppercase tracking-wide opacity-50">
                  Peer
                </span>
                <span className="font-bold">{endpoint.peer}</span>
                {endpoint.cableLabel ? (
                  <>
                    <span className="font-black uppercase tracking-wide opacity-50">
                      Cable
                    </span>
                    <span className="font-mono font-black">
                      {endpoint.cableLabel}
                    </span>
                  </>
                ) : null}
                {endpoint.comment ? (
                  <>
                    <span className="font-black uppercase tracking-wide opacity-50">
                      Note
                    </span>
                    <span className="break-words leading-relaxed">
                      {endpoint.comment}
                    </span>
                  </>
                ) : null}
                <span className="font-black uppercase tracking-wide opacity-50">
                  VLANs
                </span>
                {endpoint.vlans.length > 0 ? (
                  <span className="flex flex-wrap gap-1">
                    {endpoint.vlans.map((vlan) => (
                      <span
                        key={vlan.key}
                        className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[0.6rem] font-black"
                        style={{ borderColor: vlan.color }}
                      >
                        {vlan.label}
                        <span className="opacity-55">
                          {vlan.tagged ? 'T' : 'U'}
                        </span>
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="opacity-55">Not documented</span>
                )}
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
            className={cn(
              'inline-flex max-w-full overflow-hidden rounded-lg border-2 bg-berry-950 text-white transition hover:scale-105 hover:brightness-125',
              endpoint.dimmed && 'opacity-20 grayscale',
            )}
            style={{ borderColor: endpoint.color }}
            onMouseEnter={() => onActiveConnectionChange(endpoint.connectionId)}
            onMouseLeave={() => onActiveConnectionChange(null)}
            onFocusCapture={() => onActiveConnectionChange(endpoint.connectionId)}
            onBlurCapture={() => onActiveConnectionChange(null)}
          >
            <button
              type="button"
              className="min-w-0 truncate px-1.5 py-1 text-center font-mono text-[0.6rem] font-black"
              aria-label={`Pin connection at ${endpoint.title}`}
              onClick={(event) => {
                event.stopPropagation()
                onEndpointPin(endpoint)
              }}
            >
              {endpoint.label}
            </button>
            {endpoint.managementPortId ? (
              <button
                type="button"
                className="grid w-5 shrink-0 place-items-center border-l border-white/25 hover:bg-white/15"
                aria-label={`Edit ${endpoint.title}`}
                title={`Edit ${endpoint.title}`}
                onClick={(event) => {
                  event.stopPropagation()
                  onEndpointEdit(endpoint)
                }}
              >
                <Pencil className="size-2.5" aria-hidden="true" />
              </button>
            ) : null}
          </span>
        </Tooltip>
      ))}
    </div>
  )
}

function nodeLinkTo(node: MgmtNode): string | null {
  const id = node.id.slice(node.id.indexOf(':') + 1)
  if (node.kind === 'switch') {
    return `/management/switches/${id}`
  }
  if (node.kind === 'server') {
    return `/servers#server-${id}`
  }
  if (node.kind === 'tofino') {
    return `/tofinos/${id}`
  }
  return null
}

function NodeCard({
  layout,
  onActiveNodeChange,
  emphasis,
  isTraceStart,
  isPinned,
  onTrace,
  onPin,
  onEndpointPin,
  onEndpointEdit,
  onActiveConnectionChange,
}: {
  layout: NodeLayout
  onActiveNodeChange: (nodeId: string | null) => void
  emphasis: NodeEmphasis
  isTraceStart: boolean
  isPinned: boolean
  onTrace: (nodeId: string) => void
  onPin: (nodeId: string) => void
  onEndpointPin: (endpoint: Endpoint) => void
  onEndpointEdit: (endpoint: Endpoint) => void
  onActiveConnectionChange: (connectionId: string | null) => void
}) {
  const { node } = layout
  const Icon = KIND_ICON[node.kind]
  const linkTo = nodeLinkTo(node)
  const highlightProps = {
    onMouseEnter: () => onActiveNodeChange(node.id),
    onMouseLeave: () => onActiveNodeChange(null),
    onFocusCapture: () => onActiveNodeChange(node.id),
    onBlurCapture: () => onActiveNodeChange(null),
  }

  if (layout.collapsed) {
    return (
      <article
        className={cn(
          'absolute z-10 flex flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-berry-100 bg-white/60 px-2 py-2 text-center text-berry-950/50 shadow-soft transition hover:z-40 focus-within:z-40 dark:border-white/15 dark:bg-berry-900/50 dark:text-berry-50/45',
          emphasis === 'dimmed' && 'opacity-20 grayscale',
          emphasis === 'trace' && 'ring-4 ring-primary/70',
          emphasis === 'selected' && 'ring-4 ring-sun',
          emphasis === 'match' && 'ring-4 ring-sun',
        )}
        style={{ left: layout.x, top: layout.y, width: layout.width, height: layout.height }}
        title={`${node.label} — compacted because it is outside the current focus`}
        data-topology-node-id={node.id}
        onClick={(event) => {
          event.stopPropagation()
          onPin(node.id)
        }}
        {...highlightProps}
      >
        <Icon className="size-4" aria-hidden="true" />
        <span className="w-full truncate text-[0.6rem] font-black">{node.label}</span>
      </article>
    )
  }

  const label = (
    <span className="inline-flex items-center gap-1.5 truncate">
      <Icon className="size-4 shrink-0 text-primary dark:text-blush" aria-hidden="true" />
      <span className="truncate font-display text-sm font-black">{node.label}</span>
    </span>
  )

  return (
    <article
      className={cn(
        'absolute z-10 flex cursor-pointer flex-col items-center justify-center gap-0.5 rounded-3xl border-2 bg-white px-3 text-berry-950 shadow-soft transition hover:z-40 focus-within:z-40 dark:bg-berry-900 dark:text-berry-50',
        KIND_BORDER[node.kind],
        emphasis === 'dimmed' && 'opacity-20 grayscale',
        emphasis === 'related' && 'ring-2 ring-primary/30',
        emphasis === 'match' && 'ring-4 ring-sun',
        emphasis === 'trace' && 'ring-4 ring-primary/70',
        emphasis === 'selected' && 'ring-4 ring-sun',
        isTraceStart && 'ring-sun',
      )}
      style={{ left: layout.x, top: layout.y, width: layout.width, height: layout.height }}
      data-topology-node-id={node.id}
      onClick={(event) => {
        event.stopPropagation()
        onPin(node.id)
      }}
      {...highlightProps}
    >
      <EndpointRail
        endpoints={layout.topEndpoints}
        placement="top"
        onEndpointPin={onEndpointPin}
        onEndpointEdit={onEndpointEdit}
        onActiveConnectionChange={onActiveConnectionChange}
      />
      {linkTo ? (
        <Link
          to={linkTo}
          className="absolute left-2 top-2 z-30 grid size-7 place-items-center rounded-full bg-berry-100/80 text-berry-700 transition hover:bg-primary hover:text-white dark:bg-white/10 dark:text-rose-100"
          aria-label={`Open ${node.label} details`}
          title={`Open ${node.label} details`}
          onClick={(event) => event.stopPropagation()}
        >
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </Link>
      ) : null}
      {node.rank !== 'uplink' ? (
        <button
          type="button"
          className={cn(
            'absolute right-2 top-2 z-30 grid size-7 place-items-center rounded-full bg-berry-100/80 text-berry-700 transition hover:bg-primary hover:text-white dark:bg-white/10 dark:text-rose-100',
            isTraceStart && 'bg-primary text-white dark:bg-blush dark:text-berry-950',
          )}
          aria-label={`Trace ${node.label} to uplink`}
          title={`Trace ${node.label} to uplink`}
          onClick={(event) => {
            event.stopPropagation()
            onTrace(node.id)
          }}
        >
          <Route className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
      <button
        type="button"
        className="max-w-full transition hover:text-primary dark:hover:text-blush"
        aria-label={`${isPinned ? 'Unpin' : 'Pin'} ${node.label} connections`}
        aria-pressed={isPinned}
        onClick={(event) => {
          event.stopPropagation()
          onPin(node.id)
        }}
      >
        {label}
      </button>
      <span className="text-[0.6rem] font-black uppercase tracking-wide opacity-55">
        {KIND_LABEL[node.kind]}
      </span>
      <EndpointRail
        endpoints={layout.bottomEndpoints}
        placement="bottom"
        onEndpointPin={onEndpointPin}
        onEndpointEdit={onEndpointEdit}
        onActiveConnectionChange={onActiveConnectionChange}
      />
    </article>
  )
}

export function ManagementTopologyPage() {
  const branding = useBranding()
  const switches = useManagementSwitches()
  const ports = useManagementPorts()
  const servers = useServers()
  const tofinos = useTofinos()
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>(null)
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null)
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [tracedNodeId, setTracedNodeId] = useState<string | null>(null)
  const [traceRunId, setTraceRunId] = useState(0)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null)
  const [editPort, setEditPort] = useState<ManagementPort | null>(null)
  const topologyScrollRef = useRef<HTMLDivElement>(null)

  const allManagementPorts = ports.data?.ports ?? []

  const { connections, nodes } = useMemo(
    () =>
      buildManagementTopology(
        ports.data?.ports ?? [],
        servers.data?.servers ?? [],
        tofinos.data?.tofinos ?? [],
        {
          switchOrder: branding.topology_switch_order,
          uplinkLabels: branding.topology_uplink_labels,
          preferredUplink: branding.topology_preferred_uplink,
          centralNode: branding.topology_central_node,
        },
      ),
    [branding, ports.data, servers.data, tofinos.data],
  )

  const vlanLegend = useMemo(() => collectVlanLegend(connections), [connections])
  const hasIpmi = useMemo(() => connections.some((c) => c.isIpmi), [connections])
  const colors = useMemo(
    () => createUsageColorMap(vlanLegend.map((vlan) => vlan.key)),
    [vlanLegend],
  )
  const searchResult = useMemo(
    () => searchManagementTopology(nodes, connections, searchQuery),
    [connections, nodes, searchQuery],
  )
  const trace = useMemo(
    () =>
      tracedNodeId
        ? traceManagementUplink(nodes, connections, tracedNodeId, {
            preferredUplink: branding.topology_preferred_uplink,
          })
        : null,
    [branding.topology_preferred_uplink, connections, nodes, tracedNodeId],
  )
  const nodeById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  )
  const searchActive = searchQuery.trim().length > 0
  const traceNodeIds = new Set(trace?.nodeIds ?? [])
  const traceConnectionIds = new Set(trace?.connectionIds ?? [])
  const searchMatchingNodeIds = new Set(searchResult.matchingNodeIds)
  const searchRelatedNodeIds = new Set(searchResult.relatedNodeIds)
  const searchConnectionIds = new Set(searchResult.connectionIds)
  const selectedNodeConnectionIds = new Set(
    selectedNodeId
      ? connections
          .filter(
            (connection) =>
              connection.fromNodeId === selectedNodeId ||
              connection.toNodeId === selectedNodeId,
          )
          .map((connection) => connection.id)
      : [],
  )
  const selectedConnectionIds = new Set(
    selectedConnectionId ? [selectedConnectionId] : [],
  )
  const selectedConnection = selectedConnectionId
    ? connections.find((connection) => connection.id === selectedConnectionId) ?? null
    : null
  const selectionRelatedNodeIds = new Set<string>()
  if (selectedNodeId) {
    selectionRelatedNodeIds.add(selectedNodeId)
    for (const connection of connections) {
      if (
        connection.fromNodeId === selectedNodeId ||
        connection.toNodeId === selectedNodeId
      ) {
        selectionRelatedNodeIds.add(connection.fromNodeId)
        selectionRelatedNodeIds.add(connection.toNodeId)
      }
    }
  } else if (selectedConnection) {
    selectionRelatedNodeIds.add(selectedConnection.fromNodeId)
    selectionRelatedNodeIds.add(selectedConnection.toNodeId)
  }
  const searchFocusActive =
    searchActive &&
    !tracedNodeId &&
    !selectedNodeId &&
    !selectedConnectionId
  const searchFocusNodeId = searchFocusActive
    ? searchResult.matchingNodeIds[0] ??
      searchResult.relatedNodeIds.find(
        (nodeId) => nodeById.get(nodeId)?.kind !== 'switch',
      ) ??
      searchResult.relatedNodeIds[0] ??
      null
    : null
  const scrollFocusNodeId = tracedNodeId ?? selectedNodeId
    ?? (selectedConnection
      ? [selectedConnection.fromNodeId, selectedConnection.toNodeId].find(
          (nodeId) => nodeById.get(nodeId)?.kind !== 'switch',
        ) ?? selectedConnection.fromNodeId
      : searchFocusNodeId)
  const emphasizedConnectionIds: ReadonlySet<string> | null = tracedNodeId
    ? traceConnectionIds
    : selectedConnectionId
      ? selectedConnectionIds
      : selectedNodeId
        ? selectedNodeConnectionIds
        : searchActive
          ? searchConnectionIds
          : null

  const searchNodes = useMemo(() => {
    const directIds = new Set(searchResult.matchingNodeIds)
    return searchResult.relatedNodeIds
      .map((id) => nodeById.get(id))
      .filter((node): node is MgmtNode => Boolean(node))
      .sort(
        (a, b) =>
          Number(directIds.has(b.id)) - Number(directIds.has(a.id)) ||
          a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
      )
  }, [nodeById, searchResult.matchingNodeIds, searchResult.relatedNodeIds])

  const startTrace = (nodeId: string) => {
    setTracedNodeId(nodeId)
    setTraceRunId((current) => current + 1)
    setSelectedNodeId(null)
    setSelectedConnectionId(null)
  }
  const pinNode = (nodeId: string) => {
    setSelectedNodeId((current) => (current === nodeId ? null : nodeId))
    setSelectedConnectionId(null)
    setTracedNodeId(null)
  }
  const pinEndpoint = (endpoint: Endpoint) => {
    setSelectedConnectionId((current) =>
      current === endpoint.connectionId ? null : endpoint.connectionId,
    )
    setSelectedNodeId(null)
    setTracedNodeId(null)
  }
  const editEndpoint = (endpoint: Endpoint) => {
    if (endpoint.managementPortId) {
      const managementPort = allManagementPorts.find(
        (port) => port.id === endpoint.managementPortId,
      )
      if (managementPort) {
        setEditPort(managementPort)
      }
    }
  }
  const clearPinnedHighlight = () => {
    setSelectedNodeId(null)
    setSelectedConnectionId(null)
  }
  const clearDiagramSelection = () => {
    clearPinnedHighlight()
    setTracedNodeId(null)
    setActiveNodeId(null)
    setActiveConnectionId(null)
  }

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const container = topologyScrollRef.current
      if (container) {
        const focusedNode = scrollFocusNodeId
          ? container.querySelector<HTMLElement>(
              `[data-topology-node-id="${scrollFocusNodeId}"]`,
            )
          : null
        container.scrollLeft = focusedNode
          ? Math.max(
              0,
              focusedNode.offsetLeft +
                focusedNode.offsetWidth / 2 -
                container.clientWidth / 2,
            )
          : Math.max(0, (container.scrollWidth - container.clientWidth) / 2)
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [
    activeFilter,
    connections,
    scrollFocusNodeId,
    searchQuery,
    selectedConnectionId,
    selectedNodeId,
  ])

  if (switches.isLoading || ports.isLoading || servers.isLoading || tofinos.isLoading) {
    return <Skeleton className="h-96" />
  }

  const touchedNodeIds = new Set<string>()
  if (activeFilter) {
    for (const connection of connections) {
      if (connectionMatchesFilter(connection, activeFilter)) {
        touchedNodeIds.add(connection.fromNodeId)
        touchedNodeIds.add(connection.toNodeId)
      }
    }
  }
  if (tracedNodeId) {
    for (const nodeId of traceNodeIds) {
      touchedNodeIds.add(nodeId)
    }
  } else if (selectedNodeId) {
    touchedNodeIds.add(selectedNodeId)
    for (const connection of connections) {
      if (selectedNodeConnectionIds.has(connection.id)) {
        touchedNodeIds.add(connection.fromNodeId)
        touchedNodeIds.add(connection.toNodeId)
      }
    }
  } else if (selectedConnectionId) {
    const connection = connections.find(
      (candidate) => candidate.id === selectedConnectionId,
    )
    if (connection) {
      touchedNodeIds.add(connection.fromNodeId)
      touchedNodeIds.add(connection.toNodeId)
    }
  } else if (searchActive) {
    for (const nodeId of searchRelatedNodeIds) {
      touchedNodeIds.add(nodeId)
    }
  }

  const rowIndexByNodeId = new Map(nodes.map((node) => [node.id, rowIndexForNode(node)]))

  const byRow: MgmtNode[][] = [[], [], [], []]
  for (const node of nodes) {
    byRow[rowIndexForNode(node)].push(node)
  }
  byRow[1].sort((a, b) => a.switchOrder - b.switchOrder || a.label.localeCompare(b.label))
  for (const row of [byRow[0], byRow[2]]) {
    row.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
  }

  // Put downstream devices in the same left-to-right order as the switch ports
  // feeding them. This removes most avoidable cable crossings while retaining
  // the physical port order on every switch rail.
  const switchById = new Map(byRow[1].map((node) => [node.id, node]))
  const downstreamKey = (node: MgmtNode): [number, string, string] => {
    const candidates = connections
      .filter(
        (connection) =>
          connection.toNodeId === node.id && switchById.has(connection.fromNodeId),
      )
      .map((connection) => [
        switchById.get(connection.fromNodeId)?.switchOrder ?? Number.MAX_SAFE_INTEGER,
        connection.fromEndpointLabel,
        node.label,
      ] as [number, string, string])
      .sort(
        (a, b) =>
          a[0] - b[0] ||
          a[1].localeCompare(b[1], undefined, { numeric: true, sensitivity: 'base' }) ||
          a[2].localeCompare(b[2], undefined, { sensitivity: 'base' }),
      )
    return candidates[0] ?? [Number.MAX_SAFE_INTEGER, '', node.label]
  }
  const downstreamKeys = new Map(byRow[3].map((node) => [node.id, downstreamKey(node)]))
  byRow[3].sort((a, b) => {
    const aKey = downstreamKeys.get(a.id)!
    const bKey = downstreamKeys.get(b.id)!
    return (
      aKey[0] - bKey[0] ||
      aKey[1].localeCompare(bKey[1], undefined, { numeric: true, sensitivity: 'base' }) ||
      aKey[2].localeCompare(bKey[2], undefined, { sensitivity: 'base' })
    )
  })

  // When a filter is active, nodes it touches lay out compactly on the left;
  // untouched nodes collapse and move to the right, out of the way.
  const orderRow = (row: MgmtNode[]): MgmtNode[] => {
    if (!activeFilter) {
      return row
    }
    return [...row].sort(
      (a, b) => Number(touchedNodeIds.has(b.id)) - Number(touchedNodeIds.has(a.id)),
    )
  }

  const endpointNodes = orderRow(byRow[3])
  const endpointMidpoint = Math.ceil(endpointNodes.length / 2)

  const rowDefs: { key: string; title: string; align: 'left' | 'center'; nodes: MgmtNode[] }[] = [
    {
      key: 'uplink',
      title: 'Uplinks to the outside world',
      align: 'center' as const,
      nodes: orderRow(byRow[0]),
    },
    { key: 'switch', title: 'Management switches', align: 'center' as const, nodes: byRow[1] },
    {
      key: 'endpoints',
      title: 'Infrastructure, servers, Tofinos & other endpoints',
      align: 'center' as const,
      nodes: [
        ...endpointNodes.slice(0, endpointMidpoint),
        ...orderRow(byRow[2]),
        ...endpointNodes.slice(endpointMidpoint),
      ],
    },
  ].filter((row) => row.nodes.length > 0)

  const specsByRow = rowDefs.map((row) => ({
    ...row,
    specs: row.nodes.map((node) => {
      const collapsedByFilter =
        Boolean(activeFilter) && !touchedNodeIds.has(node.id)
      const collapsedBySelection =
        (Boolean(selectedNodeId) || Boolean(selectedConnectionId)) &&
        node.kind !== 'switch' &&
        !selectionRelatedNodeIds.has(node.id)
      const collapsedBySearch =
        searchFocusActive &&
        node.kind !== 'switch' &&
        !searchRelatedNodeIds.has(node.id)
      const collapsedByTrace =
        Boolean(tracedNodeId) &&
        node.kind !== 'switch' &&
        node.id !== tracedNodeId &&
        !traceNodeIds.has(node.id)
      return buildNodeSpec(
        node,
        connections,
        colors,
        activeFilter,
        !collapsedByFilter &&
          !collapsedBySelection &&
          !collapsedBySearch &&
          !collapsedByTrace,
        collapsedByFilter ||
          collapsedBySelection ||
          collapsedBySearch ||
          collapsedByTrace,
        rowIndexByNodeId,
        emphasizedConnectionIds,
      )
    }),
  }))

  const rowWidth = (specs: NodeSpec[]) =>
    specs.reduce((total, spec) => total + spec.width, 0) +
    Math.max(specs.length - 1, 0) * NODE_GAP

  const pinnedEndpointParts = (row: (typeof specsByRow)[number]) => {
    if (row.key !== 'endpoints') {
      return null
    }
    const firstCentral = row.specs.findIndex((spec) => spec.node.rank === 'central')
    const lastCentral = row.specs.findLastIndex((spec) => spec.node.rank === 'central')
    if (firstCentral === -1 || lastCentral === -1) {
      return null
    }
    return {
      left: row.specs.slice(0, firstCentral),
      center: row.specs.slice(firstCentral, lastCentral + 1),
      right: row.specs.slice(lastCentral + 1),
    }
  }

  const visualRowWidth = (row: (typeof specsByRow)[number]) => {
    const parts = pinnedEndpointParts(row)
    if (!parts) {
      return rowWidth(row.specs)
    }
    return (
      Math.max(rowWidth(parts.left), rowWidth(parts.right)) * 2 +
      rowWidth(parts.center) +
      NODE_GAP * 2
    )
  }

  const totalWidth = Math.max(
    720,
    ...specsByRow.map((row) => visualRowWidth(row) + PAD * 2),
  )

  let y = PAD
  const layouts = new Map<string, NodeLayout>()
  const renderRows: { title: string; layouts: NodeLayout[] }[] = []
  for (const row of specsByRow) {
    const placed: NodeLayout[] = []
    const placeSequence = (specs: NodeSpec[], startX: number) => {
      let x = startX
      for (const spec of specs) {
        const layout: NodeLayout = { ...spec, x, y }
        layouts.set(spec.nodeId, layout)
        placed.push(layout)
        x += spec.width + NODE_GAP
      }
    }

    const pinnedParts = pinnedEndpointParts(row)
    if (pinnedParts) {
      const centerWidth = rowWidth(pinnedParts.center)
      const centerX = (totalWidth - centerWidth) / 2
      placeSequence(
        pinnedParts.left,
        centerX - NODE_GAP - rowWidth(pinnedParts.left),
      )
      placeSequence(pinnedParts.center, centerX)
      placeSequence(pinnedParts.right, centerX + centerWidth + NODE_GAP)
    } else {
      const w = rowWidth(row.specs)
      const x = row.align === 'center' ? Math.max(PAD, (totalWidth - w) / 2) : PAD
      placeSequence(row.specs, x)
    }
    renderRows.push({ title: row.title, layouts: placed })
    const rowHeight = Math.max(...row.specs.map((spec) => spec.height), COLLAPSED_HEIGHT)
    y += rowHeight + ROW_GAP
  }
  const totalHeight = y - ROW_GAP + PAD
  const traceMotionPath = trace?.connectionIds
    .map((connectionId, hopIndex) => {
      const connectionIndex = connections.findIndex(
        (candidate) => candidate.id === connectionId,
      )
      const connection = connections[connectionIndex]
      if (!connection) {
        return null
      }
      const from = layouts.get(connection.fromNodeId)
      const to = layouts.get(connection.toNodeId)
      if (!from || !to) {
        return null
      }
      return connectionPathD(
        connection,
        connectionIndex,
        from,
        to,
        rowIndexByNodeId,
        connection.fromNodeId !== trace.nodeIds[hopIndex],
      )
    })
    .filter((path): path is string => Boolean(path))
    .join(' ')
  const tracedNode = tracedNodeId ? nodeById.get(tracedNodeId) : null
  const traceLabels = trace?.nodeIds
    .map((nodeId) => nodeById.get(nodeId)?.label)
    .filter((label): label is string => Boolean(label)) ?? []
  const tracePortLabels = trace?.connectionIds
    .map((connectionId, index) => {
      const connection = connections.find(
        (candidate) => candidate.id === connectionId,
      )
      if (!connection) {
        return null
      }
      const forward = connection.fromNodeId === trace.nodeIds[index]
      const left = forward
        ? `${connection.fromLabel} ${connection.fromEndpointLabel}`
        : `${connection.toLabel} ${connection.toEndpointLabel}`
      const right = forward
        ? `${connection.toLabel} ${connection.toEndpointLabel}`
        : `${connection.fromLabel} ${connection.fromEndpointLabel}`
      return `${left.trim()} ↔ ${right.trim()}`
    })
    .filter((label): label is string => Boolean(label)) ?? []
  const nodeEmphasis = (nodeId: string): NodeEmphasis => {
    if (tracedNodeId) {
      return nodeId === tracedNodeId || traceNodeIds.has(nodeId) ? 'trace' : 'dimmed'
    }
    if (selectedConnectionId) {
      const connection = connections.find(
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
      const isRelated = connections.some(
        (connection) =>
          selectedNodeConnectionIds.has(connection.id) &&
          (connection.fromNodeId === nodeId || connection.toNodeId === nodeId),
      )
      return isRelated ? 'related' : 'dimmed'
    }
    if (searchActive) {
      if (searchMatchingNodeIds.has(nodeId)) {
        return 'match'
      }
      return searchRelatedNodeIds.has(nodeId) ? 'related' : 'dimmed'
    }
    return null
  }

  return (
    <div className="space-y-5">
      {connections.length === 0 ? (
        <>
          <h2 className="font-display text-lg font-black">Management topology</h2>
          <Card>
            <p className="text-sm font-bold text-berry-700/70 dark:text-rose-100/70">
              No management links yet. Cable some switch ports to servers, Tofinos or other
              switches to see them here.
            </p>
          </Card>
        </>
      ) : (
        <Card className="relative left-1/2 w-[calc(100vw-1rem)] max-w-none -translate-x-1/2 overflow-hidden p-0 sm:w-[calc(100vw-2rem)]">
          <div className="border-b border-berry-100 px-5 py-4 dark:border-white/10">
            <h2 className="font-display text-lg font-black">Management topology</h2>
            <p className="mt-1 text-xs font-bold opacity-60">
              Switch ports, uplinks, infrastructure and connected endpoints.
            </p>

            <div className="mt-4 max-w-3xl">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 opacity-45"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => {
                    setSearchQuery(event.target.value)
                    setTracedNodeId(null)
                    clearPinnedHighlight()
                  }}
                  placeholder="Search hostname, switch, port, cable, VLAN…"
                  aria-label="Search management topology"
                  className="h-11 w-full rounded-2xl border-2 border-berry-100 bg-white pl-10 pr-10 text-sm font-bold text-berry-950 shadow-sm transition placeholder:opacity-45 focus:border-primary dark:border-white/10 dark:bg-berry-950 dark:text-berry-50"
                />
                {searchQuery ? (
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full opacity-55 transition hover:bg-berry-100 hover:opacity-100 dark:hover:bg-white/10"
                    aria-label="Clear topology search"
                    onClick={() => {
                      setSearchQuery('')
                      setTracedNodeId(null)
                      clearPinnedHighlight()
                    }}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                ) : null}
              </div>

              {searchActive ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold">
                  {searchNodes.length > 0 ? (
                    <>
                      <span className="opacity-55">
                        {searchResult.matchingNodeIds.length > 0
                          ? `${searchResult.matchingNodeIds.length} direct match${searchResult.matchingNodeIds.length === 1 ? '' : 'es'}`
                          : `${searchResult.connectionIds.length} matching link${searchResult.connectionIds.length === 1 ? '' : 's'}`}
                      </span>
                      {searchNodes.slice(0, 10).map((node) => (
                        <button
                          key={node.id}
                          type="button"
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition hover:border-primary hover:text-primary dark:hover:text-blush',
                            searchMatchingNodeIds.has(node.id)
                              ? 'border-sun bg-sun/15'
                              : 'border-berry-100 dark:border-white/10',
                          )}
                          title={`Trace ${node.label} to uplink`}
                          onClick={() => startTrace(node.id)}
                        >
                          {node.label}
                          <Route className="size-3" aria-hidden="true" />
                        </button>
                      ))}
                      {searchNodes.length > 10 ? (
                        <span className="opacity-55">+{searchNodes.length - 10} more</span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-primary dark:text-blush">
                      No topology matches for “{searchQuery.trim()}”
                    </span>
                  )}
                </div>
              ) : null}

              {tracedNode ? (
                <div
                  className="mt-3 rounded-2xl border-2 border-primary/25 bg-primary/5 px-3 py-2 text-xs font-bold"
                  role="status"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-2 font-black text-primary dark:text-blush">
                      <Route className="size-4" aria-hidden="true" />
                      Tracing {tracedNode.label} to uplink
                    </span>
                    <button
                      type="button"
                      className="shrink-0 underline opacity-65 hover:opacity-100"
                      onClick={() => setTracedNodeId(null)}
                    >
                      Clear trace
                    </button>
                  </div>
                  {trace ? (
                    <div className="mt-1 space-y-1 opacity-70">
                      <p>
                        {traceLabels.join(' → ')}
                        {trace.viaCentral ? ' · routed through central gateway' : ''}
                      </p>
                      <p className="font-mono text-[0.65rem]">
                        Ports: {tracePortLabels.join(' · ')}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-1 text-primary dark:text-blush">
                      No modeled path from {tracedNode.label} to an uplink.
                    </p>
                  )}
                </div>
              ) : null}
            </div>

            {vlanLegend.length > 0 || hasIpmi ? (
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-black">
                <span className="opacity-60">Filter:</span>
                {vlanLegend.map(({ key, label }) => {
                  const isActive = activeFilter?.type === 'vlan' && activeFilter.key === key
                  return (
                    <button
                      key={key}
                      type="button"
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border-2 border-transparent px-2.5 py-1 transition',
                        isActive
                          ? 'bg-berry-900 text-white shadow-soft ring-2 ring-white/40 dark:bg-white dark:text-berry-950'
                          : 'hover:bg-berry-100 dark:hover:bg-white/10',
                        activeFilter && !isActive && 'opacity-40',
                      )}
                      style={{ borderColor: isActive ? colors.get(key) : undefined }}
                      aria-pressed={isActive}
                      onClick={() =>
                        setActiveFilter((current) =>
                          current?.type === 'vlan' && current.key === key
                            ? null
                            : { type: 'vlan', key, label },
                        )
                      }
                    >
                      <span className="size-2.5 rounded-full" style={{ backgroundColor: colors.get(key) }} />
                      {label}
                    </button>
                  )
                })}
                {hasIpmi ? (
                  <button
                    type="button"
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border-2 border-transparent px-2.5 py-1 transition',
                      activeFilter?.type === 'ipmi'
                        ? 'bg-berry-900 text-white shadow-soft ring-2 ring-white/40 dark:bg-white dark:text-berry-950'
                        : 'hover:bg-berry-100 dark:hover:bg-white/10',
                      activeFilter && activeFilter.type !== 'ipmi' && 'opacity-40',
                    )}
                    aria-pressed={activeFilter?.type === 'ipmi'}
                    onClick={() =>
                      setActiveFilter((current) => (current?.type === 'ipmi' ? null : { type: 'ipmi' }))
                    }
                  >
                    <Radio className="size-3" aria-hidden="true" />
                    IPMI
                  </button>
                ) : null}
                {activeFilter ? (
                  <button
                    type="button"
                    className="rounded-full px-2 py-1 underline opacity-70 hover:opacity-100"
                    onClick={() => setActiveFilter(null)}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-4 text-xs font-black opacity-65">
              <span className="inline-flex items-center gap-2">
                <span className="w-8 border-t-2 border-dashed border-current" />
                Tagged VLAN membership
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-0.5 w-8 bg-current" />
                Untagged VLAN membership
              </span>
              <span>
                Hover to preview · click a node/port to pin · use{' '}
                <Route className="inline size-3" aria-hidden="true" /> to trace to an uplink
              </span>
              {selectedNodeId || selectedConnectionId ? (
                <button
                  type="button"
                  className="underline opacity-70 hover:opacity-100"
                  onClick={clearPinnedHighlight}
                >
                  Clear pinned highlight
                </button>
              ) : null}
            </div>
          </div>

          <div
            ref={topologyScrollRef}
            className="overflow-x-auto"
          >
            <div
              className="relative"
              onClick={clearDiagramSelection}
              style={{
                width: totalWidth,
                height: totalHeight,
                minWidth: '100%',
                backgroundImage:
                  'radial-gradient(circle, color-mix(in srgb, currentColor 14%, transparent) 1px, transparent 1px)',
                backgroundSize: '20px 20px',
              }}
            >
              {renderRows.map((row) => (
                <span
                  key={row.title}
                  className="absolute z-30 -translate-x-1/2 rounded-full bg-[#fffdf8]/90 px-2 text-[0.65rem] font-black uppercase tracking-[0.2em] opacity-60 dark:bg-berry-900/90"
                  style={{ left: totalWidth / 2, top: (row.layouts[0]?.y ?? 0) - 28 }}
                >
                  {row.title}
                </span>
              ))}
              <svg
                className="absolute inset-0 size-full overflow-visible"
                width={totalWidth}
                height={totalHeight}
                role="img"
                aria-label="Management topology diagram"
              >
                {connections.map((connection, index) => {
                  const from = layouts.get(connection.fromNodeId)
                  const to = layouts.get(connection.toNodeId)
                  if (!from || !to) {
                    return null
                  }
                  const color = connectionColor(connection, activeFilter, colors)
                  const dashed = connectionDashed(connection, activeFilter)
                  const dimmed = !connectionMatchesFilter(connection, activeFilter)
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
                  const d = connectionPathD(
                    connection,
                    index,
                    from,
                    to,
                    rowIndexByNodeId,
                  )
                  return (
                    <g
                      key={connection.id}
                      data-connection-id={connection.id}
                      data-highlighted={highlighted}
                    >
                      <path
                        d={d}
                        fill="none"
                        className="stroke-white dark:stroke-berry-950"
                        strokeWidth={dimmed || deEmphasized ? 4 : highlighted ? 9 : 6}
                        strokeOpacity={dimmed || deEmphasized ? 0.05 : highlighted ? 0.95 : 0.6}
                        strokeLinecap="round"
                      />
                      <path
                        d={d}
                        fill="none"
                        stroke={color}
                        strokeWidth={dimmed || deEmphasized ? 1.5 : highlighted ? 4 : 2.25}
                        strokeOpacity={dimmed || deEmphasized ? 0.1 : highlighted ? 1 : 0.6}
                        strokeDasharray={dashed ? '7 5' : undefined}
                        strokeLinecap="round"
                      >
                      <title>
                        {`${connection.fromLabel} ${connection.fromEndpointLabel} ↔ ${connection.toLabel} ${connection.toEndpointLabel}`.trim()}
                      </title>
                      </path>
                    </g>
                  )
                })}
                {traceMotionPath ? (
                  <TracePacket
                    path={traceMotionPath}
                    runId={traceRunId}
                    duration={`${Math.max(8, (trace?.connectionIds.length ?? 0) * 2.2)}s`}
                  />
                ) : null}
              </svg>
              {renderRows.flatMap((row) =>
                row.layouts.map((layout) => (
                  <NodeCard
                    key={layout.nodeId}
                    layout={layout}
                    onActiveNodeChange={setActiveNodeId}
                    emphasis={nodeEmphasis(layout.nodeId)}
                    isTraceStart={tracedNodeId === layout.nodeId}
                    isPinned={selectedNodeId === layout.nodeId}
                    onTrace={startTrace}
                    onPin={pinNode}
                    onEndpointPin={pinEndpoint}
                    onEndpointEdit={editEndpoint}
                    onActiveConnectionChange={setActiveConnectionId}
                  />
                )),
              )}
            </div>
          </div>
        </Card>
      )}
      {editPort ? (
        <EditManagementPortModal
          port={editPort}
          onClose={() => setEditPort(null)}
        />
      ) : null}
    </div>
  )
}
