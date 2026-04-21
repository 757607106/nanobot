import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from './api'

function okResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    headers: {
      get: () => 'application/json',
    },
    json: async () => ({
      success: true,
      data,
    }),
  } as Response
}

describe('tenant control plane api headers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the default tenant selection for list and create requests', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okResponse([]))
      .mockResolvedValueOnce(okResponse({ tenantId: 'tenant-a' }))
    vi.stubGlobal('fetch', fetchMock)

    await api.getTenants()
    await api.createTenant({ name: 'Tenant A' })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/tenants',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'x-tenant-id': 'default',
        }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/tenants',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'x-tenant-id': 'default',
        }),
      }),
    )
  })

  it('sends the target tenant id for tenant scoped control plane routes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okResponse({ tenantId: 'tenant-a' }))
      .mockResolvedValueOnce(okResponse([]))
      .mockResolvedValueOnce(okResponse({ deleted: true }))
    vi.stubGlobal('fetch', fetchMock)

    await api.getTenant('tenant-a')
    await api.getTenantApiKeys('tenant-a')
    await api.revokeApiKey('key-1', 'tenant-a')

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/tenants/tenant-a',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'x-tenant-id': 'tenant-a',
        }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/tenants/tenant-a/api-keys',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'x-tenant-id': 'tenant-a',
        }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/api-keys/key-1',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'x-tenant-id': 'tenant-a',
        }),
      }),
    )
  })
})
