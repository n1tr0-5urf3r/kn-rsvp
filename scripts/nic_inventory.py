#!/usr/bin/env python3
"""Collect NIC inventory from the testbed hosts and seed rsvp with it.

Collect (runs scripts/collect-nics.sh over SSH, nothing to install remotely):

    python3 scripts/nic_inventory.py collect server-a server-b
    python3 scripts/nic_inventory.py collect --hosts-file scripts/hosts.txt

Review the JSON, delete what should not be documented, then seed — either
straight into a running instance or as a migration:

    python3 scripts/nic_inventory.py seed nics.json --api http://localhost:3125 \\
        --cookie "$(grep -o 'rsvp_session=[^;]*' cookiejar)"
    python3 scripts/nic_inventory.py seed nics.json \\
        --sql backend/migrations/202607280004_seed_servers_nics.sql

Both seed paths are idempotent: servers are matched by name, NICs by PCI
address, and anything already present is left alone.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COLLECTOR = os.path.join(ROOT, "scripts", "collect-nics.sh")

SSH_OPTIONS = [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "StrictHostKeyChecking=accept-new",
]


# --------------------------------- collect ---------------------------------


def run_collector(target: str, user: str | None, ssh_options: list[str]) -> dict:
    """Runs the collector on one host and parses its TSV output."""
    with open(COLLECTOR, "rb") as script:
        payload = script.read()

    if target in {"localhost", "-"}:
        command = ["sh", "-s"]
    else:
        destination = f"{user}@{target}" if user else target
        command = ["ssh", *SSH_OPTIONS, *ssh_options, destination, "sh", "-s"]

    try:
        completed = subprocess.run(
            command, input=payload, capture_output=True, timeout=60
        )
    except subprocess.TimeoutExpired:
        return {"target": target, "ok": False, "error": "timed out"}
    if completed.returncode != 0:
        error = completed.stderr.decode(errors="replace").strip().splitlines()
        return {
            "target": target,
            "ok": False,
            "error": error[-1] if error else f"exit {completed.returncode}",
        }

    facts, nics = parse_sections(completed.stdout.decode(errors="replace"))
    if not facts and not nics:
        return {"target": target, "ok": False, "error": "no output"}
    return {
        "target": target,
        "ok": True,
        "host": facts.get("host") or target,
        "arch": facts.get("arch", ""),
        "cpu_model": facts.get("cpu_model", ""),
        "cpu_sockets": as_int(facts.get("cpu_sockets")),
        "cpu_cores": as_int(facts.get("cpu_cores")),
        "cpu_threads": as_int(facts.get("cpu_threads")),
        "cpu_mhz": as_float(facts.get("cpu_mhz")),
        "memory_gb": as_float(facts.get("memory_gb")),
        # "no" | "ok (n guests, via …)" | "denied (…)" — why the per-NIC
        # "usage" column is filled in, empty, or unavailable.
        "pve": facts.get("pve", ""),
        "nics": nics,
    }


def as_int(value: str | None) -> int | None:
    try:
        return int(value) if value else None
    except ValueError:
        return None


def as_float(value: str | None) -> float | None:
    try:
        return float(value) if value else None
    except ValueError:
        return None


def parse_sections(output: str) -> tuple[dict, list[dict]]:
    """Splits the collector's "=== host" / "=== nics" TSV sections."""
    section = None
    header: list[str] | None = None
    facts: dict[str, str] = {}
    nics: list[dict] = []

    for line in output.splitlines():
        if line.startswith("=== "):
            section = line[4:].strip()
            header = None
            continue
        if not line.strip():
            continue
        if section == "host":
            key, _, value = line.partition("\t")
            facts[key] = value
        elif section == "nics":
            if header is None:
                header = line.split("\t")
            else:
                nic = dict(zip(header, line.split("\t")))
                nic["speed_gbps"] = as_float(nic.get("speed_gbps")) or 0.0
                nic["numa"] = as_int(nic.get("numa"))
                nics.append(nic)
    return facts, nics


def read_hosts(paths: list[str], inline: list[str]) -> list[str]:
    hosts = list(inline)
    for path in paths:
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                line = line.split("#", 1)[0].strip()
                if line:
                    hosts.append(line)
    seen: dict[str, None] = {}
    for host in hosts:
        seen.setdefault(host, None)
    return list(seen)


