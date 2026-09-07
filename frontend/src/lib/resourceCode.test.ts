import { describe, expect, it } from 'vitest'
import { resourceCodeMap, resourceCodes } from './resourceCode'

describe('resourceCodes', () => {
  it('abbreviates single-word names to three letters', () => {
    expect(resourceCodes(['Donnie', 'Frank', 'Pennywise'])).toEqual([
      'DON',
      'FRA',
      'PEN',
    ])
  })

  it('uses initials for multi-word names', () => {
    expect(resourceCodes(['tofino-1', 'tofino-2', 'KN Test Bed'])).toEqual([
      'T1',
      'T2',
      'KTB',
    ])
  })

  it('keeps names shorter than the code length intact', () => {
    expect(resourceCodes(['KN'])).toEqual(['KN'])
  })

  it('extends the code until it is unique', () => {
    expect(resourceCodes(['Penny', 'Pennywise'])).toEqual(['PEN', 'PENN'])
  })

  it('counts names apart once every prefix is taken', () => {
    expect(
      resourceCodes(['Donnie', 'Donnie', 'Donnie', 'Donnie', 'Donnie']),
    ).toEqual(['DON', 'DONN', 'DONNI', 'DONNIE', 'DON2'])
  })

  it('survives names without letters or digits', () => {
    expect(resourceCodes(['—'])).toEqual(['?'])
  })
})

describe('resourceCodeMap', () => {
  it('keys the codes like the calendar color map', () => {
    expect(
      resourceCodeMap([
        { key: 'tofino:1', name: 'Donnie' },
        { key: 'server:2', name: 'Pennywise' },
      ]),
    ).toEqual({ 'tofino:1': 'DON', 'server:2': 'PEN' })
  })
})
