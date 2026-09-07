#!/bin/sh
# Inventories the host it runs on: CPU, memory, and every PCI-attached network
# interface.
#
#   ./collect-nics.sh                     # here
#   ssh <host> sh -s < collect-nics.sh    # there, nothing to install
#
# Prints two TSV sections, "=== host" (key/value) and "=== nics" (with a header
# row). Reads /proc and /sys; lspci, ethtool and lscpu are used when available
# but are not required, and no root is needed.
#
# NICs are enumerated from the PCI bus, not from /sys/class/net, so cards that
# were handed to a VM (bound to vfio-pci) show up too — they have no kernel
# interface on the host, and appear with an empty ifname, link "passthrough"
# and no MAC or speed.
#
# On Proxmox nodes it also reports which VMs have a NIC passed through to them
# (hostpciN, including PVE 8 resource mappings). Bridge membership is reported
# as the plain bridge name, not as a VM list: every guest on vmbr0 would
# otherwise be attributed to every uplink. Guest configs are read from
# /etc/pve directly, else via sudo,
# else through "qm config"/"pct config"; all three need root, so run the
# collector as root there. The "pve" line of the host section says which route
# worked, so an empty usage column is never a silent mystery.
#
#   ./collect-nics.sh --pve-usage 0000:65:00.1 vmbr1   # debug that mapping
#
# scripts/nic_inventory.py fans this out over many hosts and turns the result
# into servers/NICs for rsvp.

set -eu

# sshd hands non-root users a PATH without the sbin directories on Debian, and
# ethtool lives in /usr/sbin — without this the speed of every down link would
# silently come out empty.
PATH="$PATH:/usr/local/sbin:/usr/sbin:/sbin"
export PATH

pve_root=${PVE_ROOT:-/etc/pve}
pve_reader=''
pve_status=no
pve_configs=''

# Runs a Proxmox command as root when we are not already.
pve_run() {
    if [ "$(id -u 2>/dev/null || echo 1)" = 0 ]; then
        "$@"
    else
        sudo -n "$@"
    fi
}

pve_list_confs() {
    # A cluster keeps every node's guests under nodes/<name>/; the local ones
    # are also reachable through the qemu-server/lxc symlinks. Duplicates are
    # harmless, they collapse per VMID.
    ls "$pve_root"/qemu-server/*.conf "$pve_root"/lxc/*.conf \
       "$pve_root"/nodes/*/qemu-server/*.conf "$pve_root"/nodes/*/lxc/*.conf \
       2>/dev/null || true
}

# /etc/pve is root:www-data 0640, so an ordinary SSH login sees nothing there.
# Try the files, then sudo, then the qm/pct CLI, and record which worked so an
# empty "usage" column is never a silent mystery.
pve_detect() {
    [ -d "$pve_root" ] || return 0
    pve_confs=$(pve_list_confs)
    first=$(printf '%s\n' "$pve_confs" | head -n 1)
    if [ -n "$first" ] && [ -r "$first" ]; then
        pve_reader=files
        pve_status=ok
        return 0
    fi
    if sudo -n true 2>/dev/null; then
        pve_confs=$(sudo -n sh -c "$(command -v ls) $pve_root/qemu-server/*.conf \
            $pve_root/lxc/*.conf $pve_root/nodes/*/qemu-server/*.conf \
            $pve_root/nodes/*/lxc/*.conf 2>/dev/null" || true)
        if [ -n "$pve_confs" ]; then
            pve_reader=sudo
            pve_status=ok
            return 0
        fi
    fi
    if command -v qm >/dev/null 2>&1 && pve_run qm list >/dev/null 2>&1; then
        pve_reader=qm
        pve_status=ok
        return 0
    fi
    pve_status=denied
}

# All guest configs as one stream, each preceded by a "#__vmid <id>" marker so
# the parser knows whose config follows regardless of where it came from.
pve_config_stream() {
    if [ -r "$pve_root/mapping/pci.cfg" ]; then
        printf '#__mapping\n'
        cat "$pve_root/mapping/pci.cfg" 2>/dev/null || true
    elif [ "$pve_reader" != files ] && [ -e "$pve_root/mapping/pci.cfg" ]; then
        printf '#__mapping\n'
        pve_run cat "$pve_root/mapping/pci.cfg" 2>/dev/null || true
    fi

    case $pve_reader in
        files | sudo)
            for conf in $pve_confs; do
                vmid=${conf##*/}
                vmid=${vmid%.conf}
                printf '#__vmid %s\n' "$vmid"
                if [ "$pve_reader" = sudo ]; then
                    sudo -n cat "$conf" 2>/dev/null || true
                else
                    cat "$conf" 2>/dev/null || true
                fi
            done
            ;;
        qm)
            for vmid in $(pve_run qm list 2>/dev/null | awk 'NR > 1 { print $1 }'); do
                printf '#__vmid %s\n' "$vmid"
                pve_run qm config "$vmid" 2>/dev/null || true
            done
            for vmid in $(pve_run pct list 2>/dev/null | awk 'NR > 1 { print $1 }'); do
                printf '#__vmid %s\n' "$vmid"
                pve_run pct config "$vmid" 2>/dev/null || true
            done
            ;;
    esac
}

