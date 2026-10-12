import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  api,
  type CreateBookingRequest,
  type CreateCalDavCalendarRequest,
  type CreateNicRequest,
  type CreateServerRequest,
  type CreateManagementPortRequest,
  type CreateManagementSwitchRequest,
  type CreateTofinoPortRequest,
  type CreateTofinoRequest,
  type CreateVlanRequest,
  type ImportManagementSwitchRequest,
  type PutNicClaimRequest,
  type UpdateBookingRequest,
  type UpdateCalDavCalendarRequest,
  type UpdateManagementPortRequest,
  type UpdateManagementSwitchRequest,
  type UpdateNicRequest,
  type UpdateServerRequest,
  type UpdateSettingsRequest,
  type UpdateTofinoPortRequest,
  type UpdateTofinoRequest,
  type UpdateVlanRequest,
} from './client'

export const queryKeys = {
  me: ['me'] as const,
  servers: ['servers'] as const,
  tofinos: ['tofinos'] as const,
  tofinoPorts: (tofinoId?: string) =>
    ['tofino-ports', tofinoId ?? 'all'] as const,
  bookings: (
    params: {
      from?: number
      to?: number
      tofino_id?: string
      server_id?: string
    } = {},
  ) =>
    ['bookings', params] as const,
  managementSwitches: ['management-switches'] as const,
  managementPorts: (switchId?: string) =>
    ['management-switch-ports', switchId ?? 'all'] as const,
  vlans: ['vlans'] as const,
  adminUsers: ['admin', 'users'] as const,
  settings: ['admin', 'settings'] as const,
  caldavCalendars: ['admin', 'caldav', 'calendars'] as const,
  caldavStatus: ['admin', 'caldav', 'status'] as const,
}

export function useMe() {
  return useQuery({ queryKey: queryKeys.me, queryFn: api.me, retry: false })
}

export function useServers() {
  return useQuery({ queryKey: queryKeys.servers, queryFn: api.servers })
}

export function useTofinos() {
  return useQuery({ queryKey: queryKeys.tofinos, queryFn: api.tofinos })
}

/** Omit the id for every Tofino's ports (the peer picker needs them all). */
export function useTofinoPorts(tofinoId?: string) {
  return useQuery({
    queryKey: queryKeys.tofinoPorts(tofinoId),
    queryFn: () => api.tofinoPorts({ tofino_id: tofinoId }),
  })
}

export function useBookings(
  params: {
    from?: number
    to?: number
    tofino_id?: string
    server_id?: string
  } = {},
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.bookings(params),
    queryFn: () => api.bookings(params),
    enabled,
  })
}

export function useAdminUsers(enabled = true) {
  return useQuery({
    queryKey: queryKeys.adminUsers,
    queryFn: api.adminUsers,
    enabled,
    staleTime: 60_000,
  })
}

function useInvalidate() {
  const queryClient = useQueryClient()
  return (...keys: readonly (readonly unknown[])[]) =>
    Promise.all(
      keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    )
}

/* ------------------------------- Bookings ------------------------------- */

export function useCreateBookingMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (body: CreateBookingRequest) => api.createBooking(body),
    onSuccess: () => invalidate(['bookings']),
  })
}

export function useUpdateBookingMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateBookingRequest }) =>
      api.updateBooking(id, body),
    onSuccess: () => invalidate(['bookings']),
  })
}

export function useDeleteBookingMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => api.deleteBooking(id),
    onSuccess: () => invalidate(['bookings']),
  })
}

/* ---------------------------- Admin: devices ---------------------------- */

export function useCreateServerMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (body: CreateServerRequest) => api.createServer(body),
    onSuccess: () => invalidate(queryKeys.servers),
  })
}

export function useUpdateServerMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateServerRequest }) =>
      api.updateServer(id, body),
    onSuccess: () => invalidate(queryKeys.servers),
  })
}

export function useDeleteServerMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => api.deleteServer(id),
    onSuccess: () => invalidate(queryKeys.servers, ['tofino-ports']),
  })
}

export function useCreateNicMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({
      serverId,
      body,
    }: {
      serverId: string
      body: CreateNicRequest
    }) => api.createNic(serverId, body),
    onSuccess: () => invalidate(queryKeys.servers),
  })
}

export function useUpdateNicMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateNicRequest }) =>
      api.updateNic(id, body),
    onSuccess: () => invalidate(queryKeys.servers),
  })
}

export function useDeleteNicMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => api.deleteNic(id),
    onSuccess: () => invalidate(queryKeys.servers, ['tofino-ports']),
  })
}

export function usePutNicClaimMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({
      nicId,
      body,
    }: {
      nicId: string
      body: PutNicClaimRequest
    }) => api.putNicClaim(nicId, body),
    onSuccess: () => invalidate(queryKeys.servers, ['tofino-ports']),
  })
}

export function useReleaseNicClaimMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (nicId: string) => api.releaseNicClaim(nicId),
    onSuccess: () => invalidate(queryKeys.servers),
  })
}

/** Frees a NIC: clears claim and "used by", unplugs its cable on both ends. */
export function useFreeNicMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (nicId: string) => api.freeNic(nicId),
    onSuccess: () =>
      invalidate(
        queryKeys.servers,
        ['tofino-ports'],
        ['management-switch-ports'],
      ),
  })
}

/* ---------------------------- Admin: tofinos ---------------------------- */

export function useCreateTofinoMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (body: CreateTofinoRequest) => api.createTofino(body),
    onSuccess: () => invalidate(queryKeys.tofinos),
  })
}

export function useUpdateTofinoMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateTofinoRequest }) =>
      api.updateTofino(id, body),
    onSuccess: () => invalidate(queryKeys.tofinos, ['bookings']),
  })
}

