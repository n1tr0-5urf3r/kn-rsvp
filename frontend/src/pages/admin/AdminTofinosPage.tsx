import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import {
  useCreateTofinoMutation,
  useDeleteTofinoMutation,
  useTofinos,
  useUpdateTofinoMutation,
} from '../../api/queries'
import { ApiError, type Tofino, type TofinoVersion } from '../../api/client'
import { Button } from '../../components/Button'
import { Card, Skeleton } from '../../components/Card'
import { Modal } from '../../components/Modal'
import { FieldLabel, Select, TextInput } from '../../components/Select'
import { useToast } from '../../lib/toast'

function TofinoModal({
  tofino,
  onClose,
}: {
  tofino: Tofino | null
  onClose: () => void
}) {
  const create = useCreateTofinoMutation()
  const update = useUpdateTofinoMutation()
  const { toast } = useToast()
  const [name, setName] = useState(tofino?.name ?? '')
  const [version, setVersion] = useState<TofinoVersion>(tofino?.version ?? 1)
  const [notes, setNotes] = useState(tofino?.notes ?? '')
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      if (tofino) {
        await update.mutateAsync({
          id: tofino.id,
          body: { name, version, notes },
        })
      } else {
        await create.mutateAsync({ name, version, notes: notes || undefined })
      }
      toast('Tofino saved.', 'success')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saving failed.')
    }
  }

  return (
    <Modal title={tofino ? `Edit ${tofino.name}` : 'New Tofino'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FieldLabel label="Name">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </FieldLabel>
        <FieldLabel label="Version">
          <Select
            value={version}
            onChange={(e) => setVersion(Number(e.target.value) as TofinoVersion)}
          >
            <option value="1">Tofino 1</option>
            <option value="2">Tofino 2</option>
          </Select>
        </FieldLabel>
        <FieldLabel label="Notes">
          <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} />
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

export function AdminTofinosPage() {
  const { data, isLoading } = useTofinos()
  const update = useUpdateTofinoMutation()
  const remove = useDeleteTofinoMutation()
  const { toast } = useToast()
  const [modal, setModal] = useState<{ open: boolean; tofino: Tofino | null }>({
    open: false,
    tofino: null,
  })

  const toggleActive = async (tofino: Tofino) => {
    try {
      await update.mutateAsync({
        id: tofino.id,
        body: { active: !tofino.active },
      })
      toast(
        `${tofino.name} is now ${tofino.active ? 'inactive' : 'active'}.`,
        'success',
      )
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Update failed.', 'error')
    }
  }

  const deleteTofino = async (tofino: Tofino) => {
    if (!window.confirm(`Delete ${tofino.name}? This cannot be undone.`)) {
      return
    }
    try {
      await remove.mutateAsync(tofino.id)
      toast(`${tofino.name} deleted.`, 'success')
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast(
          `${tofino.name} has future bookings — set it inactive instead.`,
          'error',
        )
      } else {
        toast(err instanceof Error ? err.message : 'Delete failed.', 'error')
      }
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-black">Tofinos</h2>
        <Button onClick={() => setModal({ open: true, tofino: null })}>
          <Plus className="size-4" aria-hidden="true" />
          Add Tofino
        </Button>
      </div>
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(data?.tofinos ?? []).map((tofino) => (
            <Card key={tofino.id}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-display font-black">{tofino.name}</h3>
                  <span className="text-xs font-black text-primary dark:text-blush">
                    Tofino {tofino.version}
                  </span>
                  {tofino.notes ? (
                    <p className="mt-1 text-sm font-bold text-berry-700/70 dark:text-rose-100/70">
                      {tofino.notes}
                    </p>
                  ) : null}
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-xs font-black">
                  <input
                    type="checkbox"
                    checked={tofino.active}
                    onChange={() => toggleActive(tofino)}
                    className="size-4 accent-primary"
                  />
                  Active
                </label>
              </div>
              <div className="mt-3 flex gap-1">
                <Button
                  variant="ghost"
                  className="min-h-9 px-3 text-xs"
                  onClick={() => setModal({ open: true, tofino })}
                >
                  <Pencil className="size-4" aria-hidden="true" />
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  className="min-h-9 px-3 text-xs"
                  onClick={() => deleteTofino(tofino)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {modal.open ? (
        <TofinoModal
          tofino={modal.tofino}
          onClose={() => setModal({ open: false, tofino: null })}
        />
      ) : null}
    </div>
  )
}
