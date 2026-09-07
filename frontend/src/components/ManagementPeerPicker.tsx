import type {
  ManagementPeerInput,
  ManagementPort,
  ServerWithNics,
  Tofino,
} from '../api/types'
import { FieldLabel, Select, TextInput } from './Select'

export type ManagementPeerDraft = {
  kind: 'none' | 'port' | 'nic' | 'tofino' | 'server' | 'text'
  deviceId: string
  endpointId: string
  text: string
}

export function managementPeerInputFromDraft(
  draft: ManagementPeerDraft,
): ManagementPeerInput | null {
  switch (draft.kind) {
    case 'none':
      return { kind: 'none' }
    case 'port':
      return draft.endpointId ? { kind: 'port', port_id: draft.endpointId } : null
    case 'nic':
      return draft.endpointId ? { kind: 'nic', nic_id: draft.endpointId } : null
    case 'tofino':
      return draft.endpointId
        ? { kind: 'tofino', tofino_id: draft.endpointId }
        : null
    case 'server':
      return draft.deviceId
        ? { kind: 'server', server_id: draft.deviceId }
        : null
    case 'text':
      return draft.text.trim() ? { kind: 'text', text: draft.text.trim() } : null
  }
}

/** Turns an existing port's stored peer into an editable draft. */
export function draftFromPort(port: ManagementPort): ManagementPeerDraft {
  if (port.peer_port_id) {
    return {
      kind: 'port',
      deviceId: port.peer_port_switch_id ?? '',
      endpointId: port.peer_port_id,
      text: '',
    }
  }
  if (port.peer_nic_id) {
    return {
      kind: 'nic',
      deviceId: port.peer_nic_server_id ?? '',
      endpointId: port.peer_nic_id,
      text: '',
    }
  }
  if (port.peer_tofino_id) {
    return { kind: 'tofino', deviceId: '', endpointId: port.peer_tofino_id, text: '' }
  }
  if (port.peer_server_id) {
    return { kind: 'server', deviceId: port.peer_server_id, endpointId: '', text: '' }
  }
  if (port.peer_text) {
    return { kind: 'text', deviceId: '', endpointId: '', text: port.peer_text }
  }
  return { kind: 'none', deviceId: '', endpointId: '', text: '' }
}

export function ManagementPeerPicker({
  draft,
  onChange,
  ports,
  servers,
  tofinos,
  excludePortId,
}: {
  draft: ManagementPeerDraft
  onChange: (draft: ManagementPeerDraft) => void
  ports: ManagementPort[]
  servers: ServerWithNics[]
  tofinos: Tofino[]
  excludePortId?: string
}) {
  const switches = [
    ...new Map(
      ports.map((port) => [
        port.switch_id,
        { id: port.switch_id, name: port.switch_name },
      ]),
    ).values(),
  ]
  const selectedPorts = ports.filter(
    (port) => port.switch_id === draft.deviceId && port.id !== excludePortId,
  )
  const selectedServer = servers.find((server) => server.id === draft.deviceId)
  const selectedNics = selectedServer?.nics ?? []

  const changeKind = (kind: ManagementPeerDraft['kind']) => {
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
            changeKind(event.target.value as ManagementPeerDraft['kind'])
          }
        >
          <option value="none">Not connected</option>
          <option value="port">Management switch port</option>
          <option value="nic">Server NIC</option>
          <option value="tofino">Tofino management port</option>
          <option value="server">Server (IPMI — no specific NIC)</option>
          <option value="text">Other / free text</option>
        </Select>
      </FieldLabel>

      {draft.kind === 'port' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="Switch">
            <Select
              value={draft.deviceId}
              onChange={(event) =>
                onChange({ ...draft, deviceId: event.target.value, endpointId: '' })
              }
              required
            >
              <option value="" disabled>
                Select a switch…
              </option>
              {switches.map((sw) => (
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
              {selectedPorts.map((port) => (
                <option key={port.id} value={port.id}>
                  {port.name}
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
                onChange({ ...draft, deviceId: event.target.value, endpointId: '' })
              }
              required
            >
              <option value="" disabled>
                Select a server…
              </option>
              {servers
                .filter((server) => server.nics.length > 0)
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

      {draft.kind === 'tofino' ? (
        <FieldLabel label="Tofino">
          <Select
            value={draft.endpointId}
            onChange={(event) =>
              onChange({ ...draft, endpointId: event.target.value })
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
      ) : null}

      {draft.kind === 'server' ? (
        <FieldLabel label="Server">
          <Select
            value={draft.deviceId}
            onChange={(event) =>
              onChange({ ...draft, deviceId: event.target.value, endpointId: '' })
            }
            required
          >
            <option value="" disabled>
              Select a server…
            </option>
            {servers.map((server) => (
              <option key={server.id} value={server.id}>
                {server.name}
              </option>
            ))}
          </Select>
        </FieldLabel>
      ) : null}

      {draft.kind === 'text' ? (
        <FieldLabel label="Plugged into (free text)">
          <TextInput
            value={draft.text}
            onChange={(event) => onChange({ ...draft, text: event.target.value })}
            placeholder="e.g. uplink to core"
            required
          />
        </FieldLabel>
      ) : null}
    </div>
  )
}
