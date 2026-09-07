/**
 * Hand-written API types matching the backend's public OpenAPI contract.
 *
 * A later pass may replace this module with types generated from
 * `fixtures/openapi.json` (`npm run generate:api` -> `src/api/schema.ts`).
 * To keep that swap trivial, this file is the single source of API types:
 * everything else imports from `./types` (via `./client` re-exports).
 *
 * Timestamps are unix seconds (UTC). Booking starts are hour-aligned, ends are
 * minute-aligned and end exclusive.
 */

export type CurrentUser = {
  id: string
  username: string
  display_name: string
  email: string | null
  is_admin: boolean
}

export type MeResponse = {
  user: CurrentUser | null
}

export type PublicConfigResponse = {
  app_name: string
  app_subtitle: string
  app_tagline: string
  logo_url: string | null
  favicon_url: string
  repository_url: string
  topology_switch_order: string[]
  topology_uplink_labels: string[]
  topology_preferred_uplink: string | null
  topology_central_node: string | null
}

/** Entry from GET /admin/users (claim-assign dropdown). */
export type AdminUserView = {
  id: string
  username: string
  display_name: string
  email: string | null
  is_admin: boolean
}

export type AdminUsersResponse = { users: AdminUserView[] }

/**
 * What is documented about a NIC (0..1 per NIC), admin-assigned. The owner is
 * optional: a cabled NIC nobody holds still carries the cable label and
 * comment shared with the other end of the link. Use `claimOwner()` rather
 * than testing for the row itself.
 */
export type NicClaimView = {
  /** Null when the assignee has no Authentik-backed RSVP account. */
  user_id: string | null
  /** Empty when the row only documents the cable. */
  user_display_name: string
  connected_to: string | null
  /** Shared with the other endpoint of the link. */
  cable_label: string | null
  /** Shared with the other endpoint of the link. */
  comment: string | null
  updated_at: number
}

export type NicView = {
  id: string
  server_id: string
  name: string
  pci_address: string
  nic_type: string
  /** Link speed in Gbit/s; may be fractional (e.g. 2.5). */
  speed_gbps: number
  /** Kernel interface name, e.g. "ens65f0np0". */
  ifname: string
  mac: string
  /** NUMA node; null when unknown or the NIC has no affinity. */
  numa_node: number | null
  /** Physical function or SR-IOV virtual function. */
  kind: NicKind
  /**
   * Who uses this NIC: the Proxmox VM it is passed through to ("281
   * (kuppler-2)") or a role such as "Management". A property of this one NIC —
   * never shared with the other end of a link.
   */
  usage: string
  /** Tofino port cabled to this NIC, derived from the port map. */
  peer_port_id: string | null
  peer_port_tofino_id: string | null
  /** Display label such as "Donnie 3/0". */
  peer_port_label: string | null
  /** Server NIC cabled directly to this NIC. */
  peer_nic_id: string | null
  peer_nic_server_id: string | null
  /** Display label such as "Pennywise 65.1". */
  peer_nic_label: string | null
  /** Management-switch port cabled to this NIC (read-only mirror). */
  peer_mgmt_port_id: string | null
  peer_mgmt_switch_id: string | null
  /** Display label such as "MgmtSwitch1 12". */
  peer_mgmt_port_label: string | null
  sort_order: number
  claim: NicClaimView | null
}

export type NicKind = 'pf' | 'vf'

export type ServerWithNics = {
  id: string
  name: string
  description: string | null
  /** Empty when the hardware has not been documented. */
  cpu_model: string
  cpu_sockets: number | null
  /** Physical cores across all sockets. */
  cpu_cores: number | null
  /** Logical CPUs. */
  cpu_threads: number | null
  /** Maximum clock in MHz. */
  cpu_mhz: number | null
  /** Usable RAM in GiB, as the kernel reports it. */
  memory_gb: number | null
  /** Whole-server hourly reservations are enabled. */
  reservable: boolean
  sort_order: number
  nics: NicView[]
}

export type ServersResponse = { servers: ServerWithNics[] }

export type TofinoVersion = 1 | 2

export type Tofino = {
  id: string
  name: string
  version: TofinoVersion
  notes: string | null
  active: boolean
  /** Management-switch port this Tofino's management port is cabled to;
   * "MgmtSwitch1 12" or null. Read-only mirror, edited from the switch side. */
  mgmt_peer_label: string | null
}

export type TofinosResponse = { tofinos: Tofino[] }

/**
 * A documented front-panel port. `fp_port`/`dev_port`/`pipe` are hardware
 * facts (read-only in the port view); speed, cable label, peer and comment are
 * the documentation admins maintain.
 */
