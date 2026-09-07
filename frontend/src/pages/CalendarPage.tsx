import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { addDays, differenceInCalendarDays, format, startOfDay } from 'date-fns'
import {
  useBookings,
  useCreateBookingMutation,
  useDeleteBookingMutation,
  useMe,
  useServers,
  useTofinos,
  useUpdateBookingMutation,
} from '../api/queries'
import { ApiError, type BookingView } from '../api/client'
import { Button } from '../components/Button'
import { Card, Skeleton } from '../components/Card'
import { Modal } from '../components/Modal'
import { FieldLabel, Select, TextInput } from '../components/Select'
import { WeekCalendar } from '../components/calendar/WeekCalendar'
import { MonthCalendar } from '../components/calendar/MonthCalendar'
import {
  HOUR_SECONDS,
  MAX_BOOKING_DURATION_HOURS,
  bookingEndError,
  dateToUnix,
  formatDateTimeLocal,
  formatDateParam,
  monthGridRange,
  monthStart,
  parseDateTimeLocal,
  parseDateParam,
  shiftMonth,
  shiftWeek,
  unixToDate,
  weekRange,
  weekStart,
} from '../lib/date'
import { formatBookingRange } from '../lib/format'
import { useToast } from '../lib/toast'
import { cn } from '../lib/cn'
import { tofinoAccent } from '../lib/tofinoColors'
import { resourceCodeMap } from '../lib/resourceCode'

const DURATION_OPTIONS = [1, 2, 3, 4, 6, 8, 9, 10, 11, 12, 24, 48]
const END_HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) =>
  String(hour).padStart(2, '0'),
)
const ALL_RESOURCES = 'all'

type CalendarView = 'week' | 'month'

type ReservableResource = {
  key: string
  type: 'tofino' | 'server'
  id: string
  name: string
  detail: string
  active: boolean
}

function describeBookingError(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) {
    return 'That slot is already booked. Pick a free one.'
  }
  return error instanceof Error ? error.message : 'Saving the booking failed.'
}

