import { useState } from 'react'
import type { TofinoPort } from '../api/types'
import { formatSpeed } from '../lib/format'
import { cn } from '../lib/cn'
import {
  createUsageColorMap,
  FACEPLATE_COMMENT_COLORS,
  usageColor,
  usageKey,
  usageName,
} from '../lib/usageColors'
import { Card } from './Card'
import { Tooltip } from './Tooltip'

function portNumber(fpPort: string): number | null {
  const match = fpPort.match(/^(\d+)(?:\/\d+)?$/)
  if (!match) {
    return null
  }
  const value = Number(match[1])
  return Number.isInteger(value) && value > 0 ? value : null
}

function PortDetails({ port }: { port: TofinoPort }) {
  return (
    <span className="block min-w-64 max-w-72">
      <span className="block border-b border-berry-100 pb-2 font-display text-sm font-black dark:border-white/10">
        {port.tofino_name} {port.fp_port}
      </span>
      <span className="mt-2 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-2 text-xs">
        <span className="font-black uppercase tracking-wide opacity-50">
          Dev port
        </span>
        <span className="font-mono font-black">{port.dev_port}</span>
        {port.pipe ? (
          <>
            <span className="font-black uppercase tracking-wide opacity-50">
              Pipe
            </span>
            <span className="font-mono font-black">{port.pipe}</span>
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
        <span className="font-black uppercase tracking-wide opacity-50">
          Usage
        </span>
        <span className="font-bold">{usageName(usageKey(port.comment))}</span>
      </span>
    </span>
  )
}

function alignForCage(groupIndex: number, cageIndex: number) {
  const physicalColumn = groupIndex * 2 + Math.floor(cageIndex / 2)
  if (physicalColumn < 3) {
    return 'start' as const
  }
  if (physicalColumn > 12) {
    return 'end' as const
  }
  return 'center' as const
}

function PortCage({
  port,
  number,
  groupIndex,
  cageIndex,
  highlighted,
  commentColors,
  activeCommentKey,
  onPortClick,
}: {
  port?: TofinoPort
  number: number
  groupIndex: number
  cageIndex: number
  highlighted: boolean
  commentColors: ReadonlyMap<string, string>
  activeCommentKey: string | null
  onPortClick?: (port: TofinoPort) => void
}) {
  if (!port) {
    return (
      <span
        className={cn(
          'flex min-h-9 items-center justify-center rounded-md border border-dashed border-white/15 bg-black/60 font-mono text-[0.65rem] font-black text-white/25 transition',
          activeCommentKey && 'opacity-20',
        )}
        title={`Port ${number}/0 is not documented`}
      >
        {number}
      </span>
    )
  }

  const commentKey = usageKey(port.comment)
  const color = usageColor(commentColors, port.comment)
  const isActiveGroup =
    activeCommentKey !== null && commentKey === activeCommentKey
  const isOutsideActiveGroup =
    activeCommentKey !== null && commentKey !== activeCommentKey
  return (
    <Tooltip
      content={<PortDetails port={port} />}
      placement="bottom"
      align={alignForCage(groupIndex, cageIndex)}
      className="block w-full"
      triggerClassName="w-full"
      triggerTabIndex={-1}
    >
      <button
        type="button"
        onClick={() => onPortClick?.(port)}
        className={cn(
          'relative flex min-h-9 w-full items-center justify-center rounded-md border-2 bg-black/55 px-1 font-mono text-[0.65rem] font-black text-white shadow-inner transition hover:-translate-y-0.5 hover:brightness-125',
          isOutsideActiveGroup
            ? 'opacity-20 grayscale'
            : !highlighted && 'opacity-25 grayscale',
          isActiveGroup &&
            'z-10 scale-110 brightness-125 ring-2 ring-white/80',
          onPortClick && 'cursor-pointer',
        )}
        style={{
          borderColor: color,
          backgroundColor: `${color}33`,
        }}
        data-comment-group={commentKey}
        data-comment-highlighted={
          activeCommentKey === null ? undefined : isActiveGroup
        }
        aria-label={`${port.tofino_name} port ${port.fp_port}: ${
          port.peer_label ? `connected to ${port.peer_label}` : 'not connected'
        }${onPortClick ? '; activate to edit' : ''}`}
      >
        <span
          className="absolute right-1 top-1 size-1.5 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
        <span className="sm:hidden">{number}</span>
        <span className="hidden sm:inline">{port.fp_port}</span>
      </button>
    </Tooltip>
  )
}

export function TofinoFaceplate({
  tofinoName,
  ports,
  visiblePortIds,
  commentColors: suppliedCommentColors,
  activeCommentKey: suppliedActiveCommentKey,
  selectedCommentKey: suppliedSelectedCommentKey,
  onCommentHover,
  onCommentSelect,
  onPortClick,
}: {
  tofinoName: string
  ports: TofinoPort[]
  visiblePortIds?: ReadonlySet<string>
  commentColors?: ReadonlyMap<string, string>
  activeCommentKey?: string | null
  selectedCommentKey?: string | null
  onCommentHover?: (key: string | null) => void
  onCommentSelect?: (key: string) => void
  onPortClick?: (port: TofinoPort) => void
}) {
  const [localHoveredComment, setLocalHoveredComment] = useState<string | null>(
    null,
  )
  const [localSelectedComment, setLocalSelectedComment] = useState<
    string | null
  >(null)
  const activeCommentKey =
    suppliedActiveCommentKey === undefined
      ? localHoveredComment ?? localSelectedComment
      : suppliedActiveCommentKey
  const selectedCommentKey =
    suppliedSelectedCommentKey === undefined
      ? localSelectedComment
      : suppliedSelectedCommentKey
  const commentColors =
    suppliedCommentColors ??
    createUsageColorMap(
      ports.map((port) => port.comment),
      FACEPLATE_COMMENT_COLORS,
    )
  const commentKeys = [...new Set(ports.map((port) => usageKey(port.comment)))].sort(
    (left, right) =>
      usageName(left).localeCompare(usageName(right), undefined, {
        sensitivity: 'base',
      }),
  )
  const byNumber = new Map<number, TofinoPort>()
  const extras: TofinoPort[] = []
  for (const port of ports) {
    const number = portNumber(port.fp_port)
    if (number !== null && number <= 32 && !byNumber.has(number)) {
      byNumber.set(number, port)
    } else {
      extras.push(port)
    }
  }
  const hoverComment = (key: string | null) => {
    setLocalHoveredComment(key)
    onCommentHover?.(key)
  }
  const selectComment = (key: string) => {
    setLocalHoveredComment(null)
    setLocalSelectedComment((current) => (current === key ? null : key))
    onCommentSelect?.(key)
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-black">
            Interactive switch map
          </h2>
          <p className="mt-1 text-xs font-bold text-berry-700/70 dark:text-rose-100/70">
            Hover or focus a cage for details
            {onPortClick ? '; click to edit' : ''}.
          </p>
        </div>
        {commentKeys.length > 0 ? (
          <div className="flex max-w-3xl flex-wrap justify-end gap-x-4 gap-y-1 text-xs font-black">
            <span className="opacity-60">Comment:</span>
            {commentKeys.map((key) => {
              const isActive = activeCommentKey === key
              const isSelected = selectedCommentKey === key
              return (
                <button
                  key={key}
                  type="button"
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border-2 border-transparent px-2.5 py-1 transition',
                    isActive &&
                      'bg-white text-berry-950 shadow-soft ring-2 ring-white/60',
                    activeCommentKey &&
                      !isActive &&
                      'opacity-35 grayscale',
                    !isActive && 'hover:bg-white/10',
                  )}
                  style={{
                    borderColor: isActive
                      ? commentColors.get(key)
                      : undefined,
                  }}
                  data-comment-legend={key}
                  aria-label={`Comment group: ${usageName(key)}`}
                  aria-pressed={isSelected}
                  onMouseEnter={() => hoverComment(key)}
                  onMouseLeave={() => hoverComment(null)}
                  onFocus={() => hoverComment(key)}
                  onBlur={() => hoverComment(null)}
                  onClick={() => selectComment(key)}
                >
                  <span
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: commentColors.get(key) }}
                  />
                  {usageName(key)}
                </button>
              )
            })}
          </div>
        ) : null}
      </div>

      <div
        className="mt-4 rounded-3xl border-4 border-slate-400/60 bg-gradient-to-b from-slate-300 via-slate-200 to-slate-400 p-3 shadow-inner dark:border-slate-500 dark:from-slate-600 dark:via-slate-700 dark:to-slate-800"
        aria-label={`${tofinoName} front-panel port map`}
      >
        <div className="flex items-stretch gap-3">
          <div
            className="hidden w-14 shrink-0 grid-cols-2 gap-1 rounded-xl border border-slate-500/50 bg-slate-700/80 p-2 sm:grid"
            aria-hidden="true"
          >
            <span className="col-span-2 rounded-sm bg-black/70" />
            <span className="col-span-2 rounded-sm bg-black/55" />
            <span className="rounded-full bg-mint/80" />
            <span className="rounded-full bg-sun/80" />
          </div>

          <div className="grid min-w-0 flex-1 grid-cols-4 gap-2 sm:grid-cols-8">
            {Array.from({ length: 8 }, (_, groupIndex) => (
              <div
                key={groupIndex}
                className="grid grid-cols-2 gap-1 rounded-lg border border-slate-500/60 bg-slate-800/75 p-1.5 shadow-inner"
              >
                {Array.from({ length: 4 }, (_, cageIndex) => {
                  const number = groupIndex * 4 + cageIndex + 1
                  const port = byNumber.get(number)
                  return (
                    <div
                      key={number}
                      data-cage-number={number}
                      style={{
                        gridColumn: Math.floor(cageIndex / 2) + 1,
                        gridRow: (cageIndex % 2) + 1,
                      }}
                    >
                      <PortCage
                        port={port}
                        number={number}
                        groupIndex={groupIndex}
                        cageIndex={cageIndex}
                        highlighted={
                          !port ||
                          !visiblePortIds ||
                          visiblePortIds.has(port.id)
                        }
                        commentColors={commentColors}
                        activeCommentKey={activeCommentKey}
                        onPortClick={onPortClick}
                      />
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          <div
            className="hidden w-9 shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-slate-500/50 bg-slate-700/75 sm:flex"
            aria-hidden="true"
          >
            <span className="size-2 rounded-full bg-mint" />
            <span className="size-2 rounded-full bg-mint/60" />
            <span className="h-8 w-2 rounded-sm bg-black/60" />
          </div>
        </div>
      </div>

      {extras.length > 0 ? (
        <p className="mt-3 text-xs font-bold text-berry-700/70 dark:text-rose-100/70">
          {extras.length} non-standard or breakout lane
          {extras.length === 1 ? '' : 's'} remain available in the table below.
        </p>
      ) : null}
    </Card>
  )
}
