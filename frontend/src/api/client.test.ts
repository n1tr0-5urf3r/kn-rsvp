import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api, request } from './client'

function mockFetch(response: Partial<Response> & { jsonBody?: unknown }) {
  const { jsonBody, ...rest } = response
  const body = jsonBody === undefined ? '' : JSON.stringify(jsonBody)
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: rest.status !== undefined ? rest.status < 400 : true,
    status: 200,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(jsonBody),
    ...rest,
  } as Response)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('request', () => {
  it('dispatches rsvp:unauthorized on 401 and throws ApiError', async () => {
    mockFetch({ ok: false, status: 401, jsonBody: { error: 'unauthorized' } })
    const listener = vi.fn()
    window.addEventListener('rsvp:unauthorized', listener)

    await expect(request('/api/v1/auth/me')).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      message: 'unauthorized',
    })
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener('rsvp:unauthorized', listener)
  })

  it('does not dispatch the event on other errors', async () => {
    mockFetch({ ok: false, status: 409, jsonBody: { error: 'slot already booked' } })
    const listener = vi.fn()
    window.addEventListener('rsvp:unauthorized', listener)

    try {
      await request('/api/v1/bookings', { method: 'POST', json: {} })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      expect((error as ApiError).status).toBe(409)
      expect((error as ApiError).message).toBe('slot already booked')
    }
    expect(listener).not.toHaveBeenCalled()
    window.removeEventListener('rsvp:unauthorized', listener)
  })

  it('sends credentials and JSON bodies', async () => {
    const spy = mockFetch({ status: 200, jsonBody: { ok: true } })
    await api.createBooking({
      tofino_id: 't1',
      start_ts: 3600,
      end_ts: 7200,
    })
    expect(spy).toHaveBeenCalledTimes(1)
    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/bookings')
    expect(init.credentials).toBe('include')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      tofino_id: 't1',
      start_ts: 3600,
      end_ts: 7200,
    })
    expect(new Headers(init.headers).get('content-type')).toBe(
      'application/json',
    )
  })

  it('returns undefined for 204 responses', async () => {
    mockFetch({ status: 204, jsonBody: undefined })
    await expect(api.deleteBooking('b1')).resolves.toBeUndefined()
  })

  it('wraps network failures as status-0 ApiError', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'))
    await expect(request('/api/v1/servers')).rejects.toMatchObject({
      name: 'ApiError',
      status: 0,
    })
  })
})
