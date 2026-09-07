import { describe, expect, it } from 'vitest'
import {
  HOUR_SECONDS,
  MAX_BOOKING_DURATION_HOURS,
  bookingEndError,
  dateToUnix,
  formatDateTimeLocal,
  formatWeekParam,
  intervalToSegments,
  isHourAligned,
  isSameWeek,
  monthGridRange,
  monthStart,
  parseDateTimeLocal,
  parseDateParam,
  parseWeekParam,
  shiftMonth,
  shiftWeek,
  slotDate,
  slotToUnix,
  weekRange,
  weekStart,
} from './date'

// vitest is configured with TZ=Europe/Berlin (vite.config.ts) — these tests
// depend on it, including the DST transitions on 2026-03-29 (spring forward,
// 02:00 -> 03:00) and 2026-10-25 (fall back).

const utc = (
  y: number,
  mo: number,
  d: number,
  h = 0,
  mi = 0,
): number => Date.UTC(y, mo, d, h, mi) / 1000

describe('weekStart', () => {
  it('returns Monday 00:00 local for any day of the week', () => {
    // Wednesday 22 Jul 2026
    const monday = weekStart(new Date(2026, 6, 22, 15, 30))
    expect(monday.getDay()).toBe(1)
    expect(monday.getDate()).toBe(20)
    expect(monday.getHours()).toBe(0)
    expect(monday.getMinutes()).toBe(0)
  })

  it('keeps Sunday in the week of the preceding Monday', () => {
    // Sunday 26 Jul 2026
    const monday = weekStart(new Date(2026, 6, 26, 10))
    expect(monday.getDate()).toBe(20)
  })

  it('is idempotent', () => {
    const monday = weekStart(new Date(2026, 6, 22))
    expect(weekStart(monday).getTime()).toBe(monday.getTime())
  })
})

describe('week param round-trip', () => {
  it('serializes the Monday date', () => {
    expect(formatWeekParam(new Date(2026, 6, 22))).toBe('2026-07-20')
  })

  it('parses back to the same Monday', () => {
    const monday = parseWeekParam('2026-07-20')
    expect(monday.getFullYear()).toBe(2026)
    expect(monday.getMonth()).toBe(6)
    expect(monday.getDate()).toBe(20)
    expect(formatWeekParam(monday)).toBe('2026-07-20')
  })

  it('snaps a mid-week param to its Monday', () => {
    expect(formatWeekParam(parseWeekParam('2026-07-23'))).toBe('2026-07-20')
  })

  it('falls back to the current week for garbage or null', () => {
    const current = weekStart(new Date())
    expect(parseWeekParam('not-a-date').getTime()).toBe(current.getTime())
    expect(parseWeekParam(null).getTime()).toBe(current.getTime())
    expect(parseWeekParam(undefined).getTime()).toBe(current.getTime())
  })
})

describe('slot <-> timestamp conversion (UTC storage, local display)', () => {
  const monday = new Date(2026, 6, 20) // Mon 20 Jul 2026, CEST (+02:00)

  it('converts a slot to hour-aligned UTC seconds', () => {
    // Tue 10:00 CEST = 08:00 UTC
    const ts = slotToUnix(monday, 1, 10)
    expect(ts).toBe(utc(2026, 6, 21, 8))
    expect(isHourAligned(ts)).toBe(true)
  })

  it('Monday 00:00 local maps to 22:00 UTC of the prior day in summer', () => {
    expect(slotToUnix(monday, 0, 0)).toBe(utc(2026, 6, 19, 22))
  })

  it('slotDate returns the requested wall-clock hour', () => {
    const slot = slotDate(monday, 4, 17)
    expect(slot.getDay()).toBe(5) // Friday
    expect(slot.getHours()).toBe(17)
  })
})

describe('explicit booking end date/time', () => {
  const startTs = dateToUnix(new Date(2026, 7, 20, 10))

  it('round-trips datetime-local values in the browser timezone', () => {
    const endTs = startTs + 11 * HOUR_SECONDS
    expect(formatDateTimeLocal(endTs)).toBe('2026-08-20T21:00')
    expect(parseDateTimeLocal(formatDateTimeLocal(endTs))).toBe(endTs)
  })

  it('accepts an end exactly 48 hours after the start', () => {
    expect(
      bookingEndError(
        startTs,
        startTs + MAX_BOOKING_DURATION_HOURS * HOUR_SECONDS,
      ),
    ).toBeNull()
  })

  it('rejects an end beyond 48 hours', () => {
    expect(
      bookingEndError(
        startTs,
        startTs + (MAX_BOOKING_DURATION_HOURS + 1) * HOUR_SECONDS,
      ),
    ).toMatch(/within 48 hours/)
  })

  it('allows end minutes but rejects seconds and non-positive end times', () => {
    expect(bookingEndError(startTs, null)).toMatch(/valid end date/)
    expect(bookingEndError(startTs, startTs + 30 * 60)).toBeNull()
    expect(bookingEndError(startTs, startTs + 30)).toMatch(/full minute/)
    expect(bookingEndError(startTs, startTs)).toMatch(/after the start/)
  })
})

