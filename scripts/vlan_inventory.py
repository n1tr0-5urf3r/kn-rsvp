#!/usr/bin/env python3
"""Discover management-switch VLAN configuration over SNMP and seed rsvp.

Requires the net-snmp CLI (`snmpwalk`) locally; it talks to switches over
SNMP v2c (no SSH, nothing installed on the switch). Collect one switch:

    python3 scripts/vlan_inventory.py collect 10.0.0.2 --community public \\
        --name MgmtSwitch1 -o vlans.json

...or many at once from a file (comma-separated `<ip>, [name], [community]`
per line, so names may contain spaces — see scripts/switches.txt):

    python3 scripts/vlan_inventory.py collect --switches-file scripts/switches.txt \\
        -o vlans.json

Review the JSON, then seed it — straight into a running instance or as a
migration. The switch is created if it does not exist yet:

    python3 scripts/vlan_inventory.py seed vlans.json --api http://localhost:3125 \\
        --cookie "$(grep -o 'rsvp_session=[^;]*' cookiejar)"
    python3 scripts/vlan_inventory.py seed vlans.json \\
        --sql backend/migrations/20260819XXXX_seed_mgmt_switch.sql

Both seed paths are idempotent: the switch is matched by name, VLANs by their
802.1Q number, ports by name; existing facts are kept and only VLAN membership
is refreshed.

Reads the Q-BRIDGE-MIB dot1q static VLAN tables:
  dot1dBasePortIfIndex     .1.3.6.1.2.1.17.1.4.1.2   bridge port -> ifIndex
  ifName                   .1.3.6.1.2.1.31.1.1.1.1   ifIndex -> name
  ifHighSpeed              .1.3.6.1.2.1.31.1.1.1.15  ifIndex -> Mbit/s
  dot1qVlanStaticName      .1.3.6.1.2.1.17.7.1.4.3.1.1
  dot1qVlanStaticEgressPorts   ...4.3.1.2   tagged+untagged member bitmap
  dot1qVlanStaticUntaggedPorts ...4.3.1.4   untagged member bitmap
tagged = egress members - untagged members.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

OID_BASE_PORT_IFINDEX = "1.3.6.1.2.1.17.1.4.1.2"
OID_IFNAME = "1.3.6.1.2.1.31.1.1.1.1"
OID_IFHIGHSPEED = "1.3.6.1.2.1.31.1.1.1.15"
OID_SYSDESCR = "1.3.6.1.2.1.1.1.0"
OID_VLAN_NAME = "1.3.6.1.2.1.17.7.1.4.3.1.1"
OID_VLAN_EGRESS = "1.3.6.1.2.1.17.7.1.4.3.1.2"
OID_VLAN_UNTAGGED = "1.3.6.1.2.1.17.7.1.4.3.1.4"


# --------------------------------- collect ---------------------------------


class SnmpError(Exception):
    """A switch could not be walked (timeout, unreachable, SNMP error). Raised
    per switch so a batch collect can skip it and keep the others."""


def snmpwalk(host: str, community: str, oid: str, timeout: int = 45) -> dict[str, str]:
    """Walk one OID subtree, returning {last-index: value}. Hex for strings."""
    command = [
        "snmpwalk",
        "-v2c",
        "-c",
        community,
        "-OqnUx",  # quick, numeric OIDs, plain units, hex octet-strings
        "-r",
        "2",  # retries per PDU, so an unreachable switch fails fast
        "-t",
        "5",  # seconds per PDU
        host,
        oid,
    ]
    try:
        completed = subprocess.run(command, capture_output=True, timeout=timeout)
    except FileNotFoundError as error:
        # A missing CLI is fatal for every switch, not a per-switch problem.
        raise SystemExit("snmpwalk not found — install net-snmp.") from error
    except subprocess.TimeoutExpired as error:
        raise SnmpError(f"snmpwalk {oid} timed out against {host}") from error
    if completed.returncode != 0:
        stderr = completed.stderr.decode(errors="replace").strip()
        raise SnmpError(f"snmpwalk {oid} against {host} failed: {stderr}")

    result: dict[str, str] = {}
    last_index: str | None = None
    for line in completed.stdout.decode(errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        full_oid = line.split(None, 1)[0].lstrip(".")
        is_record = full_oid == oid or full_oid.startswith(oid + ".")
        if is_record:
            parts = line.split(None, 1)
            value = parts[1].strip() if len(parts) > 1 else ""
            # The index is whatever follows the walked OID prefix — empty for
            # a scalar (queried OID already ends in ".0", e.g. sysDescr) but
            # also empty when a table column isn't implemented at all: some
            # MikroTik switches answer "No Such Object available on this
            # agent at this OID" for the exact queried column OID instead of
            # just returning nothing. Callers that walk table columns (and
            # need a numeric index) filter empty keys out themselves.
            index = full_oid[len(oid) + 1 :]
            result[index] = value
            last_index = index
        elif last_index is not None:
            # net-snmp wraps long Hex-STRING values (VLAN port bitmaps,
            # sysDescr) across lines; the continuation carries no OID.
            result[last_index] = f"{result[last_index]} {line}".strip()
    return result


def bitmap_ports(hex_value: str) -> set[int]:
    """Turns a dot1q PortList octet string into a set of bridge-port numbers.

    Bit 0x80 of octet 0 is bridge port 1 (MSB-first, 1-based)."""
    tokens = re.findall(r"[0-9A-Fa-f]{2}", hex_value)
    ports: set[int] = set()
    for byte_index, token in enumerate(tokens):
        byte = int(token, 16)
        for bit in range(8):
            if byte & (0x80 >> bit):
                ports.add(byte_index * 8 + bit + 1)
    return ports


def collect(host: str, community: str, name: str | None) -> dict:
    # Table columns need a numeric sub-index; an empty key means the agent
    # doesn't implement that column at all (see snmpwalk()) rather than
    # naming a real row, so it's dropped instead of failing int().
    base_port_ifindex = {
        int(k): int(v) for k, v in snmpwalk(host, community, OID_BASE_PORT_IFINDEX).items() if k
    }
    ifnames = {
        int(k): decode_string(v) for k, v in snmpwalk(host, community, OID_IFNAME).items() if k
    }
    ifspeeds = {
        int(k): int(v) for k, v in snmpwalk(host, community, OID_IFHIGHSPEED).items() if k and v
    }
    vlan_names = {
        int(k): decode_string(v) for k, v in snmpwalk(host, community, OID_VLAN_NAME).items() if k
    }
    egress = {
        int(k): bitmap_ports(v) for k, v in snmpwalk(host, community, OID_VLAN_EGRESS).items() if k
    }
    untagged = {
        int(k): bitmap_ports(v)
        for k, v in snmpwalk(host, community, OID_VLAN_UNTAGGED).items()
        if k
    }

    sysdescr = next(iter(snmpwalk(host, community, OID_SYSDESCR).values()), "")
    model = decode_string(sysdescr).splitlines()[0][:120] if sysdescr else ""

    # Per bridge port, gather VLAN membership.
    membership: dict[int, list[dict]] = {port: [] for port in base_port_ifindex}
    for vlan_id, members in egress.items():
        untagged_members = untagged.get(vlan_id, set())
        for bridge_port in members:
            if bridge_port not in membership:
                continue
            membership[bridge_port].append(
                {"vlan_id": vlan_id, "tagged": bridge_port not in untagged_members}
            )

    ports = []
    for bridge_port, ifindex in sorted(base_port_ifindex.items()):
        ifname = ifnames.get(ifindex, f"if{ifindex}")
        speed_mbit = ifspeeds.get(ifindex, 0)
        ports.append(
            {
                "name": front_panel_name(ifname),
                "ifname": ifname,
                "ifindex": ifindex,
                "speed_gbps": round(speed_mbit / 1000, 3) if speed_mbit else 0,
                "vlans": sorted(membership[bridge_port], key=lambda m: m["vlan_id"]),
            }
        )

    vlans = [
        {"vlan_id": vlan_id, "name": vlan_names.get(vlan_id, "")}
        for vlan_id in sorted(set(vlan_names) | set(egress))
    ]

    return {
        "collected_at": int(time.time()),
        "switch": name or host,
        "mgmt_ip": host,
        "model": model,
        "vlans": vlans,
        "ports": ports,
    }


def read_switches_file(path: str, default_community: str) -> list[dict]:
    """Parses a switches file: `<ip>, [name], [community]` per line (comma
    separated so names may contain spaces), `#` comments, fields trimmed."""
    switches = []
    with open(path, encoding="utf-8") as handle:
        for lineno, raw in enumerate(handle, start=1):
            line = raw.split("#", 1)[0].strip()
            if not line:
                continue
            parts = [field.strip() for field in line.split(",")]
            host = parts[0]
            if not host:
                raise SystemExit(f"{path}:{lineno}: missing switch IP/host")
            name = parts[1] if len(parts) > 1 and parts[1] else host
            community = (
                parts[2] if len(parts) > 2 and parts[2] else default_community
            )
            switches.append({"host": host, "name": name, "community": community})
    if not switches:
        raise SystemExit(f"{path} lists no switches")
    return switches


def decode_string(value: str) -> str:
    """snmpwalk -Ox renders every OCTET STRING value as a double-quoted,
    space-separated hex dump ('"31 "' for the ASCII text "1"), unconditionally
    — including short/printable values, so there is no ambiguity: quoted
    means hex-encoded and must be decoded. A value with no quotes (already
    plain, e.g. re-processing already-decoded text) is returned unchanged."""
    stripped = value.strip()
    if len(stripped) >= 2 and stripped[0] == '"' and stripped[-1] == '"':
        inner = stripped[1:-1]
        tokens = inner.split()
        is_hex = bool(tokens) and all(re.fullmatch(r"[0-9A-Fa-f]{2}", tok) for tok in tokens)
        if is_hex:
            raw = bytes(int(tok, 16) for tok in tokens)
            return raw.decode("utf-8", errors="replace").rstrip("\x00").strip()
        return inner.strip()
    return stripped


def front_panel_name(ifname: str) -> str:
    """Front-panel port number from a decoded ifName. Ubiquiti ES-16-XG names
    ports "0/1".."0/16" → "1".."16"; HP 2920 names them "1".."24" already;
    MikroTik CRS312-4C+8XG names its RJ45 ports "ether1".."ether8" → "1".."8"
    (matching the chassis silkscreen). Its 4 combo ports ("combo1".."combo4")
    are kept as-is: physically each is two jacks (RJ45 "N-T" + SFP+ "N-F")
    sharing one SNMP interface, so MIKROTIK_LAYOUT maps both faceplate
    positions to the same "comboN" port name instead of splitting it in two.
    Anything else (e.g. Ubiquiti internal "3/1") is kept as-is."""
    match = re.fullmatch(r"0/(\d+)", ifname)
    if match:
        return match.group(1)
    match = re.fullmatch(r"ether(\d+)", ifname)
    if match:
        return match.group(1)
    return ifname


# ----------------------------------- seed -----------------------------------


class Api:
    def __init__(self, base_url: str, cookie: str):
        self.base_url = base_url.rstrip("/")
        self.cookie = cookie if "=" in cookie else f"rsvp_session={cookie}"

    def call(self, path: str, method: str = "GET", body: dict | None = None):
        request = urllib.request.Request(
            f"{self.base_url}/api/v1{path}",
            method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"content-type": "application/json", "cookie": self.cookie},
        )
        try:
            with urllib.request.urlopen(request) as response:
                payload = response.read()
                return json.loads(payload) if payload else None
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")
            raise SystemExit(f"{method} {path} failed: {error.code} {detail}") from error


def seed_api(data: dict, api: Api, name: str, dry_run: bool) -> None:
    switches = {s["name"].lower(): s for s in api.call("/management-switches")["switches"]}
    current = switches.get(name.lower())
    if current is None:
        print(f"+ switch {name}")
        if dry_run:
            print("  (dry run: cannot import ports without the switch; stopping)")
            return
        current = api.call(
            "/admin/management-switches",
            "POST",
            {"name": name, "mgmt_ip": data.get("mgmt_ip", ""), "model": data.get("model", "")},
        )
    else:
        print(f"= switch {name} (exists)")

    payload = {
        "mgmt_ip": data.get("mgmt_ip", ""),
        "model": data.get("model", ""),
        "vlans": data.get("vlans", []),
        "ports": data.get("ports", []),
    }
    print(
        f"  importing {len(payload['ports'])} ports, {len(payload['vlans'])} VLANs"
    )
    if dry_run:
        return
    result = api.call(
        f"/admin/management-switches/{current['id']}/import", "POST", payload
    )
    print(
        f"  done: {result['ports_created']} new / {result['ports_updated']} updated ports, "
        f"{result['vlans_created']} new VLANs"
    )


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def seed_sql(datasets: list[tuple[dict, str]], path: str) -> None:
    """Emits one idempotent migration for every collected switch, creating the
    switch, VLANs, ports and membership with deterministic seed-* ids. Switch/
    port/VLAN facts are fill-gaps only (never clobber an admin edit), but a
    port's VLAN membership is always fully replaced — matching
    POST .../import — since re-running discovery is how VLAN changes on the
    switch are meant to reach rsvp."""
    lines = [
        "-- Generated by vlan_inventory.py.",
        "-- Idempotent: re-running keeps existing switch/port/VLAN facts, only",
        "-- backfills gaps -- except port VLAN membership, which is always",
        "-- replaced wholesale with what was just discovered.",
        "",
    ]
    for data, name in datasets:
        lines.extend(switch_sql_lines(data, name))
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
    print(f"Wrote {path}")


def switch_sql_lines(data: dict, name: str) -> list[str]:
    switch_id = f"seed-msw-{slug(name)}"
    lines = [
        f"-- Switch {name}",
        f"INSERT OR IGNORE INTO management_switches "
        f"(id, name, mgmt_ip, model, active, sort_order, created_at, updated_at) "
        f"VALUES ('{switch_id}', {sql(name)}, {sql(data.get('mgmt_ip', ''))}, "
        f"{sql(data.get('model', ''))}, 1, 0, strftime('%s','now'), strftime('%s','now'));",
        "",
    ]
    for vlan in data.get("vlans", []):
        vlan_seed = f"seed-vlan-{vlan['vlan_id']}"
        lines.append(
            f"INSERT OR IGNORE INTO vlans (id, vlan_id, name, purpose, created_at, updated_at) "
            f"VALUES ('{vlan_seed}', {vlan['vlan_id']}, {sql(vlan.get('name', ''))}, '', "
            f"strftime('%s','now'), strftime('%s','now'));"
        )
    lines.append("")
    for index, port in enumerate(data.get("ports", []), start=1):
        port_seed = f"seed-mswport-{slug(name)}-{slug(port['name'])}"
        lines.append(
            f"INSERT OR IGNORE INTO management_switch_ports "
            f"(id, switch_id, name, ifname, ifindex, speed_gbps, sort_order, created_at, updated_at) "
            f"VALUES ('{port_seed}', '{switch_id}', {sql(port['name'])}, "
            f"{sql(port.get('ifname', ''))}, {port.get('ifindex') or 'NULL'}, "
            f"{port.get('speed_gbps', 0)}, {index}, strftime('%s','now'), strftime('%s','now'));"
        )
        # Membership is the whole point of re-running discovery: replace it
        # wholesale (matches backend replace_port_vlans), so a VLAN removed
        # from a port on the switch is also removed here, not just added to.
        lines.append(f"DELETE FROM management_port_vlans WHERE port_id = '{port_seed}';")
        for member in port.get("vlans", []):
            vlan_seed = f"seed-vlan-{member['vlan_id']}"
            lines.append(
                f"INSERT INTO management_port_vlans (port_id, vlan_id, tagged) "
                f"SELECT '{port_seed}', v.id, {1 if member['tagged'] else 0} "
                f"FROM vlans v WHERE v.vlan_id = {member['vlan_id']};"
            )
        lines.append("")
    return lines


def sql(text: str) -> str:
    return "'" + str(text).replace("'", "''") + "'"


# ----------------------------------- cli -----------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    collect_cmd = sub.add_parser("collect", help="SNMP-walk switches into JSON")
    collect_cmd.add_argument("host", nargs="?", help="switch IP or hostname")
    collect_cmd.add_argument(
        "--switches-file", help="file of `<ip> [name] [community]` lines"
    )
    collect_cmd.add_argument(
        "--community",
        default=os.environ.get("SNMP_COMMUNITY", "public"),
        help="SNMP v2c read community (default: $SNMP_COMMUNITY or 'public')",
    )
    collect_cmd.add_argument("--name", help="switch name in rsvp (default: host)")
    collect_cmd.add_argument("-o", "--output", default="vlans.json")

    seed_cmd = sub.add_parser("seed", help="Seed rsvp from a collected JSON file")
    seed_cmd.add_argument("inventory", help="vlans.json from collect")
    seed_cmd.add_argument("--name", help="override the switch name")
    target = seed_cmd.add_mutually_exclusive_group(required=True)
    target.add_argument("--api", help="base URL of a running instance")
    target.add_argument("--sql", help="write an idempotent migration to this path")
    seed_cmd.add_argument("--cookie", help="rsvp_session cookie (required with --api)")
    seed_cmd.add_argument("--dry-run", action="store_true")

    args = parser.parse_args()

    if args.command == "collect":
        if bool(args.host) == bool(args.switches_file):
            raise SystemExit("pass exactly one of a host or --switches-file")
        if args.switches_file:
            targets = read_switches_file(args.switches_file, args.community)
            collected = []
            failed = []
            for target in targets:
                print(f"collecting {target['name']} ({target['host']})…", file=sys.stderr)
                try:
                    collected.append(
                        collect(target["host"], target["community"], target["name"])
                    )
                except SnmpError as error:
                    # One unreachable switch must not lose the rest of the batch.
                    print(f"  ! skipping {target['name']}: {error}", file=sys.stderr)
                    failed.append(target["name"])
            output = {"collected_at": int(time.time()), "switches": collected}
            summary = f"{len(collected)} switches"
            if failed:
                summary += f" ({len(failed)} skipped: {', '.join(failed)})"
        else:
            try:
                output = collect(args.host, args.community, args.name)
            except SnmpError as error:
                raise SystemExit(str(error)) from error
            summary = f"{len(output['ports'])} ports, {len(output['vlans'])} VLANs"
        with open(args.output, "w", encoding="utf-8") as handle:
            json.dump(output, handle, indent=2)
        print(f"Wrote {args.output}: {summary}", file=sys.stderr)
        return

    with open(args.inventory, encoding="utf-8") as handle:
        data = json.load(handle)
    # A file may hold one switch or a {"switches": [...]} batch.
    datasets = data["switches"] if isinstance(data, dict) and "switches" in data else [data]
    # --name only overrides when there is a single switch to name.
    override = args.name if len(datasets) == 1 else None

    def switch_name(entry: dict) -> str:
        return override or entry.get("switch") or "switch"

    if args.api:
        if not args.cookie:
            raise SystemExit("--api requires --cookie")
        api = Api(args.api, args.cookie)
        for entry in datasets:
            seed_api(entry, api, switch_name(entry), args.dry_run)
    else:
        seed_sql([(entry, switch_name(entry)) for entry in datasets], args.sql)


if __name__ == "__main__":
    main()
