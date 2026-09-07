/** Keep SVG link ends on the exact centre of their rendered endpoint cells. */
export const NODE_BORDER_WIDTH = 2
export const ENDPOINT_RAIL_INSET = 12 + NODE_BORDER_WIDTH
export const ENDPOINT_RAIL_GAP = 4

export function endpointRailCenter(
  width: number,
  itemCount: number,
  itemIndex: number,
): number {
  if (itemCount <= 0) {
    return width / 2
  }

  const safeIndex = Math.min(Math.max(itemIndex, 0), itemCount - 1)
  const availableWidth =
    width - ENDPOINT_RAIL_INSET * 2 - ENDPOINT_RAIL_GAP * (itemCount - 1)
  const cellWidth = availableWidth / itemCount

  return (
    ENDPOINT_RAIL_INSET +
    safeIndex * (cellWidth + ENDPOINT_RAIL_GAP) +
    cellWidth / 2
  )
}
