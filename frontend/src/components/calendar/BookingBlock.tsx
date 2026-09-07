import type { CSSProperties } from 'react'
import type { BookingView } from '../../api/client'
import { formatBookingRange } from '../../lib/format'
import { cn } from '../../lib/cn'
import { Tooltip } from '../Tooltip'
import type { DaySegment } from '../../lib/date'

/**
 * From this many side-by-side lanes on, a block is too narrow for the full
 * resource name ("Pennywise" would truncate to "P…"): it switches to the short
 * code from the legend and drops the comment line.
 */
const COMPACT_FROM_COLUMNS = 3

export function BookingBlock({
  booking,
  segment,
  editable,
  onClick,
  column = 0,
  columns = 1,
  colorClass,
  showResourceName = false,
  resourceCode,
  rowHeightRem = 2.75,
}: {
  booking: BookingView
  segment: DaySegment
  editable: boolean
  onClick?: (booking: BookingView) => void
  /** cluster layout: 0-based column and total columns (side-by-side overlaps) */
  column?: number
  columns?: number
  /** per-tofino accent classes (All-Tofinos view); default single-view styling */
  colorClass?: string
  showResourceName?: boolean
  /** short code shown instead of the name in narrow lanes (see legend) */
  resourceCode?: string
  /** Height of one calendar hour, used for minute-accurate positioning. */
  rowHeightRem?: number
}) {
  const style: CSSProperties = {
    position: 'absolute',
    top: `calc(${segment.startHour * rowHeightRem}rem + 2px)`,
    height: `calc(${(segment.endHour - segment.startHour) * rowHeightRem}rem - 4px)`,
    minHeight: '0.75rem',
    left: `calc(${(100 * column) / columns}% + 2px)`,
    width: `calc(${100 / columns}% - 4px)`,
  }

  const compact = columns >= COMPACT_FROM_COLUMNS
  const description = `${booking.resource_name} — ${booking.user_display_name}, ${formatBookingRange(booking.start_ts, booking.end_ts)}`

  const body = (
    <span className="block min-w-0 overflow-hidden text-left leading-tight">
      {showResourceName ? (
        <span
          className={cn(
            'block truncate font-black uppercase',
            compact
              ? 'text-[0.7rem] tracking-tight'
              : 'text-[0.65rem] tracking-wide opacity-80',
          )}
        >
          {compact && resourceCode ? (
            <>
              <span aria-hidden="true">{resourceCode}</span>
              <span className="sr-only">{booking.resource_name}</span>
            </>
          ) : (
            booking.resource_name
          )}
        </span>
      ) : null}
      <span
        className={cn(
          'block truncate',
          compact ? 'text-[0.6rem] font-bold opacity-90' : 'font-black',
        )}
      >
        {booking.user_display_name}
      </span>
      {booking.comment && !compact ? (
        <span className="block truncate text-[0.65rem] opacity-80">
          {booking.comment}
        </span>
      ) : null}
    </span>
  )

  const blockClasses = cn(
    'z-10 flex min-w-0 items-start overflow-hidden rounded-xl py-1 text-xs shadow-soft',
    compact ? 'px-1' : 'px-2',
    colorClass
      ? cn(
          colorClass,
          editable &&
            'cursor-pointer transition hover:brightness-110 hover:saturate-150',
        )
      : editable
        ? 'cursor-pointer bg-primary text-white transition hover:bg-secondary dark:bg-blush dark:text-berry-950'
        : 'bg-sky/30 text-berry-950 ring-1 ring-sky/50 dark:bg-sky/20 dark:text-berry-50',
  )

  const testAttrs = {
    'data-testid': 'booking-block',
    'data-booking-id': booking.id,
    'data-day': segment.dayIndex,
    'data-start-hour': segment.startHour,
    'data-end-hour': segment.endHour,
    'data-column': column,
    'data-columns': columns,
  }

  const tooltipContent = (
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
        style={style}
        className={blockClasses}
        onClick={() => onClick?.(booking)}
        // Own blocks have no tooltip, so the abbreviated ones need the title.
        title={description}
        aria-label={`Edit booking on ${booking.resource_name} by ${booking.user_display_name}, ${formatBookingRange(booking.start_ts, booking.end_ts)}`}
        {...testAttrs}
      >
        {body}
      </button>
    )
  }

  return (
    <div style={style} className="z-10 grid min-w-0" {...testAttrs}>
      <Tooltip className="h-full w-full" content={tooltipContent}>
        <span className={cn(blockClasses, 'h-full w-full')}>{body}</span>
      </Tooltip>
    </div>
  )
}
