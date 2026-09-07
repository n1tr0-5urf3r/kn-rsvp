import { describe, expect, it } from 'vitest'
import {
  ENDPOINT_RAIL_GAP,
  ENDPOINT_RAIL_INSET,
  endpointRailCenter,
} from './managementTopologyLayout'

describe('endpointRailCenter', () => {
  it('matches the centre of grid cells including their rendered gaps', () => {
    const width = 220
    const count = 4
    const cellWidth =
      (width - ENDPOINT_RAIL_INSET * 2 - ENDPOINT_RAIL_GAP * (count - 1)) / count

    expect(endpointRailCenter(width, count, 0)).toBe(
      ENDPOINT_RAIL_INSET + cellWidth / 2,
    )
    expect(endpointRailCenter(width, count, 3)).toBe(
      width - ENDPOINT_RAIL_INSET - cellWidth / 2,
    )
  })

  it('falls back to the node centre for an empty rail', () => {
    expect(endpointRailCenter(196, 0, 0)).toBe(98)
  })
})
