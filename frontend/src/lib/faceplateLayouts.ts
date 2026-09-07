/**
 * Explicit per-model front-panel layouts for management switches.
 *
 * Each layout is a matrix of port labels, rows top→bottom, columns left→right.
 * A `null` cell is an empty gap (spacer) that keeps the physical alignment of a
 * real front panel. A non-null label is matched against `port.name` — the
 * canonical front-panel labels ("1".."24", "1-T"/"1-F", …). Labels with no
 * matching port render as an empty placeholder cage; ports whose name is not in
 * the matrix are surfaced separately as "extra" ports.
 */
export type FaceplateLayout = (string | null)[][]
export type FaceplateGroupLayout = FaceplateLayout[]

/** HP 2920 (name "hp-…"): 2 rows × 13 cols, col index 6 is a gap. */
export const HP_LAYOUT: FaceplateLayout = [
  ['1', '3', '5', '7', '9', '11', null, '13', '15', '17', '19', '21', '23'],
  ['2', '4', '6', '8', '10', '12', null, '14', '16', '18', '20', '22', '24'],
]

/** Ubiquiti EdgeSwitch ES-16-XG: 1-12 paired, gap, then SFP 13-16 bottom row. */
export const UBNT_LAYOUT: FaceplateLayout = [
  ['1', '3', '5', '7', '9', '11', null, null, null, null, null],
  ['2', '4', '6', '8', '10', '12', null, '13', '14', '15', '16'],
]

/**
 * MikroTik CRS312-4C+8XG: RJ45 "1".."8", plus 4 combo ports. Each combo port
 * is one SNMP interface ("comboN") but two physical jacks — an RJ45 inline
 * with the "1".."8" row and an SFP+ cage in the stacked 2×2 block above/right
 * (2-F/4-F over 1-F/3-F) — so both faceplate positions carry the same port
 * name and render as two cages for that one logical port.
 */
export const MIKROTIK_LAYOUT: FaceplateLayout = [
  // prettier-ignore
  [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, 'combo2', 'combo4'],
  ['1', '2', '3', '4', null, '5', '6', '7', '8', null, 'combo1', 'combo2', 'combo3', 'combo4', null, 'combo1', 'combo3'],
]

/** Physical cage blocks, kept separate so the faceplate can render the darker
 * hardware groupings visible on the real switch front panels. */
export const HP_GROUPS: FaceplateGroupLayout = [
  [
    ['1', '3', '5', '7', '9', '11'],
    ['2', '4', '6', '8', '10', '12'],
  ],
  [
    ['13', '15', '17', '19', '21', '23'],
    ['14', '16', '18', '20', '22', '24'],
  ],
]

export const UBNT_GROUPS: FaceplateGroupLayout = [
  [
    ['1', '3', '5', '7', '9', '11'],
    ['2', '4', '6', '8', '10', '12'],
  ],
  [['13', '14', '15', '16']],
]

export const MIKROTIK_GROUPS: FaceplateGroupLayout = [
  [['1', '2', '3', '4']],
  [['5', '6', '7', '8']],
  [['combo1', 'combo2', 'combo3', 'combo4']],
  [
    ['combo2', 'combo4'],
    ['combo1', 'combo3'],
  ],
]

/**
 * Pick the layout for a switch by its name/model, or `null` for an unknown
 * switch (the faceplate then falls back to a generic two-row auto grid).
 */
export function faceplateLayoutFor(
  switchName: string,
  model: string,
): FaceplateLayout | null {
  const name = switchName.trim().toLowerCase()
  const m = model.trim().toLowerCase()
  if (name.startsWith('hp-') || m.includes('2920')) {
    return HP_LAYOUT
  }
  if (
    name.startsWith('ubnt') ||
    m.includes('edgeswitch') ||
    m.includes('ubiquit')
  ) {
    return UBNT_LAYOUT
  }
  if (name.startsWith('mikrotik')) {
    return MIKROTIK_LAYOUT
  }
  return null
}

export function faceplateGroupsFor(
  switchName: string,
  model: string,
): FaceplateGroupLayout | null {
  const layout = faceplateLayoutFor(switchName, model)
  if (layout === HP_LAYOUT) {
    return HP_GROUPS
  }
  if (layout === UBNT_LAYOUT) {
    return UBNT_GROUPS
  }
  if (layout === MIKROTIK_LAYOUT) {
    return MIKROTIK_GROUPS
  }
  return null
}
