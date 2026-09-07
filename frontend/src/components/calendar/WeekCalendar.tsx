import { format, isSameDay } from 'date-fns'
import type { BookingView } from '../../api/client'
import {
  dayIndexInWeek,
  intervalToSegments,
  isPastSlot,
  slotDate,
  weekStart,
  type DaySegment,
} from '../../lib/date'
import { layoutOverlaps } from '../../lib/overlap'
import { cn } from '../../lib/cn'
import { useNow } from '../../lib/useNow'
import { BookingBlock } from './BookingBlock'

const HOURS = Array.from({ length: 24 }, (_, hour) => hour)
const DAYS = [0, 1, 2, 3, 4, 5, 6]

/** Width of the hour labels; part of the grid template and the min width. */
const GUTTER_REM = 3.5
/** Height of one hour row; also the unit the current-time line is placed in. */
const ROW_REM = 2.75
/** Day column floor, matching the previous static `min-w-[52rem]`. */
const DAY_MIN_REM = 6.9
/**
 * Minimum width every side-by-side lane gets once the day column grows past
 * the floor (see `maxRealLanes` below) — kept just wide enough for the
 * three-letter resource codes so busy days stay readable instead of
 * squeezing every label into two letters.
 */
const LANE_MIN_REM = 2.75

type PlacedBooking = {
  booking: BookingView
  segment: DaySegment
  start: number
  end: number
}

