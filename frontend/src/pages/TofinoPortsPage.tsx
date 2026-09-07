import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  CalendarDays,
  Cpu,
  FileDown,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import {
  useCreateTofinoPortMutation,
  useDeleteTofinoPortMutation,
  useImportTofinoPortsMutation,
  useMe,
  useServers,
  useTofinoPorts,
  useTofinos,
} from '../api/queries'
import type {
  ImportTofinoPortsResponse,
  Tofino,
  TofinoPort,
} from '../api/client'
import { Button } from '../components/Button'
import { Card, Skeleton } from '../components/Card'
import { Modal } from '../components/Modal'
import { FieldLabel, TextArea, TextInput } from '../components/Select'
import { Tooltip } from '../components/Tooltip'
import { TofinoFaceplate } from '../components/TofinoFaceplate'
import { EditTofinoPortModal } from '../components/EditTofinoPortModal'
import { formatDateTime, formatSpeed } from '../lib/format'
import { useToast } from '../lib/toast'
import { cn } from '../lib/cn'
import { orderTofinos } from '../lib/tofinoOrder'
import {
  createUsageColorMap,
  FACEPLATE_COMMENT_COLORS,
} from '../lib/usageColors'

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function AddPortModal({
  tofino,
  onClose,
}: {
  tofino: Tofino
  onClose: () => void
}) {
  const createPort = useCreateTofinoPortMutation()
  const { toast } = useToast()
  const [fpPort, setFpPort] = useState('')
  const [devPort, setDevPort] = useState('')
  const [pipe, setPipe] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    const devPortValue = Number(devPort)
    if (!Number.isInteger(devPortValue) || devPortValue < 0) {
      setError('Dev port must be a non-negative whole number.')
      return
    }
    try {
      await createPort.mutateAsync({
        tofinoId: tofino.id,
        body: { fp_port: fpPort, dev_port: devPortValue, pipe },
      })
      toast(`Added port ${fpPort} to ${tofino.name}.`, 'success')
      onClose()
    } catch (err) {
      setError(errorMessage(err, 'Adding the port failed.'))
    }
  }

  return (
    <Modal title={`Add a port to ${tofino.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FieldLabel label="Front panel port">
          <TextInput
            required
            value={fpPort}
            onChange={(e) => setFpPort(e.target.value)}
            placeholder="e.g. 1/0"
          />
        </FieldLabel>
        <FieldLabel label="Dev port">
          <TextInput
            required
            type="number"
            min="0"
            step="1"
            value={devPort}
            onChange={(e) => setDevPort(e.target.value)}
            placeholder="e.g. 132"
          />
        </FieldLabel>
        <FieldLabel label="Pipe">
          <TextInput
            value={pipe}
            onChange={(e) => setPipe(e.target.value)}
            placeholder="e.g. 2/4"
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
          <Button type="submit" disabled={createPort.isPending}>
            Add port
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function ImportPortsModal({
  tofino,
  onClose,
}: {
  tofino: Tofino
  onClose: () => void
}) {
  const importPorts = useImportTofinoPortsMutation()
  const { toast } = useToast()
  const [markdown, setMarkdown] = useState('')
  const [result, setResult] = useState<ImportTofinoPortsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      const response = await importPorts.mutateAsync({
        tofinoId: tofino.id,
        markdown,
      })
      setResult(response)
      toast(
        `${response.created} ports added, ${response.updated} updated.`,
        'success',
      )
    } catch (err) {
      setError(errorMessage(err, 'Importing failed.'))
    }
  }

  return (
    <Modal
      title={`Import port map: ${tofino.name}`}
      onClose={onClose}
      className="max-w-2xl"
    >
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm font-bold text-berry-700/70 dark:text-rose-100/70">
          Paste a Markdown port table — or all of tofino.md, in which case the
          section headed “{tofino.name}” is used. Existing ports are matched by
          front-panel port and overwritten.
        </p>
        <FieldLabel label="Markdown">
          <TextArea
            required
            className="min-h-64 font-mono text-xs"
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            placeholder={
              '| Front Panel Port | Dev Port | Pipe | Speed | Kabellabel | Plugged into | Kommentar |'
            }
          />
        </FieldLabel>
        {result ? (
          <div className="space-y-2 rounded-2xl bg-mint/15 px-4 py-3 text-sm font-bold">
            <p>
              {result.created} ports added, {result.updated} updated.
            </p>
            {result.unresolved.length > 0 ? (
              <p className="text-berry-700 dark:text-rose-100">
                Kept as free text because no matching port or NIC exists:{' '}
                {result.unresolved.join(', ')}
              </p>
            ) : null}
          </div>
        ) : null}
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
            {result ? 'Close' : 'Cancel'}
          </Button>
          <Button type="submit" disabled={importPorts.isPending}>
            Import
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function PeerCell({ port }: { port: TofinoPort }) {
  if (!port.peer_label) {
    return <span className="text-berry-700/50 dark:text-rose-100/50">—</span>
  }
  if (port.peer_port_tofino_id) {
    return (
      <Link
        to={`/tofinos/${port.peer_port_tofino_id}`}
        className="font-black text-primary underline decoration-dotted underline-offset-4 dark:text-blush"
      >
        {port.peer_label}
      </Link>
    )
  }
  if (port.peer_nic_id) {
    return (
      <Link
        to="/servers"
        className="font-black text-mint underline decoration-dotted underline-offset-4"
      >
        {port.peer_label}
      </Link>
    )
  }
  return <span>{port.peer_label}</span>
}

export function TofinoPortsPage() {
  const { tofinoId = '' } = useParams()
  const { data: me } = useMe()
  const { data: tofinosData, isLoading: tofinosLoading } = useTofinos()
  const { data: portsData, isLoading: portsLoading } = useTofinoPorts()
  const { data: serversData } = useServers()
  const deletePort = useDeleteTofinoPortMutation()
  const { toast } = useToast()

  const [filter, setFilter] = useState('')
  const [onlyConnected, setOnlyConnected] = useState(false)
  const [editPort, setEditPort] = useState<TofinoPort | null>(null)
  const [addPort, setAddPort] = useState(false)
  const [importPorts, setImportPorts] = useState(false)

  const isAdmin = me?.user?.is_admin ?? false
  const tofinos = orderTofinos(tofinosData?.tofinos ?? [])
  const tofino = tofinos.find((t) => t.id === tofinoId)
  const allPorts = useMemo(() => portsData?.ports ?? [], [portsData])
  const ports = useMemo(
    () => allPorts.filter((port) => port.tofino_id === tofinoId),
    [allPorts, tofinoId],
  )

  const visiblePorts = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return ports.filter((port) => {
      if (onlyConnected && !port.peer_label) {
        return false
      }
      if (!needle) {
        return true
      }
      return [
        port.fp_port,
        String(port.dev_port),
        port.pipe,
        port.cable_label,
        port.peer_label,
        port.comment,
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
  }, [ports, filter, onlyConnected])

  const connectedCount = ports.filter((port) => port.peer_label).length
  const visiblePortIds = useMemo(
    () => new Set(visiblePorts.map((port) => port.id)),
    [visiblePorts],
  )
  const commentColors = useMemo(
    () =>
      createUsageColorMap(
        allPorts.map((port) => port.comment),
        FACEPLATE_COMMENT_COLORS,
      ),
    [allPorts],
  )

  const remove = async (port: TofinoPort) => {
    if (!window.confirm(`Delete port ${port.fp_port}?`)) {
      return
    }
    try {
      await deletePort.mutateAsync(port.id)
      toast(`Deleted port ${port.fp_port}.`, 'success')
    } catch (err) {
      toast(errorMessage(err, 'Deleting the port failed.'), 'error')
    }
  }

  if (tofinosLoading || portsLoading) {
    return <Skeleton className="h-96" />
  }

  if (!tofino) {
    return (
      <Card>
        <p className="font-bold text-berry-700/70 dark:text-rose-100/70">
          This Tofino does not exist (or is inactive).
        </p>
        <Link
          to="/tofinos"
          className="mt-4 inline-flex items-center gap-2 font-black text-primary dark:text-blush"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to Tofinos
        </Link>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <nav
        aria-label="Tofino details"
        className="overflow-x-auto border-b-2 border-berry-100 dark:border-white/10"
      >
        <div className="flex min-w-max gap-1" role="tablist">
          {tofinos.map((item) => {
            const isCurrent = item.id === tofino.id
            return (
              <Link
                key={item.id}
                to={`/tofinos/${item.id}`}
                role="tab"
                aria-selected={isCurrent}
                aria-current={isCurrent ? 'page' : undefined}
                className={cn(
                  'rounded-t-2xl px-5 py-3 font-display text-sm font-black transition',
                  isCurrent
                    ? 'bg-primary text-white shadow-button dark:bg-blush dark:text-berry-950'
                    : 'text-berry-700 hover:bg-primary/10 hover:text-primary dark:text-rose-100 dark:hover:bg-white/10 dark:hover:text-blush',
                )}
              >
                {item.name}
              </Link>
            )
          })}
        </div>
      </nav>

      <Link
        to="/tofinos"
        className="inline-flex items-center gap-2 text-sm font-black text-berry-700 hover:text-primary dark:text-rose-100 dark:hover:text-blush"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Tofinos
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-xl font-black">
            <Cpu className="size-6 text-primary dark:text-blush" aria-hidden="true" />
            {tofino.name}
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-black text-primary dark:bg-blush/15 dark:text-blush">
              Tofino {tofino.version}
            </span>
          </h2>
          <p className="mt-1 text-sm font-bold text-berry-700/70 dark:text-rose-100/70">
            {ports.length} ports documented, {connectedCount} connected
            {tofino.notes ? ` — ${tofino.notes}` : ''}
          </p>
          {tofino.mgmt_peer_label ? (
            <p className="mt-1 text-xs font-black text-primary dark:text-blush">
              Management port → {tofino.mgmt_peer_label}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin ? (
            <>
              <Button
                variant="secondary"
                className="min-h-11"
                onClick={() => setImportPorts(true)}
              >
                <FileDown className="size-4" aria-hidden="true" />
                Import Markdown
              </Button>
              <Button
                variant="secondary"
                className="min-h-11"
                onClick={() => setAddPort(true)}
              >
                <Plus className="size-4" aria-hidden="true" />
                Add port
              </Button>
            </>
          ) : null}
          <Link
            to={`/calendar?tofino=${tofino.id}`}
            className="inline-flex min-h-11 items-center gap-2 rounded-3xl bg-primary px-5 font-display text-sm font-black text-white shadow-button transition hover:-translate-y-0.5 hover:bg-secondary dark:bg-blush dark:text-berry-950"
          >
            <CalendarDays className="size-4" aria-hidden="true" />
            Open calendar
          </Link>
        </div>
      </div>

      {ports.length > 0 ? (
        <TofinoFaceplate
          tofinoName={tofino.name}
          ports={ports}
          visiblePortIds={visiblePortIds}
          commentColors={commentColors}
          onPortClick={isAdmin ? setEditPort : undefined}
        />
      ) : null}

      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <TextInput
            className="w-auto min-w-64 flex-1"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by port, cable, peer or comment…"
            aria-label="Filter ports"
          />
          <label className="flex items-center gap-2 text-sm font-black text-berry-700 dark:text-rose-100">
            <input
              type="checkbox"
              className="size-4 accent-[var(--color-primary)]"
              checked={onlyConnected}
              onChange={(e) => setOnlyConnected(e.target.checked)}
            />
            Only connected
          </label>
        </div>

        {ports.length === 0 ? (
          <p className="font-bold text-berry-700/70 dark:text-rose-100/70">
            No ports documented for {tofino.name} yet.
            {isAdmin
              ? ' Import the Markdown table to get started.'
              : ' An admin can import them from the port map.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] border-separate border-spacing-y-1 text-left text-sm">
              <thead>
                <tr className="text-xs font-black uppercase tracking-wide text-berry-700/70 dark:text-rose-100/70">
                  <th className="px-3 py-1" title="Hardware fact, read-only">
                    FP port
                  </th>
                  <th className="px-3 py-1" title="Hardware fact, read-only">
                    Dev port
                  </th>
                  <th className="px-3 py-1" title="Hardware fact, read-only">
                    Pipe
                  </th>
                  <th className="px-3 py-1">Speed</th>
                  <th className="px-3 py-1">Cable</th>
                  <th className="px-3 py-1">Plugged into</th>
                  <th className="px-3 py-1">Comment</th>
                  {isAdmin ? <th className="px-3 py-1">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {visiblePorts.map((port) => (
                  <tr
                    key={port.id}
                    className={cn(
                      'rounded-2xl bg-white/70 font-bold dark:bg-berry-950/50',
                      !port.peer_label && 'opacity-70',
                    )}
                  >
                    <td className="rounded-l-2xl px-3 py-2 font-mono font-black">
                      {port.fp_port}
                    </td>
                    <td className="px-3 py-2 font-mono text-berry-700/70 dark:text-rose-100/70">
                      {port.dev_port}
                    </td>
                    <td className="px-3 py-2 font-mono text-berry-700/70 dark:text-rose-100/70">
                      {port.pipe || '—'}
                    </td>
                    <td className="px-3 py-2">
                      {port.speed_gbps ? formatSpeed(port.speed_gbps) : '—'}
                    </td>
                    <td className="px-3 py-2">{port.cable_label || '—'}</td>
                    <td className="px-3 py-2">
                      <PeerCell port={port} />
                    </td>
                    <td
                      className={cn('px-3 py-2', !isAdmin && 'rounded-r-2xl')}
                    >
                      {port.updated_by_display_name ? (
                        <Tooltip
                          content={
                            <span className="block">
                              Last edited by {port.updated_by_display_name} on{' '}
                              {formatDateTime(port.updated_at)}
                            </span>
                          }
                        >
                          <span className="cursor-help underline decoration-dotted underline-offset-4">
                            {port.comment || '—'}
                          </span>
                        </Tooltip>
                      ) : (
                        (port.comment || '—')
                      )}
                    </td>
                    {isAdmin ? (
                      <td className="rounded-r-2xl px-3 py-2">
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            className="min-h-9 px-3 text-xs"
                            onClick={() => setEditPort(port)}
                            aria-label={`Edit port ${port.fp_port}`}
                          >
                            <Pencil className="size-4" aria-hidden="true" />
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            className="min-h-9 px-3 text-xs"
                            onClick={() => remove(port)}
                            aria-label={`Delete port ${port.fp_port}`}
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                          </Button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
            {visiblePorts.length === 0 ? (
              <p className="py-3 font-bold text-berry-700/70 dark:text-rose-100/70">
                No port matches this filter.
              </p>
            ) : null}
          </div>
        )}
      </Card>

      {editPort ? (
        <EditTofinoPortModal
          port={editPort}
          ports={allPorts}
          servers={serversData?.servers ?? []}
          onClose={() => setEditPort(null)}
        />
      ) : null}
      {addPort ? (
        <AddPortModal tofino={tofino} onClose={() => setAddPort(false)} />
      ) : null}
      {importPorts ? (
        <ImportPortsModal tofino={tofino} onClose={() => setImportPorts(false)} />
      ) : null}
    </div>
  )
}