# Which VMs have this PCI device passed through: "101 (dpdk-gen), 102 (p4-ats)".
# Bridge membership is deliberately not attributed to VMs — every guest on
# vmbr0 would be listed against every uplink; the "bridge" column says which
# bridge the NIC feeds and that is enough.
pve_usage() {
    pve_pci=$1
    [ -n "$pve_configs" ] || return 0

    # PVE writes hostpci without the 0000 domain, and may omit the function to
    # mean "every function of this device".
    pve_short=${pve_pci#0000:}
    pve_dev=${pve_short%.*}

    printf '%s\n' "$pve_configs" |
    awk -v want_pci="$pve_short" -v want_dev="$pve_dev" '
    function matches_pci(token,   value) {
        value = token
        sub(/^0000:/, "", value)
        if (value == want_pci) { return 1 }
        # "65:00" covers every function of that device.
        return (index(value, ".") == 0 && value == want_dev)
    }
    # PVE 8 resource mappings: "pci: <name>" then "map ...,path=<addr>,...".
    /^#__mapping/ { in_mapping = 1; live = 0; next }
    in_mapping && /^pci:/ {
        map_name = $0
        sub(/^pci:[ \t]*/, "", map_name)
        next
    }
    in_mapping && /path=/ {
        path = $0
        sub(/.*path=/, "", path)
        sub(/[,\r].*/, "", path)
        if (map_name != "" && matches_pci(path)) { mapped[map_name] = 1 }
        next
    }
    /^#__vmid / {
        vmid = $2
        in_mapping = 0
        # Snapshot and pending sections describe other points in time.
        live = 1
        next
    }
    /^\[/ { live = 0 }
    live != 1 { next }
    /^(name|hostname):/ {
        value = $0
        sub(/^[a-z]+:[ \t]*/, "", value)
        names[vmid] = value
    }
    /^hostpci[0-9]+:/ {
        value = $0
        sub(/^hostpci[0-9]+:[ \t]*/, "", value)
        count = split(value, tokens, /[;,]/)
        for (i = 1; i <= count; i++) {
            token = tokens[i]
            if (token ~ /^mapping=/) {
                sub(/^mapping=/, "", token)
                if (token in mapped) { passthrough[vmid] = 1 }
            } else if (token ~ /^[0-9a-fA-F]+:/ && matches_pci(token)) {
                passthrough[vmid] = 1
            }
        }
    }
    END {
        for (id in passthrough) {
            printf "%s\t%s\n", id, (id in names ? names[id] : "")
        }
    }' |
        sort -n |
        awk -F'\t' '
        {
            entry = $1 ($2 != "" ? " (" $2 ")" : "")
            out = out (out != "" ? ", " : "") entry
        }
        END { print out }'
}

pve_detect
if [ "$pve_status" = ok ]; then
    pve_configs=$(pve_config_stream)
    pve_guests=$(printf '%s\n' "$pve_configs" | grep -c '^#__vmid ' || true)
fi

# Debug entry point: sh collect-nics.sh --pve-usage <pci>
if [ "${1:-}" = "--pve-usage" ]; then
    case $pve_status in
        ok) printf 'pve: read %s guest configs via %s\n' "${pve_guests:-0}" "$pve_reader" >&2 ;;
        denied) printf 'pve: %s is not readable — run as root or allow sudo\n' "$pve_root" >&2 ;;
        *) printf 'pve: %s does not exist, not a Proxmox node\n' "$pve_root" >&2 ;;
    esac
    pve_usage "${2:-}"
    exit 0
fi

host=$(hostname -s 2>/dev/null || hostname)

# ------------------------------- host section -------------------------------

lscpu_out=''
if command -v lscpu >/dev/null 2>&1; then
    lscpu_out=$(LC_ALL=C lscpu 2>/dev/null || true)