def collect(args: argparse.Namespace) -> int:
    hosts = read_hosts(args.hosts_file, args.hosts)
    if args.local:
        hosts.append("localhost")
    if not hosts:
        print("no hosts given (pass them as arguments or --hosts-file)", file=sys.stderr)
        return 2

    ssh_options = [part for option in args.ssh_option for part in ("-o", option)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as pool:
        results = list(
            pool.map(lambda host: run_collector(host, args.user, ssh_options), hosts)
        )

    failed = [result for result in results if not result["ok"]]
    for result in results:
        if not result["ok"]:
            print(f"{result['target']:20} FAILED: {result['error']}", file=sys.stderr)
            continue
        nics = result["nics"]
        physical = sum(1 for nic in nics if nic.get("kind") == "pf")
        hardware = f"{result.get('cpu_cores') or '?'}c/{result.get('cpu_threads') or '?'}t"
        if result.get("memory_gb"):
            hardware += f", {result['memory_gb']:.0f} GB"
        pve = result.get("pve", "")
        if pve.startswith("ok"):
            used = sum(1 for nic in nics if nic.get("usage"))
            hardware += f", Proxmox: {used} NICs mapped to VMs"
        elif pve.startswith("denied"):
            hardware += ", Proxmox: NO ACCESS to /etc/pve (run as root for VM usage)"
        print(
            f"{result['target']:20} {result['host']:16} "
            f"{physical} NICs ({len(nics) - physical} VFs), {hardware}",
            file=sys.stderr,
        )

    document = {"collected_at": int(time.time()), "hosts": results}
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(document, handle, indent=2)
        handle.write("\n")
    print(f"\nwrote {args.output}", file=sys.stderr)
    return 1 if failed and args.strict else 0


# ---------------------------------- seed -----------------------------------


def nic_type(vendor: str, model: str) -> str:
    """'Mellanox…MT28908 Family [ConnectX-6]' -> 'ConnectX-6'."""
    model = (model or "").strip()
    bracketed = re.search(r"\[([^\]]+)\]", model)
    if bracketed:
        return bracketed.group(1).strip()
    for prefix in ("Ethernet Controller ", "Ethernet Connection ", "Network Controller "):
        if model.lower().startswith(prefix.lower()):
            model = model[len(prefix) :]
    model = re.sub(r"\s+Family$", "", model).strip()
    return model or (vendor or "").strip() or "unknown"


def numa_node(value) -> int | None:
    return value if isinstance(value, int) and value >= 0 else None


def planned_servers(document: dict, args: argparse.Namespace) -> list[dict]:
    """Turns the collected JSON into servers with the NIC rows rsvp stores."""
    servers = []
    for result in document["hosts"]:
        if not result.get("ok"):
            continue
        nics = []
        for nic in result["nics"]:
            if nic.get("kind") == "vf" and not args.include_vf:
                continue
            if args.driver_skip and nic.get("driver") in args.driver_skip:
                continue
            name = nic["ifname"] if args.name_style == "ifname" else nic["short_name"]
            nics.append(
                {
                    "name": name,
                    "pci_address": nic["pci_address"],
                    "nic_type": nic_type(nic.get("vendor", ""), nic.get("model", "")),
                    "speed_gbps": float(nic.get("speed_gbps") or 0.0),
                    "ifname": nic["ifname"],
                    "mac": nic.get("mac", ""),
                    # sysfs reports -1 for "no NUMA affinity" — store nothing.
                    "numa_node": numa_node(nic.get("numa")),
                    "kind": nic.get("kind") or "pf",
                    "usage": (nic.get("usage") or "").strip(),
                }
            )
        nics.sort(key=lambda nic: nic["pci_address"])
        servers.append(
            {
                "name": result["host"],
                "cpu_model": result.get("cpu_model", ""),
                "cpu_sockets": result.get("cpu_sockets"),
                "cpu_cores": result.get("cpu_cores"),
                "cpu_threads": result.get("cpu_threads"),
                "cpu_mhz": result.get("cpu_mhz"),
                "memory_gb": result.get("memory_gb"),
                "nics": nics,
            }
        )
    servers.sort(key=lambda server: server["name"].lower())
    return servers


HARDWARE_FIELDS = (
    "cpu_model",
    "cpu_sockets",
    "cpu_cores",
    "cpu_threads",
    "cpu_mhz",
    "memory_gb",
)


def sql_str(value: str) -> str:
    return "'" + (value or "").replace("'", "''") + "'"


def sql_value(value) -> str:
    """SQL literal for an optional hardware fact; unknown becomes NULL."""
    if value is None or value == "":
        return "NULL"
    if isinstance(value, str):
        return sql_str(value)
    return repr(value)


def seed_sql(servers: list[dict], path: str) -> None:
    now = "strftime('%s', 'now')"
    lines = [
        "-- Seeds servers and their NICs from the SSH inventory",
        "-- (scripts/nic_inventory.py). Servers and PCI addresses that already",
        "-- exist are kept; missing CPU/memory facts are filled in, never",
        "-- overwritten. Safe to run against a populated database.",
        "",
    ]
    for index, server in enumerate(servers):
        name = server["name"]
        key = sql_str(name.lower())
        server_id = f"seed-srv-{name.lower()}"
        # cpu_model is NOT NULL DEFAULT ''; the numerics are nullable.
        hardware = [sql_str(server["cpu_model"])] + [
            sql_value(server[field]) for field in HARDWARE_FIELDS[1:]
        ]
        lines += [
            f"-- {name}: {len(server['nics'])} NICs",
            "INSERT INTO servers (id, name, description, cpu_model, cpu_sockets, cpu_cores,",
            "                     cpu_threads, cpu_mhz, memory_gb, sort_order,",
            "                     created_at, updated_at)",
            f"SELECT {sql_str(server_id)}, {sql_str(name)}, '', {', '.join(hardware)}, "
            f"{index}, {now}, {now}",
            f"WHERE NOT EXISTS (SELECT 1 FROM servers WHERE lower(name) = {key});",
            # Fill gaps on servers that already exist, never overwrite.
            "UPDATE servers SET",
            f"    cpu_model = CASE WHEN cpu_model = '' THEN {hardware[0]} ELSE cpu_model END,",
            f"    cpu_sockets = COALESCE(cpu_sockets, {hardware[1]}),",
            f"    cpu_cores = COALESCE(cpu_cores, {hardware[2]}),",
            f"    cpu_threads = COALESCE(cpu_threads, {hardware[3]}),",
            f"    cpu_mhz = COALESCE(cpu_mhz, {hardware[4]}),",
            f"    memory_gb = COALESCE(memory_gb, {hardware[5]})",
            f"WHERE lower(name) = {key};",
        ]
        for order, nic in enumerate(server["nics"]):
            nic_id = f"seed-nic-{name.lower()}-{nic['pci_address']}"
            lines += [
                "INSERT INTO nics (id, server_id, name, pci_address, nic_type, speed_gbps,",
                "                  ifname, mac, numa_node, kind, usage, sort_order,",
                "                  created_at, updated_at)",
                f"SELECT {sql_str(nic_id)}, s.id, {sql_str(nic['name'])}, "
                f"{sql_str(nic['pci_address'])}, {sql_str(nic['nic_type'])}, "
                f"{nic['speed_gbps']!r}, {sql_str(nic['ifname'])}, {sql_str(nic['mac'])}, "
                f"{sql_value(nic['numa_node'])}, {sql_str(nic['kind'])}, "
                f"{sql_str(nic['usage'])}, {order}, {now}, {now}",
                f"FROM servers s WHERE lower(s.name) = {key}",
                "  AND NOT EXISTS (SELECT 1 FROM nics n WHERE n.server_id = s.id",
                f"                  AND n.pci_address = {sql_str(nic['pci_address'])});",
                "UPDATE nics SET",
                f"    usage = CASE WHEN usage = '' THEN {sql_str(nic['usage'])} ELSE usage END",
                "WHERE server_id = (SELECT id FROM servers WHERE lower(name) = "
                f"{key}) AND pci_address = {sql_str(nic['pci_address'])};",
            ]
        lines.append("")

    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines))


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


