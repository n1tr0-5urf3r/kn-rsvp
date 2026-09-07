import { useEffect, useState } from 'react'

/**
 * Current local time, re-rendered every `intervalMs` (default one minute) so
 * time-dependent UI — the calendar's current-time line — keeps up without the
 * caller wiring its own timer.
 */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])

  return now
}
