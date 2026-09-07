import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import {
  useCreateNicMutation,
  useCreateServerMutation,
  useDeleteNicMutation,
  useDeleteServerMutation,
  useServers,
  useUpdateNicMutation,
  useUpdateServerMutation,
} from '../../api/queries'
import type { NicKind, NicView, ServerWithNics } from '../../api/client'
import { Button } from '../../components/Button'
import { Card, Skeleton } from '../../components/Card'
import { Modal } from '../../components/Modal'
import { FieldLabel, Select, TextInput } from '../../components/Select'
import { formatSpeed } from '../../lib/format'
import { useToast } from '../../lib/toast'

function ServerModal({
  server,
  onClose,
}: {
  server: ServerWithNics | null
  onClose: () => void
}) {
  const create = useCreateServerMutation()
  const update = useUpdateServerMutation()
  const { toast } = useToast()
  const [name, setName] = useState(server?.name ?? '')
  const [description, setDescription] = useState(server?.description ?? '')
  const [sortOrder, setSortOrder] = useState(String(server?.sort_order ?? 0))
  const [cpuModel, setCpuModel] = useState(server?.cpu_model ?? '')
  const [cpuSockets, setCpuSockets] = useState(String(server?.cpu_sockets ?? ''))
  const [cpuCores, setCpuCores] = useState(String(server?.cpu_cores ?? ''))
  const [cpuThreads, setCpuThreads] = useState(String(server?.cpu_threads ?? ''))
  const [cpuMhz, setCpuMhz] = useState(String(server?.cpu_mhz ?? ''))
  const [memoryGb, setMemoryGb] = useState(String(server?.memory_gb ?? ''))
  const [reservable, setReservable] = useState(server?.reservable ?? false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    // Blank clears a hardware number: the API reads 0 as "not documented".
    const number = (value: string) => (value.trim() === '' ? 0 : Number(value))
    const body = {
      name,
      description: description || undefined,
      sort_order: Number(sortOrder) || 0,
      cpu_model: cpuModel,
      cpu_sockets: number(cpuSockets),
      cpu_cores: number(cpuCores),
      cpu_threads: number(cpuThreads),
      cpu_mhz: number(cpuMhz),
      memory_gb: number(memoryGb),
      reservable: server ? reservable : reservable || undefined,
    }
    try {
      if (server) {
        await update.mutateAsync({ id: server.id, body })
      } else {
        await create.mutateAsync(body)
      }
      toast('Server saved.', 'success')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saving failed.')
    }
  }

  return (
    <Modal title={server ? `Edit ${server.name}` : 'New server'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FieldLabel label="Name">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </FieldLabel>
        <FieldLabel label="Description">
          <TextInput
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FieldLabel>
        <FieldLabel label="CPU model">
          <TextInput
            value={cpuModel}
            onChange={(e) => setCpuModel(e.target.value)}
            placeholder="e.g. AMD EPYC 7443P 24-Core Processor"
          />
        </FieldLabel>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <FieldLabel label="Sockets">
            <TextInput
              type="number"
              min="0"
              value={cpuSockets}
              onChange={(e) => setCpuSockets(e.target.value)}
            />
          </FieldLabel>
          <FieldLabel label="Cores">
            <TextInput
              type="number"
              min="0"
              value={cpuCores}
              onChange={(e) => setCpuCores(e.target.value)}
            />
          </FieldLabel>
          <FieldLabel label="Threads">
            <TextInput
              type="number"
              min="0"
              value={cpuThreads}
              onChange={(e) => setCpuThreads(e.target.value)}
            />
          </FieldLabel>
          <FieldLabel label="Max MHz">
            <TextInput
              type="number"
              min="0"
              value={cpuMhz}
              onChange={(e) => setCpuMhz(e.target.value)}
            />
          </FieldLabel>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FieldLabel label="Memory (GB)">
            <TextInput
              type="number"
              min="0"
              step="0.1"
              value={memoryGb}
              onChange={(e) => setMemoryGb(e.target.value)}
            />
          </FieldLabel>
          <FieldLabel label="Sort order">
            <TextInput
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
            />
          </FieldLabel>
        </div>
        <label className="flex items-start gap-3 rounded-2xl bg-berry-100/60 px-4 py-3 text-sm font-bold dark:bg-white/5">
          <input
            type="checkbox"
            checked={reservable}
            onChange={(e) => setReservable(e.target.checked)}
            className="mt-0.5 size-4 accent-primary"
          />
          <span>
            Allow hourly reservations
            <span className="block text-xs font-medium opacity-70">
              Makes the whole bare-metal server available to every signed-in user
              in the calendar.
            </span>
          </span>
        </label>
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

function NicModal({
  serverId,
  nic,
  onClose,
}: {
  serverId: string
  nic: NicView | null
  onClose: () => void
}) {
  const create = useCreateNicMutation()
  const update = useUpdateNicMutation()
  const { toast } = useToast()
  const [name, setName] = useState(nic?.name ?? '')
  const [pciAddress, setPciAddress] = useState(nic?.pci_address ?? '')
  const [nicType, setNicType] = useState(nic?.nic_type ?? '')
  const [speed, setSpeed] = useState(String(nic?.speed_gbps ?? 100))
  const [ifname, setIfname] = useState(nic?.ifname ?? '')
  const [mac, setMac] = useState(nic?.mac ?? '')
  const [numaNode, setNumaNode] = useState(
    nic?.numa_node === null || nic?.numa_node === undefined
      ? ''
      : String(nic.numa_node),
  )
  const [kind, setKind] = useState<NicKind>(nic?.kind ?? 'pf')
  const [usage, setUsage] = useState(nic?.usage ?? '')
  const [sortOrder, setSortOrder] = useState(String(nic?.sort_order ?? 0))
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    const speedGbps = parseFloat(speed)
    if (Number.isNaN(speedGbps) || speedGbps <= 0) {
      setError('Speed must be a positive number of Gbit/s (e.g. 100 or 2.5).')
      return
    }
    const body = {
      name,
      pci_address: pciAddress,
      nic_type: nicType,
      speed_gbps: speedGbps,
      ifname,
      mac,
      // Blank means "no affinity"; the API stores a negative node as null.
      numa_node: numaNode.trim() === '' ? -1 : Number(numaNode),
      kind,
      usage,
      sort_order: Number(sortOrder) || 0,
    }
    try {
      if (nic) {
        await update.mutateAsync({ id: nic.id, body })
      } else {
        await create.mutateAsync({ serverId, body })
      }
      toast('NIC saved.', 'success')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saving failed.')
    }
  }

  return (
    <Modal title={nic ? `Edit ${nic.name}` : 'New NIC'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FieldLabel label="Name">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. enp65s0f0"
            required
          />
        </FieldLabel>
        <FieldLabel label="PCI address">
          <TextInput
            value={pciAddress}
            onChange={(e) => setPciAddress(e.target.value)}
            placeholder="e.g. 0000:41:00.0"
            required
          />
        </FieldLabel>
        <FieldLabel label="NIC type">
          <TextInput
            value={nicType}
            onChange={(e) => setNicType(e.target.value)}
            placeholder="e.g. Mellanox ConnectX-5"
            required
          />
        </FieldLabel>
        <FieldLabel label="Interface name">
          <TextInput
            value={ifname}
            onChange={(e) => setIfname(e.target.value)}
            placeholder="e.g. ens65f0np0"
          />
        </FieldLabel>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <FieldLabel label="MAC" className="sm:col-span-1">
            <TextInput
              value={mac}
              onChange={(e) => setMac(e.target.value)}
              placeholder="aa:bb:cc:dd:ee:ff"
            />
          </FieldLabel>
          <FieldLabel label="NUMA node">
            <TextInput
              type="number"
              min="0"
              value={numaNode}
              onChange={(e) => setNumaNode(e.target.value)}
              placeholder="—"
            />
          </FieldLabel>
          <FieldLabel label="Function">
            <Select
              value={kind}
              onChange={(e) => setKind(e.target.value as NicKind)}
            >
              <option value="pf">Physical (PF)</option>
              <option value="vf">SR-IOV virtual (VF)</option>
            </Select>
          </FieldLabel>
        </div>
        <FieldLabel label="Speed (Gbit/s)">
          <TextInput
            type="number"
            step="0.1"
            min="0.1"
            value={speed}
            onChange={(e) => setSpeed(e.target.value)}
            placeholder="e.g. 100 or 2.5"
            required
          />
        </FieldLabel>
        <FieldLabel label="Usage">
          <TextInput
            value={usage}
            onChange={(e) => setUsage(e.target.value)}
            placeholder="e.g. Management, DPDK, teaching"
          />
        </FieldLabel>
        <FieldLabel label="Sort order">
          <TextInput
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
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
        <ServerModal
          server={serverModal.server}
          onClose={() => setServerModal({ open: false, server: null })}
        />
      ) : null}
      {nicModal ? (
        <NicModal
          serverId={nicModal.serverId}
          nic={nicModal.nic}
          onClose={() => setNicModal(null)}
        />
      ) : null}
    </div>
  )
}
