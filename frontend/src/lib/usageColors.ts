export const UNLABELLED_USAGE = '__unlabelled__'

// Darkened/saturated from the original pastel palette: those reads fine on a
// dark card but drop under ~2:1 contrast against light/white surfaces (issue:
// "port colors hard to read in light mode"). These stay >= ~3:1 against white
// while remaining clearly legible against the near-black berry-950 dark
// surfaces too -- verified by hand against both `:root` and `.dark` tokens in
// src/index.css.
export const USAGE_COLORS = [
  '#c23b56',
  '#c9701a',
  '#a98a12',
  '#1f9463',
  '#147f8f',
  '#3164c9',
  '#7c4fd6',
  '#b23f8f',
]

/** High-contrast hardware colors derived from the original faceplate design. */
export const FACEPLATE_COMMENT_COLORS = [
  '#c2284a',
  '#1f9d76',
  '#b8860b',
  '#2f80c4',
  '#b23f5f',
  '#0e8f83',
  '#8a5a1f',
  '#5b5fc7',
  '#cf571f',
  '#647f16',
  '#087bb5',
  '#9145a8',
  '#c23b87',
  '#447e3c',
  '#76518f',
  '#a34f30',
]

/**
 * Palettes are intentionally finite, but usage/VLAN databases are not. Keep
 * assigning distinct colours after the curated entries are exhausted instead
 * of cycling back to a colour that is already visible in the same map.
 */
function overflowUsageColor(index: number): string {
  const hue = Math.round((index * 137.508 + 19) % 360)
  return `hsl(${hue} 68% 38%)`
}

export function usageKey(usage: string): string {
  return usage.trim() || UNLABELLED_USAGE
}

export function usageName(key: string): string {
  return key === UNLABELLED_USAGE ? 'Unlabelled' : key
}

export function createUsageColorMap(
  usages: Iterable<string>,
  palette: readonly string[] = USAGE_COLORS,
): Map<string, string> {
  const keys = [...new Set([...usages].map(usageKey))].sort((left, right) =>
    usageName(left).localeCompare(usageName(right), undefined, {
      sensitivity: 'base',
    }),
  )

  let colorIndex = 0
  return new Map(
    keys.map((key) => {
      if (key === UNLABELLED_USAGE) {
        return [key, '#8b8792']
      }

      const color =
        colorIndex < palette.length
          ? palette[colorIndex]
          : overflowUsageColor(colorIndex - palette.length)
      colorIndex += 1
      return [key, color]
    }),
  )
}

export function usageColor(
  colors: ReadonlyMap<string, string>,
  usage: string,
): string {
  return colors.get(usageKey(usage)) ?? '#8b8792'
}
