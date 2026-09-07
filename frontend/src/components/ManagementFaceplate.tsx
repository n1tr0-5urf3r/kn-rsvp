import { useState } from 'react'
import type { ManagementPort } from '../api/types'
import { formatSpeed } from '../lib/format'
import { cn } from '../lib/cn'
import {
  createUsageColorMap,
  FACEPLATE_COMMENT_COLORS,
  usageColor,
} from '../lib/usageColors'
import { faceplateGroupsFor } from '../lib/faceplateLayouts'
import {
  portVlanKey,
  vlanDisplayLabel,
} from '../lib/vlanColors'
import { Card } from './Card'
import { Tooltip } from './Tooltip'

/** Tooltip edge alignment so cages near the board edges don't clip. */
function alignForColumn(
  columnIndex: number,
  columnCount: number,
): 'start' | 'center' | 'end' {
  if (columnIndex < 3) {
    return 'start'
  }
  if (columnIndex >= columnCount - 3) {
    return 'end'
  }
  return 'center'
}

function PortDetails({
  port,
  vlanColors,
}: {
  port: ManagementPort
  vlanColors: ReadonlyMap<string, string>
}) {
  return (
    <span className="block min-w-64 max-w-72">
      <span className="block border-b border-berry-100 pb-2 font-display text-sm font-black dark:border-white/10">
        {port.switch_name} {port.name}
      </span>
      <span className="mt-2 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-2 text-xs">
        {port.ifname ? (
          <>
            <span className="font-black uppercase tracking-wide opacity-50">
              Interface
            </span>
            <span className="font-mono font-black">
              {port.ifname}
              {port.ifindex != null ? ` · if${port.ifindex}` : ''}
            </span>
          </>
        ) : null}
        <span className="font-black uppercase tracking-wide opacity-50">
          Speed
        </span>
        <span>{port.speed_gbps ? formatSpeed(port.speed_gbps) : 'Undocumented'}</span>
        <span className="font-black uppercase tracking-wide opacity-50">
          Peer
        </span>
        <span className="break-words font-bold">
          {port.peer_label || 'Not connected'}
        </span>
        {port.cable_label ? (
          <>
            <span className="font-black uppercase tracking-wide opacity-50">
              Cable
            </span>
            <span className="font-mono font-black">{port.cable_label}</span>
          </>
        ) : null}
        {port.comment ? (
          <>
            <span className="font-black uppercase tracking-wide opacity-50">
              Note
            </span>
            <span className="break-words leading-relaxed">{port.comment}</span>
          </>
        ) : null}
        <span className="font-black uppercase tracking-wide opacity-50">
          VLANs
        </span>
        {port.vlans.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {port.vlans
              .slice()
              .sort((a, b) => a.vlan_id - b.vlan_id)
              .map((vlan) => (
                <span
                  key={`${vlan.vlan_id}:${vlan.tagged}`}
                  className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[0.6rem] font-black"
                  style={{
                    borderColor: usageColor(
                      vlanColors,
                      `VLAN ${vlan.vlan_id}`,
                    ),
                  }}
                >
                  {vlanDisplayLabel(vlan.vlan_id, vlan.name)}
                  <span className="opacity-55">{vlan.tagged ? 'T' : 'U'}</span>
                </span>
              ))}
          </span>
        ) : (
          <span className="opacity-55">Not documented</span>
        )}
      </span>
    </span>
  )
}

/** Empty cage for a front-panel slot that has no documented port yet. */
function EmptyCage({ label }: { label: string }) {
  return (
    <span
      className="flex min-h-9 w-full items-center justify-center rounded-md border border-dashed border-white/15 bg-black/60 font-mono text-[0.65rem] font-black text-white/25"
      title={`Port ${label} is not documented`}
    >
      {label}
    </span>
  )
}

/** Decorative hardware controls only; these do not represent live state. */
function ChassisControls() {
  return (
    <div
      data-faceplate-controls
      className="hidden w-16 shrink-0 flex-col justify-between rounded-xl border border-slate-500/60 bg-slate-800/85 p-2 shadow-inner sm:flex"
      aria-hidden="true"
    >
      <div>
        <span className="block text-[0.42rem] font-black uppercase tracking-wider text-white/45">
          Status
        </span>
        <span className="mt-1 flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-mint shadow-[0_0_6px_#36d399]" />
          <span className="size-2 rounded-full bg-sun/85 shadow-[0_0_5px_#f2c94c]" />
          <span className="size-2 rounded-full bg-slate-500" />
        </span>
      </div>
      <div className="space-y-1.5">
        <span className="block text-center text-[0.4rem] font-black uppercase tracking-wide text-white/40">
          Console
        </span>
        <span className="grid h-6 place-items-center rounded-sm border border-slate-400/45 bg-black/75">
          <span className="flex gap-0.5">
            {Array.from({ length: 6 }, (_, index) => (
              <span key={index} className="h-1.5 w-px bg-amber-200/60" />
            ))}
          </span>
        </span>
        <span className="block text-center text-[0.4rem] font-black uppercase tracking-wide text-white/40">
          USB
        </span>
        <span className="mx-auto block h-2.5 w-7 rounded-sm border border-slate-300/45 bg-black/70" />
      </div>
    </div>
  )
}

