import { useState } from 'react'
import type { PortPeerInput, ServerWithNics, TofinoPort } from '../api/types'
import { useUpdateTofinoPortMutation } from '../api/queries'
import { useToast } from '../lib/toast'
import { Button } from './Button'
import { Modal } from './Modal'
import {
  PeerPicker,
  peerInputFromDraft,
  type PeerDraft,
} from './PeerPicker'
import { FieldLabel, TextArea, TextInput } from './Select'

function peerDraftOf(port: TofinoPort, ports: TofinoPort[]): PeerDraft {
  if (port.peer_port_id) {
    return {
      kind: 'port',
      deviceId:
        ports.find((candidate) => candidate.id === port.peer_port_id)
          ?.tofino_id ?? port.peer_port_tofino_id ?? '',
      endpointId: port.peer_port_id,
      text: '',
    }
  }
  if (port.peer_nic_id) {
    return {
      kind: 'nic',
      deviceId: port.peer_nic_server_id ?? '',
      endpointId: port.peer_nic_id,
      text: '',
    }
  }
  if (port.peer_text) {
    return {
      kind: 'text',
      deviceId: '',
      endpointId: '',
      text: port.peer_text,
    }
  }
  return { kind: 'none', deviceId: '', endpointId: '', text: '' }
}

function PortFacts({ port }: { port: TofinoPort }) {
  return (
    <dl className="grid grid-cols-3 gap-2 rounded-2xl bg-primary/5 px-4 py-3 text-sm font-bold dark:bg-white/5">
      {[
        ['Front panel', port.fp_port],
        ['Dev port', String(port.dev_port)],
        ['Pipe', port.pipe || '—'],
      ].map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs font-black uppercase tracking-wide text-berry-700/70 dark:text-rose-100/70">
            {label}
          </dt>
          <dd className="font-mono">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function EditTofinoPortModal({
  port,
  ports,
  servers,
  onClose,
}: {
  port: TofinoPort
  /** Every port, so any other Tofino port can be picked as the peer. */
  ports: TofinoPort[]
  servers: ServerWithNics[]
  onClose: () => void
}) {
  const updatePort = useUpdateTofinoPortMutation()
  const { toast } = useToast()
  const [speed, setSpeed] = useState(
    port.speed_gbps ? String(port.speed_gbps) : '',
  )
  const [cableLabel, setCableLabel] = useState(port.cable_label)
  const [comment, setComment] = useState(port.comment)
  const [peerDraft, setPeerDraft] = useState<PeerDraft>(() =>
    peerDraftOf(port, ports),
  )
  const [error, setError] = useState<string | null>(null)

  // Links are mirrored, so re-using a port silently re-cables its old peer.
  const selectedPort =
    peerDraft.kind === 'port'
      ? ports.find((item) => item.id === peerDraft.endpointId)
      : undefined
  const stealsFrom =
    selectedPort && selectedPort.peer_label && selectedPort.peer_port_id !== port.id
      ? selectedPort
      : undefined
  const selectedNic = peerDraft.kind === 'nic'
    ? servers
        .flatMap((server) => server.nics)
        .find((nic) => nic.id === peerDraft.endpointId)
    : undefined
  const recablesNic =
    (selectedNic?.peer_port_label || selectedNic?.peer_nic_label) &&
    selectedNic.peer_port_id !== port.id
      ? selectedNic
      : undefined

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    const speedGbps = speed.trim() === '' ? 0 : Number(speed)
    if (!Number.isFinite(speedGbps) || speedGbps < 0) {
      setError('Speed must be a number in Gbit/s (0 for undocumented).')
      return
    }
    const peer = peerInputFromDraft(peerDraft)
    if (!peer) {
      setError('Choose a device and endpoint for this connection.')
      return
    }
    try {
      await updatePort.mutateAsync({
        id: port.id,
        body: {
          speed_gbps: speedGbps,
          cable_label: cableLabel,
          comment,
          // This picker is never given `managementSwitches`/`managementPorts`,
          // so the draft can never reach `kind: 'mgmt'` here.
          peer: peer as PortPeerInput,
        },
      })
      toast(`Saved ${port.tofino_name} ${port.fp_port}.`, 'success')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saving the port failed.')
    }
  }

  return (
    <Modal title={`${port.tofino_name} ${port.fp_port}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <PortFacts port={port} />
        <FieldLabel label="Speed (Gbit/s)">
          <TextInput
            type="number"
            min="0"
            step="any"
            value={speed}
            onChange={(event) => setSpeed(event.target.value)}
            placeholder="e.g. 100"
          />
        </FieldLabel>
        <FieldLabel label="Cable label">
          <TextInput
            value={cableLabel}
            onChange={(event) => setCableLabel(event.target.value)}
            placeholder="e.g. A22"
          />
        </FieldLabel>
        <PeerPicker
          draft={peerDraft}
          onChange={setPeerDraft}
          ports={ports}
          servers={servers}
          excludePortId={port.id}
        />
        {stealsFrom ? (
          <p className="rounded-2xl bg-sun/20 px-4 py-3 text-sm font-bold text-berry-950 dark:bg-sun/10 dark:text-berry-50">
            {stealsFrom.tofino_name} {stealsFrom.fp_port} is currently plugged
            into {stealsFrom.peer_label}. Saving re-cables both ends.
          </p>
        ) : null}
        {recablesNic ? (
          <p className="rounded-2xl bg-sun/20 px-4 py-3 text-sm font-bold text-berry-950 dark:bg-sun/10 dark:text-berry-50">
            {recablesNic.name} is currently plugged into{' '}
            {recablesNic.peer_port_label || recablesNic.peer_nic_label}. Saving
            re-cables it to {port.tofino_name} {port.fp_port}.
          </p>
        ) : null}
        <FieldLabel label="Comment">
          <TextArea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="What is this link used for?"
          />
        </FieldLabel>
        {error ? (
          <p
            role="alert"
            className="rounded-2xl bg-primary/10 px-4 py-3 text-sm font-bold text-primary dark:bg-blush/15 dark:text-blush"
          >
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={updatePort.isPending}>
            Save port
          </Button>
        </div>
      </form>
    </Modal>
  )
}
