import { useEffect, useRef, useState } from 'react'
import { Alert, App, Button, Card, Empty, Input, Space, Spin, Tag, Typography } from 'antd'
import { DeleteOutlined, ReloadOutlined, SaveOutlined, UploadOutlined, UserOutlined } from '@ant-design/icons'
import { api, ApiError } from '../api'
import PageHero from '../components/PageHero'
import { formatDateTimeZh } from '../locale'
import { useAuth } from '../auth'
import { testIds } from '../testIds'
import type { ProfileData } from '../types'

const { Text } = Typography

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
}

function profileLabel(profile: ProfileData | null) {
  if (!profile) {
    return '--'
  }
  return profile.displayName || profile.username
}

export default function ProfilePage() {
  const { message } = App.useApp()
  const { refresh } = useAuth()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [avatarError, setAvatarError] = useState<string | null>(null)

  useEffect(() => {
    void loadProfile()
  }, [])

  function applyProfile(next: ProfileData) {
    setProfile(next)
    setUsername(next.username)
    setDisplayName(next.displayName || '')
    setEmail(next.email || '')
  }

  async function loadProfile() {
    try {
      setLoading(true)
      const next = await api.getProfile()
      applyProfile(next)
      setProfileError(null)
      setPasswordError(null)
      setAvatarError(null)
    } catch (error) {
      setProfileError(getErrorMessage(error, '加载管理员资料失败'))
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveProfile() {
    const cleanUsername = username.trim()
    if (cleanUsername.length < 3) {
      setProfileError('管理员名称至少需要 3 个字符。')
      return
    }

    try {
      setSavingProfile(true)
      const result = await api.updateProfile({
        username: cleanUsername,
        displayName: displayName.trim() || null,
        email: email.trim() || null,
      })
      applyProfile(result.profile)
      setProfileError(null)
      await refresh()
      message.success('管理员资料已保存')
    } catch (error) {
      setProfileError(getErrorMessage(error, '保存管理员资料失败'))
    } finally {
      setSavingProfile(false)
    }
  }

  async function handleRotatePassword() {
    if (currentPassword.length < 8) {
      setPasswordError('当前密码至少需要 8 个字符。')
      return
    }
    if (newPassword.length < 8) {
      setPasswordError('新密码至少需要 8 个字符。')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('两次输入的新密码不一致。')
      return
    }

    try {
      setSavingPassword(true)
      const result = await api.rotateProfilePassword({
        currentPassword,
        newPassword,
      })
      applyProfile(result.profile)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordError(null)
      await refresh()
      message.success('密码已更新，旧会话已失效')
    } catch (error) {
      setPasswordError(getErrorMessage(error, '更新密码失败'))
    } finally {
      setSavingPassword(false)
    }
  }

  async function handleUploadAvatar() {
    if (!selectedFile) {
      setAvatarError('请先选择一张头像图片。')
      return
    }

    try {
      setUploadingAvatar(true)
      const formData = new FormData()
      formData.append('file', selectedFile)
      const result = await api.uploadProfileAvatar(formData)
      applyProfile(result.profile)
      setSelectedFile(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      setAvatarError(null)
      message.success('头像已更新')
    } catch (error) {
      setAvatarError(getErrorMessage(error, '上传头像失败'))
    } finally {
      setUploadingAvatar(false)
    }
  }

  async function handleDeleteAvatar() {
    try {
      setUploadingAvatar(true)
      const result = await api.deleteProfileAvatar()
      applyProfile(result.profile)
      setSelectedFile(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      setAvatarError(null)
      message.success('头像已移除')
    } catch (error) {
      setAvatarError(getErrorMessage(error, '移除头像失败'))
    } finally {
      setUploadingAvatar(false)
    }
  }

  if (loading && !profile) {
    return (
      <div className="center-box page-card">
        <Spin />
      </div>
    )
  }

  if (!profile) {
    return <Empty description="当前无法读取管理员资料" className="page-card" />
  }

  return (
    <div className="page-stack">
      <PageHero
        className="page-hero-compact"
        eyebrow="Admin Profile"
        title="维护管理员资料、头像与密码轮换"
        description="这部分独立于普通配置页，专门处理管理员身份本身，避免把账号信息和运行时配置混在一起。"
        badges={[<Tag key="username">@{profile.username}</Tag>]}
        actions={(
          <Button icon={<ReloadOutlined />} onClick={() => void loadProfile()} loading={loading}>
            刷新资料
          </Button>
        )}
        stats={[
          { label: '展示名称', value: profileLabel(profile) },
          { label: '邮箱', value: profile.email || '--' },
          { label: '头像状态', value: profile.hasAvatar ? '已上传' : '未设置' },
          { label: '最后更新', value: formatDateTimeZh(profile.updatedAt) },
        ]}
      />

      <div className="page-grid profile-page-grid">
        <Card className="config-panel-card">
          <div className="config-card-header">
            <div className="page-section-title">
              <Typography.Title level={4}>管理员资料</Typography.Title>
              <Text type="secondary">用户名用于登录，展示名称和邮箱用于后续运维与通知信息呈现。</Text>
            </div>
          </div>

          <div className="page-stack">
            <label className="auth-field">
              <span>管理员名称</span>
              <Input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                data-testid={testIds.profile.username}
              />
            </label>

            <label className="auth-field">
              <span>展示名称</span>
              <Input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                data-testid={testIds.profile.displayName}
              />
            </label>

            <label className="auth-field">
              <span>邮箱</span>
              <Input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="owner@example.com"
                data-testid={testIds.profile.email}
              />
            </label>

            {profileError ? <Alert type="error" showIcon message={profileError} /> : null}

            <Space wrap>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                loading={savingProfile}
                onClick={() => void handleSaveProfile()}
                data-testid={testIds.profile.saveProfile}
              >
                保存资料
              </Button>
              <Text type="secondary">创建时间：{formatDateTimeZh(profile.createdAt)}</Text>
            </Space>
          </div>
        </Card>

        <Card className="config-panel-card">
          <div className="config-card-header">
            <div className="page-section-title">
              <Typography.Title level={4}>头像</Typography.Title>
              <Text type="secondary">头像独立存储为受限图片文件，不直接写进会话状态，避免认证信息膨胀。</Text>
            </div>
          </div>

          <div className="page-stack">
            {profile.avatarUrl ? (
              <img
                src={profile.avatarUrl}
                alt={profileLabel(profile)}
                className="profile-avatar-preview"
              />
            ) : (
              <div className="page-meta-card profile-avatar-empty">
                <span>头像</span>
                <strong><UserOutlined /></strong>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden-file-input"
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
            />

            <div className="profile-avatar-picker">
              <Button icon={<UploadOutlined />} onClick={() => fileInputRef.current?.click()}>
                选择图片
              </Button>
              <Text type="secondary">
                {selectedFile ? `待上传: ${selectedFile.name}` : '支持 PNG、JPEG、WEBP、GIF，大小不超过 2 MB。'}
              </Text>
            </div>

            {avatarError ? <Alert type="error" showIcon message={avatarError} /> : null}

            <Space wrap>
              <Button type="primary" icon={<SaveOutlined />} loading={uploadingAvatar} onClick={() => void handleUploadAvatar()}>
                上传头像
              </Button>
              <Button danger icon={<DeleteOutlined />} loading={uploadingAvatar} disabled={!profile.hasAvatar} onClick={() => void handleDeleteAvatar()}>
                移除头像
              </Button>
            </Space>
          </div>
        </Card>

        <Card className="config-panel-card">
          <div className="config-card-header">
            <div className="page-section-title">
              <Typography.Title level={4}>密码轮换</Typography.Title>
              <Text type="secondary">更新密码后会重新签发当前会话，旧密码和旧会话都会失效。</Text>
            </div>
          </div>

          <div className="page-stack">
            <label className="auth-field">
              <span>当前密码</span>
              <Input.Password
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                data-testid={testIds.profile.currentPassword}
              />
            </label>

            <label className="auth-field">
              <span>新密码</span>
              <Input.Password
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                data-testid={testIds.profile.newPassword}
              />
            </label>

            <label className="auth-field">
              <span>确认新密码</span>
              <Input.Password
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                data-testid={testIds.profile.confirmPassword}
              />
            </label>

            {passwordError ? <Alert type="error" showIcon message={passwordError} /> : null}

            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={savingPassword}
              onClick={() => void handleRotatePassword()}
              data-testid={testIds.profile.rotatePassword}
            >
              更新密码
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