export function WeekCalendar({
  monday,
  bookings,
  currentUserId,
  isAdmin = false,
  onSlotClick,
  onBookingClick,
  resourceColorClasses,
  resourceCodes,
  showResourceNames = false,
  reserveFreeLane,
}: {
  /** Monday 00:00 local time of the displayed week. */
  monday: Date
  bookings: BookingView[]
  currentUserId: string | undefined
  isAdmin?: boolean
  onSlotClick?: (start: Date) => void
  onBookingClick?: (booking: BookingView) => void
  /** `resource_type:resource_id` -> accent classes in the combined view. */
  resourceColorClasses?: Record<string, string>
  /** `resource_type:resource_id` -> short code for lanes too narrow for names. */
  resourceCodes?: Record<string, string>
  showResourceNames?: boolean
  /**
   * All-Tofinos view: number of bookable Tofinos. Every overlap cluster then
   * lays out one lane more than it needs, so the strip next to a booking stays
   * uncovered and the slot button underneath remains clickable — you can book
   * another Tofino in parallel. Capped at the Tofino count: once they are all
   * booked there is nothing left to click anyway.
   */
  reserveFreeLane?: number
}) {
  const week = weekStart(monday)
  const today = useNow()

  // Current-time line: only drawn when the displayed week contains today.
  const nowDayIndex = dayIndexInWeek(week, today)
  const nowTopRem =
    ((today.getHours() * 60 + today.getMinutes()) / 60) * ROW_REM
  const showNow = nowDayIndex >= 0 && nowDayIndex <= 6

  const placedByDay = new Map<number, PlacedBooking[]>()
  for (const booking of bookings) {
    for (const segment of intervalToSegments(week, booking.start_ts, booking.end_ts)) {
      const list = placedByDay.get(segment.dayIndex) ?? []
      list.push({
        booking,
        segment,
        start: segment.startHour,
        end: segment.endHour,
      })
      placedByDay.set(segment.dayIndex, list)
    }
  }

  const overlapsByDay = new Map(
    DAYS.map((dayIndex) => [dayIndex, layoutOverlaps(placedByDay.get(dayIndex) ?? [])]),
  )

  // The reserved free lane (see `reserveFreeLane` above) is an empty,
  // clickable strip, not an actual booking — it must not by itself grow the
  // calendar or trigger horizontal scrolling. Sizing is driven only by real
  // overlapping bookings; the reserved lane is added afterwards purely for
  // layout (it just divides the already-decided width one slice further).
  const maxRealLanes = Math.max(
    1,
    ...[...overlapsByDay.values()].flatMap((entries) =>
      entries.map((entry) => entry.columns),
    ),
  )
  // Up to three real parallel bookings squeeze into the fixed floor width;
  // only a fourth (or more) grows the columns — and with them, the need to
  // scroll on narrower screens.
  const dayMinRem =
    maxRealLanes > 3 ? maxRealLanes * LANE_MIN_REM : DAY_MIN_REM

  const laidOutByDay = new Map(
    [...overlapsByDay].map(([dayIndex, entries]) => [
      dayIndex,
      entries.map((entry) => ({
        ...entry,
        columns: reserveFreeLane
          ? Math.min(reserveFreeLane, entry.columns + 1)
          : entry.columns,
      })),
    ]),
  )

  return (
    <div className="overflow-x-auto rounded-4xl border-2 border-berry-100 bg-[#fffdf8] p-3 shadow-soft dark:border-white/10 dark:bg-berry-900">
      <div
        className="grid"
        style={{
          gridTemplateColumns: `${GUTTER_REM}rem repeat(7, minmax(${dayMinRem}rem, 1fr))`,
          minWidth: `${GUTTER_REM + 7 * dayMinRem}rem`,
        }}
      >
        {/* Header row */}
        <div />
        {DAYS.map((dayIndex) => {
          const day = slotDate(week, dayIndex, 0)
          const isToday = isSameDay(day, today)
          return (
            <div
              key={dayIndex}
              className={cn(
                'px-2 pb-2 text-center text-sm font-black',
                isToday
                  ? 'text-primary dark:text-blush'
                  : 'text-berry-700 dark:text-rose-100',
              )}
            >
              {format(day, 'EEE')}
              <span className="block text-xs font-bold opacity-70">
                {format(day, 'dd MMM')}
              </span>
            </div>
          )
        })}

        {/* Time gutter */}
        <div
          className="relative grid"
          style={{ gridTemplateRows: `repeat(24, ${ROW_REM}rem)` }}
        >
          {HOURS.map((hour) => (
            <div
              key={hour}
              className="pr-2 text-right text-[0.65rem] font-bold text-berry-700/60 dark:text-rose-100/60"
            >
              {String(hour).padStart(2, '0')}:00
            </div>
          ))}
          {showNow ? (
            <span
              data-testid="current-time-label"
              className="pointer-events-none absolute right-1 z-20 -translate-y-1/2 rounded-lg bg-primary px-1 py-px text-[0.6rem] font-black text-white shadow-soft dark:bg-blush dark:text-berry-950"
              style={{ top: `${nowTopRem}rem` }}
            >
              {format(today, 'HH:mm')}
            </span>
          ) : null}
        </div>

        {/* Day columns */}
        {DAYS.map((dayIndex) => {
          const day = slotDate(week, dayIndex, 0)
          const isToday = isSameDay(day, today)
          return (
            <div
              key={dayIndex}
              data-testid={`day-column-${dayIndex}`}
              className={cn(
                'relative grid border-l border-berry-100 dark:border-white/10',
                isToday && 'bg-sun/10 dark:bg-sun/5',
              )}
              style={{ gridTemplateRows: `repeat(24, ${ROW_REM}rem)` }}
            >
              {HOURS.map((hour) => {
                const isPast = isPastSlot(week, dayIndex, hour, today)
                return (
                  <button
                    key={hour}
                    type="button"
                    disabled={isPast}
                    style={{ gridRow: `${hour + 1}`, gridColumn: '1' }}
                    className={cn(
                      'border-t border-berry-100/70 transition dark:border-white/5',
                      isPast
                        ? 'cursor-not-allowed bg-berry-100/35 dark:bg-black/10'
                        : 'hover:bg-primary/10 dark:hover:bg-white/10',
                    )}
                    aria-label={`Book ${format(day, 'EEEE dd MMM')} ${String(hour).padStart(2, '0')}:00`}
                    data-testid={`slot-${dayIndex}-${hour}`}
                    onClick={() =>
                      onSlotClick?.(slotDate(week, dayIndex, hour))
                    }
                  />
                )
              })}
              {(laidOutByDay.get(dayIndex) ?? []).map(
                ({ item: { booking, segment }, column, columns }) => (
                  <BookingBlock
                    key={`${booking.id}-${segment.startHour}`}
                    booking={booking}
                    segment={segment}
                    editable={isAdmin || booking.user_id === currentUserId}
                    onClick={onBookingClick}
                    column={column}
                    columns={columns}
                    colorClass={
                      resourceColorClasses?.[
                        `${booking.resource_type}:${booking.resource_id}`
                      ]
                    }
                    resourceCode={
                      resourceCodes?.[
                        `${booking.resource_type}:${booking.resource_id}`
                      ]
                    }
                    showResourceName={showResourceNames}
                    rowHeightRem={ROW_REM}
                  />
                ),
              )}
              {/*
                Current time. Sits above the booking blocks (z-10) but never
                takes a click, so the slot button underneath stays bookable.
              */}
              {showNow && dayIndex === nowDayIndex ? (
                <div
                  aria-hidden="true"
                  data-testid="current-time-line"
                  className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-primary dark:border-blush"
                  style={{ top: `${nowTopRem}rem` }}
                >
                  <span className="absolute -top-[0.3rem] -left-[0.2rem] block size-2.5 rounded-full bg-primary dark:bg-blush" />
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