fi
lscpu_field() {
    printf '%s\n' "$lscpu_out" | awk -F: -v key="$1" '
        $1 == key { sub(/^[ \t]+/, "", $2); print $2; exit }'
}

# x86 exposes the model in /proc/cpuinfo; other architectures only via lscpu.
cpu_model=$(awk -F': ' '/^model name/ { print $2; exit }' /proc/cpuinfo 2>/dev/null || true)
[ -n "$cpu_model" ] || cpu_model=$(lscpu_field "Model name")

cpu_threads=$(grep -c '^processor' /proc/cpuinfo 2>/dev/null || echo '')
cpu_sockets=$(awk -F': ' '/^physical id/ { ids[$2] = 1 }
    END { count = 0; for (id in ids) count++; if (count) print count }' /proc/cpuinfo 2>/dev/null || true)
[ -n "$cpu_sockets" ] || cpu_sockets=$(lscpu_field "Socket(s)")
[ -n "$cpu_sockets" ] || cpu_sockets=1

cores_per_socket=$(awk -F': ' '/^cpu cores/ { print $2; exit }' /proc/cpuinfo 2>/dev/null || true)
[ -n "$cores_per_socket" ] || cores_per_socket=$(lscpu_field "Core(s) per socket")
if [ -n "$cores_per_socket" ]; then
    cpu_cores=$((cores_per_socket * cpu_sockets))
else
    cpu_cores=$cpu_threads
fi

# Prefer the advertised maximum; a current reading drifts with the governor.
cpu_mhz=''
max_khz=/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq
if [ -r "$max_khz" ]; then
    cpu_mhz=$(awk '{ printf "%.0f", $1 / 1000 }' "$max_khz")
fi
[ -n "$cpu_mhz" ] || cpu_mhz=$(lscpu_field "CPU max MHz" | awk '{ if ($1 > 0) printf "%.0f", $1 }')
if [ -z "$cpu_mhz" ]; then
    # Intel puts the nominal clock in the model name ("… @ 2.30GHz").
    cpu_mhz=$(printf '%s\n' "$cpu_model" | awk '
        { if (match($0, /@ *[0-9.]+ *GHz/)) {
              value = substr($0, RSTART, RLENGTH)
              gsub(/[^0-9.]/, "", value)
              printf "%.0f", value * 1000
          } }')
fi
[ -n "$cpu_mhz" ] || cpu_mhz=$(awk -F': ' '/^cpu MHz/ { printf "%.0f", $2; exit }' /proc/cpuinfo 2>/dev/null || true)

memory_gb=$(awk '/^MemTotal:/ { printf "%.1f", $2 / 1048576; exit }' /proc/meminfo 2>/dev/null || true)

printf '=== host\n'
printf 'host\t%s\n' "$host"
printf 'arch\t%s\n' "$(uname -m 2>/dev/null || true)"
printf 'cpu_model\t%s\n' "$cpu_model"
printf 'cpu_sockets\t%s\n' "$cpu_sockets"
printf 'cpu_cores\t%s\n' "$cpu_cores"
printf 'cpu_threads\t%s\n' "$cpu_threads"
printf 'cpu_mhz\t%s\n' "$cpu_mhz"
printf 'memory_gb\t%s\n' "$memory_gb"
# no | ok (<n> guests, via <reader>) | denied (<path>): why the usage column is
# populated, empty, or unavailable.
case $pve_status in
    ok) printf 'pve\tok (%s guests, via %s)\n' "${pve_guests:-0}" "$pve_reader" ;;
    denied) printf 'pve\tdenied (%s not readable; run as root or allow sudo)\n' "$pve_root" ;;
    *) printf 'pve\tno\n' ;;
esac

# ------------------------------- nics section -------------------------------

printf '=== nics\n'
printf 'host\tifname\tshort_name\tpci_address\tvendor\tmodel\tdriver\tspeed_gbps\tspeed_source\tlink\tmac\tnuma\tkind\tbridge\tusage\n'