def seed_api(servers: list[dict], api: Api, dry_run: bool) -> None:
    existing = {
        server["name"].lower(): server for server in api.call("/servers")["servers"]
    }
    created_servers = created_nics = 0

    updated_servers = updated_nics = 0
    for server in servers:
        hardware = {
            field: server[field] for field in HARDWARE_FIELDS if server.get(field)
        }
        current = existing.get(server["name"].lower())
        if current is None:
            summary = describe_hardware(server)
            print(f"+ server {server['name']}{summary}")
            if not dry_run:
                current = api.call(
                    "/admin/servers", "POST", {"name": server["name"], **hardware}
                )
                current["nics"] = []
            created_servers += 1
        else:
            # Fill in facts the server does not have yet; never overwrite what
            # an admin may have corrected by hand.
            gaps = {
                field: value
                for field, value in hardware.items()
                if not current.get(field)
            }
            if gaps:
                print(f"~ server {server['name']}: filling in {', '.join(gaps)}")
                if not dry_run:
                    api.call(f"/admin/servers/{current['id']}", "PATCH", gaps)
                updated_servers += 1
        if current is None:  # dry run: no server exists to attach NICs to
            for nic in server["nics"]:
                print(
                    f"    + {server['name']} {nic['name']:8} {nic['pci_address']}  "
                    f"{nic['nic_type']} @ {nic['speed_gbps']}G"
                )
                created_nics += 1
            continue

        known = {
            nic["pci_address"]: nic for nic in current.get("nics", [])
        }
        for order, nic in enumerate(server["nics"]):
            existing_nic = known.get(nic["pci_address"])
            if existing_nic is not None:
                if nic["usage"] and not existing_nic.get("usage"):
                    print(
                        f"    ~ {server['name']} {nic['name']:8} usage={nic['usage']}"
                    )
                    if not dry_run:
                        api.call(
                            f"/admin/nics/{existing_nic['id']}",
                            "PATCH",
                            {"usage": nic["usage"]},
                        )
                    updated_nics += 1
                continue
            print(
                f"    + {server['name']} {nic['name']:8} {nic['pci_address']}  "
                f"{nic['nic_type']} @ {nic['speed_gbps']}G"
            )
            if not dry_run:
                api.call(
                    f"/admin/servers/{current['id']}/nics",
                    "POST",
                    {
                        "name": nic["name"],
                        "pci_address": nic["pci_address"],
                        "nic_type": nic["nic_type"],
                        "speed_gbps": nic["speed_gbps"],
                        "ifname": nic["ifname"],
                        "mac": nic["mac"],
                        "numa_node": nic["numa_node"],
                        "kind": nic["kind"],
                        "usage": nic["usage"],
                        "sort_order": order,
                    },
                )
            created_nics += 1

    verb = "would create" if dry_run else "created"
    print(
        f"\n{verb} {created_servers} servers and {created_nics} NICs; "
        f"filled in hardware for {updated_servers} existing servers and usage "
        f"for {updated_nics} existing NICs"
    )


