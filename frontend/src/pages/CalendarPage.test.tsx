import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import {
  HOUR_SECONDS,
  dateToUnix,
  formatDateTimeLocal,
} from '../lib/date'
import { BookingEndFields } from './CalendarPage'

function EndFieldsHarness() {
  const startTs = dateToUnix(new Date(2026, 7, 20, 17))
  const [endValue, setEndValue] = useState(
    formatDateTimeLocal(startTs + HOUR_SECONDS),
  )
  return (
    <BookingEndFields
      startTs={startTs}
      endValue={endValue}
      onEndValueChange={setEndValue}
    />
  )
}

describe('booking end fields', () => {
  it('shows German dates and allows tomorrow within the 48-hour range', async () => {
    const user = userEvent.setup()
    render(<EndFieldsHarness />)

    await user.click(screen.getByRole('button', { name: '20.08.2026' }))

    expect(screen.getByRole('button', { name: /21\.08\.2026/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /22\.08\.2026/ })).toBeEnabled()
    expect(screen.getByText('18:00–23:59')).toBeInTheDocument()
    expect(screen.getByText('00:00–23:59')).toBeInTheDocument()
    expect(screen.getByText('00:00–17:00')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /21\.08\.2026/ }))

    expect(screen.getByRole('button', { name: '21.08.2026' })).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'End hour' })).toHaveValue('18')
    const minutes = screen.getByRole('textbox', { name: 'End minutes' })
    expect(minutes).toHaveValue('00')

    await user.clear(minutes)
    await user.type(minutes, '30')
    await user.tab()

    expect(minutes).toHaveValue('30')
    expect(
      screen.getByRole('combobox', { name: 'Duration' }),
    ).toHaveValue('')
  })

  it('shows the precise custom duration in the shortcut selector', async () => {
    const user = userEvent.setup()
    render(<EndFieldsHarness />)

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'End hour' }),
      '23',
    )
    const minutes = screen.getByRole('textbox', { name: 'End minutes' })
    await user.clear(minutes)
    await user.type(minutes, '40')
    await user.tab()

    expect(
      screen.getByRole('combobox', { name: 'Duration' }),
    ).toHaveDisplayValue('6 hours 40 minutes')
  })
})
