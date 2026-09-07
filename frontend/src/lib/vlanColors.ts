import type { ManagementPort, PortVlan } from '../api/types'

/** The untagged (native/access) VLAN of a port, if any. */
export function untaggedVlan(port: ManagementPort): PortVlan | undefined {
  return port.vlans.find((vlan) => !vlan.tagged)
}

/**
 * The grouping label used to colour a port: its access VLAN when it has one,
 * otherwise empty (neutral). Tagged-only ports have no access VLAN, so they
 * must not borrow a VLAN colour from the shared palette.
 */
export function portVlanKey(port: ManagementPort): string {
  const untagged = untaggedVlan(port)
  if (untagged) {
    return `VLAN ${untagged.vlan_id}`
  }
  return ''
}

/** Human label for one membership, e.g. "10 untagged" / "20 tagged". */
export function vlanChipLabel(vlan: PortVlan): string {
  return `${vlan.vlan_id} ${vlan.tagged ? 'tagged' : 'untagged'}`
}

/**
 * Stable identity for one VLAN across every port that carries it, regardless
 * of whether a given port has it tagged or untagged -- used so filtering by a
 * VLAN finds every member port, not just the ones where it happens to be the
 * access VLAN.
 */
export function vlanFilterKey(vlanId: number): string {
  return `vlan:${vlanId}`
}

/** "{name} ({id})" when the VLAN has a name, else just the numeral. */
export function vlanDisplayLabel(vlanId: number, name: string): string {
  const trimmed = name.trim()
  return trimmed ? `${trimmed} (${vlanId})` : `${vlanId}`
}
