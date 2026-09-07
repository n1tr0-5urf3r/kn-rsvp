import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { BookingView } from '../../api/types'
import { dateToUnix } from '../../lib/date'
import { MonthCalendar } from './MonthCalendar'

const month = new Date(2026, 6, 1)

const booking: BookingView = {
  id: 'server-booking',
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
  start_ts: dateToUnix(new Date(2026, 6, 21, 10)),
  end_ts: dateToUnix(new Date(2026, 6, 21, 12)),
  comment: 'DPDK test',
  created_at: 0,
}

describe('MonthCalendar', () => {
  it('renders a six-week month grid and server bookings', () => {
    render(
      <MonthCalendar
        month={month}
        bookings={[booking]}
        currentUserId="u1"
        showResourceNames
      />,
    )

    expect(screen.getByTestId('month-day-2026-06-29')).toBeInTheDocument()
    expect(screen.getByTestId('month-day-2026-08-09')).toBeInTheDocument()
    expect(screen.getByText(/Pennywise/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Edit booking on Pennywise/ }))
      .toBeInTheDocument()
  })

  it('opens a selected day in the detailed week view', async () => {
    const user = userEvent.setup()
    const onDayClick = vi.fn()
    render(
      <MonthCalendar
        month={month}
        bookings={[]}
        currentUserId="u1"
        onDayClick={onDayClick}
      />,
    )

    await user.click(
      screen.getByRole('button', {
        name: 'Open week of Tuesday 21 July 2026',
      }),
    )
    expect(onDayClick).toHaveBeenCalledTimes(1)
    expect(onDayClick.mock.calls[0][0].getDate()).toBe(21)
  })
})
