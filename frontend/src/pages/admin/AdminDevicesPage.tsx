import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import {
  useDeleteNicMutation,
  useDeleteServerMutation,
  useServers,
} from '../../api/queries'
import type { NicView, ServerWithNics } from '../../api/client'
import { Button } from '../../components/Button'
import { Card, Skeleton } from '../../components/Card'
import {
  NicFormModal,
  ServerFormModal,
} from '../../components/DeviceFormModals'
import { formatSpeed } from '../../lib/format'
import { useToast } from '../../lib/toast'

export function AdminDevicesPage() {
  const { data, isLoading } = useServers()
  const deleteServer = useDeleteServerMutation()
  const deleteNic = useDeleteNicMutation()
  const { toast } = useToast()
  const [serverModal, setServerModal] = useState<{
    open: boolean
    server: ServerWithNics | null
  }>({ open: false, server: null })
  const [nicModal, setNicModal] = useState<{
    serverId: string
    nic: NicView | null
  } | null>(null)

  const removeServer = async (server: ServerWithNics) => {
    if (
      !window.confirm(
        `Delete ${server.name} and all its NICs? This cannot be undone.`,
      )
    ) {
      return
    }
    try {
      await deleteServer.mutateAsync(server.id)
      toast(`${server.name} deleted.`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Delete failed.', 'error')
    }
  }

  const removeNic = async (nic: NicView) => {
    if (!window.confirm(`Delete NIC ${nic.name}?`)) {
      return
    }
    try {
      await deleteNic.mutateAsync(nic.id)
      toast(`${nic.name} deleted.`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Delete failed.', 'error')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-black">Servers & NICs</h2>
        <Button onClick={() => setServerModal({ open: true, server: null })}>
          <Plus className="size-4" aria-hidden="true" />
          Add server
        </Button>
      </div>
      {isLoading ? (
        <Skeleton className="h-48" />
      ) : (
        (data?.servers ?? []).map((server) => (
          <Card key={server.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-display font-black">{server.name}</h3>
                {server.description ? (
                  <p className="text-sm font-bold text-berry-700/70 dark:text-rose-100/70">
                    {server.description}
                  </p>
                ) : null}
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  className="min-h-9 px-3 text-xs"
                  onClick={() => setServerModal({ open: true, server })}
                >
                  <Pencil className="size-4" aria-hidden="true" />
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  className="min-h-9 px-3 text-xs"
                  onClick={() => removeServer(server)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  Delete
                </Button>
                <Button
                  variant="secondary"
                  className="min-h-9 px-3 text-xs"
                  onClick={() => setNicModal({ serverId: server.id, nic: null })}
                >
                  <Plus className="size-4" aria-hidden="true" />
                  Add NIC
                </Button>
              </div>
            </div>
            {server.nics.length > 0 ? (
              <ul className="mt-3 space-y-1">
                {server.nics.map((nic) => (
                  <li
                    key={nic.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white/70 px-4 py-2 text-sm font-bold dark:bg-berry-950/50"
                  >
                    <span>
                      {nic.name}
                      <span className="ml-2 font-mono text-xs opacity-70">
                        {nic.pci_address}
                      </span>
                      <span className="ml-2 text-xs opacity-70">
                        {nic.nic_type} · {formatSpeed(nic.speed_gbps)}
                      </span>
                    </span>
                    <span className="flex gap-1">
                      <Button
                        variant="ghost"
                        className="min-h-8 px-2 text-xs"
                        onClick={() =>
                          setNicModal({ serverId: server.id, nic })
                        }
                        aria-label={`Edit NIC ${nic.name}`}
                      >
                        <Pencil className="size-4" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        className="min-h-8 px-2 text-xs"
                        onClick={() => removeNic(nic)}
                        aria-label={`Delete NIC ${nic.name}`}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        ))
      )}
      {serverModal.open ? (
        <ServerFormModal
          server={serverModal.server}
          onClose={() => setServerModal({ open: false, server: null })}
        />
      ) : null}
      {nicModal ? (
        <NicFormModal
          serverId={nicModal.serverId}
          nic={nicModal.nic}
          onClose={() => setNicModal(null)}
        />
      ) : null}
    </div>
  )
}