export type TofinoPort = {
  id: string
  tofino_id: string
  tofino_name: string
  /** Front-panel port, e.g. "1/0". */
  fp_port: string
  dev_port: number
  /** Pipe/lane, e.g. "2/4". */
  pipe: string
  /** Link speed in Gbit/s; 0 means "not documented". */
  speed_gbps: number
  cable_label: string
  peer_port_id: string | null
  peer_port_tofino_id: string | null
  peer_nic_id: string | null
  peer_nic_server_id: string | null
  peer_text: string
  /** "Donnie 3/0", "Pennywise 65.1" or the free text; empty when unplugged. */
  peer_label: string
  comment: string
  sort_order: number
  updated_by_display_name: string | null
  updated_at: number
}

export type TofinoPortsResponse = { ports: TofinoPort[] }

/** What a port is plugged into. `port` links are mirrored onto the other end. */
export type PortPeerInput =
  | { kind: 'none' }
  | { kind: 'port'; port_id: string }
  | { kind: 'nic'; nic_id: string }
  | { kind: 'text'; text: string }

export type CreateTofinoPortRequest = {
  /** "1/0", "P1" and "1" all mean front-panel port 1. */
  fp_port: string
  dev_port: number
  pipe?: string
  speed_gbps?: number
  cable_label?: string
  comment?: string
  sort_order?: number
}

/** PATCH — `peer` replaces the whole "plugged into" side when present. */
export type UpdateTofinoPortRequest = Partial<CreateTofinoPortRequest> & {
  peer?: PortPeerInput
}

/** POST /admin/tofinos/{id}/ports/import — a table or a whole tofino.md. */
export type ImportTofinoPortsRequest = { markdown: string }

export type ImportTofinoPortsResponse = {
  created: number
  updated: number
  /** Peers that matched no port or NIC and were kept as free text. */
  unresolved: string[]
}

export type BookingView = {
  id: string
  resource_type: 'tofino' | 'server'
  resource_id: string
  resource_name: string
  tofino_id: string | null
  tofino_name: string | null
  tofino_version: TofinoVersion | null
  server_id: string | null
  server_name: string | null
  user_id: string
  user_display_name: string
  start_ts: number
  end_ts: number
  comment: string | null
  created_at: number
}

export type BookingsResponse = { bookings: BookingView[] }

export type CalDavCalendarView = {
  id: string
  name: string
  caldav_url: string
  username: string
  /** The app password is never returned by the API. */
  has_password: boolean
  enabled: boolean
}

export type CalDavCalendarsResponse = { calendars: CalDavCalendarView[] }

export type CalDavQueueAction = 'upsert' | 'delete'
export type CalDavQueueStatus = 'pending' | 'synced' | 'error'

export type QueueItemView = {
  id: string
  calendar_id: string
  ics_uid: string
  action: CalDavQueueAction
  status: CalDavQueueStatus
  attempts: number
  last_error: string | null
  last_attempt_at: number | null
  updated_at: number
}

export type CalDavStatusResponse = {
  pending: number
  error: number
  synced: number
  last_run_at: number | null
  items: QueueItemView[]
}

export type CalDavTestResponse = { ok: boolean; message: string }

/** GET/PUT /admin/settings — flat key/value map. */
export type SettingsMap = Record<string, string>
export type SettingsResponse = { settings: SettingsMap }

export type HealthResponse = { status: string; version: string }

export type ApiErrorBody = { error: string }

/* ------------------------------- Requests ------------------------------- */

export type CreateBookingRequest = {
  /** Exactly one resource id is required. */
  tofino_id?: string
  server_id?: string
  start_ts: number
  end_ts: number
  comment?: string
}

export type UpdateBookingRequest = {
  start_ts?: number
  end_ts?: number
  comment?: string
}

export type CreateServerRequest = {
  name: string
  description?: string
  sort_order?: number
  cpu_model?: string
  /** Zero or negative clears a hardware number. */
  cpu_sockets?: number
  cpu_cores?: number
  cpu_threads?: number
  cpu_mhz?: number
  memory_gb?: number
  reservable?: boolean
}

export type UpdateServerRequest = Partial<CreateServerRequest>

export type CreateNicRequest = {
  name: string
  pci_address: string
  nic_type: string
  /** Link speed in Gbit/s; may be fractional (e.g. 2.5). */
  speed_gbps: number
  ifname?: string
  mac?: string
  /** Negative means "no affinity" and is stored as null. */
  numa_node?: number
  kind?: NicKind
  usage?: string
  sort_order?: number
}

export type UpdateNicRequest = Partial<CreateNicRequest>

export type NicPeerInput =
  | { kind: 'none' }
  | { kind: 'port'; port_id: string }
  /** A management-switch port (`management_switch_ports.id`). */
  | { kind: 'mgmt'; port_id: string }
  | { kind: 'nic'; nic_id: string }
  | { kind: 'text'; text: string }

