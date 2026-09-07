import { describe, expect, it } from 'vitest'
import { layoutOverlaps, type Interval } from './overlap'

type Named = Interval & { id: string }

const iv = (id: string, start: number, end: number): Named => ({
  id,
  start,
  end,
})

function byId(results: ReturnType<typeof layoutOverlaps<Named>>) {
  return Object.fromEntries(
    results.map((r) => [r.item.id, { column: r.column, columns: r.columns }]),
  )
}

describe('layoutOverlaps', () => {
  it('handles empty input', () => {
    expect(layoutOverlaps([])).toEqual([])
  })

  it('gives non-overlapping intervals full width', () => {
    const out = byId(layoutOverlaps([iv('a', 9, 10), iv('b', 12, 14)]))
    expect(out.a).toEqual({ column: 0, columns: 1 })
    expect(out.b).toEqual({ column: 0, columns: 1 })
  })

  it('adjacent intervals (end === start) do NOT overlap', () => {
    const out = byId(layoutOverlaps([iv('a', 9, 11), iv('b', 11, 13)]))
    expect(out.a).toEqual({ column: 0, columns: 1 })
    expect(out.b).toEqual({ column: 0, columns: 1 })
  })

  it('puts two concurrent intervals side by side', () => {
    const out = byId(layoutOverlaps([iv('a', 10, 12), iv('b', 10, 12)]))
    expect(out.a.columns).toBe(2)
    expect(out.b.columns).toBe(2)
    expect(out.a.column).not.toBe(out.b.column)
  })

  it('a chain of overlaps forms one cluster and reuses freed columns', () => {
    // a-b overlap, b-c overlap, a-c touch only (2 === 2) — transitively one
    // cluster of width 2; c reuses a's column.
    const out = byId(
      layoutOverlaps([iv('a', 0, 2), iv('b', 1, 3), iv('c', 2, 4)]),
    )
    expect(out.a).toEqual({ column: 0, columns: 2 })
    expect(out.b).toEqual({ column: 1, columns: 2 })
    expect(out.c).toEqual({ column: 0, columns: 2 })
  })

  it('three-way overlap needs three columns', () => {
    const out = byId(
      layoutOverlaps([iv('a', 9, 12), iv('b', 10, 13), iv('c', 11, 14)]),
    )
    expect(out.a).toEqual({ column: 0, columns: 3 })
    expect(out.b).toEqual({ column: 1, columns: 3 })
    expect(out.c).toEqual({ column: 2, columns: 3 })
  })

  it('separates independent clusters with their own widths', () => {
    const out = byId(
      layoutOverlaps([
        iv('a', 8, 10),
        iv('b', 9, 10), // cluster 1: a+b
        iv('c', 14, 16), // cluster 2: alone
        iv('d', 20, 22),
        iv('e', 21, 23),
        iv('f', 21, 22), // cluster 3: d+e+f
      ]),
    )
    expect(out.a.columns).toBe(2)
    expect(out.b.columns).toBe(2)
    expect(out.c).toEqual({ column: 0, columns: 1 })
    expect(out.d.columns).toBe(3)
    expect(out.e.columns).toBe(3)
    expect(out.f.columns).toBe(3)
    expect(
      new Set([out.d.column, out.e.column, out.f.column]).size,
    ).toBe(3)
  })

  it('input order does not matter', () => {
    const a = byId(layoutOverlaps([iv('a', 0, 2), iv('b', 1, 3)]))
    const b = byId(layoutOverlaps([iv('b', 1, 3), iv('a', 0, 2)]))
    expect(a).toEqual(b)
  })

  it('works on cross-midnight day segments (clipped to row ranges)', () => {
    // Booking A Tue 23:00–Wed 01:00 appears on Wednesday as [0, 1);
    // booking B Wed 00:00–02:00 as [0, 2): they share the 00 hour.
    const out = byId(layoutOverlaps([iv('a-wed', 0, 1), iv('b', 0, 2)]))
    expect(out['a-wed'].columns).toBe(2)
    expect(out.b.columns).toBe(2)
    expect(out['a-wed'].column).not.toBe(out.b.column)
    // On Tuesday A's segment [23, 24) is alone — full width.
    const tue = byId(layoutOverlaps([iv('a-tue', 23, 24)]))
    expect(tue['a-tue']).toEqual({ column: 0, columns: 1 })
  })
})
