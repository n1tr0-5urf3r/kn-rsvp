/**
 * All week/slot math for the booking calendar lives here.
 *
 * Storage is unix seconds in UTC, with hour-aligned starts, minute-aligned
 * ends, and end exclusive. Display is the browser's local timezone. The week
 * grid is Monday-first with 24 hourly rows;
 * a grid cell (dayIndex, hour) means "that wall-clock hour on that local day".
 * On DST days a local day has 23 or 25 real hours — the grid intentionally
 * stays at 24 rows and cells map to whatever instant the local wall clock
 * produces for that hour.
 */
import {
  addDays,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  format,
  isValid,
  parse,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns'

export const HOUR_SECONDS = 3600
export const MINUTE_SECONDS = 60
export const MAX_BOOKING_DURATION_HOURS = 48

/** Monday 00:00 local time of the week containing `date`. */
export function weekStart(date: Date): Date {
  return startOfWeek(date, { weekStartsOn: 1 })
}

/** Monday 00:00 local time, `offset` weeks away from `date`'s week. */
export function shiftWeek(monday: Date, offset: number): Date {
  return weekStart(addWeeks(monday, offset))
}

/** Serialize a week for the `?week=` URL param (its Monday as yyyy-MM-dd). */
export function formatWeekParam(monday: Date): string {
  return format(weekStart(monday), 'yyyy-MM-dd')
}

/** Parse a `?week=` param; falls back to the current week when invalid. */
export function parseWeekParam(value: string | null | undefined): Date {
  if (value) {
    const parsed = parse(value, 'yyyy-MM-dd', new Date())
    if (isValid(parsed)) {
      return weekStart(parsed)
    }
  }
  return weekStart(new Date())
}

/** Serialize an arbitrary local calendar day for the calendar URL. */
export function formatDateParam(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

/** Parse an arbitrary calendar date, falling back to today. */
export function parseDateParam(value: string | null | undefined): Date {
  if (value) {
    const parsed = parse(value, 'yyyy-MM-dd', new Date())
    if (isValid(parsed)) {
      return startOfDay(parsed)
    }
  }
  return startOfDay(new Date())
}

/** First local day of the month containing `date`. */
export function monthStart(date: Date): Date {
  return startOfMonth(date)
}

export function shiftMonth(date: Date, offset: number): Date {
  return startOfMonth(addMonths(date, offset))
}

/**
 * Six-week Monday-first range rendered by the month grid, including the
 * leading/trailing days from adjacent months.
 */
export function monthGridRange(date: Date): { from: number; to: number } {
  const fromDate = weekStart(startOfMonth(date))
  return {
    from: dateToUnix(fromDate),
    to: dateToUnix(addWeeks(fromDate, 6)),
  }
}

/** Local Date for grid cell (dayIndex 0=Mon..6=Sun, hour 0..23). */
export function slotDate(monday: Date, dayIndex: number, hour: number): Date {
  const day = startOfDay(addDays(weekStart(monday), dayIndex))
  const slot = new Date(day)
  slot.setHours(hour, 0, 0, 0)
  return slot
}

/** Unix seconds (UTC) for a Date. */
export function dateToUnix(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

/** Date for unix seconds. */
export function unixToDate(ts: number): Date {
  return new Date(ts * 1000)
}

/** Value used by a datetime-local input for a Unix timestamp. */
export function formatDateTimeLocal(ts: number): string {
  return format(unixToDate(ts), "yyyy-MM-dd'T'HH:mm")
}

/** Parse a datetime-local value in the browser's local timezone. */
export function parseDateTimeLocal(value: string): number | null {
  if (!value) {
    return null
  }
  const date = new Date(value)
  return isValid(date) ? dateToUnix(date) : null
}

/** Validate the explicit booking end used by the calendar forms. */
export function bookingEndError(startTs: number, endTs: number | null): string | null {
  if (endTs === null) {
    return 'Pick a valid end date and time.'
  }
  if (endTs % MINUTE_SECONDS !== 0) {
    return 'The end time must be on a full minute.'
  }
  if (endTs <= startTs) {
    return 'The end time must be after the start time.'
  }
  if (endTs - startTs > MAX_BOOKING_DURATION_HOURS * HOUR_SECONDS) {
    return `The end time must be within ${MAX_BOOKING_DURATION_HOURS} hours of the start.`
  }
  return null
}

/** Unix seconds for a grid cell. */
export function slotToUnix(monday: Date, dayIndex: number, hour: number): number {
  return dateToUnix(slotDate(monday, dayIndex, hour))
}

export function isHourAligned(ts: number): boolean {
  return ts % HOUR_SECONDS === 0
}

/** Inclusive range of unix seconds covered by a week, for API queries. */
export function weekRange(monday: Date): { from: number; to: number } {
  const start = weekStart(monday)
  return { from: dateToUnix(start), to: dateToUnix(shiftWeek(start, 1)) }
}

export type DaySegment = {
  /** 0 (Monday) .. 6 (Sunday) */
  dayIndex: number
  /** first occupied hourly row, 0..23 */
  startHour: number
  /** exclusive end position in hours, 0..24; may include a minute fraction */
  endHour: number
}

/**
 * Split a [startTs, endTs) interval into per-local-day grid segments within
 * the given week. Days outside the week are clipped; intervals that don't
 * intersect the week yield []. Hours are local wall-clock hours.
 */
export function intervalToSegments(
  monday: Date,
  startTs: number,
  endTs: number,
): DaySegment[] {
  const week = weekStart(monday)
  const segments: DaySegment[] = []
  const start = unixToDate(startTs)
  const end = unixToDate(endTs)

  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const dayStart = startOfDay(addDays(week, dayIndex))
    const nextDayStart = startOfDay(addDays(week, dayIndex + 1))
    if (end <= dayStart || start >= nextDayStart) {
      continue
    }
    const segStart = start > dayStart ? start : dayStart
    const segEnd = end < nextDayStart ? end : nextDayStart
    const startHour = segStart.getTime() === dayStart.getTime() ? 0 : segStart.getHours()
    const endHour =
      segEnd.getTime() === nextDayStart.getTime()
        ? 24
        : segEnd.getHours() + segEnd.getMinutes() / 60
    if (endHour > startHour) {
      segments.push({ dayIndex, startHour, endHour })
    }
  }
  return segments
}

/** Day index (0=Mon..6=Sun) of a Date within its week. */
export function dayIndexInWeek(monday: Date, date: Date): number {
  return differenceInCalendarDays(startOfDay(date), weekStart(monday))
}

export function isSameWeek(a: Date, b: Date): boolean {
  return weekStart(a).getTime() === weekStart(b).getTime()
}

/** True once the whole slot hour has passed; the current hour stays bookable. */
export function isPastSlot(monday: Date, dayIndex: number, hour: number, now = new Date()): boolean {
  const currentHour = new Date(now)
  currentHour.setMinutes(0, 0, 0)
  return slotDate(monday, dayIndex, hour).getTime() < currentHour.getTime()
}