# Enumerate PCI network devices (class 0x02xxxx) rather than /sys/class/net:
# a NIC handed to a VM through vfio-pci has no kernel interface on the host at
# all, and those are exactly the ones worth documenting. PCI_ROOT is an
# override for testing against a fixture tree.
for pcidir in "${PCI_ROOT:-/sys/bus/pci/devices}"/*; do
    [ -d "$pcidir" ] || continue
    pci=${pcidir##*/}
    class=$(cat "$pcidir/class" 2>/dev/null || echo '')
    case "$class" in
        0x02*) ;;
        *) continue ;;
    esac

    # tofino.md names NICs after bus and function: 0000:65:00.1 -> "65.1".
    bus=${pci#*:}
    bus=${bus%%:*}
    short="$bus.${pci##*.}"

    driver=''
    if [ -e "$pcidir/driver" ]; then
        driver=$(readlink -f "$pcidir/driver")
        driver=${driver##*/}
    fi

    # Present only while the host owns the device; empty under vfio-pci.
    ifname=''
    for netdir in "$pcidir"/net/*; do
        if [ -d "$netdir" ]; then
            ifname=${netdir##*/}
            break
        fi
    done
    path="/sys/class/net/$ifname"

    # Link speed in Mbit/s, only knowable while the host owns the interface.
    # /sys answers just for an up link (a down port reads -1 or EINVAL, the
    # normal state of a spare testbed port), so fall back to the fastest mode
    # the NIC advertises and record which of the two it was.
    speed_mbit=''
    speed_source=''
    if [ -n "$ifname" ]; then
        if [ -r "$path/speed" ]; then
            speed_mbit=$(cat "$path/speed" 2>/dev/null || true)
        fi
        case "$speed_mbit" in
            '' | -* | *[!0-9]*) speed_mbit='' ;;
            *) speed_source=link ;;
        esac
        if [ -z "$speed_mbit" ] && command -v ethtool >/dev/null 2>&1; then
            speed_source=supported
            speed_mbit=$(ethtool "$ifname" 2>/dev/null | awk '
                {
                    while (match($0, /[0-9]+base/)) {
                        value = substr($0, RSTART, RLENGTH - 4) + 0
                        if (value > max) max = value
                        $0 = substr($0, RSTART + RLENGTH)
                    }
                }
                END { if (max) print max }')
            [ -n "$speed_mbit" ] || speed_source=''
        fi
    fi
    speed_gbps=$(awk -v mbit="${speed_mbit:-0}" \
        'BEGIN { if (mbit > 0) printf "%g", mbit / 1000 }')

    vendor=''
    model=''
    if command -v lspci >/dev/null 2>&1; then
        # -mm quotes each field: slot "class" "vendor" "device" -rXX ...
        vendor=$(lspci -mm -s "$pci" 2>/dev/null | head -n 1 | awk -F'"' '{print $4}')
        model=$(lspci -mm -s "$pci" 2>/dev/null | head -n 1 | awk -F'"' '{print $6}')
    fi
    if [ -z "$model" ] && [ -r "$pcidir/device" ]; then
        model="$(cat "$pcidir/vendor"):$(cat "$pcidir/device")"
    fi

    # -L as well as -e: a VF whose PF is not enumerated leaves a dangling link.
    kind=pf
    if [ -e "$pcidir/physfn" ] || [ -L "$pcidir/physfn" ]; then
        kind=vf
    fi

    # Bridges this NIC feeds: its own master chain (NIC -> bond -> bridge) plus
    # one hop through devices stacked on it (VLAN ens1.100 -> vmbr1).
    bridges=''
    if [ -n "$ifname" ]; then
        candidates=$ifname
        for candidate in /sys/class/net/*; do
            if [ -e "$candidate/lower_$ifname" ]; then
                candidates="$candidates ${candidate##*/}"
            fi
        done
        for current in $candidates; do
            depth=0
            while [ "$depth" -lt 4 ] && [ -L "/sys/class/net/$current/master" ]; do
                parent=$(readlink -f "/sys/class/net/$current/master")
                parent=${parent##*/}
                case ",$bridges," in
                    *",$parent,"*) ;;
                    *) bridges="${bridges:+$bridges,}$parent" ;;
                esac
                current=$parent
                depth=$((depth + 1))
            done
        done
    fi

    link=''
    mac=''
    if [ -n "$ifname" ]; then
        link=$(cat "$path/operstate" 2>/dev/null || echo unknown)
        mac=$(cat "$path/address" 2>/dev/null || true)
    elif [ "$driver" = "vfio-pci" ]; then
        # No kernel interface: the device is bound for passthrough.
        link=passthrough
    fi

    usage=$(pve_usage "$pci")

    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
        "$host" "$ifname" "$short" "$pci" "$vendor" "$model" "$driver" \
        "$speed_gbps" "$speed_source" "$link" "$mac" \
        "$(cat "$pcidir/numa_node" 2>/dev/null || true)" \
        "$kind" "$bridges" "$usage" | tr -d '\r'
done
