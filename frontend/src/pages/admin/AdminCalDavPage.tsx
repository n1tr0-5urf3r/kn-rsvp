import { useState } from 'react'
import { Info, Pencil, Plus, RefreshCw, Trash2, Zap } from 'lucide-react'
import {
  useCalDavCalendars,
  useCalDavResyncMutation,
  useCalDavStatus,
  useCreateCalDavCalendarMutation,
  useDeleteCalDavCalendarMutation,
  useTestCalDavCalendarMutation,
  useUpdateCalDavCalendarMutation,
} from '../../api/queries'
import type { CalDavCalendarView } from '../../api/client'
import { Button } from '../../components/Button'
import { Card, Skeleton } from '../../components/Card'
import { Modal } from '../../components/Modal'
import { FieldLabel, TextInput } from '../../components/Select'
import { formatDateTime } from '../../lib/format'
import { useToast } from '../../lib/toast'
import { cn } from '../../lib/cn'

function CalendarModal({
  calendar,
  onClose,
}: {
  calendar: CalDavCalendarView | null
  onClose: () => void
}) {
  const create = useCreateCalDavCalendarMutation()
  const update = useUpdateCalDavCalendarMutation()
  const { toast } = useToast()
  const [name, setName] = useState(calendar?.name ?? '')
  const [url, setUrl] = useState(calendar?.caldav_url ?? '')
  const [username, setUsername] = useState(calendar?.username ?? '')
  const [appPassword, setAppPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      if (calendar) {
        await update.mutateAsync({
          id: calendar.id,
          body: {
            name,
            caldav_url: url,
            username,
            // Empty password = keep the stored one (API contract).
            ...(appPassword ? { app_password: appPassword } : {}),
          },
        })
      } else {
        if (!appPassword) {
          setError('An app password is required for a new calendar.')
          return
        }
        await create.mutateAsync({
          name,
          caldav_url: url,
          username,
          app_password: appPassword,
        })
      }
      toast('Calendar saved.', 'success')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saving failed.')
    }
  }

  return (
    <Modal
      title={calendar ? `Edit ${calendar.name}` : 'Add Nextcloud calendar'}
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="flex gap-3 rounded-2xl bg-sky/15 px-4 py-3 text-sm font-bold text-berry-950 dark:bg-sky/10 dark:text-berry-50">
          <Info className="mt-0.5 size-5 shrink-0 text-sky" aria-hidden="true" />
          <div className="space-y-1">
            <p>
              Nextcloud <em>share links</em> are read-only and will not work
              here. You need the calendar's internal CalDAV address:
            </p>
            <p>
              In Nextcloud Calendar, open the calendar's{' '}
              <strong>… menu → Edit → Copy internal link</strong> (it looks
              like{' '}
              <code className="break-all text-xs">
                https://cloud.example.org/remote.php/dav/calendars/USER/cal-name/
              </code>
              ). Then create an <strong>app password</strong> under{' '}
              <strong>Settings → Security → Devices &amp; sessions</strong> and
              use it below — not your account password.
            </p>
          </div>
        </div>
        <FieldLabel label="Label">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Testbed bookings"
            required
          />
        </FieldLabel>
        <FieldLabel label="CalDAV URL">
          <TextInput
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://cloud.example.org/remote.php/dav/calendars/user/testbed/"
            required
          />
        </FieldLabel>
        <FieldLabel label="Username">
          <TextInput
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </FieldLabel>
        <FieldLabel
          label={
            calendar?.has_password
              ? 'App password (leave empty to keep current)'
              : 'App password'
          }
        >
          <TextInput
            type="password"
            value={appPassword}
            onChange={(e) => setAppPassword(e.target.value)}
            autoComplete="new-password"
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

export function AdminCalDavPage() {
  const { data, isLoading } = useCalDavCalendars()
  const { data: status } = useCalDavStatus()
  const deleteCalendar = useDeleteCalDavCalendarMutation()
  const testCalendar = useTestCalDavCalendarMutation()
  const resync = useCalDavResyncMutation()
  const { toast } = useToast()
  const [modal, setModal] = useState<{
    open: boolean
    calendar: CalDavCalendarView | null
  }>({ open: false, calendar: null })

  const test = async (calendar: CalDavCalendarView) => {
    try {
      const result = await testCalendar.mutateAsync(calendar.id)
      toast(result.message, result.ok ? 'success' : 'error')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Test failed.', 'error')
    }
  }

  const remove = async (calendar: CalDavCalendarView) => {
    if (!window.confirm(`Remove calendar ${calendar.name}?`)) {
      return
    }
    try {
      await deleteCalendar.mutateAsync(calendar.id)
      toast('Calendar removed.', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Delete failed.', 'error')
    }
  }

  const triggerResync = async () => {
    try {
      await resync.mutateAsync()
      toast('Resync queued.', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Resync failed.', 'error')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-black">
          Nextcloud calendars (CalDAV)
        </h2>
        <Button onClick={() => setModal({ open: true, calendar: null })}>
          <Plus className="size-4" aria-hidden="true" />
          Add calendar
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-32" />
      ) : (data?.calendars ?? []).length === 0 ? (
        <Card>
          <p className="font-bold text-berry-700/70 dark:text-rose-100/70">
            No calendars configured. Resource bookings sync one-way to every
            enabled calendar here.
          </p>
        </Card>
      ) : (
        (data?.calendars ?? []).map((calendar) => (
          <Card key={calendar.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-display font-black">
                  {calendar.name}
                  {!calendar.enabled ? (
                    <span className="ml-2 text-xs font-black uppercase text-berry-700/50 dark:text-rose-100/50">
                      disabled
                    </span>
                  ) : null}
                </h3>
                <p className="break-all text-sm font-bold text-berry-700/70 dark:text-rose-100/70">
                  {calendar.caldav_url}
                </p>
                <p className="text-xs font-bold text-berry-700/70 dark:text-rose-100/70">
                  {calendar.username} ·{' '}
                  {calendar.has_password ? 'app password set' : 'no password!'}
                </p>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="secondary"
                  className="min-h-9 px-3 text-xs"
                  onClick={() => test(calendar)}
                  disabled={testCalendar.isPending}
                >
                  <Zap className="size-4" aria-hidden="true" />
                  Test connection
                </Button>
                <Button
                  variant="ghost"
                  className="min-h-9 px-3 text-xs"
                  onClick={() => setModal({ open: true, calendar })}
                >
                  <Pencil className="size-4" aria-hidden="true" />
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  className="min-h-9 px-3 text-xs"
                  onClick={() => remove(calendar)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  Remove
                </Button>
              </div>
            </div>
          </Card>
        ))
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display font-black">Sync status</h3>
          <Button
            variant="secondary"
            className="min-h-9 px-3 text-xs"
            onClick={triggerResync}
            disabled={resync.isPending}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Resync everything
          </Button>
        </div>
        {status ? (
          <>
            <div className="mt-3 flex flex-wrap gap-3 text-sm font-black">
              <span className="rounded-full bg-sun/20 px-3 py-1">
                {status.pending} pending
              </span>
              <span
                className={cn(
                  'rounded-full px-3 py-1',
                  status.error > 0
                    ? 'bg-primary/15 text-primary dark:text-blush'
                    : 'bg-mint/15 text-mint',
                )}
              >
                {status.error} errors
              </span>
              <span className="rounded-full bg-mint/15 px-3 py-1 text-mint">
                {status.synced} synced
              </span>
              <span className="rounded-full bg-white/70 px-3 py-1 dark:bg-berry-950/50">
                last run:{' '}
                {status.last_run_at ? formatDateTime(status.last_run_at) : 'never'}
              </span>
            </div>
            {status.items.length > 0 ? (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[36rem] border-separate border-spacing-y-1 text-left text-xs font-bold">
                  <thead>
                    <tr className="font-black uppercase tracking-wide text-berry-700/70 dark:text-rose-100/70">
                      <th className="px-3 py-1">Event</th>
                      <th className="px-3 py-1">Action</th>
                      <th className="px-3 py-1">Status</th>
                      <th className="px-3 py-1">Attempts</th>
                      <th className="px-3 py-1">Last error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.items.map((item) => (
                      <tr
                        key={item.id}
                        className="bg-white/70 dark:bg-berry-950/50"
                      >
                        <td className="rounded-l-2xl px-3 py-2 font-mono">
                          {item.ics_uid}
                        </td>
                        <td className="px-3 py-2">{item.action}</td>
                        <td
                          className={cn(
                            'px-3 py-2 font-black',
                            item.status === 'error' &&
                              'text-primary dark:text-blush',
                            item.status === 'synced' && 'text-mint',
                          )}
                        >
                          {item.status}
                        </td>
                        <td className="px-3 py-2">{item.attempts}</td>
                        <td className="rounded-r-2xl px-3 py-2">
                          {item.last_error ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : (
          <Skeleton className="mt-3 h-16" />
        )}
      </Card>

      {modal.open ? (
        <CalendarModal
          calendar={modal.calendar}
          onClose={() => setModal({ open: false, calendar: null })}
        />
      ) : null}
    </div>
  )
}
