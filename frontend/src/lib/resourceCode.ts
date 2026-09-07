/**
 * Short display codes for reservable resources ("Donnie" -> "DON",
 * "tofino-1" -> "T1").
 *
 * In the combined calendar view three or four parallel bookings leave a block
 * barely wide enough for a single letter, so the full name truncates to "D…"
 * and only the color identifies the resource. Blocks then fall back to a code
 * that actually fits; the legend prints the same code next to the full name so
 * it stays decodable.
 *
 * Codes are unique within one list: candidates are tried from shortest to
 * longest and a numeric suffix ends the standoff between names that share every
 * prefix.
 */

const MIN_LENGTH = 3
const MAX_LENGTH = 5

function tokensOf(name: string): string[] {
  return name.split(/[^A-Za-z0-9]+/).filter(Boolean)
}

/** Candidate codes for one name, most desirable first. */
function candidates(name: string): string[] {
  const tokens = tokensOf(name)
  if (tokens.length === 0) {
    return ['?']
  }
  const joined = tokens.join('').toUpperCase()
  const options: string[] = []
  if (tokens.length > 1) {
    // "tofino-1" -> "T1", "KN Test Bed" -> "KTB"
    options.push(
      tokens
        .map((token) => token[0])
        .join('')
        .toUpperCase()
        .slice(0, MAX_LENGTH),
    )
    // "tofino-1" -> "TOF1"
    options.push(
      (
        tokens[0].slice(0, MIN_LENGTH) +
        tokens
          .slice(1)
          .map((token) => token[0])
          .join('')
      )
        .toUpperCase()
        .slice(0, MAX_LENGTH),
    )
  }
  for (let length = MIN_LENGTH; length <= MAX_LENGTH; length += 1) {
    if (length < joined.length) {
      options.push(joined.slice(0, length))
    }
  }
  options.push(joined)
  return options.filter((option, index) => options.indexOf(option) === index)
}

/** Unique short codes, one per input name, in input order. */
export function resourceCodes(names: readonly string[]): string[] {
  const used = new Set<string>()
  return names.map((name) => {
    const options = candidates(name)
    let code = options.find((option) => !used.has(option))
    if (code === undefined) {
      // Identical names: keep the short form and count them apart.
      let suffix = 2
      code = `${options[0]}${suffix}`
      while (used.has(code)) {
        suffix += 1
        code = `${options[0]}${suffix}`
      }
    }
    used.add(code)
    return code
  })
}

/** `{ key: code }` for a list of resources, keyed the same way as colors. */
export function resourceCodeMap(
  resources: readonly { key: string; name: string }[],
): Record<string, string> {
  const codes = resourceCodes(resources.map((resource) => resource.name))
  return Object.fromEntries(
    resources.map((resource, index) => [resource.key, codes[index]]),
  )
}
