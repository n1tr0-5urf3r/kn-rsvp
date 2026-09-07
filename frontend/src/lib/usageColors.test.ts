import { describe, expect, it } from 'vitest'
import {
  createUsageColorMap,
  UNLABELLED_USAGE,
} from './usageColors'

describe('createUsageColorMap', () => {
  it('does not repeat colours when there are more usages than palette entries', () => {
    const colors = createUsageColorMap(
      ['WSI', 'TSN Management', 'Storage', 'VM', 'Guest'],
      ['#112233', '#445566'],
    )

    expect(new Set(colors.values()).size).toBe(colors.size)
  })

  it('keeps unlabelled usage neutral without consuming a palette colour', () => {
    const colors = createUsageColorMap(['', 'WSI'], ['#112233'])

    expect(colors.get(UNLABELLED_USAGE)).toBe('#8b8792')
    expect(colors.get('WSI')).toBe('#112233')
  })
})
