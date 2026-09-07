import { describe, expect, it } from 'vitest'
import { faceplateGroupsFor } from './faceplateLayouts'

describe('management faceplate hardware groups', () => {
  it('keeps the modeled physical cage blocks separate', () => {
    const hp = faceplateGroupsFor('hp-1', 'HP 2920-24G')
    expect(hp).toHaveLength(2)
    expect(hp?.[0].flat()).toEqual([
      '1',
      '3',
      '5',
      '7',
      '9',
      '11',
      '2',
      '4',
      '6',
      '8',
      '10',
      '12',
    ])
    expect(faceplateGroupsFor('ubnt', 'Ubiquiti ES-16-XG')).toHaveLength(2)
    expect(faceplateGroupsFor('mikrotik-1', 'CRS312')).toHaveLength(4)
    expect(faceplateGroupsFor('unknown', 'custom')).toBeNull()
  })
})