def describe_hardware(server: dict) -> str:
    parts = []
    if server.get("cpu_model"):
        parts.append(server["cpu_model"])
    if server.get("cpu_cores"):
        parts.append(f"{server['cpu_cores']}c/{server.get('cpu_threads') or '?'}t")
    if server.get("memory_gb"):
        parts.append(f"{server['memory_gb']:.0f} GB")
    return f" — {', '.join(parts)}" if parts else ""


def seed(args: argparse.Namespace) -> int:
    with open(args.inventory, encoding="utf-8") as handle:
        document = json.load(handle)
    servers = planned_servers(document, args)
    if not servers:
        print("nothing to seed — the inventory holds no successful hosts", file=sys.stderr)
        return 1

    if args.sql:
        seed_sql(servers, args.sql)
        total = sum(len(server["nics"]) for server in servers)
        print(f"wrote {args.sql}: {len(servers)} servers, {total} NICs")
        return 0

    seed_api(servers, Api(args.api, args.cookie), args.dry_run)
    return 0


# ---------------------------------- cli ------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = parser.add_subparsers(dest="command", required=True)

    collect_parser = sub.add_parser("collect", help="run the collector over SSH")
    collect_parser.add_argument("hosts", nargs="*", help="SSH targets")
    collect_parser.add_argument(
        "--hosts-file", action="append", default=[], help="file with one target per line"
    )
    collect_parser.add_argument("--user", help="SSH user (default: your ssh config)")
    collect_parser.add_argument(
        "--ssh-option", action="append", default=[], help="extra ssh -o option"
    )
    collect_parser.add_argument("--jobs", type=int, default=8, help="parallel hosts")
    collect_parser.add_argument("--local", action="store_true", help="also inventory this machine")
    collect_parser.add_argument("--strict", action="store_true", help="exit non-zero if a host failed")
    collect_parser.add_argument("-o", "--output", default="nics.json")
    collect_parser.set_defaults(func=collect)

    seed_parser = sub.add_parser("seed", help="turn the inventory into servers/NICs")
    seed_parser.add_argument("inventory", help="JSON written by collect")
    target = seed_parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--sql", help="write a seed migration to this path")
    target.add_argument("--api", help="base URL of a running rsvp instance")
    seed_parser.add_argument("--cookie", default="", help="rsvp_session cookie for --api")
    seed_parser.add_argument("--dry-run", action="store_true", help="--api: only report")
    seed_parser.add_argument(
        "--name-style",
        choices=("short", "ifname"),
        default="short",
        help="NIC name: bus.function like tofino.md (default) or the kernel name",
    )
    seed_parser.add_argument("--include-vf", action="store_true", help="keep SR-IOV VFs")
    seed_parser.add_argument(
        "--driver-skip",
        action="append",
        default=[],
        help="skip NICs bound to this driver (repeatable, e.g. --driver-skip igb)",
    )
    seed_parser.set_defaults(func=seed)

    args = parser.parse_args()
    if args.command == "seed" and args.api and not args.cookie:
        parser.error("--api needs --cookie with an admin session")
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
