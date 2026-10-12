import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, Cpu } from 'lucide-react'
import {
  useAdminUsers,
  useManagementPorts,
  useManagementSwitches,
  useMe,
  usePutNicClaimMutation,
  useReleaseNicClaimMutation,
  useServers,
  useTofinoPorts,
  useFreeNicMutation,
  useUpdateNicMutation,
} from '../api/queries'
import type { NicView, ServerWithNics } from '../api/client'
import { claimOwner } from '../lib/claims'
import { describeHardware } from '../lib/format'
import { cn } from '../lib/cn'
import { Card, Skeleton } from '../components/Card'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'
import { filterNics, hasAssignment, NicTable } from '../components/NicTable'
import { ServerNicMap } from '../components/ServerNicMap'
import { FieldLabel, Select, TextInput } from '../components/Select'
import {
  PeerPicker,
  peerInputFromDraft,
  type PeerDraft,
} from '../components/PeerPicker'
import { useToast } from '../lib/toast'
import {
  createUsageColorMap,
  FACEPLATE_COMMENT_COLORS,
  usageKey,
  usageName,
} from '../lib/usageColors'

function confirmFree(nic: NicView): boolean {
  const peer =
    nic.peer_port_label || nic.peer_nic_label || nic.peer_mgmt_port_label
  const cable = peer
    ? ` It is also unplugged from ${peer}, and the cable label and comment are removed on both ends.`
    : ''
  return window.confirm(
    `Free ${nic.name}? This clears the owner, "Used by", and comment.${cable}`,
  )
}

/**
 * Everything an admin can document about one NIC: what it is used for, how
 * fast it is, who holds it, and what it is plugged into. Owner-less NICs are
 * fine — the row then only documents the cable.
 */
