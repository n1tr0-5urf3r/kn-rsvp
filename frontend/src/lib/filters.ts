/** Upcoming resource bookings shown on the overview page. */
import type { BookingView, TofinoVersion } from '../api/types'

export type ReservationRow = {
  kind: 'tofino' | 'server'
  key: string
  deviceName: string
  detail: string
  userId: string
  userName: string
  tofinoVersion: TofinoVersion | null
  startTs: number
  endTs: number
  /** Booking comment shown in the extra info column. */
  info: string
  searchText: string
}

export function buildReservationRows(
  bookings: BookingView[],
): ReservationRow[] {
  return bookings.map((booking) => ({
    kind: booking.resource_type,
    key: `booking-${booking.id}`,
    deviceName: booking.resource_name,
    detail:
      booking.resource_type === 'tofino'
        ? `Tofino ${booking.tofino_version}`
        : 'Bare-metal server',
    userId: booking.user_id,
    userName: booking.user_display_name,
    tofinoVersion: booking.tofino_version,
    startTs: booking.start_ts,
    endTs: booking.end_ts,
    info: booking.comment ?? '',
    searchText: [
      booking.resource_name,
      booking.user_display_name,
      booking.comment,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
  }))
}

export type ReservationFilters = {
  deviceType: 'all' | 'tofino' | 'server'
  tofinoVersion: TofinoVersion | 'all'
  userId: string | 'all'
  query: string
}

export const defaultReservationFilters: ReservationFilters = {
  deviceType: 'all',
  tofinoVersion: 'all',
  userId: 'all',
  query: '',
}

export function filterReservations(
  rows: ReservationRow[],
  filters: ReservationFilters,
): ReservationRow[] {
  const query = filters.query.trim().toLowerCase()
  return rows.filter((row) => {
    if (filters.deviceType !== 'all' && row.kind !== filters.deviceType) {
      return false
    }
    if (filters.tofinoVersion !== 'all') {
      if (row.kind !== 'tofino' || row.tofinoVersion !== filters.tofinoVersion) {
        return false
      }
    }
    if (filters.userId !== 'all' && row.userId !== filters.userId) {
      return false
    }
    if (query && !row.searchText.includes(query)) {
      return false
    }
    return true
  })
}
