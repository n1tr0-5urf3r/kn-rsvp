import type { NicClaimView } from '../api/types'

/**
 * A claim row may exist purely to document the cable — a NIC that was plugged
 * in from the Tofino port editor has no owner. Returns the owner's display
 * name, or null when the row only carries cabling documentation.
 */
export function claimOwner(claim: NicClaimView | null | undefined): string | null {
  const name = claim?.user_display_name.trim() ?? ''
  return name === '' ? null : name
}
