-- Public schema baseline.
--
-- This migration is intentionally idempotent: fresh installations create the
-- complete schema without deployment-specific inventory, while installations
-- upgraded from the private migration chain keep their existing data.

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    oidc_sub TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL,
    display_name TEXT NOT NULL,
    email TEXT,
    is_admin INTEGER NOT NULL DEFAULT 0,
    groups_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
    id_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    cpu_model TEXT NOT NULL DEFAULT '',
    cpu_sockets INTEGER,
    cpu_cores INTEGER,
    cpu_threads INTEGER,
    cpu_mhz REAL,
    memory_gb REAL,
    reservable INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS nics (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    pci_address TEXT NOT NULL,
    nic_type TEXT NOT NULL,
    speed_gbps REAL NOT NULL,
    ifname TEXT NOT NULL DEFAULT '',
    mac TEXT NOT NULL DEFAULT '',
    numa_node INTEGER,
    kind TEXT NOT NULL DEFAULT 'pf',
    usage TEXT NOT NULL DEFAULT '',
    peer_nic_id TEXT REFERENCES nics(id) ON DELETE SET NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(server_id, pci_address)
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS caldav_calendars (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    caldav_url TEXT NOT NULL,
    username TEXT NOT NULL,
    app_password TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS caldav_sync_queue (
    id TEXT PRIMARY KEY,
    calendar_id TEXT NOT NULL REFERENCES caldav_calendars(id) ON DELETE CASCADE,
    ics_uid TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('upsert', 'delete')),
    ics_payload TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'synced', 'error')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    last_attempt_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(calendar_id, ics_uid)
);

CREATE TABLE IF NOT EXISTS management_switches (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    mgmt_ip TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vlans (
    id TEXT PRIMARY KEY,
    vlan_id INTEGER NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    purpose TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tofinos (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    version INTEGER NOT NULL CHECK (version IN (1, 2)),
    notes TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    mgmt_peer_port_id TEXT
        REFERENCES management_switch_ports(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tofino_ports (
    id TEXT PRIMARY KEY,
    tofino_id TEXT NOT NULL REFERENCES tofinos(id) ON DELETE CASCADE,
    fp_port TEXT NOT NULL,
    dev_port INTEGER NOT NULL,
    pipe TEXT NOT NULL DEFAULT '',
    speed_gbps REAL NOT NULL DEFAULT 0,
    cable_label TEXT NOT NULL DEFAULT '',
    peer_port_id TEXT REFERENCES tofino_ports(id) ON DELETE SET NULL,
    peer_nic_id TEXT REFERENCES nics(id) ON DELETE SET NULL,
    peer_text TEXT NOT NULL DEFAULT '',
    comment TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(tofino_id, fp_port),
    CHECK (peer_port_id IS NULL OR peer_nic_id IS NULL)
);

CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    tofino_id TEXT REFERENCES tofinos(id) ON DELETE CASCADE,
    server_id TEXT REFERENCES servers(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_ts INTEGER NOT NULL,
    end_ts INTEGER NOT NULL,
    comment TEXT NOT NULL DEFAULT '',
    ics_uid TEXT NOT NULL UNIQUE,
    sequence INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    CHECK (end_ts > start_ts),
    CHECK ((tofino_id IS NOT NULL) != (server_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS nic_claims (
    id TEXT PRIMARY KEY,
    nic_id TEXT NOT NULL UNIQUE REFERENCES nics(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    assignee_name TEXT NOT NULL DEFAULT '',
    connected_to TEXT NOT NULL DEFAULT '',
    cable_label TEXT NOT NULL DEFAULT '',
    comment TEXT NOT NULL DEFAULT '',
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS management_switch_ports (
    id TEXT PRIMARY KEY,
    switch_id TEXT NOT NULL REFERENCES management_switches(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    ifname TEXT NOT NULL DEFAULT '',
    ifindex INTEGER,
    speed_gbps REAL NOT NULL DEFAULT 0,
    cable_label TEXT NOT NULL DEFAULT '',
    peer_port_id TEXT
        REFERENCES management_switch_ports(id) ON DELETE SET NULL,
    peer_nic_id TEXT REFERENCES nics(id) ON DELETE SET NULL,
    peer_tofino_id TEXT REFERENCES tofinos(id) ON DELETE SET NULL,
    peer_server_id TEXT REFERENCES servers(id) ON DELETE SET NULL,
    peer_text TEXT NOT NULL DEFAULT '',
    comment TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(switch_id, name),
    CHECK (
        (peer_port_id IS NOT NULL)
        + (peer_nic_id IS NOT NULL)
        + (peer_tofino_id IS NOT NULL) <= 1
    )
);

CREATE TABLE IF NOT EXISTS management_port_vlans (
    port_id TEXT NOT NULL
        REFERENCES management_switch_ports(id) ON DELETE CASCADE,
    vlan_id TEXT NOT NULL REFERENCES vlans(id) ON DELETE CASCADE,
    tagged INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (port_id, vlan_id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id
    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_nics_server_id
    ON nics(server_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_nics_peer_nic
    ON nics(peer_nic_id);
CREATE INDEX IF NOT EXISTS idx_caldav_sync_queue_status
    ON caldav_sync_queue(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_tofino_ports_tofino
    ON tofino_ports(tofino_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_tofino_ports_peer_port
    ON tofino_ports(peer_port_id);
CREATE INDEX IF NOT EXISTS idx_tofino_ports_peer_nic
    ON tofino_ports(peer_nic_id);
CREATE INDEX IF NOT EXISTS idx_bookings_tofino_start
    ON bookings(tofino_id, start_ts);
CREATE INDEX IF NOT EXISTS idx_bookings_server_start
    ON bookings(server_id, start_ts);
CREATE INDEX IF NOT EXISTS idx_bookings_user_id
    ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_nic_claims_user_id
    ON nic_claims(user_id);
CREATE INDEX IF NOT EXISTS idx_msw_ports_switch
    ON management_switch_ports(switch_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_msw_ports_peer_port
    ON management_switch_ports(peer_port_id);
CREATE INDEX IF NOT EXISTS idx_msw_ports_peer_nic
    ON management_switch_ports(peer_nic_id);
CREATE INDEX IF NOT EXISTS idx_msw_ports_peer_tof
    ON management_switch_ports(peer_tofino_id);
CREATE INDEX IF NOT EXISTS idx_msw_ports_peer_server
    ON management_switch_ports(peer_server_id);
CREATE INDEX IF NOT EXISTS idx_mgmt_port_vlans_vlan
    ON management_port_vlans(vlan_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tofinos_mgmt_peer
    ON tofinos(mgmt_peer_port_id);
