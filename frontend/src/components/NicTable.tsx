import { Pencil, Plug, Unplug } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { NicView, ServerWithNics } from '../api/client'
import { claimOwner } from '../lib/claims'
import { formatSpeed } from '../lib/format'
import { Button } from './Button'

export function isManagementNic(nic: Pick<NicView, 'usage'>): boolean {
  return nic.usage.trim().toLowerCase() === 'management'
}

function FunctionBadge({ nic }: { nic: NicView }) {
  return nic.kind === 'vf' ? (
    <span
      className="rounded-full bg-sky/30 px-2 py-0.5 text-[0.6rem] font-black uppercase tracking-wide"
      title="SR-IOV virtual function"
    >
      VF
    </span>
  ) : null
}

function ClaimUser({ nic }: { nic: NicView }) {
  const owner = claimOwner(nic.claim)
  return owner ? (
    <span className="inline-block rounded-full bg-primary/10 px-3 py-1 text-primary dark:bg-blush/15 dark:text-blush">
      {owner}
    </span>
  ) : (
    <span className="text-mint">free</span>
  )
}

function Peer({ nic }: { nic: NicView }) {
  if (nic.peer_port_label && nic.peer_port_tofino_id) {
    return (
      <Link
        to={`/tofinos/${nic.peer_port_tofino_id}`}
        className="font-black text-primary underline decoration-dotted underline-offset-4 dark:text-blush"
      >
        {nic.peer_port_label}
      </Link>
    )
  }
  if (nic.peer_nic_label && nic.peer_nic_server_id) {
    return (
      <Link
        to={`/servers#server-${nic.peer_nic_server_id}`}
        className="font-black text-primary underline decoration-dotted underline-offset-4 dark:text-blush"
      >
        {nic.peer_nic_label}
      </Link>
    )
  }
  return nic.claim?.connected_to || '—'
}

function Usage({ nic }: { nic: NicView }) {
  return <>{nic.usage || '—'}</>
}

function Speed({ nic }: { nic: NicView }) {
  return <>{formatSpeed(nic.speed_gbps)}</>
}

function NicActions({
  nic,
  onConfigure,
  onRelease,
}: {
  nic: NicView
  onConfigure?: (nic: NicView) => void
  onRelease?: (nic: NicView) => void
}) {
  const owner = claimOwner(nic.claim)
  return (
    <div className="flex flex-wrap gap-1">
      <Button
        variant="ghost"
        className="min-h-9 px-3 text-xs"
        onClick={() => onConfigure?.(nic)}
        aria-label={owner ? `Edit ${nic.name}` : `Configure ${nic.name}`}
      >
        {owner ? (
          <Pencil className="size-4" aria-hidden="true" />
        ) : (
          <Plug className="size-4" aria-hidden="true" />
        )}
        {owner ? 'Edit' : 'Configure'}
      </Button>
      {owner ? (
        <Button
          variant="ghost"
          className="min-h-9 px-3 text-xs"
          onClick={() => onRelease?.(nic)}
          aria-label={`Release claim on ${nic.name}`}
        >
          <Unplug className="size-4" aria-hidden="true" />
          Release
        </Button>
      ) : null}
    </div>
  )
}

function MobileDetail({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.65rem] font-black uppercase tracking-wide text-berry-700/60 dark:text-rose-100/60">
        {label}
      </dt>
      <dd className="break-words font-bold">{children}</dd>
    </div>
  )
}