describe('DST spring forward (Europe/Berlin, week of 2026-03-23)', () => {
  const monday = new Date(2026, 2, 23)

  it('the week has 167 real hours', () => {
    const { from, to } = weekRange(monday)
    expect(to - from).toBe(167 * 3600)
  })

  it('Sunday 01:00 local is 00:00 UTC (still CET)', () => {
    expect(slotToUnix(monday, 6, 1)).toBe(utc(2026, 2, 29, 0))
  })

  it('Sunday 03:00 local is 01:00 UTC (now CEST)', () => {
    expect(slotToUnix(monday, 6, 3)).toBe(utc(2026, 2, 29, 1))
  })

  it('the skipped hour 02:00 resolves to the same instant as 03:00', () => {
    expect(slotToUnix(monday, 6, 2)).toBe(slotToUnix(monday, 6, 3))
  })

  it('a booking across the transition spans wall-clock rows, not real hours', () => {
    // 01:00 local (00:00Z) to 04:00 local (02:00Z) is 2 real hours but
    // occupies rows 1..4 on the wall-clock grid.
    const segments = intervalToSegments(
      monday,
      utc(2026, 2, 29, 0),
      utc(2026, 2, 29, 2),
    )
    expect(segments).toEqual([{ dayIndex: 6, startHour: 1, endHour: 4 }])
  })
})

describe('DST fall back (Europe/Berlin, week of 2026-10-19)', () => {
  const monday = new Date(2026, 9, 19)

  it('the week has 169 real hours', () => {
    const { from, to } = weekRange(monday)
    expect(to - from).toBe(169 * 3600)
  })

  it('the repeated hour 02:00 resolves to its first occurrence (CEST)', () => {
    // Sunday 2026-10-25 02:00 CEST = 00:00 UTC
    expect(slotToUnix(monday, 6, 2)).toBe(utc(2026, 9, 25, 0))
  })

  it('Sunday 03:00 local is 02:00 UTC (back on CET)', () => {
    expect(slotToUnix(monday, 6, 3)).toBe(utc(2026, 9, 25, 2))
  })
})

describe('intervalToSegments', () => {
  const monday = new Date(2026, 6, 20) // CEST

  it('places a same-day booking in one segment', () => {
    const segments = intervalToSegments(
      monday,
      slotToUnix(monday, 1, 10),
      slotToUnix(monday, 1, 12),
    )
    expect(segments).toEqual([{ dayIndex: 1, startHour: 10, endHour: 12 }])
  })

  it('splits a booking crossing midnight into two segments', () => {
    const segments = intervalToSegments(
      monday,
      slotToUnix(monday, 1, 23),
      slotToUnix(monday, 2, 1),
    )
    expect(segments).toEqual([
      { dayIndex: 1, startHour: 23, endHour: 24 },
      { dayIndex: 2, startHour: 0, endHour: 1 },
    ])
  })

  it('preserves minute precision in the final hourly row', () => {
    const start = slotToUnix(monday, 1, 17)
    const segments = intervalToSegments(monday, start, start + 90 * 60)
    expect(segments).toEqual([{ dayIndex: 1, startHour: 17, endHour: 18.5 }])
  })

  it('clips a booking that starts before the week', () => {
    const previousFriday = slotToUnix(shiftWeek(monday, -1), 4, 12)
    const segments = intervalToSegments(
      monday,
      previousFriday,
      slotToUnix(monday, 0, 5),
    )
    expect(segments).toEqual([{ dayIndex: 0, startHour: 0, endHour: 5 }])
  })

  it('clips a booking that ends after the week', () => {
    const segments = intervalToSegments(
      monday,
      slotToUnix(monday, 6, 20),
      slotToUnix(shiftWeek(monday, 1), 0, 8),
    )
    expect(segments).toEqual([{ dayIndex: 6, startHour: 20, endHour: 24 }])
  })

  it('returns nothing for bookings outside the week', () => {
    const nextWeek = shiftWeek(monday, 1)
    expect(
      intervalToSegments(
        monday,
        slotToUnix(nextWeek, 0, 10),
        slotToUnix(nextWeek, 0, 12),
      ),
    ).toEqual([])
  })

  it('covers a full day as rows 0..24', () => {
    const segments = intervalToSegments(
      monday,
      slotToUnix(monday, 3, 0),
      slotToUnix(monday, 4, 0),
    )
    expect(segments).toEqual([{ dayIndex: 3, startHour: 0, endHour: 24 }])
  })
})

describe('misc helpers', () => {
  it('shiftWeek moves whole weeks', () => {
    const monday = weekStart(new Date(2026, 6, 20))
    expect(formatWeekParam(shiftWeek(monday, 1))).toBe('2026-07-27')
    expect(formatWeekParam(shiftWeek(monday, -1))).toBe('2026-07-13')
  })

  it('isSameWeek', () => {
    expect(isSameWeek(new Date(2026, 6, 20), new Date(2026, 6, 26))).toBe(true)
    expect(isSameWeek(new Date(2026, 6, 20), new Date(2026, 6, 27))).toBe(false)
  })

  it('isHourAligned', () => {
    expect(isHourAligned(utc(2026, 0, 1, 12))).toBe(true)
    expect(isHourAligned(utc(2026, 0, 1, 12, 30))).toBe(false)
  })

  it('dateToUnix floors to whole seconds', () => {
    expect(dateToUnix(new Date(1_750_000_000_500))).toBe(1_750_000_000)
  })

  it('builds a six-week Monday-first range for a month', () => {
    const july = monthStart(new Date(2026, 6, 20))
    expect(july.getDate()).toBe(1)
    expect(shiftMonth(july, 1).getMonth()).toBe(7)
    const { from, to } = monthGridRange(july)
    expect(new Date(from * 1000).getDate()).toBe(29) // Mon 29 Jun
    expect((to - from) / (24 * 3600)).toBe(42)
  })

  it('calendar date params preserve the selected day', () => {
    const parsed = parseDateParam('2026-07-21')
    expect(parsed.getFullYear()).toBe(2026)
    expect(parsed.getMonth()).toBe(6)
    expect(parsed.getDate()).toBe(21)
  })
})