function formatDurationLabel(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const parts: string[] = []
  if (hours > 0) {
    parts.push(`${hours} hour${hours === 1 ? '' : 's'}`)
  }
  if (minutes > 0) {
    parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`)
  }
  return parts.join(' ')
}

export function BookingEndFields({
  startTs,
  endValue,
  onEndValueChange,
}: {
  startTs: number
  endValue: string
  onEndValueChange: (value: string) => void
}) {
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const endTs = parseDateTimeLocal(endValue)
  const durationMinutes = endTs === null ? null : (endTs - startTs) / 60
  const duration =
    durationMinutes === null ? null : durationMinutes / 60
  const selectedDuration =
    duration !== null && DURATION_OPTIONS.includes(duration)
      ? String(duration)
      : ''
  const [endDate = '', endTime = ''] = endValue.split('T')
  const [endHour = '', endMinute = ''] = endTime.split(':')
  const minEndTs = startTs + HOUR_SECONDS
  const maxEndTs = startTs + MAX_BOOKING_DURATION_HOURS * HOUR_SECONDS
  const minEnd = unixToDate(minEndTs)
  const maxEnd = unixToDate(maxEndTs)
  const bookableDates = Array.from(
    {
      length:
        differenceInCalendarDays(startOfDay(maxEnd), startOfDay(minEnd)) + 1,
    },
    (_, index) => addDays(startOfDay(minEnd), index),
  )

  const chooseDate = (date: Date) => {
    const dateValue = format(date, 'yyyy-MM-dd')
    let nextEndTs = parseDateTimeLocal(`${dateValue}T${endTime}`)
    if (nextEndTs === null || nextEndTs < minEndTs) {
      nextEndTs = minEndTs
    } else if (nextEndTs > maxEndTs) {
      nextEndTs = maxEndTs
    }
    onEndValueChange(formatDateTimeLocal(nextEndTs))
    setDatePickerOpen(false)
  }

  return (
    <>
      <FieldLabel label="Duration">
        <Select
          value={selectedDuration}
          onChange={(event) =>
            onEndValueChange(
              formatDateTimeLocal(
                startTs + Number(event.target.value) * HOUR_SECONDS,
              ),
            )
          }
        >
          <option value="" disabled>
            {durationMinutes !== null && durationMinutes > 0
              ? formatDurationLabel(durationMinutes)
              : 'Custom end date/time'}
          </option>
          {DURATION_OPTIONS.map((hours) => (
            <option key={hours} value={hours}>
              {hours} hour{hours > 1 ? 's' : ''}
            </option>
          ))}
        </Select>
      </FieldLabel>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="block space-y-1.5">
          <span className="block text-xs font-black uppercase tracking-wide text-berry-700 dark:text-rose-100">
            End date
          </span>
          <div className="relative">
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-2xl border-2 border-berry-100 bg-white px-4 py-2.5 text-left text-sm font-bold text-berry-950 transition focus:border-primary/40 dark:border-white/10 dark:bg-berry-950 dark:text-berry-50"
              aria-haspopup="dialog"
              aria-expanded={datePickerOpen}
              onClick={() => setDatePickerOpen((open) => !open)}
            >
              {endDate
                ? format(new Date(`${endDate}T12:00`), 'dd.MM.yyyy')
                : 'Datum wählen'}
              <CalendarDays className="size-4" aria-hidden="true" />
            </button>
            {datePickerOpen ? (
              <div
                role="dialog"
                aria-label="Bookable end dates"
                className="absolute left-0 top-full z-30 mt-2 w-[min(22rem,calc(100vw-3rem))] rounded-2xl border-2 border-berry-100 bg-white p-3 shadow-soft dark:border-white/10 dark:bg-berry-950"
              >
                <p className="mb-1 text-sm font-black text-berry-950 dark:text-berry-50">
                  Bookable end dates
                </p>
                <p className="mb-3 text-xs font-semibold text-berry-700/70 dark:text-rose-100/70">
                  {format(minEnd, 'dd.MM.yyyy, HH:mm')} –{' '}
                  {format(maxEnd, 'dd.MM.yyyy, HH:mm')}
                </p>
                <div className="grid gap-2">
                  {bookableDates.map((date) => {
                    const dateValue = format(date, 'yyyy-MM-dd')
                    const firstTime =
                      dateValue === format(minEnd, 'yyyy-MM-dd')
                        ? format(minEnd, 'HH:mm')
                        : '00:00'
                    const lastTime =
                      dateValue === format(maxEnd, 'yyyy-MM-dd')
                        ? format(maxEnd, 'HH:mm')
                        : '23:59'
                    return (
                      <button
                        key={dateValue}
                        type="button"
                        className={cn(
                          'flex items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition hover:border-primary/40 hover:bg-primary/5 dark:hover:border-blush/40 dark:hover:bg-blush/10',
                          dateValue === endDate
                            ? 'border-primary bg-primary/10 dark:border-blush dark:bg-blush/15'
                            : 'border-berry-100 dark:border-white/10',
                        )}
                        aria-pressed={dateValue === endDate}
                        onClick={() => chooseDate(date)}
                      >
                        <span className="font-black capitalize">
                          {date.toLocaleDateString('de-DE', {
                            weekday: 'short',
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                          })}
                        </span>
                        <span className="ml-3 text-xs font-semibold text-berry-700/70 dark:text-rose-100/70">
                          {firstTime}–{lastTime}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </div>
        <div className="block space-y-1.5">
          <span className="block text-xs font-black uppercase tracking-wide text-berry-700 dark:text-rose-100">
            End time
          </span>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <Select
              required
              aria-label="End hour"
              value={endHour}
              onChange={(event) =>
                onEndValueChange(
                  `${endDate}T${event.target.value}:${endMinute || '00'}`,
                )
              }
            >
              {END_HOUR_OPTIONS.map((hour) => {
                const hourStart = parseDateTimeLocal(
                  `${endDate}T${hour}:00`,
                )
                const disabled =
                  hourStart === null ||
                  hourStart + HOUR_SECONDS - 60 < minEndTs ||
                  hourStart > maxEndTs
                return (
                  <option key={hour} value={hour} disabled={disabled}>
                    {hour}
                  </option>
                )
              })}
            </Select>
            <span className="font-black" aria-hidden="true">
              :
            </span>
            <TextInput
              required
              aria-label="End minutes"
              inputMode="numeric"
              pattern="[0-5]?[0-9]"
              maxLength={2}
              placeholder="00"
              value={endMinute}
              onChange={(event) => {
                const minute = event.target.value
                if (/^\d{0,2}$/.test(minute) && Number(minute || 0) <= 59) {
                  onEndValueChange(`${endDate}T${endHour}:${minute}`)
                }
              }}
              onBlur={() => {
                if (endMinute) {
                  const normalizedValue = `${endDate}T${endHour}:${endMinute.padStart(2, '0')}`
                  const normalizedEndTs = parseDateTimeLocal(normalizedValue)
                  if (normalizedEndTs !== null && normalizedEndTs < minEndTs) {
                    onEndValueChange(formatDateTimeLocal(minEndTs))
                  } else if (
                    normalizedEndTs !== null &&
                    normalizedEndTs > maxEndTs
                  ) {
                    onEndValueChange(formatDateTimeLocal(maxEndTs))
                  } else {
                    onEndValueChange(normalizedValue)
                  }
                }
              }}
            />
          </div>
        </div>
      </div>
      <p className="text-xs font-semibold text-berry-700/70 dark:text-rose-100/70">
        The end must be after the start and within {MAX_BOOKING_DURATION_HOURS}{' '}
        hours.
      </p>
    </>
  )
}

function CreateModal({
  resource,
  resources,
  start,
  onClose,
}: {
  /** Fixed resource in a single-resource view; undefined in the combined view. */
  resource?: ReservableResource
  resources: ReservableResource[]
  start: Date
  onClose: () => void
}) {
  const createBooking = useCreateBookingMutation()
  const { toast } = useToast()
  const [comment, setComment] = useState('')
  const [selectedResourceKey, setSelectedResourceKey] = useState(
    resource?.key ?? '',
  )
  const [error, setError] = useState<string | null>(null)

  const startTs = dateToUnix(start)
  const [endValue, setEndValue] = useState(() =>
    formatDateTimeLocal(startTs + HOUR_SECONDS),
  )
  const bookableResources = resources.filter((item) => item.active)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    const currentHour = new Date()
    currentHour.setMinutes(0, 0, 0)
    if (start.getTime() < currentHour.getTime()) {
      setError('The start time has already passed. Pick a future slot.')
      return
    }
    const selected = resources.find((item) => item.key === selectedResourceKey)
    if (!selected) {
      setError('Pick a resource to book.')
      return
    }
    const endTs = parseDateTimeLocal(endValue)
    const endError = bookingEndError(startTs, endTs)
    if (endError) {
      setError(endError)
      return
    }
    try {
      await createBooking.mutateAsync({
        ...(selected.type === 'tofino'
          ? { tofino_id: selected.id }
          : { server_id: selected.id }),
        start_ts: startTs,
        end_ts: endTs!,
        comment: comment || undefined,
      })
      toast('Slot booked.', 'success')
      onClose()
    } catch (err) {
      const message = describeBookingError(err)
      setError(message)
      if (err instanceof ApiError && err.status === 409) {
        toast(message, 'error')
      }
    }
  }

  return (
    <Modal title="New booking" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm font-bold text-berry-700 dark:text-rose-100">
          Starts {format(start, 'EEEE dd MMM yyyy, HH:mm')}
        </p>
        {resource ? null : (
          <FieldLabel label="Resource">
            <Select
              required
              value={selectedResourceKey}
              onChange={(e) => setSelectedResourceKey(e.target.value)}
            >
              <option value="" disabled>
                Pick a resource…
              </option>
              {bookableResources.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.name} ({item.detail})
                </option>
              ))}
            </Select>
          </FieldLabel>
        )}
        <BookingEndFields
          startTs={startTs}
          endValue={endValue}
          onEndValueChange={setEndValue}
        />
        <FieldLabel label="Comment (optional)">
          <TextInput
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What are you running?"
          />
        </FieldLabel>
        {error ? (
          <p role="alert" className="rounded-2xl bg-primary/10 px-4 py-3 text-sm font-bold text-primary dark:bg-blush/15 dark:text-blush">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={createBooking.isPending}>
            Book slot
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function EditModal({
  booking,
  onClose,
}: {
  booking: BookingView
  onClose: () => void
}) {
  const updateBooking = useUpdateBookingMutation()
  const deleteBooking = useDeleteBookingMutation()
  const { toast } = useToast()
  const [endValue, setEndValue] = useState(() =>
    formatDateTimeLocal(booking.end_ts),
  )
  const [comment, setComment] = useState(booking.comment ?? '')
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    const endTs = parseDateTimeLocal(endValue)
    const endError = bookingEndError(booking.start_ts, endTs)
    if (endError) {
      setError(endError)
      return
    }
    try {
      await updateBooking.mutateAsync({
        id: booking.id,
        body: {
          end_ts: endTs!,
          comment,
        },
      })
      toast('Booking updated.', 'success')
      onClose()
    } catch (err) {
      const message = describeBookingError(err)
      setError(message)
      if (err instanceof ApiError && err.status === 409) {
        toast(message, 'error')
      }
    }
  }

  const remove = async () => {
    if (!window.confirm('Delete this booking?')) {
      return
    }
    try {
      await deleteBooking.mutateAsync(booking.id)
      toast('Booking deleted.', 'success')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deleting failed.')
    }
  }

  return (
    <Modal title={`Booking on ${booking.resource_name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm font-bold text-berry-700 dark:text-rose-100">
          {formatBookingRange(booking.start_ts, booking.end_ts)}
          <span className="block text-xs opacity-70">
            Booked by {booking.user_display_name}
          </span>
        </p>
        <BookingEndFields
          startTs={booking.start_ts}
          endValue={endValue}
          onEndValueChange={setEndValue}
        />
        <FieldLabel label="Comment">
          <TextInput
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </FieldLabel>
        {error ? (
          <p role="alert" className="rounded-2xl bg-primary/10 px-4 py-3 text-sm font-bold text-primary dark:bg-blush/15 dark:text-blush">
            {error}
          </p>
        ) : null}
        <div className="flex justify-between gap-2">
          <Button
            type="button"
            variant="danger"
            onClick={remove}
            disabled={deleteBooking.isPending}
          >
            Delete
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateBooking.isPending}>
              Save
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}

export function CalendarPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: me } = useMe()
  const { data: tofinosData, isLoading: tofinosLoading } = useTofinos()
  const { data: serversData, isLoading: serversLoading } = useServers()

  const tofinos = useMemo(() => tofinosData?.tofinos ?? [], [tofinosData])
  const reservableServers = useMemo(
    () => (serversData?.servers ?? []).filter((server) => server.reservable),
    [serversData],
  )
  const resources = useMemo<ReservableResource[]>(
    () => [
      ...tofinos.map((tofino) => ({
        key: `tofino:${tofino.id}`,
        type: 'tofino' as const,
        id: tofino.id,
        name: tofino.name,
        detail: `Tofino ${tofino.version}`,
        active: tofino.active,
      })),
      ...reservableServers.map((server) => ({
        key: `server:${server.id}`,
        type: 'server' as const,
        id: server.id,
        name: server.name,
        detail: 'bare-metal server',
        active: true,
      })),
    ],
    [reservableServers, tofinos],
  )

  // Keep old /calendar?tofino=<id> links working while using a generic
  // resource parameter for both switches and servers.
  const legacyTofino = searchParams.get('tofino')
  const resourceParam =
    searchParams.get('resource') ??
    (legacyTofino && legacyTofino !== 'all'
      ? `tofino:${legacyTofino}`
      : ALL_RESOURCES)
  const selectedResource = resources.find((item) => item.key === resourceParam)
  const showAll = !selectedResource

  useEffect(() => {
    if (
      resourceParam !== ALL_RESOURCES &&
      resources.length > 0 &&
      !selectedResource
    ) {
      setSearchParams(
        (params) => {
          params.set('resource', ALL_RESOURCES)
          params.delete('tofino')
          return params
        },
        { replace: true },
      )
    }
  }, [resourceParam, resources.length, selectedResource, setSearchParams])

  const view: CalendarView =
    searchParams.get('view') === 'month' ? 'month' : 'week'
  const anchor = parseDateParam(
    searchParams.get('date') ?? searchParams.get('week'),
  )
  const monday = weekStart(anchor)
  const month = monthStart(anchor)
  const range = view === 'month' ? monthGridRange(month) : weekRange(monday)

  const { data: bookingsData, isLoading: bookingsLoading } = useBookings(
    {
      from: range.from,
      to: range.to,
      tofino_id:
        selectedResource?.type === 'tofino' ? selectedResource.id : undefined,
      server_id:
        selectedResource?.type === 'server' ? selectedResource.id : undefined,
    },
    resources.length > 0,
  )

  const resourceColorClasses = useMemo(
    () =>
      Object.fromEntries(
        resources.map((resource, index) => [
          resource.key,
          tofinoAccent(index).block,
        ]),
      ),
    [resources],
  )

  // Narrow side-by-side blocks show this code instead of a truncated name; the
  // legend below the toolbar spells it out.
  const resourceCodes = useMemo(() => resourceCodeMap(resources), [resources])

  const bookableCount = useMemo(
    () => resources.filter((resource) => resource.active).length,
    [resources],
  )

  const [createStart, setCreateStart] = useState<Date | null>(null)
  const [editBooking, setEditBooking] = useState<BookingView | null>(null)

  const setAnchor = (date: Date) => {
    setSearchParams((params) => {
      params.set('date', formatDateParam(date))
      params.delete('week')
      return params
    })
  }

  const setView = (nextView: CalendarView, date = anchor) => {
    setSearchParams((params) => {
      params.set('view', nextView)
      params.set('date', formatDateParam(date))
      params.delete('week')
      return params
    })
  }

  const selectResource = (key: string) => {
    setSearchParams((params) => {
      params.set('resource', key)
      params.delete('tofino')
      return params
    })
  }

  const isAdmin = me?.user?.is_admin ?? false
  const currentUserId = me?.user?.id

  if (tofinosLoading || serversLoading) {
    return <Skeleton className="h-96" />
  }

  if (resources.length === 0) {
    return (
      <Card>
        <p className="font-bold text-berry-700/70 dark:text-rose-100/70">
          No reservable Tofinos or servers are configured yet.
        </p>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-2xl font-black">Calendar</h1>
          <Select
            aria-label="Reservable resource"
            className="w-auto"
            value={selectedResource?.key ?? ALL_RESOURCES}
            onChange={(e) => selectResource(e.target.value)}
          >
            <option value={ALL_RESOURCES}>All resources</option>
            {resources.map((resource) => (
              <option key={resource.key} value={resource.key}>
                {resource.name} ({resource.detail})
                {resource.active ? '' : ' — inactive'}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="inline-flex rounded-3xl bg-berry-100 p-1 dark:bg-white/10">
            {(['week', 'month'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={cn(
                  'min-h-9 rounded-2xl px-4 text-sm font-black capitalize transition',
                  view === option
                    ? 'bg-white text-primary shadow-soft dark:bg-berry-900 dark:text-blush'
                    : 'text-berry-700 hover:bg-white/60 dark:text-rose-100 dark:hover:bg-white/5',
                )}
                aria-pressed={view === option}
                onClick={() => setView(option)}
              >
                {option}
              </button>
            ))}
          </div>
          <Button
            variant="secondary"
            className="min-h-11 px-3"
            aria-label={`Previous ${view}`}
            title={`Previous ${view}`}
            onClick={() =>
              setAnchor(
                view === 'week'
                  ? shiftWeek(monday, -1)
                  : shiftMonth(month, -1),
              )
            }
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            <span className="hidden lg:inline">Previous {view}</span>
          </Button>
          <Button
            variant="secondary"
            className="min-h-11"
            onClick={() => setAnchor(new Date())}
          >
            Today
          </Button>
          <Button
            variant="secondary"
            className="min-h-11 px-3"
            aria-label={`Next ${view}`}
            title={`Next ${view}`}
            onClick={() =>
              setAnchor(
                view === 'week' ? shiftWeek(monday, 1) : shiftMonth(month, 1),
              )
            }
          >
            <span className="hidden lg:inline">Next {view}</span>
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
          <span className="ml-1 text-sm font-black text-berry-700 dark:text-rose-100">
            {view === 'week'
              ? `Week of ${format(monday, 'dd MMM yyyy')}`
              : format(month, 'MMMM yyyy')}
          </span>
        </div>
      </div>

      {showAll ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="resource-legend">
          {resources.map((resource, index) => (
            <button
              key={resource.key}
              type="button"
              className="inline-flex items-center gap-2 rounded-3xl border border-berry-100 bg-[#fffdf8] px-3 py-1.5 text-xs font-black text-berry-700 transition hover:-translate-y-0.5 hover:shadow-soft dark:border-white/10 dark:bg-berry-900 dark:text-rose-100"
              title={`Show only ${resource.name}`}
              onClick={() => selectResource(resource.key)}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'rounded-lg px-1.5 py-0.5 text-[0.7rem] font-black uppercase tracking-tight',
                  tofinoAccent(index).block,
                )}
              >
                {resourceCodes[resource.key]}
              </span>
              {resource.name} ({resource.detail})
            </button>
          ))}
        </div>
      ) : null}

      {bookingsLoading ? (
        <Skeleton className="h-96" />
      ) : (
        view === 'week' ? (
          <WeekCalendar
            monday={monday}
            bookings={bookingsData?.bookings ?? []}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            onSlotClick={setCreateStart}
            onBookingClick={setEditBooking}
            resourceColorClasses={showAll ? resourceColorClasses : undefined}
            resourceCodes={showAll ? resourceCodes : undefined}
            showResourceNames={showAll}
            reserveFreeLane={showAll ? bookableCount : undefined}
          />
        ) : (
          <MonthCalendar
            month={month}
            bookings={bookingsData?.bookings ?? []}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            onDayClick={(day) => setView('week', day)}
            onBookingClick={setEditBooking}
            resourceColorClasses={showAll ? resourceColorClasses : undefined}
            showResourceNames={showAll}
          />
        )
      )}

      {createStart ? (
        <CreateModal
          resource={selectedResource}
          resources={resources}
          start={createStart}
          onClose={() => setCreateStart(null)}
        />
      ) : null}
      {editBooking ? (
        <EditModal booking={editBooking} onClose={() => setEditBooking(null)} />
      ) : null}
    </div>
  )
}