function PortCage({
  port,
  color,
  vlanColors,
  highlighted,
  activeVlanId,
  align,
  onPortClick,
}: {
  port: ManagementPort
  color: string
  vlanColors: ReadonlyMap<string, string>
  highlighted: boolean
  activeVlanId: number | null
  align: 'start' | 'center' | 'end'
  onPortClick?: (port: ManagementPort) => void
}) {
  const isActiveVlan =
    activeVlanId !== null &&
    port.vlans.some((vlan) => vlan.vlan_id === activeVlanId)
  const isOutsideActiveVlan = activeVlanId !== null && !isActiveVlan
  // Ports with nothing plugged in read as faint/hollow so wired ports stand out.
  const connected = Boolean(port.peer_label)
  return (
    <Tooltip
      content={<PortDetails port={port} vlanColors={vlanColors} />}
      placement="bottom"
      align={align}
      className="block w-full"
      triggerClassName="w-full"
      triggerTabIndex={-1}
    >
      <button
        type="button"
        onClick={() => onPortClick?.(port)}
        className={cn(
          'relative flex min-h-9 w-full items-center justify-center rounded-md border-2 bg-black/55 px-1 font-mono text-[0.65rem] font-black shadow-inner transition hover:-translate-y-0.5 hover:brightness-125',
          connected ? 'text-white' : 'border-dashed text-white/55',
          isOutsideActiveVlan
            ? 'opacity-20 grayscale'
            : !highlighted && 'opacity-25 grayscale',
          isActiveVlan && 'z-10 scale-110 brightness-125 ring-2 ring-white/80',
          onPortClick && 'cursor-pointer',
        )}
        style={{
          borderColor: connected ? color : `${color}66`,
          backgroundColor: connected ? `${color}33` : `${color}10`,
        }}
        aria-label={`${port.switch_name} port ${port.name}: ${
          port.peer_label ? `connected to ${port.peer_label}` : 'not connected'
        }${onPortClick ? '; activate to edit' : ''}`}
      >
        {port.peer_label ? (
          <span
            className="absolute right-1 top-1 size-1.5 rounded-full"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          />
        ) : null}
        {port.name}
      </button>
    </Tooltip>
  )
}

/**
 * A management switch faceplate. Known models (HP, Ubiquiti, MikroTik) render
 * an explicit front-panel matrix (matching the physical port arrangement);
 * unknown switches fall back to a generic two-row auto grid. Ports are coloured
 * by their access VLAN. There is no scroll wrapper so hover tooltips escape the
 * board cleanly, exactly like the Tofino faceplate.
 */
