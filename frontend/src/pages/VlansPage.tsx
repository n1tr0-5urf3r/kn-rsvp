import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import {
  useCreateVlanMutation,
  useDeleteVlanMutation,
  useUpdateVlanMutation,
  useVlans,
} from '../api/queries'
import { type Vlan } from '../api/client'
import { Button } from '../components/Button'
import { Card, Skeleton } from '../components/Card'
import { Modal } from '../components/Modal'
import { FieldLabel, TextInput } from '../components/Select'
import { useToast } from '../lib/toast'

function VlanModal({ vlan, onClose }: { vlan: Vlan | null; onClose: () => void }) {
  const create = useCreateVlanMutation()
  const update = useUpdateVlanMutation()
  const { toast } = useToast()
  const [vlanId, setVlanId] = useState(vlan ? String(vlan.vlan_id) : '')
  const [name, setName] = useState(vlan?.name ?? '')
  const [purpose, setPurpose] = useState(vlan?.purpose ?? '')
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    const parsed = Number(vlanId)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 4094) {
      setError('VLAN ID must be between 1 and 4094.')
      return
    }
    try {
      if (vlan) {
        await update.mutateAsync({ id: vlan.id, body: { vlan_id: parsed, name, purpose } })
      } else {
        await create.mutateAsync({ vlan_id: parsed, name: name || undefined, purpose: purpose || undefined })
      }
      toast('VLAN saved.', 'success')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saving failed.')
    }
  }

  return (
    <Modal title={vlan ? `Edit VLAN ${vlan.vlan_id}` : 'New VLAN'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FieldLabel label="VLAN ID (1–4094)">
          <TextInput
            type="number"
            min={1}
            max={4094}
            value={vlanId}
            onChange={(e) => setVlanId(e.target.value)}
            required
          />
        </FieldLabel>
        <FieldLabel label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="mgmt" />
        </FieldLabel>
        <FieldLabel label="Purpose">
          <TextInput
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="Out-of-band management"
          />
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
          <Button type="submit" disabled={create.isPending || update.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export function VlansPage() {
  const { data, isLoading } = useVlans()
  const remove = useDeleteVlanMutation()
  const { toast } = useToast()
  const [modal, setModal] = useState<{ open: boolean; vlan: Vlan | null }>({
    open: false,
    vlan: null,
  })

  const deleteVlan = async (vlan: Vlan) => {
    if (!window.confirm(`Delete VLAN ${vlan.vlan_id}? It will be removed from every port.`)) {
      return
    }
    try {
      await remove.mutateAsync(vlan.id)
      toast(`VLAN ${vlan.vlan_id} deleted.`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Delete failed.', 'error')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-black">VLAN database</h2>
        <Button onClick={() => setModal({ open: true, vlan: null })}>
          <Plus className="size-4" aria-hidden="true" />
          Add VLAN
        </Button>
      </div>
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : (data?.vlans ?? []).length === 0 ? (
        <Card>
          <p className="text-sm font-bold text-berry-700/70 dark:text-rose-100/70">
            No VLANs yet. Add them here or import them from a switch.
          </p>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="text-xs font-black uppercase tracking-wide text-berry-700/70 dark:text-rose-100/70">
              <tr>
                <th className="px-4 py-3">VLAN</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Purpose</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(data?.vlans ?? []).map((vlan) => (
                <tr key={vlan.id} className="border-t border-berry-100 dark:border-white/10">
                  <td className="px-4 py-3 font-mono font-black">{vlan.vlan_id}</td>
                  <td className="px-4 py-3 font-bold">{vlan.name || '—'}</td>
                  <td className="px-4 py-3 font-bold text-berry-700/80 dark:text-rose-100/80">
                    {vlan.purpose || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        className="min-h-9 px-3 text-xs"
                        onClick={() => setModal({ open: true, vlan })}
                      >
                        <Pencil className="size-4" aria-hidden="true" />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        className="min-h-9 px-3 text-xs"
                        onClick={() => deleteVlan(vlan)}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {modal.open ? (
        <VlanModal vlan={modal.vlan} onClose={() => setModal({ open: false, vlan: null })} />
      ) : null}
    </div>
  )
}
