import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, App, Button, Empty, Input, Modal, Space, Spin, Table, Tag, Typography } from 'antd'
import {
  DeleteOutlined,
  EditOutlined,
  LockOutlined,
  ReloadOutlined,
  SaveOutlined,
  UploadOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { api, ApiError } from '../api'
import { formatDateTimeZh } from '../locale'
import { useAuth } from '../auth'
import { testIds } from '../testIds'
import type { ProfileData } from '../types'

const { Text } = Typography

type DialogMode = 'profile' | 'password' | 'avatar' | null

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
  const [dialogMode, setDialogMode] = useState<DialogMode>(null)
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

  const accountRows = useMemo(
    () => (profile ? [{ key: 'current-account', ...profile }] : []),
    [profile],
  )

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

  function openProfileDialog() {
    if (profile) {
      setUsername(profile.username)
      setDisplayName(profile.displayName || '')
      setEmail(profile.email || '')
    }
    setProfileError(null)
    setDialogMode('profile')
  }

  function openPasswordDialog() {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setPasswordError(null)
    setDialogMode('password')
  }

  function openAvatarDialog() {
    setSelectedFile(null)
    setAvatarError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    setDialogMode('avatar')
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
      setDialogMode(null)
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
      setDialogMode(null)
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
    return (
      <section className="account-admin-shell">
        <div className="account-admin-topbar">
          <div className="account-admin-title-chip">账户管理</div>
          <div className="account-admin-topbar-actions">
            <Button icon={<ReloadOutlined />} onClick={() => void loadProfile()} loading={loading}>
              刷新
            </Button>
          </div>
        </div>
        <div className="account-admin-table-shell">
          <Empty description="当前无法读取管理员资料" />
        </div>
      </section>
    )
  }

  return (
    <section className="account-admin-shell">
      <div className="account-admin-topbar">
        <div className="account-admin-title-chip">账户管理</div>
        <div className="account-admin-topbar-actions">
          <Button icon={<ReloadOutlined />} onClick={() => void loadProfile()} loading={loading}>
            刷新
          </Button>
          <Button icon={<EditOutlined />} onClick={openProfileDialog}>
            编辑资料
          </Button>
          <Button icon={<LockOutlined />} onClick={openPasswordDialog}>
            修改密码
          </Button>
          <Button type="primary" icon={<UploadOutlined />} onClick={openAvatarDialog}>
            头像管理
          </Button>
        </div>
      </div>

      <div className="account-admin-summary">
        <Tag color="orange">管理员</Tag>
        <span>当前实例仅开放当前管理员账号资料管理，页面样式参照参考项目的用户管理页。</span>
      </div>

      {profileError && dialogMode !== 'profile' ? (
        <Alert className="account-admin-alert" type="error" showIcon message={profileError} />
      ) : null}

      <div className="account-admin-table-shell">
        <Table
          pagination={false}
          rowKey="username"
          scroll={{ x: 'max-content' }}
          dataSource={accountRows}
          locale={{ emptyText: '暂无账号数据' }}
          columns={[
            {
              title: '用户名',
              dataIndex: 'username',
              key: 'username',
              render: (value: string, row: ProfileData) => (
                <div className="account-admin-user">
                  <div className="account-admin-avatar">
                    {row.avatarUrl ? (
                      <img src={row.avatarUrl} alt={profileLabel(row)} className="account-admin-avatar-image" />
                    ) : (
                      <UserOutlined />
                    )}
                  </div>
                  <div className="account-admin-user-copy">
                    <div className="account-admin-user-primary">
                      <strong>{value}</strong>
                      <span>当前账号</span>
                    </div>
                    <div className="account-admin-user-secondary">
                      {row.displayName || '未设置展示名称'}
                    </div>
                  </div>
                </div>
              ),
            },
            {
              title: '身份',
              key: 'role',
              render: () => <Tag color="orange">管理员</Tag>,
            },
            {
              title: '联系信息',
              key: 'contact',
              render: (_: unknown, row: ProfileData) => (
                <div className="account-admin-multi-line">
                  <strong>{row.email || '--'}</strong>
                  <span>{row.displayName || '展示名称未设置'}</span>
                </div>
              ),
            },
            {
              title: '状态',
              key: 'state',
              render: (_: unknown, row: ProfileData) => (
                <div className="account-admin-multi-line">
                  <strong>{row.hasAvatar ? '头像已设置' : '头像未设置'}</strong>
                  <span>更新时间：{formatDateTimeZh(row.updatedAt)}</span>
                </div>
              ),
            },
            {
              title: '操作',
              key: 'actions',
              align: 'right' as const,
              render: () => (
                <Space size={[8, 8]} wrap className="account-admin-action-row">
                  <Button size="small" onClick={openProfileDialog}>
                    编辑资料
                  </Button>
                  <Button size="small" onClick={openPasswordDialog}>
                    修改密码
                  </Button>
                  <Button size="small" type="default" onClick={openAvatarDialog}>
                    头像
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </div>

      <Modal
        destroyOnHidden
        open={dialogMode === 'profile'}
        title="编辑账户资料"
        onCancel={() => setDialogMode(null)}
        onOk={() => void handleSaveProfile()}
        confirmLoading={savingProfile}
        okText="保存"
      >
        <div className="account-dialog-stack">
          <label className="account-dialog-field">
            <span>管理员名称</span>
            <Input
              aria-label="管理员名称"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              data-testid={testIds.profile.username}
            />
          </label>

          <label className="account-dialog-field">
            <span>展示名称</span>
            <Input
              aria-label="展示名称"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="用于页面展示"
              data-testid={testIds.profile.displayName}
            />
          </label>

          <label className="account-dialog-field">
            <span>邮箱</span>
            <Input
              aria-label="邮箱"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="owner@example.com"
              data-testid={testIds.profile.email}
            />
          </label>

          {profileError ? <Alert type="error" showIcon message={profileError} /> : null}
        </div>
      </Modal>

      <Modal
        destroyOnHidden
        open={dialogMode === 'password'}
        title="修改密码"
        onCancel={() => setDialogMode(null)}
        onOk={() => void handleRotatePassword()}
        confirmLoading={savingPassword}
        okText="更新密码"
      >
        <div className="account-dialog-stack">
          <label className="account-dialog-field">
            <span>当前密码</span>
            <Input.Password
              aria-label="当前密码"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              data-testid={testIds.profile.currentPassword}
            />
          </label>

          <label className="account-dialog-field">
            <span>新密码</span>
            <Input.Password
              aria-label="新密码"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              data-testid={testIds.profile.newPassword}
            />
          </label>

          <label className="account-dialog-field">
            <span>确认新密码</span>
            <Input.Password
              aria-label="确认新密码"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              data-testid={testIds.profile.confirmPassword}
            />
          </label>

          {passwordError ? <Alert type="error" showIcon message={passwordError} /> : null}
        </div>
      </Modal>

      <Modal
        destroyOnHidden
        open={dialogMode === 'avatar'}
        title="头像管理"
        onCancel={() => setDialogMode(null)}
        footer={(
          <Space wrap>
            <Button onClick={() => setDialogMode(null)}>关闭</Button>
            <Button
              danger
              icon={<DeleteOutlined />}
              loading={uploadingAvatar}
              disabled={!profile.hasAvatar}
              onClick={() => void handleDeleteAvatar()}
            >
              移除头像
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={uploadingAvatar}
              onClick={() => void handleUploadAvatar()}
            >
              上传头像
            </Button>
          </Space>
        )}
      >
        <div className="account-avatar-dialog">
          <div className="account-avatar-preview">
            <div className="account-admin-avatar account-admin-avatar-large">
              {profile.avatarUrl ? (
                <img src={profile.avatarUrl} alt={profileLabel(profile)} className="account-admin-avatar-image" />
              ) : (
                <UserOutlined />
              )}
            </div>
            <div className="account-avatar-copy">
              <strong>{profileLabel(profile)}</strong>
              <span>@{profile.username}</span>
              <span>{profile.hasAvatar ? '当前已配置头像' : '当前未设置头像'}</span>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden-file-input"
            onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
          />

          <div className="account-avatar-toolbar">
            <Button icon={<UploadOutlined />} onClick={() => fileInputRef.current?.click()}>
              选择图片
            </Button>
            <Text type="secondary" className="account-avatar-note">
              {selectedFile ? selectedFile.name : 'PNG / JPEG / WEBP / GIF，2 MB 内'}
            </Text>
          </div>

          {avatarError ? <Alert type="error" showIcon message={avatarError} /> : null}
        </div>
      </Modal>
    </section>
  )
}
