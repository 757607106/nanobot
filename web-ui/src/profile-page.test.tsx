import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProfilePage from './pages/ProfilePage'
import { renderWithProviders } from './test/renderApp'

const mockApi = vi.hoisted(() => ({
  getAuthStatus: vi.fn(),
  getSetupStatus: vi.fn(),
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
  rotateProfilePassword: vi.fn(),
  uploadProfileAvatar: vi.fn(),
  deleteProfileAvatar: vi.fn(),
}))

vi.mock('./api', () => ({
  ApiError: class MockApiError extends Error {
    statusCode = 0
    code?: string
    details?: unknown
  },
  api: mockApi,
}))

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    username: 'admin',
    displayName: 'Console Owner',
    email: 'owner@example.com',
    hasAvatar: true,
    avatarUpdatedAt: '2026-03-13T12:45:00Z',
    avatarUrl: '/api/v1/profile/avatar?v=2026-03-13T12:45:00Z',
    createdAt: '2026-03-13T10:00:00Z',
    updatedAt: '2026-03-13T12:45:00Z',
    ...overrides,
  }
}

function renderPage() {
  return renderWithProviders(<ProfilePage />)
}

describe('ProfilePage', () => {
  beforeEach(() => {
    mockApi.getAuthStatus.mockReset()
    mockApi.getSetupStatus.mockReset()
    mockApi.getProfile.mockReset()
    mockApi.updateProfile.mockReset()
    mockApi.rotateProfilePassword.mockReset()
    mockApi.uploadProfileAvatar.mockReset()
    mockApi.deleteProfileAvatar.mockReset()

    mockApi.getAuthStatus.mockResolvedValue({
      initialized: true,
      authenticated: true,
      username: 'admin',
    })
    mockApi.getSetupStatus.mockResolvedValue({
      completed: true,
      currentStep: 'done',
      completedAt: '2026-03-20T10:00:00Z',
      steps: [],
    })
    mockApi.getProfile.mockResolvedValue(makeProfile())
    mockApi.updateProfile.mockResolvedValue({
      profile: makeProfile({ displayName: 'Studio Owner', email: 'studio@example.com' }),
      auth: {
        initialized: true,
        authenticated: true,
        username: 'admin',
      },
    })
  })

  it('renders the reference-style account management layout', async () => {
    renderPage()

    expect(await screen.findByText('账户管理')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /编辑资料/ }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /修改密码/ }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /头像管理/ }).length).toBeGreaterThan(0)
    expect(screen.getByText('owner@example.com')).toBeInTheDocument()
  })

  it('saves profile updates through the profile endpoint', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('owner@example.com')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: /编辑资料/ })[0])
    await user.clear(screen.getByLabelText('展示名称'))
    await user.type(screen.getByLabelText('展示名称'), 'Studio Owner')
    await user.clear(screen.getByLabelText('邮箱'))
    await user.type(screen.getByLabelText('邮箱'), 'studio@example.com')
    await user.click(screen.getByRole('button', { name: /保\s*存/ }))

    await waitFor(() => {
      expect(mockApi.updateProfile).toHaveBeenCalledTimes(1)
    })

    expect(mockApi.updateProfile.mock.calls[0][0]).toEqual({
      username: 'admin',
      displayName: 'Studio Owner',
      email: 'studio@example.com',
    })
  })
})
