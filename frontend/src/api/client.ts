import type {
  AdminUsersResponse,
  BookingView,
  BookingsResponse,
  CalDavCalendarView,
  CalDavCalendarsResponse,
  CalDavStatusResponse,
  CalDavTestResponse,
  CreateBookingRequest,
  CreateCalDavCalendarRequest,
  CreateManagementPortRequest,
  CreateManagementSwitchRequest,
  CreateNicRequest,
  CreateServerRequest,
  CreateTofinoPortRequest,
  CreateTofinoRequest,
  CreateVlanRequest,
  HealthResponse,
  ImportManagementSwitchRequest,
  ImportManagementSwitchResponse,
  ImportTofinoPortsRequest,
  ImportTofinoPortsResponse,
  ManagementPort,
  ManagementPortsResponse,
  ManagementSwitch,
  ManagementSwitchesResponse,
  MeResponse,
  NicClaimView,
  NicView,
  PutNicClaimRequest,
  PublicConfigResponse,
  ServerWithNics,
  ServersResponse,
  SettingsResponse,
  Tofino,
  TofinoPort,
  TofinoPortsResponse,
  TofinosResponse,
  UpdateBookingRequest,
  UpdateCalDavCalendarRequest,
  UpdateManagementPortRequest,
  UpdateManagementSwitchRequest,
  UpdateNicRequest,
  UpdateServerRequest,
  UpdateSettingsRequest,
  UpdateTofinoPortRequest,
  UpdateTofinoRequest,
  UpdateVlanRequest,
  Vlan,
  VlansResponse,
} from './types'

// Single import point for API types — swap `./types` for the generated
// schema later without touching consumers.
export * from './types'

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? ''

export class ApiError extends Error {
  status: number
  body: unknown

  constructor(status: number, message: string, body: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

export function isBackendUnavailableError(error: unknown) {
  const status =
    error instanceof ApiError
      ? error.status
      : typeof error === 'object' && error !== null && 'status' in error
        ? Number((error as { status: unknown }).status)
        : Number.NaN
  if ([0, 500, 502, 503, 504].includes(status)) {
    return true
  }

  const message = error instanceof Error ? error.message : String(error)
  return /backend is currently unavailable|bad gateway|econnrefused|failed to fetch|networkerror/i.test(
    message,
  )
}

type JsonBody = Record<string, unknown> | undefined

export async function request<T>(
  path: string,
  options: RequestInit & { json?: JsonBody } = {},
): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.json) {
    headers.set('content-type', 'application/json')
  }

  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...options,
      headers,
      credentials: 'include',
      body: options.json ? JSON.stringify(options.json) : options.body,
    })
  } catch (error) {
    throw new ApiError(
      0,
      'Backend is currently unavailable. Please try again in a moment.',
      error,
    )
  }

  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent('rsvp:unauthorized'))
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    let body: unknown = text
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = text
      }
    }
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `Request failed with ${response.status}`
    throw new ApiError(response.status, message, body)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

function query(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      search.set(key, String(value))
    }
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

