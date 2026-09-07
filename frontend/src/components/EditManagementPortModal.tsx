import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  useManagementPorts,
  useServers,
  useTofinos,
  useUpdateManagementPortMutation,
  useVlans,
} from '../api/queries'
import type { ManagementPort, Vlan } from '../api/client'
import { Button } from './Button'
import {
  ManagementPeerPicker,
  draftFromPort,
  managementPeerInputFromDraft,
  type ManagementPeerDraft,
} from './ManagementPeerPicker'
import { Modal } from './Modal'
import { FieldLabel, Select, TextInput } from './Select'
import { useToast } from '../lib/toast'

function VlanEditor({
  vlans,
  members,
  setMembers,
}: {
  vlans: Vlan[]
  members: Map<number, boolean>
  setMembers: (next: Map<number, boolean>) => void
}) {
  if (vlans.length === 0) {
    return (
      <p className="text-sm font-bold text-berry-700/70 dark:text-rose-100/70">
        No VLANs defined yet.{' '}
        <Link to="/management/vlans" className="text-primary underline dark:text-blush">
          Add them to the VLAN database
        </Link>{' '}
        first.
      </p>
    )
  }
  const toggle = (vlanId: number, checked: boolean) => {
    const next = new Map(members)
    if (checked) {
      next.set(vlanId, next.get(vlanId) ?? true)
    } else {
      next.delete(vlanId)
    }
    setMembers(next)
  }
  const setTagged = (vlanId: number, tagged: boolean) => {
    const next = new Map(members)
    next.set(vlanId, tagged)
    setMembers(next)
  }
  return (
    <div className="max-h-56 space-y-1 overflow-y-auto rounded-2xl border-2 border-berry-100 p-2 dark:border-white/10">
      {vlans.map((vlan) => {
        const member = members.has(vlan.vlan_id)
        return (
          <div key={vlan.id} className="flex items-center justify-between gap-2 rounded-xl px-2 py-1">
            <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm font-bold">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={member}
                onChange={(e) => toggle(vlan.vlan_id, e.target.checked)}
              />
              <span className="font-mono font-black">{vlan.vlan_id}</span>
              {vlan.name ? <span className="opacity-70">{vlan.name}</span> : null}
            </label>
            {member ? (
              <Select
                value={members.get(vlan.vlan_id) ? 'tagged' : 'untagged'}
                onChange={(e) => setTagged(vlan.vlan_id, e.target.value === 'tagged')}
                className="w-32 py-1.5 text-xs"
              >
                <option value="untagged">untagged</option>
                <option value="tagged">tagged</option>
              </Select>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

export function EditManagementPortModal({
  port,
  onClose,
}: {
  port: ManagementPort
  onClose: () => void
}) {
  const update = useUpdateManagementPortMutation()
  const { toast } = useToast()
  const ports = useManagementPorts()
  const servers = useServers()
  const tofinos = useTofinos()
  const vlansQuery = useVlans()

  const [name, setName] = useState(port.name)
  const [ifname, setIfname] = useState(port.ifname)
  const [speed, setSpeed] = useState(String(port.speed_gbps || ''))
  const [cableLabel, setCableLabel] = useState(port.cable_label)
  const [comment, setComment] = useState(port.comment)
  const [draft, setDraft] = useState<ManagementPeerDraft>(() => draftFromPort(port))
  const [members, setMembers] = useState<Map<number, boolean>>(
    () => new Map(port.vlans.map((v) => [v.vlan_id, v.tagged])),
  )
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    const peer = managementPeerInputFromDraft(draft)
    if (peer === null) {
      setError('Finish selecting what this port is plugged into.')
      return
    }
    const vlans = [...members.entries()].map(([vlan_id, tagged]) => ({ vlan_id, tagged }))
    try {
      await update.mutateAsync({
        id: port.id,
        body: {
          name,
          ifname,
          speed_gbps: speed ? Number(speed) : 0,
          cable_label: cableLabel,
          comment,
          peer,
          vlans,
        },
      })
      toast('Port saved.', 'success')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saving failed.')
    }
  }

  return (
    <Modal title={`Edit ${port.switch_name} ${port.name}`} onClose={onClose} className="max-w-2xl">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="Port name">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} required />
          </FieldLabel>
          <FieldLabel label="Interface name">
            <TextInput value={ifname} onChange={(e) => setIfname(e.target.value)} />
          </FieldLabel>
          <FieldLabel label="Speed (Gbit/s, 0 = unknown)">
            <TextInput type="number" min={0} step="0.1" value={speed} onChange={(e) => setSpeed(e.target.value)} />
          </FieldLabel>
          <FieldLabel label="Cable label">
            <TextInput value={cableLabel} onChange={(e) => setCableLabel(e.target.value)} />
          </FieldLabel>
        </div>
        <FieldLabel label="Comment">
          <TextInput value={comment} onChange={(e) => setComment(e.target.value)} />
        </FieldLabel>

        <div className="rounded-2xl bg-berry-50/60 p-3 dark:bg-white/5">
          <ManagementPeerPicker
            draft={draft}
            onChange={setDraft}
            ports={ports.data?.ports ?? []}
            servers={servers.data?.servers ?? []}
            tofinos={tofinos.data?.tofinos ?? []}
            excludePortId={port.id}
          />
        </div>

        <div>
          <span className="mb-1.5 block text-xs font-black uppercase tracking-wide text-berry-700 dark:text-rose-100">
            VLAN membership
          </span>
          <VlanEditor vlans={vlansQuery.data?.vlans ?? []} members={members} setMembers={setMembers} />
        </div>

        {error ? (
          <p role="alert" className="text-sm font-bold text-primary dark:text-blush">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={update.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  )
}