export function NicTable({
  server,
  isAdmin = false,
  showManagement = false,
  onConfigure,
  onRelease,
}: {
  server: ServerWithNics
  isAdmin?: boolean
  showManagement?: boolean
  /** Opens the NIC configuration dialog (usage, speed, owner, cabling). */
  onConfigure?: (nic: NicView) => void
  onRelease?: (nic: NicView) => void
}) {
  const visibleNics = showManagement
    ? server.nics
    : server.nics.filter((nic) => !isManagementNic(nic))

  if (server.nics.length === 0) {
    return (
      <p className="text-sm font-bold text-berry-700/70 dark:text-rose-100/70">
        No NICs recorded for this server yet.
      </p>
    )
  }

  if (visibleNics.length === 0) {
    return (
      <p className="text-sm font-bold text-berry-700/70 dark:text-rose-100/70">
        Management NICs are hidden by the current filter.
      </p>
    )
  }

  return (
    <>
      <div className="space-y-3 xl:hidden">
        {visibleNics.map((nic) => (
          <article
            key={nic.id}
            className="rounded-3xl bg-white/70 p-4 text-sm dark:bg-berry-950/50"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="flex items-center gap-2 font-display text-base font-black">
                {nic.name}
                <FunctionBadge nic={nic} />
              </h3>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
              <MobileDetail label="Interface">
                <span className="font-mono">{nic.ifname || '—'}</span>
                {nic.mac ? (
                  <span className="block font-mono text-xs opacity-60">
                    {nic.mac}
                  </span>
                ) : null}
              </MobileDetail>
              <MobileDetail label="PCI address">
                <span className="font-mono">{nic.pci_address}</span>
              </MobileDetail>
              <MobileDetail label="Type">
                {nic.nic_type || '—'}
              </MobileDetail>
              <MobileDetail label="Speed">
                <Speed nic={nic} />
              </MobileDetail>
              <MobileDetail label="NUMA node">
                {nic.numa_node ?? '—'}
              </MobileDetail>
              <MobileDetail label="Used by (VM)">
                <Usage nic={nic} />
              </MobileDetail>
              <MobileDetail label="User">
                <ClaimUser nic={nic} />
              </MobileDetail>
              <MobileDetail label="Plugged into">
                <Peer nic={nic} />
              </MobileDetail>
              <MobileDetail label="Cable">
                {nic.claim?.cable_label || '—'}
              </MobileDetail>
              <MobileDetail label="Comment">
                {nic.claim?.comment || '—'}
              </MobileDetail>
            </dl>
            {isAdmin ? (
              <div className="mt-3 border-t border-berry-100 pt-3 dark:border-white/10">
                <NicActions
                  nic={nic}
                  onConfigure={onConfigure}
                  onRelease={onRelease}
                />
              </div>
            ) : null}
          </article>
        ))}
      </div>

      <div className="hidden xl:block">
        <table className="w-full table-fixed border-separate border-spacing-y-1 text-left text-sm">
          <thead>
            <tr className="text-xs font-black uppercase tracking-wide text-berry-700/70 dark:text-rose-100/70">
              <th className="w-[10%] px-3 py-1">Name / alias</th>
              <th className="w-[10%] px-3 py-1">Interface</th>
              <th className="w-[10%] px-3 py-1">PCI address</th>
              <th className="w-[15%] px-3 py-1">Hardware</th>
              <th className="w-[9%] px-3 py-1" title="VM or role using this NIC">
                Used by
              </th>
              <th className="w-[10%] px-3 py-1">User</th>
              <th className="w-[10%] px-3 py-1">Plugged into</th>
              <th className="w-[6%] px-3 py-1">Cable</th>
              <th className="w-[10%] px-3 py-1">Comment</th>
              {isAdmin ? (
                <th className="w-[10%] px-3 py-1">Actions</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {visibleNics.map((nic) => (
              <tr
                key={nic.id}
                className="rounded-2xl bg-white/70 font-bold dark:bg-berry-950/50"
              >
                <td className="rounded-l-2xl px-3 py-2">
                  <span className="flex items-center gap-2 break-words">
                    {nic.name}
                    <FunctionBadge nic={nic} />
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {nic.ifname || '—'}
                  {nic.mac ? (
                    <span className="block text-[0.65rem] opacity-60">
                      {nic.mac}
                    </span>
                  ) : null}
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                  {nic.pci_address}
                </td>
                <td className="break-words px-3 py-2">
                  <span className="block">{nic.nic_type || '—'}</span>
                  <span className="flex flex-wrap items-center gap-x-1 text-xs text-berry-700/60 dark:text-rose-100/60">
                    <Speed nic={nic} />
                    {nic.numa_node !== null ? (
                      <span>· NUMA {nic.numa_node}</span>
                    ) : null}
                  </span>
                </td>
                <td className="break-words px-3 py-2">
                  <Usage nic={nic} />
                </td>
                <td className="px-3 py-2">
                  <ClaimUser nic={nic} />
                </td>
                <td className="px-3 py-2">
                  <Peer nic={nic} />
                </td>
                <td className="px-3 py-2">
                  {nic.claim?.cable_label || '—'}
                </td>
                <td
                  className={
                    isAdmin
                      ? 'break-words px-3 py-2'
                      : 'rounded-r-2xl break-words px-3 py-2'
                  }
                >
                  {nic.claim?.comment || '—'}
                </td>
                {isAdmin ? (
                  <td className="rounded-r-2xl px-3 py-2">
                    <NicActions
                      nic={nic}
                      onConfigure={onConfigure}
                      onRelease={onRelease}
                    />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