export const api = {
  loginUrl: `${apiBaseUrl}/api/v1/auth/login`,
  logout: () => request<void>('/api/v1/auth/logout', { method: 'POST' }),
  me: () => request<MeResponse>('/api/v1/auth/me'),
  health: () => request<HealthResponse>('/api/v1/health'),
  publicConfig: () => request<PublicConfigResponse>('/api/v1/config'),

  servers: () => request<ServersResponse>('/api/v1/servers'),
  tofinos: () => request<TofinosResponse>('/api/v1/tofinos'),
  /** Omit tofino_id for every port — the peer picker needs them all. */
  tofinoPorts: (params: { tofino_id?: string } = {}) =>
    request<TofinoPortsResponse>(`/api/v1/tofino-ports${query(params)}`),

  bookings: (
    params: {
      from?: number
      to?: number
      tofino_id?: string
      server_id?: string
    } = {},
  ) =>
    request<BookingsResponse>(`/api/v1/bookings${query(params)}`),
  createBooking: (body: CreateBookingRequest) =>
    request<BookingView>('/api/v1/bookings', { method: 'POST', json: body }),
  updateBooking: (id: string, body: UpdateBookingRequest) =>
    request<BookingView>(`/api/v1/bookings/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      json: body,
    }),
  deleteBooking: (id: string) =>
    request<void>(`/api/v1/bookings/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  adminUsers: () => request<AdminUsersResponse>('/api/v1/admin/users'),

  createServer: (body: CreateServerRequest) =>
    request<ServerWithNics>('/api/v1/admin/servers', {
      method: 'POST',
      json: body,
    }),
  updateServer: (id: string, body: UpdateServerRequest) =>
    request<ServerWithNics>(`/api/v1/admin/servers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      json: body,
    }),
  deleteServer: (id: string) =>
    request<void>(`/api/v1/admin/servers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  createNic: (serverId: string, body: CreateNicRequest) =>
    request<NicView>(
      `/api/v1/admin/servers/${encodeURIComponent(serverId)}/nics`,
      { method: 'POST', json: body },
    ),
  updateNic: (id: string, body: UpdateNicRequest) =>
    request<NicView>(`/api/v1/admin/nics/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      json: body,
    }),
  deleteNic: (id: string) =>
    request<void>(`/api/v1/admin/nics/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  putNicClaim: (nicId: string, body: PutNicClaimRequest) =>
    request<NicClaimView>(`/api/v1/admin/nics/${encodeURIComponent(nicId)}/claim`, {
      method: 'PUT',
      json: body,
    }),
  releaseNicClaim: (nicId: string) =>
    request<void>(`/api/v1/admin/nics/${encodeURIComponent(nicId)}/claim`, {
      method: 'DELETE',
    }),

  createTofino: (body: CreateTofinoRequest) =>
    request<Tofino>('/api/v1/admin/tofinos', { method: 'POST', json: body }),
  updateTofino: (id: string, body: UpdateTofinoRequest) =>
    request<Tofino>(`/api/v1/admin/tofinos/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      json: body,
    }),
  deleteTofino: (id: string) =>
    request<void>(`/api/v1/admin/tofinos/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  createTofinoPort: (tofinoId: string, body: CreateTofinoPortRequest) =>
    request<TofinoPort>(
      `/api/v1/admin/tofinos/${encodeURIComponent(tofinoId)}/ports`,
      { method: 'POST', json: body },
    ),
  updateTofinoPort: (id: string, body: UpdateTofinoPortRequest) =>
    request<TofinoPort>(`/api/v1/admin/tofino-ports/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      json: body,
    }),
  deleteTofinoPort: (id: string) =>
    request<void>(`/api/v1/admin/tofino-ports/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  importTofinoPorts: (tofinoId: string, body: ImportTofinoPortsRequest) =>
    request<ImportTofinoPortsResponse>(
      `/api/v1/admin/tofinos/${encodeURIComponent(tofinoId)}/ports/import`,
      { method: 'POST', json: body },
    ),

  // Management switches, VLANs and ports (admin-only).
  managementSwitches: () =>
    request<ManagementSwitchesResponse>('/api/v1/management-switches'),
  createManagementSwitch: (body: CreateManagementSwitchRequest) =>
    request<ManagementSwitch>('/api/v1/admin/management-switches', {
      method: 'POST',
      json: body,
    }),
  updateManagementSwitch: (id: string, body: UpdateManagementSwitchRequest) =>
    request<ManagementSwitch>(
      `/api/v1/admin/management-switches/${encodeURIComponent(id)}`,
      { method: 'PATCH', json: body },
    ),
  deleteManagementSwitch: (id: string) =>
    request<void>(`/api/v1/admin/management-switches/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  importManagementSwitch: (id: string, body: ImportManagementSwitchRequest) =>
    request<ImportManagementSwitchResponse>(
      `/api/v1/admin/management-switches/${encodeURIComponent(id)}/import`,
      { method: 'POST', json: body },
    ),

  /** Omit switch_id for every port — the peer picker/topology need them all. */
  managementPorts: (params: { switch_id?: string } = {}) =>
    request<ManagementPortsResponse>(
      `/api/v1/management-switch-ports${query(params)}`,
    ),
  createManagementPort: (switchId: string, body: CreateManagementPortRequest) =>
    request<ManagementPort>(
      `/api/v1/admin/management-switches/${encodeURIComponent(switchId)}/ports`,
      { method: 'POST', json: body },
    ),
  updateManagementPort: (id: string, body: UpdateManagementPortRequest) =>
    request<ManagementPort>(
      `/api/v1/admin/management-switch-ports/${encodeURIComponent(id)}`,
      { method: 'PATCH', json: body },
    ),

  vlans: () => request<VlansResponse>('/api/v1/vlans'),
  createVlan: (body: CreateVlanRequest) =>
    request<Vlan>('/api/v1/admin/vlans', { method: 'POST', json: body }),
  updateVlan: (id: string, body: UpdateVlanRequest) =>
    request<Vlan>(`/api/v1/admin/vlans/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      json: body,
    }),
  deleteVlan: (id: string) =>
    request<void>(`/api/v1/admin/vlans/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  settings: () => request<SettingsResponse>('/api/v1/admin/settings'),
  updateSettings: (body: UpdateSettingsRequest) =>
    request<SettingsResponse>('/api/v1/admin/settings', {
      method: 'PUT',
      json: { settings: body },
    }),

  caldavCalendars: () =>
    request<CalDavCalendarsResponse>('/api/v1/admin/caldav/calendars'),
  createCalDavCalendar: (body: CreateCalDavCalendarRequest) =>
    request<CalDavCalendarView>('/api/v1/admin/caldav/calendars', {
      method: 'POST',
      json: body,
    }),
  updateCalDavCalendar: (id: string, body: UpdateCalDavCalendarRequest) =>
    request<CalDavCalendarView>(
      `/api/v1/admin/caldav/calendars/${encodeURIComponent(id)}`,
      { method: 'PATCH', json: body },
    ),
  deleteCalDavCalendar: (id: string) =>
    request<void>(
      `/api/v1/admin/caldav/calendars/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    ),
  testCalDavCalendar: (id: string) =>
    request<CalDavTestResponse>(
      `/api/v1/admin/caldav/calendars/${encodeURIComponent(id)}/test`,
      { method: 'POST' },
    ),
  caldavResync: () =>
    request<void>('/api/v1/admin/caldav/resync', { method: 'POST' }),
  caldavStatus: () =>
    request<CalDavStatusResponse>('/api/v1/admin/caldav/status'),
}
