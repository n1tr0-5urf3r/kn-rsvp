import { useMemo, useState } from 'react'
import { addMonths } from 'date-fns'
import { Link } from 'react-router-dom'
import { CalendarDays, Network } from 'lucide-react'
import { useBookings, useMe, useServers } from '../api/queries'
import { Card, Skeleton } from '../components/Card'
import { Select, TextInput } from '../components/Select'
import { dateToUnix, formatDateParam, unixToDate } from '../lib/date'
import { formatBookingRange, formatSpeed } from '../lib/format'
import {
  buildReservationRows,
  defaultReservationFilters,
  filterReservations,
  type ReservationFilters,
} from '../lib/filters'

export function OverviewPage() {
  const { data: me } = useMe()
  const { data: serversData, isLoading: serversLoading } = useServers()
  const now = useMemo(() => dateToUnix(new Date()), [])
  const reservationHorizon = useMemo(
    () => dateToUnix(addMonths(new Date(), 1)),
    [],
  )
  const { data: bookingsData, isLoading: bookingsLoading } = useBookings({
    from: now,
    to: reservationHorizon,
  })

  const [filters, setFilters] = useState<ReservationFilters>(
    defaultReservationFilters,
  )

  const servers = useMemo(
    () => serversData?.servers ?? [],
    [serversData],
  )
  const bookings = useMemo(
    () => bookingsData?.bookings ?? [],
    [bookingsData],
  )

  const myBookings = bookings
    .filter((b) => b.user_id === me?.user?.id && b.end_ts > now)
    .sort((a, b) => a.start_ts - b.start_ts)

  const myNics = servers.flatMap((server) =>
    server.nics
      .filter((nic) => nic.claim?.user_id === me?.user?.id)
      .map((nic) => ({ server, nic })),
  )

  const rows = useMemo(() => buildReservationRows(bookings), [bookings])
  const filtered = useMemo(
    () =>
      filterReservations(rows, filters).sort(
        (a, b) => a.startTs - b.startTs,
      ),
    [rows, filters],
  )

  const users = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of rows) {
      map.set(row.userId, row.userName)
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [rows])

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="flex items-center gap-2 font-display text-lg font-black">
            <CalendarDays className="size-5 text-primary dark:text-blush" aria-hidden="true" />
            My upcoming bookings
          </h2>
          {bookingsLoading ? (
            <Skeleton className="mt-4 h-24" />
          ) : myBookings.length === 0 ? (
            <p className="mt-4 text-sm font-bold text-berry-700/70 dark:text-rose-100/70">
              Nothing booked.{' '}
              <Link to="/calendar" className="text-primary underline dark:text-blush">
                Grab a reservation slot
              </Link>
              .
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {myBookings.slice(0, 6).map((booking) => (
                <li key={booking.id}>
                  <Link
                    to={`/calendar?resource=${booking.resource_type}:${booking.resource_id}&date=${formatDateParam(unixToDate(booking.start_ts))}`}
                    className="block rounded-2xl bg-white/70 px-4 py-3 text-sm font-bold transition hover:bg-primary/10 dark:bg-berry-950/50 dark:hover:bg-white/10"
                  >
                    <span className="text-primary dark:text-blush">
                      {booking.resource_name}
                    </span>{' '}
                    · {formatBookingRange(booking.start_ts, booking.end_ts)}
                    {booking.comment ? (
                      <span className="block text-xs opacity-70">
                        {booking.comment}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="flex items-center gap-2 font-display text-lg font-black">
            <Network className="size-5 text-primary dark:text-blush" aria-hidden="true" />
            My claimed NICs
          </h2>
          {serversLoading ? (
            <Skeleton className="mt-4 h-24" />
          ) : myNics.length === 0 ? (
            <p className="mt-4 text-sm font-bold text-berry-700/70 dark:text-rose-100/70">
              No NICs assigned to you. NIC claims are handed out by admins.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {myNics.map(({ server, nic }) => (
                <li
                  key={nic.id}
                  className="rounded-2xl bg-white/70 px-4 py-3 text-sm font-bold dark:bg-berry-950/50"
                >
                  <span className="text-primary dark:text-blush">
                    {server.name}
                  </span>{' '}
                  · {nic.name} ({formatSpeed(nic.speed_gbps)})
                  {nic.peer_port_label ||
                  nic.peer_nic_label ||
                  nic.claim?.connected_to ? (
                    <span className="block text-xs opacity-70">
                      →{' '}
                      {nic.peer_port_label ||
                        nic.peer_nic_label ||
                        nic.claim?.connected_to}
                      {nic.claim?.cable_label
                        ? ` · cable ${nic.claim.cable_label}`
                        : ''}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="font-display text-lg font-black">
          Upcoming reservations
        </h2>
        <p className="mt-1 text-sm font-bold text-berry-700/70 dark:text-rose-100/70">
          Bookings for reservable Tofinos and bare-metal servers during the
          next month.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            aria-label="Filter by device type"
            value={filters.deviceType}
            onChange={(e) =>
              setFilters({
                ...filters,
                deviceType: e.target.value as ReservationFilters['deviceType'],
              })
            }
          >
            <option value="all">All devices</option>
            <option value="tofino">Tofinos</option>
            <option value="server">Bare-metal servers</option>
          </Select>
          <Select
            aria-label="Filter by Tofino version"
            value={String(filters.tofinoVersion)}
            onChange={(e) =>
              setFilters({
                ...filters,
                tofinoVersion:
                  e.target.value === 'all'
                    ? 'all'
                    : (Number(e.target.value) as 1 | 2),
              })
            }
          >
            <option value="all">Any Tofino version</option>
            <option value="1">Tofino 1</option>
            <option value="2">Tofino 2</option>
          </Select>
          <Select
            aria-label="Filter by user"
            value={filters.userId}
            onChange={(e) => setFilters({ ...filters, userId: e.target.value })}
          >
            <option value="all">Everyone</option>
            {users.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
          <TextInput
            type="search"
            placeholder="Search..."
            aria-label="Free-text search"
            value={filters.query}
            onChange={(e) => setFilters({ ...filters, query: e.target.value })}
          />
        </div>

        {bookingsLoading ? (
          <Skeleton className="mt-4 h-40" />
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[44rem] border-separate border-spacing-y-1 text-left text-sm">
              <thead>
                <tr className="text-xs font-black uppercase tracking-wide text-berry-700/70 dark:text-rose-100/70">
                  <th className="px-3 py-1">Device</th>
                  <th className="px-3 py-1">Detail</th>
                  <th className="px-3 py-1">User</th>
                  <th className="px-3 py-1">Info</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr
                    key={row.key}
                    className="bg-white/70 font-bold dark:bg-berry-950/50"
                  >
                    <td className="rounded-l-2xl px-3 py-2">
                      <span className="mr-2 rounded-full bg-primary/10 px-2 py-0.5 text-[0.65rem] font-black uppercase text-primary dark:bg-blush/15 dark:text-blush">
                        {row.kind === 'tofino' ? 'Tofino' : 'Server'}
                      </span>
                      {row.deviceName}
                    </td>
                    <td className="px-3 py-2">
                      {row.detail}
                      <span className="block text-xs opacity-70">
                        {formatBookingRange(row.startTs, row.endTs)}
                      </span>
                    </td>
                    <td className="px-3 py-2">{row.userName}</td>
                    <td className="rounded-r-2xl px-3 py-2">
                      {row.info || '—'}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3 py-6 text-center font-bold text-berry-700/70 dark:text-rose-100/70"
                    >
                      No reservations match these filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
