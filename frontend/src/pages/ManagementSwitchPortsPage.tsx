import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Download, Pencil, Plus } from 'lucide-react'
import {
  useCreateManagementPortMutation,
  useImportManagementSwitchMutation,
  useManagementPorts,
  useManagementSwitches,
} from '../api/queries'
import type { ManagementPort } from '../api/client'
import { Button } from '../components/Button'
import { Card, Skeleton } from '../components/Card'
import { EditManagementPortModal } from '../components/EditManagementPortModal'
import { ManagementFaceplate } from '../components/ManagementFaceplate'
import { Modal } from '../components/Modal'
import { FieldLabel, TextArea, TextInput } from '../components/Select'
import { formatSpeed } from '../lib/format'
import { useToast } from '../lib/toast'
import { vlanChipLabel } from '../lib/vlanColors'

function AddPortModal({ switchId, onClose }: { switchId: string; onClose: () => void }) {
  const create = useCreateManagementPortMutation()
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [ifname, setIfname] = useState('')
  const [speed, setSpeed] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      await create.mutateAsync({
        switchId,
        body: { name, ifname: ifname || undefined, speed_gbps: speed ? Number(speed) : undefined },
      })
      toast('Port added.', 'success')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Adding failed.')
    }
  }

  return (
    <Modal title="Add port" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FieldLabel label="Port name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="1 / Gi0/1" required />
        </FieldLabel>
        <FieldLabel label="Interface name">
          <TextInput value={ifname} onChange={(e) => setIfname(e.target.value)} />
        </FieldLabel>
        <FieldLabel label="Speed (Gbit/s)">
          <TextInput type="number" min={0} step="0.1" value={speed} onChange={(e) => setSpeed(e.target.value)} />
        </FieldLabel>
        {error ? (
          <p role="alert" className="text-sm font-bold text-primary dark:text-blush">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending}>
            Add
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function ImportModal({ switchId, onClose }: { switchId: string; onClose: () => void }) {
  const importSwitch = useImportManagementSwitchMutation()
  const { toast } = useToast()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      setError('That is not valid JSON.')
      return
    }
    try {
      const result = await importSwitch.mutateAsync({ id: switchId, body: body as never })
      toast(
        `Imported: ${result.ports_created} new / ${result.ports_updated} updated ports, ${result.vlans_created} new VLANs.`,
        'success',
      )
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.')
    }
  }

  return (
    <Modal title="Import discovery JSON" onClose={onClose} className="max-w-2xl">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm font-bold text-berry-700/70 dark:text-rose-100/70">
          Paste the JSON produced by <code>vlan_inventory.py collect</code> (the object for one
          switch: <code>mgmt_ip</code>, <code>model</code>, <code>vlans</code>, <code>ports</code>).
          Existing facts are kept; VLAN membership is replaced.
        </p>
        <TextArea
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="min-h-64 font-mono text-xs"
          placeholder='{ "model": "Aruba 6300", "vlans": [...], "ports": [...] }'
          required
        />
        {error ? (
          <p role="alert" className="text-sm font-bold text-primary dark:text-blush">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={importSwitch.isPending}>
            Import
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export function ManagementSwitchPortsPage() {
  const { switchId } = useParams<{ switchId: string }>()
  const switches = useManagementSwitches()
  const ports = useManagementPorts()
  const [filter, setFilter] = useState('')
  const [editPort, setEditPort] = useState<ManagementPort | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const sw = switches.data?.switches.find((s) => s.id === switchId)
  const switchPorts = useMemo(
    () =>
      (ports.data?.ports ?? [])
        .filter((p) => p.switch_id === switchId)
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [ports.data, switchId],
  )
  const needle = filter.trim().toLowerCase()
  const visible = needle
    ? switchPorts.filter((p) =>
        [p.name, p.ifname, p.peer_label, p.comment, ...p.vlans.map((v) => String(v.vlan_id))]
          .join(' ')
          .toLowerCase()
          .includes(needle),
      )
    : switchPorts
  const visibleIds = new Set(visible.map((p) => p.id))

  if (switches.isLoading || ports.isLoading) {
    return <Skeleton className="h-64" />
  }
  if (!sw) {
    return (
      <Card>
        <p className="font-bold">Switch not found.</p>
        <Link to="/management" className="text-primary underline dark:text-blush">
          Back to switches
        </Link>
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/management" className="text-xs font-black text-primary dark:text-blush">
            ← Switches
          </Link>
          <h2 className="font-display text-xl font-black">{sw.name}</h2>
          <p className="text-xs font-bold text-berry-700/70 dark:text-rose-100/70">
            {sw.model || 'Switch'}
            {sw.mgmt_ip ? ` · ${sw.mgmt_ip}` : ''}
          </p>
        </div>
        <div className="flex gap-1">
          <Button variant="secondary" className="min-h-10 px-4 text-xs" onClick={() => setImportOpen(true)}>
            <Download className="size-4" aria-hidden="true" />
            Import
          </Button>
          <Button className="min-h-10 px-4 text-xs" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" aria-hidden="true" />
            Add port
          </Button>
        </div>
      </div>

      {switchPorts.length > 0 ? (
        <ManagementFaceplate
          switchName={sw.name}
          model={sw.model}
          ports={switchPorts}
          visiblePortIds={needle ? visibleIds : undefined}
          onPortClick={setEditPort}
        />
      ) : null}

      <div className="flex items-center gap-3">
        <TextInput
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter ports, VLANs, peers…"
          className="max-w-xs"
        />
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead className="text-xs font-black uppercase tracking-wide text-berry-700/70 dark:text-rose-100/70">
            <tr>
              <th className="px-4 py-3">Port</th>
              <th className="px-4 py-3">Interface</th>
              <th className="px-4 py-3">Speed</th>
              <th className="px-4 py-3">VLANs</th>
              <th className="px-4 py-3">Plugged into</th>
              <th className="px-4 py-3">Comment</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((port) => (
              <tr key={port.id} className="border-t border-berry-100 dark:border-white/10">
                <td className="px-4 py-3 font-mono font-black">{port.name}</td>
                <td className="px-4 py-3 font-mono text-xs opacity-80">{port.ifname || '—'}</td>
                <td className="px-4 py-3">{port.speed_gbps ? formatSpeed(port.speed_gbps) : '—'}</td>
                <td className="px-4 py-3">
                  {port.vlans.length ? (
                    <div className="flex flex-wrap gap-1">
                      {port.vlans
                        .slice()
                        .sort((a, b) => a.vlan_id - b.vlan_id)
                        .map((vlan) => (
                          <span
                            key={vlan.vlan_id}
                            className={cn_chip(vlan.tagged)}
                            title={vlan.name || undefined}
                          >
                            {vlanChipLabel(vlan)}
                          </span>
                        ))}
                    </div>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-4 py-3 font-bold">{port.peer_label || '—'}</td>
                <td className="px-4 py-3 text-berry-700/80 dark:text-rose-100/80">
                  {port.comment || '—'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" className="min-h-9 px-3 text-xs" onClick={() => setEditPort(port)}>
                      <Pencil className="size-4" aria-hidden="true" />
                      Edit
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-sm font-bold text-berry-700/70 dark:text-rose-100/70">
                  No ports match.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>

      {editPort ? <EditManagementPortModal port={editPort} onClose={() => setEditPort(null)} /> : null}
      {addOpen ? <AddPortModal switchId={sw.id} onClose={() => setAddOpen(false)} /> : null}
      {importOpen ? <ImportModal switchId={sw.id} onClose={() => setImportOpen(false)} /> : null}
    </div>
  )
}

function cn_chip(tagged: boolean): string {
  return tagged
    ? 'rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[0.7rem] font-black text-primary dark:bg-blush/15 dark:text-blush'
    : 'rounded-full bg-mint/20 px-2 py-0.5 font-mono text-[0.7rem] font-black text-emerald-700 dark:text-mint'
}
