/**
 * Stable per-tofino accent colors for the All-Tofinos calendar view,
 * cycled from the theme accents by tofino index (order of the tofino list).
 * Solid mid-tone fills with fixed text colors read well in light and dark.
 */

export type TofinoAccent = {
  /** legend chip dot */
  dot: string
  /** calendar block fill + text */
  block: string
}

export const tofinoAccents: TofinoAccent[] = [
  { dot: 'bg-primary', block: 'bg-primary text-white' },
  { dot: 'bg-mint', block: 'bg-mint text-berry-950' },
  { dot: 'bg-sun', block: 'bg-sun text-berry-950' },
  { dot: 'bg-sky', block: 'bg-sky text-berry-950' },
  { dot: 'bg-blush', block: 'bg-blush text-berry-950' },
]

export function tofinoAccent(index: number): TofinoAccent {
  return tofinoAccents[index % tofinoAccents.length]
}
