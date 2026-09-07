import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Network, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  useCreateManagementSwitchMutation,
  useDeleteManagementSwitchMutation,
  useManagementPorts,
  useManagementSwitches,
  useUpdateManagementSwitchMutation,
} from '../api/queries'
import { type ManagementPort, type ManagementSwitch } from '../api/client'
import { Button } from '../components/Button'
import { Card, Skeleton } from '../components/Card'
import { EditManagementPortModal } from '../components/EditManagementPortModal'
import { ManagementFaceplate } from '../components/ManagementFaceplate'
import { Modal } from '../components/Modal'
import { FieldLabel, TextInput } from '../components/Select'
import { useToast } from '../lib/toast'
import { portVlanKey } from '../lib/vlanColors'
import {
  createUsageColorMap,
  FACEPLATE_COMMENT_COLORS,
} from '../lib/usageColors'

function SwitchModal({
  sw,
  onClose,
}: {
  sw: ManagementSwitch | null
  onClose: () => void
}) {
  const create = useCreateManagementSwitchMutation()
  const update = useUpdateManagementSwitchMutation()
  const { toast } = useToast()
  const [name, setName] = useState(sw?.name ?? '')
  const [mgmtIp, setMgmtIp] = useState(sw?.mgmt_ip ?? '')
  const [model, setModel] = useState(sw?.model ?? '')
  const [notes, setNotes] = useState(sw?.notes ?? '')
  const [numPorts, setNumPorts] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      if (sw) {
        await update.mutateAsync({
          id: sw.id,
          body: { name, mgmt_ip: mgmtIp, model, notes },
        })
      } else {
        const count = Number(numPorts)
        await create.mutateAsync({
          name,
          mgmt_ip: mgmtIp || undefined,
          model: model || undefined,
          notes: notes || undefined,
          num_ports: numPorts && count > 0 ? count : undefined,
        })
      }
      toast('Switch saved.', 'success')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saving failed.')
    }
  }

  return (
    <Modal title={sw ? `Edit ${sw.name}` : 'New management switch'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FieldLabel label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} required />
        </FieldLabel>
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="Management IP / host">
            <TextInput value={mgmtIp} onChange={(e) => setMgmtIp(e.target.value)} placeholder="10.0.0.2" />
          </FieldLabel>
          <FieldLabel label="Model">
            <TextInput value={model} onChange={(e) => setModel(e.target.value)} placeholder="Aruba 6300M" />
          </FieldLabel>
        </div>
        <FieldLabel label="Notes">
          <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FieldLabel>
        {!sw ? (
          <FieldLabel label="Number of ports (auto-creates ports 1…N)">
            <TextInput
              type="number"
              min={0}
              step="1"
              value={numPorts}
              onChange={(e) => setNumPorts(e.target.value)}
              placeholder="24"
            />
          </FieldLabel>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm font-bold text-primary dark:text-blush">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending || update.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/**
 * Compact chips for every distinct VLAN seen on a switch's ports — including
 * trunk-only VLANs whose ports the faceplate renders in a neutral colour.
 * "U"/"T" mark whether the VLAN appears untagged / tagged somewhere.
 */
function SwitchVlanSummary({ ports }: { ports: ManagementPort[] }) {
  const byVlan = new Map<
    number,
    { name: string; tagged: boolean; untagged: boolean }
  >()
  for (const port of ports) {
    for (const vlan of port.vlans) {
      const entry = byVlan.get(vlan.vlan_id) ?? {
        name: '',
        tagged: false,
        untagged: false,
      }
      if (vlan.name && !entry.name) {
        entry.name = vlan.name
      }
      if (vlan.tagged) {
        entry.tagged = true
      } else {
        entry.untagged = true
      }
      byVlan.set(vlan.vlan_id, entry)
    }
  }
  const vlans = [...byVlan.entries()].sort((a, b) => a[0] - b[0])
  if (vlans.length === 0) {
    return null
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-black uppercase tracking-wide text-berry-700/70 dark:text-rose-100/70">
        VLANs:
      </span>
      {vlans.map(([id, info]) => (
        <span
          key={id}
          className="inline-flex items-center gap-1 rounded-full bg-berry-100 px-2 py-0.5 text-[0.7rem] font-black text-berry-800 dark:bg-white/10 dark:text-rose-100"
          title={info.name || undefined}
        >
          <span className="font-mono">{id}</span>
          {info.name ? <span className="font-bold opacity-70">{info.name}</span> : null}
          <span className="opacity-50">
            {info.untagged ? 'U' : ''}
            {info.tagged ? 'T' : ''}
          </span>
        </span>
      ))}
    </div>
  )
}

export function ManagementPage() {
  const switches = useManagementSwitches()
  const ports = useManagementPorts()
  const remove = useDeleteManagementSwitchMutation()
  const { toast } = useToast()
  const [modal, setModal] = useState<{ open: boolean; sw: ManagementSwitch | null }>({
    open: false,
    sw: null,
  })
  const [editPort, setEditPort] = useState<ManagementPort | null>(null)

  const deleteSwitch = async (sw: ManagementSwitch) => {
    if (!window.confirm(`Delete ${sw.name}? All its ports and links are removed.`)) {
      return
    }
    try {
      await remove.mutateAsync(sw.id)
      toast(`${sw.name} deleted.`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Delete failed.', 'error')
    }
  }

  const allPorts = ports.data?.ports ?? []
  const overviewVlanColors = createUsageColorMap(
    allPorts.flatMap((port) => [
      portVlanKey(port),
      ...port.vlans.map((vlan) => `VLAN ${vlan.vlan_id}`),
    ]),
    FACEPLATE_COMMENT_COLORS,
  )
  const ordered = (switches.data?.switches ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-black">Switches</h2>
        <Button onClick={() => setModal({ open: true, sw: null })}>
          <Plus className="size-4" aria-hidden="true" />
          Add switch
        </Button>
      </div>

      {switches.isLoading ? (
        <Skeleton className="h-40" />
      ) : ordered.length === 0 ? (
        <Card>
          <p className="text-sm font-bold text-berry-700/70 dark:text-rose-100/70">
            No management switches yet. Add one, then document its ports — or run the
            snmpwalk discovery script to import them.
          </p>
        </Card>
      ) : (
        ordered.map((sw) => {
          const switchPorts = allPorts.filter((p) => p.switch_id === sw.id)
          const connected = switchPorts.filter((p) => p.peer_label).length
          return (
            <section key={sw.id} className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-xl font-black">
                    {sw.name}
                    {!sw.active ? (
                      <span className="ml-2 rounded-full bg-berry-100 px-2 py-0.5 text-xs font-black text-berry-700 dark:bg-white/10 dark:text-rose-100">
                        inactive
                      </span>
                    ) : null}
                  </h3>
                  <p className="text-xs font-black text-primary dark:text-blush">
                    {sw.model || 'Switch'}
                    {sw.mgmt_ip ? ` · ${sw.mgmt_ip}` : ''} · {connected}/{switchPorts.length}{' '}
                    ports connected
                  </p>
                  {sw.notes ? (
                    <p className="mt-1 text-sm font-bold text-berry-700/70 dark:text-rose-100/70">
                      {sw.notes}
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-1">
                  <Link
                    to={`/management/switches/${sw.id}`}
                    className="inline-flex min-h-10 items-center gap-2 rounded-3xl bg-primary px-4 font-display text-xs font-black text-white shadow-button transition hover:-translate-y-0.5 hover:bg-secondary dark:bg-blush dark:text-berry-950"
                  >
                    <Network className="size-4" aria-hidden="true" />
                    Details
                  </Link>
                  <Button
                    variant="ghost"
                    className="min-h-10 px-3 text-xs"
                    onClick={() => setModal({ open: true, sw })}
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    className="min-h-10 px-3 text-xs"
                    onClick={() => deleteSwitch(sw)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                    Delete
                  </Button>
                </div>
              </div>
              {switchPorts.length > 0 ? (
                <>
                  <SwitchVlanSummary ports={switchPorts} />
                  <ManagementFaceplate
                    switchName={sw.name}
                    model={sw.model}
                    ports={switchPorts}
                    vlanColors={overviewVlanColors}
                    onPortClick={setEditPort}
                  />
                </>
              ) : (
                <Card>
                  <p className="text-sm font-bold text-berry-700/70 dark:text-rose-100/70">
                    No ports documented yet.{' '}
                    <Link to={`/management/switches/${sw.id}`} className="text-primary underline dark:text-blush">
                      Add or import them
                    </Link>
                    .
                  </p>
                </Card>
              )}
            </section>
          )
        })
      )}

      {modal.open ? (
        <SwitchModal sw={modal.sw} onClose={() => setModal({ open: false, sw: null })} />
      ) : null}
      {editPort ? <EditManagementPortModal port={editPort} onClose={() => setEditPort(null)} /> : null}
    </div>
  )
}
