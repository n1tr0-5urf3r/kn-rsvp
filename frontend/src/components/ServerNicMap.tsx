import type { NicView, ServerWithNics } from '../api/types'
import { claimOwner } from '../lib/claims'
import { formatSpeed } from '../lib/format'
import { cn } from '../lib/cn'
import {
  createUsageColorMap,
  FACEPLATE_COMMENT_COLORS,
  usageColor,
  usageKey,
} from '../lib/usageColors'
import { Tooltip } from './Tooltip'

export function pciAddressFamily(address: string): string {
  const match = address
    .trim()
    .match(/^((?:[0-9a-f]{4}:)?[0-9a-f]{2}:[0-9a-f]{2})\.[0-7]$/i)
  return match?.[1].toLowerCase() ?? address.trim().toLowerCase()
}

function pciFunction(address: string): string {
  const match = address.trim().match(/\.([0-7])$/)
  return match ? `.${match[1]}` : address
}

function NicDetails({ nic }: { nic: NicView }) {
  return (
    <span className="block min-w-52 space-y-1">
      <span className="block font-display text-sm font-black">{nic.name}</span>
      <span className="block font-mono text-[0.7rem] opacity-70">
        {nic.pci_address}
        {nic.ifname ? ` · ${nic.ifname}` : ''}
      </span>
      <span className="block">
        {nic.nic_type} · {formatSpeed(nic.speed_gbps)}
      </span>
      <span className="block">
        User: {nic.claim?.user_display_name || 'free'}
      </span>
      <span className="block">
        Plugged into:{' '}
        {nic.peer_port_label ||
          nic.peer_nic_label ||
          nic.claim?.connected_to ||
          'not connected'}
      </span>
      {nic.usage ? <span className="block">Usage: {nic.usage}</span> : null}
      <span className="block">
        Comment: {nic.claim?.comment?.trim() || 'Unlabelled'}
      </span>
    </span>
  )
}

export function ServerNicMap({
  server,
  nics,
  commentColors: suppliedCommentColors,
  activeCommentKey = null,
  onNicClick,
}: {
  server: ServerWithNics
  nics: NicView[]
  commentColors?: ReadonlyMap<string, string>
  activeCommentKey?: string | null
  onNicClick?: (nic: NicView) => void
}) {
  const families = new Map<string, NicView[]>()
  for (const nic of nics) {
    const family = pciAddressFamily(nic.pci_address)
    const members = families.get(family) ?? []
    members.push(nic)
    families.set(family, members)
  }

  if (nics.length === 0) {
    return null
  }

  const commentColors =
    suppliedCommentColors ??
    createUsageColorMap(
      nics.map((nic) => nic.claim?.comment ?? ''),
      FACEPLATE_COMMENT_COLORS,
    )

  return (
    <section
      className="rounded-3xl border border-berry-100 bg-berry-50/60 p-3 dark:border-white/10 dark:bg-berry-950/35"
      aria-label={`${server.name} PCI adapter map`}
    >
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {[...families.entries()].map(([family, members]) => {
          const types = [
            ...new Set(members.map((nic) => nic.nic_type).filter(Boolean)),
          ]
          return (
            <article
              key={family}
              className="rounded-2xl border-2 border-slate-400/50 bg-gradient-to-b from-slate-200 to-slate-300 p-2 shadow-inner dark:border-slate-500 dark:from-slate-700 dark:to-slate-800"
            >
              <div className="mb-2 flex items-start justify-between gap-2 px-1">
                <div className="min-w-0">
                  <h4 className="font-mono text-xs font-black">
                    PCI {family.replace(/^0000:/, '')}
                  </h4>
                  <p className="truncate text-[0.6rem] font-black uppercase tracking-wide opacity-60">
                    {types.join(' / ') || 'Network adapter'}
                  </p>
                </div>
                <span className="rounded-full bg-black/10 px-2 py-0.5 text-[0.6rem] font-black dark:bg-white/10">
                  {members.length} fn
                </span>
              </div>

              <div className="space-y-1">
                {members.map((nic) => {
                  const comment = nic.claim?.comment ?? ''
                  const commentKey = usageKey(comment)
                  const color = usageColor(commentColors, comment)
                  const isActiveGroup =
                    activeCommentKey !== null &&
                    commentKey === activeCommentKey
                  const isOutsideActiveGroup =
                    activeCommentKey !== null &&
                    commentKey !== activeCommentKey
                  return (
                    <Tooltip
                      key={nic.id}
                      content={<NicDetails nic={nic} />}
                      placement="bottom"
                      align="start"
                      className="block w-full"
                      triggerClassName="w-full"
                      triggerTabIndex={-1}
                    >
                      <button
                        type="button"
                        onClick={() => onNicClick?.(nic)}
                        className={cn(
                          'flex min-h-10 w-full items-center gap-2 rounded-xl border-2 bg-berry-950/90 px-2 text-left text-xs font-black text-white transition hover:brightness-125',
                          isOutsideActiveGroup && 'opacity-20 grayscale',
                          isActiveGroup &&
                            'z-10 scale-[1.03] brightness-125 ring-2 ring-white/80',
                        )}
                        style={{
                          borderColor: color,
                          backgroundImage: `linear-gradient(${color}22, ${color}22)`,
                        }}
                        data-comment-group={commentKey}
                        data-comment-highlighted={
                          activeCommentKey === null ? undefined : isActiveGroup
                        }
                        aria-label={`${server.name} NIC ${nic.name}, PCI function ${pciFunction(
                          nic.pci_address,
                        )}: ${
                          nic.peer_port_label ||
                          nic.peer_nic_label ||
                          nic.claim?.connected_to ||
                          (claimOwner(nic.claim)
                            ? `claimed by ${claimOwner(nic.claim)}`
                            : 'free')
                        }${onNicClick ? '; activate to edit' : ''}`}
                      >
                        <span className="rounded-md bg-white/10 px-1.5 py-1 font-mono text-[0.65rem]">
                          {pciFunction(nic.pci_address)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{nic.name}</span>
                          <span className="block truncate font-mono text-[0.6rem] text-white/55">
                            {nic.ifname || formatSpeed(nic.speed_gbps)}
                          </span>
                        </span>
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: color }}
                          aria-hidden="true"
                        />
                      </button>
                    </Tooltip>
                  )
                })}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
