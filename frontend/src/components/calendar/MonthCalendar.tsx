import { addDays, format, isSameDay, isSameMonth, startOfDay } from 'date-fns'
import type { BookingView } from '../../api/client'
import { unixToDate, weekStart } from '../../lib/date'
import { cn } from '../../lib/cn'
import { formatBookingRange } from '../../lib/format'
import { Tooltip } from '../Tooltip'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const CELLS = Array.from({ length: 42 }, (_, index) => index)

function bookingsOnDay(bookings: BookingView[], day: Date) {
  const start = startOfDay(day)
  const end = addDays(start, 1)
  return bookings
    .filter(
      (booking) =>
        unixToDate(booking.end_ts) > start &&
        unixToDate(booking.start_ts) < end,
    )
    .sort((a, b) => a.start_ts - b.start_ts)
}

function BookingChip({
  booking,
  editable,
  colorClass,
  showResourceName,
  onClick,
}: {
  booking: BookingView
  editable: boolean
  colorClass?: string
  showResourceName: boolean
  onClick?: (booking: BookingView) => void
}) {
  const label = `${format(unixToDate(booking.start_ts), 'HH:mm')} ${
    showResourceName ? booking.resource_name : booking.user_display_name
  }`
  const classes = cn(
    'block w-full truncate rounded-lg px-1.5 py-1 text-left text-[0.65rem] font-black',
    colorClass ??
      (editable
        ? 'bg-primary text-white dark:bg-blush dark:text-berry-950'
        : 'bg-sky/30 text-berry-950 ring-1 ring-sky/50 dark:bg-sky/20 dark:text-berry-50'),
    editable && 'transition hover:brightness-110 hover:saturate-150',
  )
  const details = (
    <span className="block space-y-0.5">
      <span className="block font-black">{booking.resource_name}</span>
      <span className="block">{booking.user_display_name}</span>
      <span className="block">
        {formatBookingRange(booking.start_ts, booking.end_ts)}
      </span>
      {booking.comment ? <span className="block">{booking.comment}</span> : null}
    </span>
  )

  if (editable) {
    return (
      <button
        type="button"
        className={classes}
        onClick={() => onClick?.(booking)}
        aria-label={`Edit booking on ${booking.resource_name} by ${booking.user_display_name}, ${formatBookingRange(booking.start_ts, booking.end_ts)}`}
      >
        {label}
      </button>
    )
  }

  return (
    <Tooltip className="block" content={details}>
      <span className={classes}>{label}</span>
    </Tooltip>
  )
}

export function MonthCalendar({
  month,
  bookings,
  currentUserId,
  isAdmin = false,
  onDayClick,
  onBookingClick,
  resourceColorClasses,
  showResourceNames = false,
}: {
  month: Date
  bookings: BookingView[]
  currentUserId: string | undefined
  isAdmin?: boolean
  onDayClick?: (day: Date) => void
  onBookingClick?: (booking: BookingView) => void
  resourceColorClasses?: Record<string, string>
  showResourceNames?: boolean
}) {
  const gridStart = weekStart(new Date(month.getFullYear(), month.getMonth(), 1))
  const today = new Date()

  return (
    <div className="overflow-x-auto rounded-4xl border-2 border-berry-100 bg-[#fffdf8] p-3 shadow-soft dark:border-white/10 dark:bg-berry-900">
      <div className="grid min-w-[48rem] grid-cols-7">
        {DAYS.map((day) => (
          <div
            key={day}
            className="px-2 pb-2 text-center text-xs font-black uppercase tracking-wide text-berry-700/70 dark:text-rose-100/70"
          >
            {day}
          </div>
        ))}
        {CELLS.map((index) => {
          const day = addDays(gridStart, index)
          const dayBookings = bookingsOnDay(bookings, day)
          const hiddenCount = Math.max(0, dayBookings.length - 4)
          return (
            <div
              key={day.toISOString()}
              data-testid={`month-day-${format(day, 'yyyy-MM-dd')}`}
              className={cn(
                'min-h-28 border-l border-t border-berry-100 p-1.5 dark:border-white/10',
                !isSameMonth(day, month) && 'bg-berry-100/25 opacity-60 dark:bg-white/[0.02]',
                isSameDay(day, today) && 'bg-sun/10 dark:bg-sun/5',
              )}
            >
              <button
                type="button"
                className={cn(
                  'mb-1 grid size-7 place-items-center rounded-full text-xs font-black transition hover:bg-primary/10',
                  isSameDay(day, today) &&
                    'bg-primary text-white dark:bg-blush dark:text-berry-950',
                )}
                onClick={() => onDayClick?.(day)}
                aria-label={`Open week of ${format(day, 'EEEE dd MMMM yyyy')}`}
              >
                {format(day, 'd')}
              </button>
              <div className="space-y-1">
                {dayBookings.slice(0, 4).map((booking) => (
                  <BookingChip
                    key={booking.id}
                    booking={booking}
                    editable={isAdmin || booking.user_id === currentUserId}
                    onClick={onBookingClick}
                    colorClass={
                      resourceColorClasses?.[
                        `${booking.resource_type}:${booking.resource_id}`
                      ]
                    }
                    showResourceName={showResourceNames}
                  />
                ))}
                {hiddenCount > 0 ? (
                  <p className="px-1 text-[0.65rem] font-black text-berry-700/70 dark:text-rose-100/70">
                    +{hiddenCount} more
                  </p>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
