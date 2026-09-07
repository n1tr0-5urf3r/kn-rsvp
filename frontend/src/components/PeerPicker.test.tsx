import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ServerWithNics, TofinoPort } from '../api/types'
import {
  PeerPicker,
  peerInputFromDraft,
  type PeerDraft,
} from './PeerPicker'

const port = {
  id: 'port-1',
  tofino_id: 'tofino-1',
  tofino_name: 'Carrie',
  fp_port: '1/0',
  speed_gbps: 100,
} as TofinoPort

const servers = [
  {
    id: 'server-1',
    name: 'Pennywise',
    nics: [
      { id: 'nic-source', name: '65.0', ifname: 'ens1f0' },
      { id: 'nic-target', name: '65.1', ifname: 'ens1f1' },
    ],
  },
] as ServerWithNics[]

describe('PeerPicker', () => {
  it('uses short cascading device and endpoint menus', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const draft: PeerDraft = {
      kind: 'nic',
      deviceId: 'server-1',
      endpointId: '',
      text: '',
    }
    render(
      <PeerPicker
        draft={draft}
        onChange={onChange}
        ports={[port]}
        servers={servers}
        excludeNicId="nic-source"
      />,
    )

    expect(screen.getByRole('combobox', { name: 'Server' })).toHaveValue(
      'server-1',
    )
    const nicMenu = screen.getByRole('combobox', { name: 'NIC' })
    expect(
      screen.queryByRole('option', { name: /65\.0/ }),
    ).not.toBeInTheDocument()
    await user.selectOptions(nicMenu, 'nic-target')
    expect(onChange).toHaveBeenCalledWith({
      ...draft,
      endpointId: 'nic-target',
    })
  })

  it('converts complete drafts and rejects incomplete endpoint choices', () => {
    expect(
      peerInputFromDraft({
        kind: 'nic',
        deviceId: 'server-1',
        endpointId: 'nic-target',
        text: '',
      }),
    ).toEqual({ kind: 'nic', nic_id: 'nic-target' })
    expect(
      peerInputFromDraft({
        kind: 'port',
        deviceId: 'tofino-1',
        endpointId: '',
        text: '',
      }),
    ).toBeNull()
  })
})
