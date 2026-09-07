/**
 * Classic calendar cluster layout: given intervals within one day column,
 * group transitively-overlapping intervals into clusters and assign each a
 * column index; every member of a cluster shares the same column count, so a
 * block renders at width 1/columns, offset by its column.
 *
 * Intervals are half-open [start, end): touching intervals (a.end === b.start)
 * do NOT overlap.
 */

export type Interval = { start: number; end: number }

export type LaidOutInterval<T extends Interval> = {
  item: T
  /** 0-based column inside the cluster */
  column: number
  /** total columns in the cluster (shared by all cluster members) */
  columns: number
}

export function layoutOverlaps<T extends Interval>(
  items: readonly T[],
): LaidOutInterval<T>[] {
  const sorted = [...items].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  )
  const results: LaidOutInterval<T>[] = []

  let cluster: LaidOutInterval<T>[] = []
  let columnEnds: number[] = []
  let clusterEnd = -Infinity

  const closeCluster = () => {
    for (const entry of cluster) {
      entry.columns = columnEnds.length
    }
    cluster = []
    columnEnds = []
    clusterEnd = -Infinity
  }

  for (const item of sorted) {
    // A new cluster starts when this interval begins at or after everything
    // seen so far has ended (end-exclusive, so >= means "no overlap").
    if (cluster.length > 0 && item.start >= clusterEnd) {
      closeCluster()
    }
    // First column whose last interval has ended is reusable.
    let column = columnEnds.findIndex((end) => end <= item.start)
    if (column === -1) {
      column = columnEnds.length
      columnEnds.push(item.end)
    } else {
      columnEnds[column] = item.end
    }
    const entry: LaidOutInterval<T> = { item, column, columns: 0 }
    cluster.push(entry)
    results.push(entry)
    clusterEnd = Math.max(clusterEnd, item.end)
  }
  closeCluster()

  return results
}
