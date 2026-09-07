import { describe, expect, it } from 'vitest'
import { describeHardware, formatSpeed } from './format'

describe('formatSpeed (input in Gbit/s)', () => {
  it('renders whole speeds without decimals', () => {
    expect(formatSpeed(1)).toBe('1 Gbit/s')
    expect(formatSpeed(10)).toBe('10 Gbit/s')
    expect(formatSpeed(25)).toBe('25 Gbit/s')
    expect(formatSpeed(40)).toBe('40 Gbit/s')
    expect(formatSpeed(100)).toBe('100 Gbit/s')
    expect(formatSpeed(400)).toBe('400 Gbit/s')
  })

  it('keeps fractional speeds, trimming trailing zeros', () => {
    expect(formatSpeed(2.5)).toBe('2.5 Gbit/s')
    expect(formatSpeed(2.5000001)).toBe('2.5 Gbit/s')
    expect(formatSpeed(0.1)).toBe('0.1 Gbit/s')
  })
})

describe('describeHardware', () => {
  const empty = {
    cpu_model: '',
    cpu_sockets: null,
    cpu_cores: null,
    cpu_threads: null,
    cpu_mhz: null,
    memory_gb: null,
  }

  it('summarises a documented server', () => {
    expect(
      describeHardware({
        cpu_model: 'AMD EPYC 7443P 24-Core Processor',
        cpu_sockets: 2,
        cpu_cores: 48,
        cpu_threads: 96,
        cpu_mhz: 4035,
        memory_gb: 503.6,
      }),
    ).toBe('AMD EPYC 7443P 24-Core Processor · 2× 48 cores / 96 threads · 4.0 GHz · 504 GB RAM')
  })

  it('drops the socket multiplier on single-socket hosts', () => {
    expect(
      describeHardware({ ...empty, cpu_sockets: 1, cpu_cores: 8, cpu_threads: 16 }),
    ).toBe('8 cores / 16 threads')
  })

  it('is empty when nothing is documented', () => {
    expect(describeHardware(empty)).toBe('')
  })
})
