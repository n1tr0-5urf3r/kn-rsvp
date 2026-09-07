import type {
  ManagementPort,
  ManagementSwitch,
  NicPeerInput,
  ServerWithNics,
  TofinoPort,
} from '../api/types'
import { FieldLabel, Select, TextInput } from './Select'

export type PeerDraft = {
  kind: 'none' | 'port' | 'mgmt' | 'nic' | 'text'
  deviceId: string
  endpointId: string
  text: string
}

/**
 * Returns the API request shape for a draft. Typed as `NicPeerInput` because
 * that's a superset of `PortPeerInput` (it additionally allows `mgmt`); the
 * Tofino-port editor never lets a draft reach `kind: 'mgmt'` since it doesn't
 * pass the `managementSwitches`/`managementPorts` props, so it narrows the
 * result back to `PortPeerInput` with a cast.
 */
export function peerInputFromDraft(draft: PeerDraft): NicPeerInput | null {
  if (draft.kind === 'none') {
    return { kind: 'none' }
  }
  if (draft.kind === 'port') {
    return draft.endpointId
      ? { kind: 'port', port_id: draft.endpointId }
      : null
  }
  if (draft.kind === 'mgmt') {
    return draft.endpointId
      ? { kind: 'mgmt', port_id: draft.endpointId }
      : null
  }
  if (draft.kind === 'nic') {
    return draft.endpointId
      ? { kind: 'nic', nic_id: draft.endpointId }
      : null
  }
  return draft.text.trim()
    ? { kind: 'text', text: draft.text.trim() }
    : null
}

export function PeerPicker({
  draft,
  onChange,
  ports,
  servers,
  excludePortId,
  excludeNicId,
  managementSwitches,
  managementPorts,
}: {
  draft: PeerDraft
  onChange: (draft: PeerDraft) => void
  ports: TofinoPort[]
  servers: ServerWithNics[]
  excludePortId?: string
  excludeNicId?: string
  /** When both are non-empty, offers "Management switch port" as a connection type. */
  managementSwitches?: ManagementSwitch[]
  managementPorts?: ManagementPort[]
}) {
  const tofinos = [
    ...new Map(
      ports.map((port) => [
        port.tofino_id,
        { id: port.tofino_id, name: port.tofino_name },
      ]),
    ).values(),
  ]
  const selectedPorts = ports.filter(
    (port) =>
      port.tofino_id === draft.deviceId && port.id !== excludePortId,
  )
  const selectedServer = servers.find(
    (server) => server.id === draft.deviceId,
  )
  const selectedNics =
    selectedServer?.nics.filter((nic) => nic.id !== excludeNicId) ?? []
  const offerManagementPorts = Boolean(
    managementSwitches?.length && managementPorts?.length,
  )
  const selectedManagementPorts = (managementPorts ?? []).filter(
    (port) => port.switch_id === draft.deviceId,
  )

  const changeKind = (kind: PeerDraft['kind']) => {
    onChange({
      kind,
      deviceId: '',
      endpointId: '',
      text: kind === 'text' ? draft.text : '',
    })
  }

  return (
    <div className="space-y-3">
      <FieldLabel label="Connection type">
        <Select
          value={draft.kind}
          onChange={(event) =>
            changeKind(event.target.value as PeerDraft['kind'])
          }
        >
          <option value="none">Not connected</option>
          <option value="port">Tofino port</option>
          {offerManagementPorts ? (
            <option value="mgmt">Management switch port</option>
          ) : null}
          <option value="nic">Server NIC</option>
          <option value="text">Other / free text</option>
        </Select>
      </FieldLabel>

      {draft.kind === 'mgmt' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="Switch">
            <Select
              value={draft.deviceId}
              onChange={(event) =>
                onChange({
                  ...draft,
                  deviceId: event.target.value,
                  endpointId: '',
                })
              }
              required
            >
              <option value="" disabled>
                Select a switch…
              </option>
              {(managementSwitches ?? []).map((sw) => (
                <option key={sw.id} value={sw.id}>
                  {sw.name}
                </option>
              ))}
            </Select>
          </FieldLabel>
          <FieldLabel label="Port">
            <Select
              value={draft.endpointId}
              onChange={(event) =>
                onChange({ ...draft, endpointId: event.target.value })
              }
              disabled={!draft.deviceId}
              required
            >
              <option value="" disabled>
                Select a port…
              </option>
              {selectedManagementPorts.map((port) => (
                <option key={port.id} value={port.id}>
                  {port.name}
                </option>
              ))}
            </Select>
          </FieldLabel>
        </div>
      ) : null}

      {draft.kind === 'port' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="Tofino">
            <Select
              value={draft.deviceId}
              onChange={(event) =>
                onChange({
                  ...draft,
                  deviceId: event.target.value,
                  endpointId: '',
                })
              }
              required
            >
              <option value="" disabled>
                Select a Tofino…
              </option>
              {tofinos.map((tofino) => (
                <option key={tofino.id} value={tofino.id}>
                  {tofino.name}
                </option>
              ))}
            </Select>
          </FieldLabel>
          <FieldLabel label="Port">
            <Select
              value={draft.endpointId}
              onChange={(event) =>
                onChange({ ...draft, endpointId: event.target.value })
              }
              disabled={!draft.deviceId}
              required
            >
              <option value="" disabled>
                Select a port…
              </option>
              {selectedPorts.map((port) => (
                <option key={port.id} value={port.id}>
                  {port.fp_port}
                  {port.speed_gbps ? ` · ${port.speed_gbps} Gbit/s` : ''}
                </option>
              ))}
            </Select>
          </FieldLabel>
        </div>
      ) : null}

      {draft.kind === 'nic' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="Server">
            <Select
              value={draft.deviceId}
              onChange={(event) =>
                onChange({
                  ...draft,
                  deviceId: event.target.value,
                  endpointId: '',
                })
              }
              required
            >
              <option value="" disabled>
                Select a server…
              </option>
              {servers
                .filter((server) =>
                  server.nics.some((nic) => nic.id !== excludeNicId),
                )
                .map((server) => (
                  <option key={server.id} value={server.id}>
                    {server.name}
                  </option>
                ))}
            </Select>
          </FieldLabel>
          <FieldLabel label="NIC">
            <Select
              value={draft.endpointId}
              onChange={(event) =>
                onChange({ ...draft, endpointId: event.target.value })
              }
              disabled={!draft.deviceId}
              required
            >
              <option value="" disabled>
                Select a NIC…
              </option>
              {selectedNics.map((nic) => (
                <option key={nic.id} value={nic.id}>
                  {nic.name}
                  {nic.ifname ? ` · ${nic.ifname}` : ''}
                </option>
              ))}
            </Select>
          </FieldLabel>
        </div>
      ) : null}

      {draft.kind === 'text' ? (
        <FieldLabel label="Plugged into (free text)">
          <TextInput
            value={draft.text}
            onChange={(event) =>
              onChange({ ...draft, text: event.target.value })
            }
            placeholder="e.g. patch panel rack 7"
            required
          />
        </FieldLabel>
      ) : null}
    </div>
  )
}
