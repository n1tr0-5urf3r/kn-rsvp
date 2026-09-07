import { format } from 'date-fns'
import { unixToDate } from './date'

export function formatDateTime(ts: number): string {
  return format(unixToDate(ts), 'EEE dd MMM yyyy, HH:mm')
}

export function formatDate(ts: number): string {
  return format(unixToDate(ts), 'dd MMM yyyy')
}

export function formatTime(ts: number): string {
  return format(unixToDate(ts), 'HH:mm')
}

/** "Mon 23 Mar, 10:00 – 12:00" or with full end date when it crosses days. */
export function formatBookingRange(startTs: number, endTs: number): string {
  const start = unixToDate(startTs)
  const end = unixToDate(endTs)
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate()
  if (sameDay) {
    return `${format(start, 'EEE dd MMM yyyy, HH:mm')} – ${format(end, 'HH:mm')}`
  }
  return `${format(start, 'EEE dd MMM, HH:mm')} – ${format(end, 'EEE dd MMM, HH:mm')}`
}

/**
 * One-line CPU/memory summary of a server, e.g.
 * "AMD EPYC 7443P · 2× 24 cores / 96 threads · 3.7 GHz · 512 GB".
 * Empty when nothing is documented.
 */
export function describeHardware(server: {
  cpu_model: string
  cpu_sockets: number | null
  cpu_cores: number | null
  cpu_threads: number | null
  cpu_mhz: number | null
  memory_gb: number | null
}): string {
  const parts: string[] = []
  if (server.cpu_model) {
    parts.push(server.cpu_model)
  }
  if (server.cpu_cores) {
    const sockets = server.cpu_sockets && server.cpu_sockets > 1 ? `${server.cpu_sockets}× ` : ''
    const threads = server.cpu_threads ? ` / ${server.cpu_threads} threads` : ''
    parts.push(`${sockets}${server.cpu_cores} cores${threads}`)
  }
  if (server.cpu_mhz) {
    parts.push(`${(server.cpu_mhz / 1000).toFixed(1)} GHz`)
  }
  if (server.memory_gb) {
    parts.push(`${Math.round(server.memory_gb)} GB RAM`)
  }
  return parts.join(' · ')
}

/** Input is Gbit/s (may be fractional). "100 Gbit/s", "2.5 Gbit/s". */
export function formatSpeed(speedGbps: number): string {
  const text = Number.isInteger(speedGbps)
    ? String(speedGbps)
    : String(parseFloat(speedGbps.toFixed(2)))
  return `${text} Gbit/s`
}