/** PUT /admin/nics/{id}/claim — upsert. */
export type PutNicClaimRequest = {
  /** Use a mapped user or a free-form assignee name. */
  user_id?: string
  assignee_name?: string
  /** Structured connection update; omit to preserve the current link. */
  peer?: NicPeerInput
  /** Legacy free-text connection. Prefer `peer`. */
  connected_to?: string
  cable_label?: string
  comment?: string
}

export type CreateTofinoRequest = {
  name: string
  version: TofinoVersion
  notes?: string
  active?: boolean
}

export type UpdateTofinoRequest = Partial<CreateTofinoRequest>

export type CreateCalDavCalendarRequest = {
  name: string
  caldav_url: string
  username: string
  app_password: string
  enabled?: boolean
}

/** PATCH — empty/omitted app_password keeps the stored one. */
export type UpdateCalDavCalendarRequest = Partial<CreateCalDavCalendarRequest>

/** Flat map; the client wraps it as `{ settings: map }` on the wire. */
export type UpdateSettingsRequest = SettingsMap

/* --------------------------- Management switches -------------------------- */

/** Admin-only (knstaff/knadmin). Infrastructure / management switch. */
export type ManagementSwitch = {
  id: string
  name: string
  /** Management IP or hostname; empty when not documented. */
  mgmt_ip: string
  /** Vendor/model, e.g. "Aruba 6300M"; empty when not documented. */
  model: string
  notes: string
  active: boolean
  sort_order: number
  created_at: number
  updated_at: number
}

export type ManagementSwitchesResponse = { switches: ManagementSwitch[] }

export type CreateManagementSwitchRequest = {
  name: string
  mgmt_ip?: string
  model?: string
  notes?: string
  active?: boolean
  sort_order?: number
  /** Create-only: auto-generate this many front-panel ports named "1".."N". */
  num_ports?: number
}

export type UpdateManagementSwitchRequest = Partial<
  Omit<CreateManagementSwitchRequest, 'num_ports'>
>

/** Global VLAN database entry. */
export type Vlan = {
  id: string
  /** 802.1Q VLAN number, 1..4094. */
  vlan_id: number
  name: string
  purpose: string
  created_at: number
  updated_at: number
}

export type VlansResponse = { vlans: Vlan[] }

export type CreateVlanRequest = {
  vlan_id: number
  name?: string
  purpose?: string
}

export type UpdateVlanRequest = Partial<CreateVlanRequest>

/** One VLAN membership on a management-switch port. */
export type PortVlan = {
  /** 802.1Q VLAN number. */
  vlan_id: number
  /** Row id in the global VLAN database. */
  vlan_db_id: string
  name: string
  purpose: string
  /** true = tagged (trunk), false = untagged (native/access). */
  tagged: boolean
}

export type ManagementPort = {
  id: string
  switch_id: string
  switch_name: string
  /** Port label, e.g. "1" / "Gi0/1". */
  name: string
  ifname: string
  ifindex: number | null
  speed_gbps: number
  cable_label: string
  peer_port_id: string | null
  peer_port_switch_id: string | null
  peer_nic_id: string | null
  peer_nic_server_id: string | null
  peer_tofino_id: string | null
  /** Set when plugged into a whole server (no specific NIC), e.g. its IPMI port. */
  peer_server_id: string | null
  peer_text: string
  /** Display label of whatever this port is plugged into; empty when unplugged. */
  peer_label: string
  comment: string
  sort_order: number
  updated_by_display_name: string | null
  updated_at: number
  vlans: PortVlan[]
}

export type ManagementPortsResponse = { ports: ManagementPort[] }

/** What a management port is plugged into. `port`/`tofino` links are mirrored. */
export type ManagementPeerInput =
  | { kind: 'none' }
  | { kind: 'port'; port_id: string }
  | { kind: 'nic'; nic_id: string }
  | { kind: 'tofino'; tofino_id: string }
  | { kind: 'server'; server_id: string }
  | { kind: 'text'; text: string }

export type PortVlanInput = { vlan_id: number; tagged: boolean }

export type CreateManagementPortRequest = {
  name: string
  ifname?: string
  ifindex?: number
  speed_gbps?: number
  cable_label?: string
  comment?: string
  sort_order?: number
}

/** PATCH — `peer` and `vlans` replace their whole side when present. */
export type UpdateManagementPortRequest = Partial<CreateManagementPortRequest> & {
  peer?: ManagementPeerInput
  vlans?: PortVlanInput[]
}

export type ImportManagementSwitchRequest = {
  mgmt_ip?: string
  model?: string
  vlans?: { vlan_id: number; name?: string; purpose?: string }[]
  ports?: {
    name: string
    ifname?: string
    ifindex?: number
    speed_gbps?: number
    vlans?: PortVlanInput[]
  }[]
}

export type ImportManagementSwitchResponse = {
  vlans_created: number
  ports_created: number
  ports_updated: number
}