export function useDeleteTofinoMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => api.deleteTofino(id),
    onSuccess: () => invalidate(queryKeys.tofinos, ['bookings']),
  })
}

/* -------------------------- Admin: Tofino ports -------------------------- */

export function useCreateTofinoPortMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({
      tofinoId,
      body,
    }: {
      tofinoId: string
      body: CreateTofinoPortRequest
    }) => api.createTofinoPort(tofinoId, body),
    onSuccess: () => invalidate(['tofino-ports']),
  })
}

export function useUpdateTofinoPortMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateTofinoPortRequest }) =>
      api.updateTofinoPort(id, body),
    // A port↔NIC link is visible in both inventories.
    onSuccess: () => invalidate(['tofino-ports'], queryKeys.servers),
  })
}

export function useDeleteTofinoPortMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => api.deleteTofinoPort(id),
    onSuccess: () => invalidate(['tofino-ports'], queryKeys.servers),
  })
}

export function useImportTofinoPortsMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ tofinoId, markdown }: { tofinoId: string; markdown: string }) =>
      api.importTofinoPorts(tofinoId, { markdown }),
    onSuccess: () => invalidate(['tofino-ports'], queryKeys.servers),
  })
}

/* ------------------------- Management switches -------------------------- */

export function useManagementSwitches(enabled = true) {
  return useQuery({
    queryKey: queryKeys.managementSwitches,
    queryFn: api.managementSwitches,
    enabled,
  })
}

/** Omit the id for every switch's ports (peer picker / topology need all). */
export function useManagementPorts(switchId?: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.managementPorts(switchId),
    queryFn: () => api.managementPorts({ switch_id: switchId }),
    enabled,
  })
}

export function useVlans(enabled = true) {
  return useQuery({
    queryKey: queryKeys.vlans,
    queryFn: api.vlans,
    enabled,
  })
}

export function useCreateManagementSwitchMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (body: CreateManagementSwitchRequest) =>
      api.createManagementSwitch(body),
    onSuccess: () => invalidate(queryKeys.managementSwitches),
  })
}

export function useUpdateManagementSwitchMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string
      body: UpdateManagementSwitchRequest
    }) => api.updateManagementSwitch(id, body),
    onSuccess: () => invalidate(queryKeys.managementSwitches),
  })
}

export function useDeleteManagementSwitchMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => api.deleteManagementSwitch(id),
    onSuccess: () =>
      invalidate(
        queryKeys.managementSwitches,
        ['management-switch-ports'],
        queryKeys.servers,
        queryKeys.tofinos,
      ),
  })
}

export function useImportManagementSwitchMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string
      body: ImportManagementSwitchRequest
    }) => api.importManagementSwitch(id, body),
    onSuccess: () =>
      invalidate(['management-switch-ports'], queryKeys.vlans),
  })
}

/** A link touches management ports, servers (NIC mirror) and tofinos (mgmt). */
function invalidateManagementLinks() {
  return [
    ['management-switch-ports'] as const,
    queryKeys.servers,
    queryKeys.tofinos,
  ]
}

export function useCreateManagementPortMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({
      switchId,
      body,
    }: {
      switchId: string
      body: CreateManagementPortRequest
    }) => api.createManagementPort(switchId, body),
    onSuccess: () => invalidate(['management-switch-ports']),
  })
}

export function useUpdateManagementPortMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string
      body: UpdateManagementPortRequest
    }) => api.updateManagementPort(id, body),
    onSuccess: () => invalidate(...invalidateManagementLinks()),
  })
}

export function useCreateVlanMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (body: CreateVlanRequest) => api.createVlan(body),
    onSuccess: () => invalidate(queryKeys.vlans),
  })
}

export function useUpdateVlanMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateVlanRequest }) =>
      api.updateVlan(id, body),
    onSuccess: () => invalidate(queryKeys.vlans, ['management-switch-ports']),
  })
}

export function useDeleteVlanMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => api.deleteVlan(id),
    onSuccess: () => invalidate(queryKeys.vlans, ['management-switch-ports']),
  })
}

/* ---------------------------- Admin: settings ---------------------------- */

export function useSettings(enabled = true) {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: api.settings,
    enabled,
  })
}

export function useUpdateSettingsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateSettingsRequest) => api.updateSettings(body),
    onSuccess: (data) => queryClient.setQueryData(queryKeys.settings, data),
  })
}

/* ----------------------------- Admin: CalDAV ----------------------------- */

export function useCalDavCalendars(enabled = true) {
  return useQuery({
    queryKey: queryKeys.caldavCalendars,
    queryFn: api.caldavCalendars,
    enabled,
  })
}

export function useCalDavStatus(enabled = true) {
  return useQuery({
    queryKey: queryKeys.caldavStatus,
    queryFn: api.caldavStatus,
    enabled,
    refetchInterval: 5_000,
  })
}

export function useCreateCalDavCalendarMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (body: CreateCalDavCalendarRequest) =>
      api.createCalDavCalendar(body),
    onSuccess: () => invalidate(queryKeys.caldavCalendars),
  })
}

export function useUpdateCalDavCalendarMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string
      body: UpdateCalDavCalendarRequest
    }) => api.updateCalDavCalendar(id, body),
    onSuccess: () => invalidate(queryKeys.caldavCalendars),
  })
}

export function useDeleteCalDavCalendarMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => api.deleteCalDavCalendar(id),
    onSuccess: () =>
      invalidate(queryKeys.caldavCalendars, queryKeys.caldavStatus),
  })
}

export function useTestCalDavCalendarMutation() {
  return useMutation({
    mutationFn: (id: string) => api.testCalDavCalendar(id),
  })
}

export function useCalDavResyncMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: () => api.caldavResync(),
    onSuccess: () => invalidate(queryKeys.caldavStatus),
  })
}