export function ManagementFaceplate({
  switchName,
  model = '',
  ports,
  vlanColors,
  visiblePortIds,
  onPortClick,
}: {
  switchName: string
  model?: string
  ports: ManagementPort[]
  /** Shared overview palette; omit for a standalone switch-local palette. */
  vlanColors?: ReadonlyMap<string, string>
  visiblePortIds?: ReadonlySet<string>
  onPortClick?: (port: ManagementPort) => void
}) {
  const [selectedVlanId, setSelectedVlanId] = useState<number | null>(null)
  const [hoveredVlanId, setHoveredVlanId] = useState<number | null>(null)
  const activeVlanId = selectedVlanId ?? hoveredVlanId
  const ordered = ports
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
  const colors =
    vlanColors ??
    createUsageColorMap(
      ordered.flatMap((port) => [
        portVlanKey(port),
        ...port.vlans.map((vlan) => `VLAN ${vlan.vlan_id}`),
      ]),
      FACEPLATE_COMMENT_COLORS,
    )
  const vlanNames = new Map<number, string>()
  for (const port of ordered) {
    for (const vlan of port.vlans) {
      const currentName = vlanNames.get(vlan.vlan_id) ?? ''
      vlanNames.set(vlan.vlan_id, currentName || vlan.name)
    }
  }
  const vlanLegend = [...vlanNames.entries()]
    .map(([vlanId, name]) => ({
      vlanId,
      label: vlanDisplayLabel(vlanId, name),
    }))
    .sort((a, b) => a.vlanId - b.vlanId)
  if (ordered.length === 0) {
    return null
  }

  const groups = faceplateGroupsFor(switchName, model)
  const byName = new Map(ordered.map((port) => [port.name, port]))
  const matrixLabels = new Set(
    groups
      ? groups
          .flat(2)
          .filter((label): label is string => label !== null)
      : [],
  )
  const extras = groups
    ? ordered.filter((port) => !matrixLabels.has(port.name))
    : []

  const renderCage = (
    port: ManagementPort,
    columnIndex: number,
    columnCount: number,
  ) => {
    return (
      <PortCage
        port={port}
        color={usageColor(colors, portVlanKey(port))}
        vlanColors={colors}
        highlighted={!visiblePortIds || visiblePortIds.has(port.id)}
        activeVlanId={activeVlanId}
        align={alignForColumn(columnIndex, columnCount)}
        onPortClick={onPortClick}
      />
    )
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-black">Interactive switch map</h2>
          <p className="mt-1 text-xs font-bold text-berry-700/70 dark:text-rose-100/70">
            Hover a port for details{onPortClick ? '; click to edit' : ''}. Coloured by
            access VLAN.
          </p>
        </div>
        {vlanLegend.length > 0 ? (
          <div className="flex max-w-3xl flex-wrap justify-end gap-x-4 gap-y-1 text-xs font-black">
            <span className="opacity-60">VLAN:</span>
            {vlanLegend.map(({ vlanId, label }) => {
              const isSelected = selectedVlanId === vlanId
              const isActive = activeVlanId === vlanId
              const color = usageColor(colors, `VLAN ${vlanId}`)
              return (
                <button
                  key={vlanId}
                  type="button"
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border-2 border-transparent px-2.5 py-1 transition',
                    isActive &&
                      'bg-white text-berry-950 shadow-soft ring-2 ring-white/60',
                    activeVlanId !== null && !isActive && 'opacity-35 grayscale',
                    !isActive && 'hover:bg-white/10',
                  )}
                  style={{ borderColor: isActive ? color : undefined }}
                  aria-label={`VLAN filter: ${label}`}
                  aria-pressed={isSelected}
                  onClick={() => {
                    setHoveredVlanId(null)
                    setSelectedVlanId((current) =>
                      current === vlanId ? null : vlanId,
                    )
                  }}
                  onMouseEnter={() => setHoveredVlanId(vlanId)}
                  onMouseLeave={() => setHoveredVlanId(null)}
                >
                  <span
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  {label}
                </button>
              )
            })}
          </div>
        ) : null}
      </div>

      <div
        className="mt-4 rounded-3xl border-4 border-slate-400/60 bg-gradient-to-b from-slate-300 via-slate-200 to-slate-400 p-3 shadow-inner dark:border-slate-500 dark:from-slate-600 dark:via-slate-700 dark:to-slate-800"
        aria-label={`${switchName} port map`}
      >
        <div className="flex items-stretch gap-3">
          <ChassisControls />
          {groups ? (
          <div className="flex min-w-0 flex-1 items-end gap-3">
            {groups.map((group, groupIndex) => {
              const groupOffset = groups
                .slice(0, groupIndex)
                .reduce(
                  (total, candidate) =>
                    total + Math.max(...candidate.map((row) => row.length)),
                  0,
                )
              const totalColumns = groups.reduce(
                (total, candidate) =>
                  total + Math.max(...candidate.map((row) => row.length)),
                0,
              )
              return (
                <div
                  key={groupIndex}
                  data-port-group={groupIndex}
                  className="flex flex-col gap-1 rounded-xl border border-slate-500/60 bg-slate-800/75 p-1.5 shadow-inner"
                >
                  {group.map((row, rowIndex) => (
                    <div key={rowIndex} className="flex gap-1">
                      {row.map((label, colIndex) => {
                        if (label === null) {
                          return (
                            <div key={colIndex} className="w-11" aria-hidden="true" />
                          )
                        }
                        const port = byName.get(label)
                        return (
                          <div key={`${rowIndex}:${colIndex}`} className="w-11">
                            {port
                              ? renderCage(
                                  port,
                                  groupOffset + colIndex,
                                  totalColumns,
                                )
                              : <EmptyCage label={label} />}
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-end gap-3">
            {Array.from(
              { length: Math.ceil(ordered.length / 4) },
              (_, groupIndex) => ordered.slice(groupIndex * 4, groupIndex * 4 + 4),
            ).map((group, groupIndex, allGroups) => (
              <div
                key={groupIndex}
                data-port-group={groupIndex}
                className="grid grid-cols-2 gap-1 rounded-xl border border-slate-500/60 bg-slate-800/75 p-1.5 shadow-inner"
              >
                {group.map((port, index) => (
                  <div
                    key={port.id}
                    className="w-11"
                    style={{
                      gridColumn: Math.floor(index / 2) + 1,
                      gridRow: (index % 2) + 1,
                    }}
                  >
                    {renderCage(
                      port,
                      groupIndex * 2 + Math.floor(index / 2),
                      allGroups.length * 2,
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        </div>
      </div>

      {extras.length > 0 ? (
        <p className="mt-3 text-xs font-bold text-berry-700/70 dark:text-rose-100/70">
          {extras.length} non-front-panel port
          {extras.length === 1 ? '' : 's'} ({extras.map((p) => p.name).join(', ')})
          listed in the table below.
        </p>
      ) : null}
    </Card>
  )
}
