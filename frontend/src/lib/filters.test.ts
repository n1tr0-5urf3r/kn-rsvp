import { describe, expect, it } from 'vitest'
import type { BookingView } from '../api/types'
import {
  buildReservationRows,
  defaultReservationFilters,
  filterReservations,
} from './filters'

const bookings: BookingView[] = [
  {
    id: 'b1',
    resource_type: 'tofino',
    resource_id: 't1',
    resource_name: 'tofino-1',
    tofino_id: 't1',
    tofino_name: 'tofino-1',
    tofino_version: 1,
    server_id: null,
    server_name: null,
    user_id: 'u1',
    user_display_name: 'Alice',
    start_ts: 1_760_200_000,
    end_ts: 1_760_203_600,
    comment: 'p4 pipeline test',
    created_at: 1_760_000_000,
  },
  {
    id: 'b2',
    resource_type: 'tofino',
    resource_id: 't2',
    resource_name: 'tofino-2',
    tofino_id: 't2',
    tofino_name: 'tofino-2',
    tofino_version: 2,
    server_id: null,
    server_name: null,
    user_id: 'u3',
    user_display_name: 'Carol',
    start_ts: 1_760_300_000,
    end_ts: 1_760_303_600,
    comment: null,
    created_at: 1_760_000_000,
  },
  {
    id: 'b3',
    resource_type: 'server',
    resource_id: 'pennywise',
    resource_name: 'Pennywise',
    tofino_id: null,
    tofino_name: null,
    tofino_version: null,
    server_id: 'pennywise',
    server_name: 'Pennywise',
    user_id: 'u1',
    user_display_name: 'Alice',
    start_ts: 1_760_400_000,
    end_ts: 1_760_403_600,
    comment: 'kernel test',
    created_at: 1_760_000_000,
  },
]

const rows = buildReservationRows(bookings)

describe('buildReservationRows', () => {
  it('includes only actual Tofino and server bookings', () => {
    expect(rows).toHaveLength(3)
    expect(rows.filter((r) => r.kind === 'tofino')).toHaveLength(2)
    expect(rows.filter((r) => r.kind === 'server')).toHaveLength(1)
  })

  it('carries booking ranges for tofino rows', () => {
    const b1 = rows.find((r) => r.key === 'booking-b1')
    expect(b1?.startTs).toBe(1_760_200_000)
    expect(b1?.endTs).toBe(1_760_203_600)
  })
})

describe('filterReservations', () => {
  it('passes everything through with default filters', () => {
    expect(filterReservations(rows, defaultReservationFilters)).toHaveLength(3)
  })

  it('filters by device type', () => {
    const tofinos = filterReservations(rows, {
      ...defaultReservationFilters,
      deviceType: 'tofino',
    })
    expect(tofinos.map((r) => r.kind)).toEqual(['tofino', 'tofino'])

    const servers = filterReservations(rows, {
      ...defaultReservationFilters,
      deviceType: 'server',
    })
    expect(servers.map((r) => r.key)).toEqual(['booking-b3'])
  })

  it('filters by Tofino version (implies tofino rows only)', () => {
    const v2 = filterReservations(rows, {
      ...defaultReservationFilters,
      tofinoVersion: 2,
    })
    expect(v2.map((r) => r.key)).toEqual(['booking-b2'])
  })

  it('filters by user across resource types', () => {
    const alice = filterReservations(rows, {
      ...defaultReservationFilters,
      userId: 'u1',
    })
    expect(alice.map((r) => r.key).sort()).toEqual([
      'booking-b1',
      'booking-b3',
    ])
  })

  it('free-text search is case-insensitive and spans device, user and comments', () => {
    expect(
      filterReservations(rows, {
        ...defaultReservationFilters,
        query: 'PIPELINE',
      }).map((r) => r.key),
    ).toEqual(['booking-b1'])

    expect(
      filterReservations(rows, {
        ...defaultReservationFilters,
        query: 'tofino-1',
      }).map((r) => r.key),
    ).toEqual(['booking-b1'])
  })

  it('combines filters with AND semantics', () => {
    expect(
      filterReservations(rows, {
        ...defaultReservationFilters,
        deviceType: 'server',
        userId: 'u1',
        query: 'kernel',
      }).map((r) => r.key),
    ).toEqual(['booking-b3'])

    expect(
      filterReservations(rows, {
        ...defaultReservationFilters,
        deviceType: 'tofino',
        userId: 'u1',
        query: 'kernel',
      }),
    ).toEqual([])
  })
})