function NicModal({
  nic,
  servers,
  onClose,
}: {
  nic: NicView
  servers: ServerWithNics[]
  onClose: () => void
}) {
  const { data: usersData } = useAdminUsers()
  const { data: portsData } = useTofinoPorts()
  const { data: switchesData } = useManagementSwitches()
  const { data: mgmtPortsData } = useManagementPorts()
  const putClaim = usePutNicClaimMutation()
  const releaseClaim = useReleaseNicClaimMutation()
  const freeNic = useFreeNicMutation()
  const updateNic = useUpdateNicMutation()
  const { toast } = useToast()
  const [usage, setUsage] = useState(nic.usage)
  const [speed, setSpeed] = useState(String(nic.speed_gbps))
  const [assigneeType, setAssigneeType] = useState<'user' | 'text' | 'none'>(
    () => {
      if (nic.claim?.user_id) {
        return 'user'
      }
      return claimOwner(nic.claim) ? 'text' : 'none'
    },
  )
  const [userId, setUserId] = useState(nic.claim?.user_id ?? '')
  const [assigneeName, setAssigneeName] = useState(
    nic.claim?.user_id ? '' : (claimOwner(nic.claim) ?? ''),
  )
  const [peerDraft, setPeerDraft] = useState<PeerDraft>(() => {
    if (nic.peer_port_id) {
      return {
        kind: 'port',
        deviceId: nic.peer_port_tofino_id ?? '',
        endpointId: nic.peer_port_id,
        text: '',
      }
    }
    if (nic.peer_mgmt_port_id) {
      return {
        kind: 'mgmt',
        deviceId: nic.peer_mgmt_switch_id ?? '',
        endpointId: nic.peer_mgmt_port_id,
        text: '',
      }
    }
    if (nic.peer_nic_id) {
      return {
        kind: 'nic',
        deviceId: nic.peer_nic_server_id ?? '',
        endpointId: nic.peer_nic_id,
        text: '',
      }
    }
    if (nic.claim?.connected_to) {
      return {
        kind: 'text',
        deviceId: '',
        endpointId: '',
        text: nic.claim.connected_to,
      }
    }
    return { kind: 'none', deviceId: '', endpointId: '', text: '' }
  })
  const [cableLabel, setCableLabel] = useState(nic.claim?.cable_label ?? '')
  const [comment, setComment] = useState(nic.claim?.comment ?? '')
  const [error, setError] = useState<string | null>(null)
  const selectedPort =
    peerDraft.kind === 'port'
      ? (portsData?.ports ?? []).find(
          (port) => port.id === peerDraft.endpointId,
        )
      : undefined
  const recablesPort =
    selectedPort?.peer_label && selectedPort.peer_nic_id !== nic.id
      ? selectedPort
      : undefined
  const selectedNic =
    peerDraft.kind === 'nic'
      ? servers
          .flatMap((server) => server.nics)
          .find((candidate) => candidate.id === peerDraft.endpointId)
      : undefined
  const selectedNicPeer =
    selectedNic?.peer_port_label || selectedNic?.peer_nic_label
  const recablesNic =
    selectedNicPeer && selectedNic?.peer_nic_id !== nic.id
      ? selectedNic
      : undefined
  const selectedMgmtPort =
    peerDraft.kind === 'mgmt'
      ? (mgmtPortsData?.ports ?? []).find(
          (port) => port.id === peerDraft.endpointId,
        )
      : undefined
  const recablesMgmt =
    selectedMgmtPort?.peer_label && selectedMgmtPort.peer_nic_id !== nic.id
      ? selectedMgmtPort
      : undefined

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (assigneeType === 'user' && !userId) {
      setError('Pick a mapped user for this claim.')
      return
    }
    if (assigneeType === 'text' && !assigneeName.trim()) {
      setError('Enter a person, team, or project name.')
      return
    }
    const speedGbps = Number(speed)
    if (!Number.isFinite(speedGbps) || speedGbps < 0) {
      setError('Speed must be zero (unknown) or a positive number of Gbit/s.')
      return
    }
    const peer = peerInputFromDraft(peerDraft)
    if (!peer) {
      setError('Choose a device and endpoint for this connection.')
      return
    }
    // Nothing to claim and nothing to document: drop the row instead of
    // storing an empty one.
    const documents =
      assigneeType !== 'none' ||
      peer.kind !== 'none' ||
      cableLabel.trim() !== '' ||
      comment.trim() !== ''
    // Releasing alone never unplugs: a NIC that loses its peer has to go
    // through the claim endpoint first so both ends are disconnected.
    const wasCabled = Boolean(
      nic.peer_port_id || nic.peer_nic_id || nic.peer_mgmt_port_id,
    )
    try {
      await updateNic.mutateAsync({
        id: nic.id,
        body: { usage, speed_gbps: speedGbps },
      })
      if (documents || wasCabled) {
        await putClaim.mutateAsync({
          nicId: nic.id,
          body: {
            ...(assigneeType === 'user'
              ? { user_id: userId }
              : assigneeType === 'text'
                ? { assignee_name: assigneeName.trim() }
                : {}),
            peer,
            cable_label: cableLabel.trim(),
            comment: comment.trim(),
          },
        })
      }
      if (!documents && (nic.claim || wasCabled)) {
        await releaseClaim.mutateAsync(nic.id)
      }
      toast(`Saved ${nic.name}.`, 'success')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saving failed.')
    }
  }

  const free = async () => {
    if (!confirmFree(nic)) {
      return
    }
    setError(null)
    try {
      await freeNic.mutateAsync(nic.id)
      toast(`Freed ${nic.name}.`, 'success')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Freeing failed.')
    }
  }
  const busy =
    updateNic.isPending ||
    putClaim.isPending ||
    releaseClaim.isPending ||
    freeNic.isPending

  return (
    <Modal title={`Configure ${nic.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="Used by (VM)">
            <TextInput
              value={usage}
              onChange={(e) => setUsage(e.target.value)}
              placeholder="e.g. 281 (kuppler-2), Management"
            />
          </FieldLabel>
          <FieldLabel label="Speed (Gbit/s)">
            <TextInput
              type="number"
              step="0.1"
              min="0"
              value={speed}
              onChange={(e) => setSpeed(e.target.value)}
              placeholder="e.g. 100, 2.5, or 0 if unknown"
              required
            />
          </FieldLabel>
        </div>
        <p className="text-sm font-bold text-berry-700/70 dark:text-rose-100/70">
          Use 0 when the nominal speed is not documented yet.
        </p>
        <p className="text-sm font-bold text-berry-700/70 dark:text-rose-100/70">
          "Used by" is the VM this NIC is passed through to (as the inventory
          collector reports it) or a role like Management. It belongs to this
          one NIC and is never copied to the other end of a cable.
        </p>
        <FieldLabel label="Assignee type">
          <Select
            value={assigneeType}
            onChange={(e) =>
              setAssigneeType(e.target.value as 'user' | 'text' | 'none')
            }
          >
            <option value="none">Nobody — documentation only</option>
            <option value="user">Mapped RSVP user</option>
            <option value="text">Free-form name</option>
          </Select>
        </FieldLabel>
        {assigneeType === 'user' ? (
          <FieldLabel label="Mapped user">
            <Select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              required
            >
              <option value="" disabled>
                Select a user...
              </option>
              {(usersData?.users ?? []).map((user) => (
                <option key={user.id} value={user.id}>
                  {user.display_name} ({user.username})
                </option>
              ))}
            </Select>
          </FieldLabel>
        ) : assigneeType === 'text' ? (
          <FieldLabel label="Assignee name">
            <TextInput
              value={assigneeName}
              onChange={(e) => setAssigneeName(e.target.value)}
              placeholder="Person, team, course, or project"
              required
            />
          </FieldLabel>
        ) : null}
        <PeerPicker
          draft={peerDraft}
          onChange={setPeerDraft}
          ports={portsData?.ports ?? []}
          servers={servers}
          excludeNicId={nic.id}
          managementSwitches={switchesData?.switches ?? []}
          managementPorts={mgmtPortsData?.ports ?? []}
        />
        {recablesPort ? (
          <p className="rounded-2xl bg-sun/20 px-4 py-3 text-sm font-bold text-berry-950 dark:bg-sun/10 dark:text-berry-50">
            {recablesPort.tofino_name} {recablesPort.fp_port} is currently
            plugged into {recablesPort.peer_label}. Saving re-cables it to this
            NIC.
          </p>
        ) : null}
        {recablesNic ? (
          <p className="rounded-2xl bg-sun/20 px-4 py-3 text-sm font-bold text-berry-950 dark:bg-sun/10 dark:text-berry-50">
            {recablesNic.name} is currently plugged into{' '}
            {recablesNic.peer_port_label || recablesNic.peer_nic_label}. Saving
            re-cables both NICs.
          </p>
        ) : null}
        {recablesMgmt ? (
          <p className="rounded-2xl bg-sun/20 px-4 py-3 text-sm font-bold text-berry-950 dark:bg-sun/10 dark:text-berry-50">
            {recablesMgmt.switch_name} {recablesMgmt.name} is currently
            plugged into {recablesMgmt.peer_label}. Saving re-cables it to
            this NIC.
          </p>
        ) : null}
        <FieldLabel label="Cable label">
          <TextInput
            value={cableLabel}
            onChange={(e) => setCableLabel(e.target.value)}
            placeholder="e.g. C-042"
          />
        </FieldLabel>
        <FieldLabel label="Comment">
          <TextInput
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </FieldLabel>
        <p className="text-sm font-bold text-berry-700/70 dark:text-rose-100/70">
          Cable label and comment describe the cable: the other end of this
          link is updated with them too.
        </p>
        {error ? (
          <p role="alert" className="text-sm font-bold text-primary dark:text-blush">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          {hasAssignment(nic) ? (
            <Button
              type="button"
              variant="ghost"
              className="mr-auto"
              onClick={free}
              disabled={busy}
            >
              Free NIC
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export function ServersPage() {
  const { data: me } = useMe()
  const { data, isLoading } = useServers()
  const freeNic = useFreeNicMutation()
  const { toast } = useToast()
  const [configureNic, setConfigureNic] = useState<NicView | null>(null)
  const [showManagement, setShowManagement] = useState(false)
  const [onlyFree, setOnlyFree] = useState(false)
  const [hoveredComment, setHoveredComment] = useState<string | null>(null)
  const [selectedComment, setSelectedComment] = useState<string | null>(null)
  const isAdmin = me?.user?.is_admin ?? false
  const servers = data?.servers ?? []
  const allNics = servers.flatMap((server) => server.nics)
  const visibleNics = (server: ServerWithNics) =>
    filterNics(server.nics, { showManagement, onlyFree })
  const commentColors = createUsageColorMap(
    allNics.map((nic) => nic.claim?.comment ?? ''),
    FACEPLATE_COMMENT_COLORS,
  )
  const commentKeys = [
    ...new Set(
      servers.flatMap((server) =>
        visibleNics(server).map((nic) => usageKey(nic.claim?.comment ?? '')),
      ),
    ),
  ].sort((left, right) =>
    usageName(left).localeCompare(usageName(right), undefined, {
      sensitivity: 'base',
    }),
  )
  const activeCommentKey = hoveredComment ?? selectedComment

  const free = async (nic: NicView) => {
    if (!confirmFree(nic)) {
      return
    }
    try {
      await freeNic.mutateAsync(nic.id)
      toast(`Freed ${nic.name}.`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Freeing failed.', 'error')
    }
  }
  const filterToggleClass =
    'inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-3xl border-2 border-berry-100 bg-white/80 px-4 text-sm font-black text-berry-700 shadow-soft dark:border-white/10 dark:bg-berry-900 dark:text-rose-100'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-black">Servers</h2>
        <div className="flex flex-wrap gap-2">
          <label className={filterToggleClass}>
            <input
              type="checkbox"
              checked={onlyFree}
              onChange={(event) => {
                setOnlyFree(event.target.checked)
                setHoveredComment(null)
                setSelectedComment(null)
              }}
              className="size-4 accent-primary"
            />
            Only free NICs
          </label>
          <label className={filterToggleClass}>
            <input
              type="checkbox"
              checked={showManagement}
              onChange={(event) => {
                setShowManagement(event.target.checked)
                setHoveredComment(null)
                setSelectedComment(null)
              }}
              className="size-4 accent-primary"
            />
            Show management NICs
          </label>
        </div>
      </div>
      {isLoading ? (
        <Skeleton className="h-48" />
      ) : servers.length === 0 ? (
        <Card>
          <p className="font-bold text-berry-700/70 dark:text-rose-100/70">
            No servers configured yet.
          </p>
        </Card>
      ) : (
        <>
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-black">
                  Server & NIC overview
                </h2>
                <p className="mt-1 text-xs font-bold text-berry-700/70 dark:text-rose-100/70">
                  Functions sharing a PCI device are grouped together
                  {isAdmin ? '; click a function to configure it' : ''}.
                </p>
              </div>
              {commentKeys.length > 0 ? (
                <div className="flex max-w-3xl flex-wrap justify-end gap-x-4 gap-y-1 text-xs font-black">
                  <span className="self-center opacity-60">Comment:</span>
                  {commentKeys.map((key) => {
                    const isActive = activeCommentKey === key
                    const isSelected = selectedComment === key
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
                        aria-label={`Comment group: ${usageName(key)}`}
                        aria-pressed={isSelected}
                        onMouseEnter={() => setHoveredComment(key)}
                        onMouseLeave={() => setHoveredComment(null)}
                        onFocus={() => setHoveredComment(key)}
                        onBlur={() => setHoveredComment(null)}
                        onClick={() => {
                          setHoveredComment(null)
                          setSelectedComment((current) =>
                            current === key ? null : key,
                          )
                        }}
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

            <div className="mt-5 space-y-6">
              {servers.map((server) => {
                const nics = visibleNics(server)
                return (
                  <section
                    key={server.id}
                    aria-labelledby={`server-overview-${server.id}`}
                  >
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
                      <h3
                        id={`server-overview-${server.id}`}
                        className="font-display text-base font-black"
                      >
                        {server.name}
                      </h3>
                      <a
                        href={`#server-${server.id}`}
                        className="text-xs font-black text-primary underline decoration-dotted underline-offset-4 dark:text-blush"
                      >
                        {nics.length} {nics.length === 1 ? 'NIC' : 'NICs'} ·
                        details
                      </a>
                    </div>
                    {nics.length > 0 ? (
                      <ServerNicMap
                        server={server}
                        nics={nics}
                        commentColors={commentColors}
                        activeCommentKey={activeCommentKey}
                        onNicClick={isAdmin ? setConfigureNic : undefined}
                      />
                    ) : (
                      <p className="rounded-3xl border border-berry-100 bg-berry-50/60 p-3 text-sm font-bold text-berry-700/70 dark:border-white/10 dark:bg-berry-950/35 dark:text-rose-100/70">
                        {server.nics.length === 0
                          ? 'No NICs recorded for this server yet.'
                          : onlyFree
                            ? 'No free NICs match the current filter.'
                            : 'Management NICs are hidden by the current filter.'}
                      </p>
                    )}
                  </section>
                )
              })}
            </div>
          </Card>

          <section aria-labelledby="detailed-nic-inventory" className="space-y-4">
            <div>
              <h2
                id="detailed-nic-inventory"
                className="font-display text-xl font-black"
              >
                Detailed NIC inventory
              </h2>
              <p className="mt-1 text-sm font-bold text-berry-700/70 dark:text-rose-100/70">
                Complete hardware and cabling details for every server.
              </p>
            </div>
            {servers.map((server) => (
              <Card
                key={server.id}
                id={`server-${server.id}`}
                className="scroll-mt-28"
              >
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-display text-lg font-black">
                      {server.name}
                    </h3>
                    {server.description ? (
                      <p className="text-sm font-bold text-berry-700/70 dark:text-rose-100/70">
                        {server.description}
                      </p>
                    ) : null}
                    {describeHardware(server) ? (
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-black uppercase tracking-wide text-berry-700/70 dark:text-rose-100/70">
                        <Cpu className="size-3.5" aria-hidden="true" />
                        {describeHardware(server)}
                      </p>
                    ) : null}
                  </div>
                  {server.reservable ? (
                    <Link
                      to={`/calendar?resource=server:${server.id}`}
                      className="inline-flex min-h-10 items-center gap-2 rounded-3xl bg-primary px-4 font-display text-sm font-black text-white shadow-button transition hover:-translate-y-0.5 hover:bg-secondary dark:bg-blush dark:text-berry-950"
                    >
                      <CalendarDays className="size-4" aria-hidden="true" />
                      Reserve server
                    </Link>
                  ) : null}
                </div>
                <NicTable
                  server={server}
                  isAdmin={isAdmin}
                  showManagement={showManagement}
                  onlyFree={onlyFree}
                  onConfigure={setConfigureNic}
                  onFree={free}
                />
              </Card>
            ))}
          </section>
        </>
      )}
      {configureNic ? (
        <NicModal
          nic={configureNic}
          servers={servers}
          onClose={() => setConfigureNic(null)}
        />
      ) : null}
    </div>
  )
}
