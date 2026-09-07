import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BookingView } from '../../api/types'
import { slotToUnix } from '../../lib/date'
import { WeekCalendar } from './WeekCalendar'

const monday = new Date(2026, 6, 20) // Mon 20 Jul 2026

function booking(
  id: string,
  userId: string,
  day: number,
  startHour: number,
  endHour: number,
  overrides: Partial<BookingView> = {},
): BookingView {
  const result: BookingView = {
    id,
    resource_type: 'tofino',
    resource_id: 't1',
    resource_name: 'tofino-1',
    tofino_id: 't1',
    tofino_name: 'tofino-1',
    tofino_version: 1,
    server_id: null,
    server_name: null,
    user_id: userId,
    user_display_name: userId === 'u1' ? 'Alice' : 'Bob',
    start_ts: slotToUnix(monday, day, startHour),
    end_ts: slotToUnix(monday, day, endHour),
    comment: null,
    created_at: 0,
    ...overrides,
  }
  if (overrides.tofino_id) result.resource_id = overrides.tofino_id
  if (overrides.tofino_name) result.resource_name = overrides.tofino_name
  return result
}

describe('WeekCalendar', () => {
  it('places bookings in the correct day column and grid rows', () => {
    render(
      <WeekCalendar
        monday={monday}
        bookings={[
          booking('b1', 'u1', 1, 10, 12),
          booking('b2', 'u2', 3, 9, 10),
        ]}
        currentUserId="u1"
      />,
    )

    const blocks = screen.getAllByTestId('booking-block')
    expect(blocks).toHaveLength(2)

    const b1 = blocks.find((el) => el.dataset.bookingId === 'b1')!
    expect(b1.dataset.day).toBe('1')
    expect(b1.dataset.startHour).toBe('10')
    expect(b1.dataset.endHour).toBe('12')
    expect(b1.style.top).toBe('calc(2px + 27.5rem)')
    expect(b1.style.height).toBe('calc(5.5rem - 4px)')
    expect(screen.getByTestId('day-column-1')).toContainElement(b1)

    const b2 = blocks.find((el) => el.dataset.bookingId === 'b2')!
    expect(b2.dataset.day).toBe('3')
    expect(b2.style.top).toBe('calc(2px + 24.75rem)')
    expect(b2.style.height).toBe('calc(2.75rem - 4px)')
    expect(screen.getByTestId('day-column-3')).toContainElement(b2)
  })

  it('positions a minute-based end within its hourly row', () => {
    const startTs = slotToUnix(monday, 1, 18)
    render(
      <WeekCalendar
        monday={monday}
        bookings={[
          booking('minute-end', 'u1', 1, 18, 19, {
            end_ts: startTs + 40 * 60,
          }),
        ]}
        currentUserId="u1"
      />,
    )

    const block = screen.getByTestId('booking-block')
    expect(block.style.position).toBe('absolute')
    expect(block.style.top).toBe('calc(2px + 49.5rem)')
    const heightRem = Number(
      block.style.height.match(/calc\(([^r]+)rem/)?.[1],
    )
    expect(heightRem).toBeCloseTo((40 / 60) * 2.75)
  })

  it('renders concurrent bookings of different tofinos side by side', () => {
    render(
      <WeekCalendar
        monday={monday}
        bookings={[
          booking('b1', 'u1', 2, 10, 12),
          booking('b2', 'u2', 2, 11, 13, {
            tofino_id: 't2',
            tofino_name: 'tofino-2',
          }),
          booking('b3', 'u2', 4, 9, 10, {
            tofino_id: 't2',
            tofino_name: 'tofino-2',
          }),
        ]}
        currentUserId="u1"
        resourceColorClasses={{
          'tofino:t1': 'bg-primary text-white',
          'tofino:t2': 'bg-mint text-berry-950',
        }}
        showResourceNames
      />,
    )

    const blocks = screen.getAllByTestId('booking-block')
    const b1 = blocks.find((el) => el.dataset.bookingId === 'b1')!
    const b2 = blocks.find((el) => el.dataset.bookingId === 'b2')!
    const b3 = blocks.find((el) => el.dataset.bookingId === 'b3')!

    // b1 and b2 overlap 11-12 on the same day: half width, distinct columns.
    expect(b1.dataset.columns).toBe('2')
    expect(b2.dataset.columns).toBe('2')
    expect(b1.dataset.column).not.toBe(b2.dataset.column)
    expect(b1.style.width).toBe('calc(50% - 4px)')

    // b3 is alone on its day: full width.
    expect(b3.dataset.columns).toBe('1')
    expect(b3.style.width).toBe('calc(100% - 4px)')

    // Per-tofino colors and names are applied in the All view. b1 is editable
    // (a button carrying the classes); b2 is someone else's booking, rendered
    // as a wrapper with the colored span inside its tooltip.
    expect(b1.className).toContain('bg-primary')
    expect(b2.querySelector('.bg-mint')).not.toBeNull()
    expect(b2.textContent).toContain('tofino-2')
  })

  it('keeps a lane free in the All view so parallel slots stay clickable', () => {
    render(
      <WeekCalendar
        monday={monday}
        bookings={[
          booking('b1', 'u1', 2, 10, 12),
          booking('b2', 'u2', 4, 10, 12),
          booking('b3', 'u2', 4, 10, 12, {
            tofino_id: 't2',
            tofino_name: 'tofino-2',
          }),
        ]}
        currentUserId="u1"
        reserveFreeLane={2}
      />,
    )

    const blocks = screen.getAllByTestId('booking-block')
    const b1 = blocks.find((el) => el.dataset.bookingId === 'b1')!

    // Alone in its cluster, b1 would span the full column and swallow every
    // click on the slot button below it. The reserved lane halves it, exposing
    // the other half for booking the second Tofino at the same hour.
    expect(b1.dataset.columns).toBe('2')
    expect(b1.style.width).toBe('calc(50% - 4px)')
    expect(b1.style.left).toBe('calc(0% + 2px)')

    // Both Tofinos booked on day 4: no lane to reserve, the cluster fills the
    // column as before.
    const b2 = blocks.find((el) => el.dataset.bookingId === 'b2')!
    const b3 = blocks.find((el) => el.dataset.bookingId === 'b3')!
    expect(b2.dataset.columns).toBe('2')
    expect(b3.dataset.columns).toBe('2')
    expect(b2.dataset.column).not.toBe(b3.dataset.column)
  })

  it('shows short codes instead of truncated names in narrow lanes', () => {
    const { container } = render(
      <WeekCalendar
        monday={monday}
        bookings={[
          booking('b1', 'u1', 2, 10, 12),
          booking('b2', 'u2', 2, 10, 12, {
            tofino_id: 't2',
            tofino_name: 'Pennywise',
          }),
          booking('b3', 'u2', 2, 10, 12, {
            tofino_id: 't3',
            tofino_name: 'Donnie',
          }),
          booking('b4', 'u2', 5, 10, 12, {
            tofino_id: 't2',
            tofino_name: 'Pennywise',
          }),
        ]}
        currentUserId="u1"
        resourceCodes={{
          'tofino:t1': 'T1',
          'tofino:t2': 'PEN',
          'tofino:t3': 'DON',
        }}
        showResourceNames
      />,
    )

    const blocks = screen.getAllByTestId('booking-block')
    const b2 = blocks.find((el) => el.dataset.bookingId === 'b2')!
    const b4 = blocks.find((el) => el.dataset.bookingId === 'b4')!

    // Three parallel bookings: one third of a day column fits "PEN", not
    // "Pennywise" — which stays available to screen readers and the tooltip.
    expect(b2.dataset.columns).toBe('3')
    expect(b2.querySelector('[aria-hidden="true"]')?.textContent).toBe('PEN')
    expect(b2.querySelector('.sr-only')?.textContent).toBe('Pennywise')

    // Alone on its day, the block keeps the full name.
    expect(b4.dataset.columns).toBe('1')
    expect(b4.querySelector('.sr-only')).toBeNull()
    expect(b4.textContent).toContain('Pennywise')

    // Three parallel bookings still fit the fixed floor width — the calendar
    // must not resize (or need to scroll) until a fourth lane shows up.
    const grid = container.querySelector<HTMLElement>('.grid')!
    expect(grid.style.gridTemplateColumns).toContain('minmax(6.9rem, 1fr)')
  })

  it('only widens the day columns once a fourth booking overlaps', () => {
    const { container } = render(
      <WeekCalendar
        monday={monday}
        bookings={[
          booking('b1', 'u1', 2, 10, 12),
          booking('b2', 'u2', 2, 10, 12, {
            tofino_id: 't2',
            tofino_name: 'Pennywise',
          }),
          booking('b3', 'u2', 2, 10, 12, {
            tofino_id: 't3',
            tofino_name: 'Donnie',
          }),
          booking('b4', 'u2', 2, 10, 12, {
            tofino_id: 't4',
            tofino_name: 'Carrie',
          }),
        ]}
        currentUserId="u1"
        showResourceNames
      />,
    )

    // Four real parallel bookings: only now does the calendar need the extra
    // width (and, on narrower screens, horizontal scrolling) to stay legible.
    const grid = container.querySelector<HTMLElement>('.grid')!
    expect(grid.style.gridTemplateColumns).toContain('minmax(11rem, 1fr)')
  })

  it('splits a booking that crosses midnight across two day columns', () => {
    render(
      <WeekCalendar
        monday={monday}
        bookings={[booking('b1', 'u1', 1, 23, 25)]} // Tue 23:00 - Wed 01:00
        currentUserId="u1"
      />,
    )

    const blocks = screen.getAllByTestId('booking-block')
    expect(blocks).toHaveLength(2)
    const [first, second] = blocks.sort((a, b) =>
      Number(a.dataset.day) - Number(b.dataset.day),
    )
    expect(first.dataset.day).toBe('1')
    expect(first.style.top).toBe('calc(2px + 63.25rem)')
    expect(first.style.height).toBe('calc(2.75rem - 4px)')
    expect(second.dataset.day).toBe('2')
    expect(second.style.top).toBe('calc(2px + 0rem)')
    expect(second.style.height).toBe('calc(2.75rem - 4px)')
  })

  it('lets the owner click their booking, but not others', async () => {
    const user = userEvent.setup()
    const onBookingClick = vi.fn()
    render(
      <WeekCalendar
        monday={monday}
        bookings={[
          booking('mine', 'u1', 1, 10, 11),
          booking('theirs', 'u2', 2, 10, 11),
        ]}
        currentUserId="u1"
        onBookingClick={onBookingClick}
      />,
    )

    const blocks = screen.getAllByTestId('booking-block')
    const mine = blocks.find((el) => el.dataset.bookingId === 'mine')!
    const theirs = blocks.find((el) => el.dataset.bookingId === 'theirs')!

    expect(mine.tagName).toBe('BUTTON')
    expect(theirs.tagName).not.toBe('BUTTON')

    await user.click(mine)
    expect(onBookingClick).toHaveBeenCalledTimes(1)
    expect(onBookingClick.mock.calls[0][0].id).toBe('mine')
  })

  it('admins can click any booking', () => {
    render(
      <WeekCalendar
        monday={monday}
        bookings={[booking('theirs', 'u2', 2, 10, 11)]}
        currentUserId="u1"
        isAdmin
      />,
    )
    expect(screen.getByTestId('booking-block').tagName).toBe('BUTTON')
  })

  it('clicking an empty slot reports its local start Date', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(2026, 6, 20, 0))
      const onSlotClick = vi.fn()
      const { unmount } = render(
        <WeekCalendar
          monday={monday}
          bookings={[]}
          currentUserId="u1"
          onSlotClick={onSlotClick}
        />,
      )

      fireEvent.click(screen.getByTestId('slot-4-8')) // Friday 08:00
      expect(onSlotClick).toHaveBeenCalledTimes(1)
      const start: Date = onSlotClick.mock.calls[0][0]
      expect(start.getDay()).toBe(5)
      expect(start.getHours()).toBe(8)
      expect(Math.floor(start.getTime() / 1000)).toBe(
        slotToUnix(monday, 4, 8),
      )
      unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the current hour bookable and disables earlier hours', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(2026, 6, 22, 9, 30))
      const onSlotClick = vi.fn()
      const { unmount } = render(
        <WeekCalendar
          monday={monday}
          bookings={[]}
          currentUserId="u1"
          onSlotClick={onSlotClick}
        />,
      )

      expect(screen.getByTestId('slot-2-8')).toBeDisabled()
      expect(screen.getByTestId('slot-2-9')).toBeEnabled()
      expect(screen.getByTestId('slot-2-10')).toBeEnabled()
      expect(screen.getByTestId('slot-1-23')).toBeDisabled()
      expect(screen.getByTestId('slot-3-0')).toBeEnabled()

      fireEvent.click(screen.getByTestId('slot-2-8'))
      expect(onSlotClick).not.toHaveBeenCalled()
      unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('marks the current time in today’s column only', () => {
    vi.useFakeTimers()
    try {
      // Wed 22 Jul 2026, 09:30 — day index 2 of the rendered week.
      vi.setSystemTime(new Date(2026, 6, 22, 9, 30))
      const { unmount } = render(
        <WeekCalendar monday={monday} bookings={[]} currentUserId="u1" />,
      )

      const line = screen.getByTestId('current-time-line')
      expect(screen.getByTestId('day-column-2')).toContainElement(line)
      // 09:30 = 9.5 hour rows of 2.75rem each.
      expect(line.style.top).toBe('26.125rem')
      expect(screen.getByTestId('current-time-label').textContent).toBe('09:30')
      unmount()

      // Another week shows no line at all.
      render(
        <WeekCalendar
          monday={new Date(2026, 7, 3)}
          bookings={[]}
          currentUserId="u1"
        />,
      )
      expect(screen.queryByTestId('current-time-line')).toBeNull()
      expect(screen.queryByTestId('current-time-label')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders 7 day columns with 24 slots each', () => {
    render(
      <WeekCalendar monday={monday} bookings={[]} currentUserId="u1" />,
    )
    for (let day = 0; day < 7; day += 1) {
      expect(screen.getByTestId(`day-column-${day}`)).toBeInTheDocument()
    }
    expect(screen.getByTestId('slot-0-0')).toBeInTheDocument()
    expect(screen.getByTestId('slot-6-23')).toBeInTheDocument()
  })
})
