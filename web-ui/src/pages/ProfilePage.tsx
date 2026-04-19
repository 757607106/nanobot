import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Alert,
  Avatar,
  Descriptions,
  Flex,
  Progress,
  Space,
  Tag,
  Typography,
  theme,
} from 'antd'
import type { DescriptionsProps } from 'antd'
import {
  CameraOutlined,
  DeleteOutlined,
  EditOutlined,
  LockOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { api } from '../api'
import PageHeader from '../components/console/PageHeader'
import SectionCard from '../components/console/SectionCard'
import { formatDateTimeZh } from '../locale'
import { useAuth } from '../auth'
import { testIds } from '../testIds'
import type { ProfileData } from '../types'
import { useToast } from '../toast'
import { Button, Card, Input, Modal } from 'antd'

type DialogMode = 'profile' | 'password' | 'avatar' | null

function getPasswordStrength(password: string): {
  percent: number
  label: string
  color: 'error' | 'warning' | 'success'
} {
  if (!password) {
    return { percent: 0, label: '未输入', color: 'warning' }
  }

  let score = 0
  if (password.length >= 8) score += 1
  if (password.length >= 12) score += 1
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1
  if (/\d/.test(password)) score += 1
  if (/[^a-zA-Z0-9]/.test(password)) score += 1

  if (score <= 2) {
    return { percent: 33, label: '弱', color: 'error' }
  }
  if (score <= 3) {
    return { percent: 66, label: '中', color: 'warning' }
  }
  return { percent: 100, label: '强', color: 'success' }
}

function profileLabel(profile: ProfileData | null) {
  if (!profile) {
    return '--'
  }
  return profile.displayName || profile.username
}

function progressStatus(color: 'error' | 'warning' | 'success') {
  if (color === 'error') return 'exception'
  if (color === 'success') return 'success'
  return 'active'
}

function FieldGroup({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <Flex vertical gap={8}>
      <Typography.Text strong style={{ fontSize: 'var(--nb-text-xs)' }}>
        {label}
      </Typography.Text>
      {children}
    </Flex>
  )
}

export default function ProfilePage() {
  const message = useToast()
  const { refresh } = useAuth()
  const { token } = theme.useToken()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [dialogMode, setDialogMode] = useState<DialogMode>(null)
  const [confirmDeleteAvatarOpen, setConfirmDeleteAvatarOpen] = useState(false)
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
  const [draggingOver, setDraggingOver] = useState(false)

  const passwordStrength = useMemo(() => getPasswordStrength(newPassword), [newPassword])

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
    } catch (loadError) {
      setProfileError(loadError instanceof Error ? loadError.message : '加载管理员资料失败')
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
    } catch (saveError) {
      setProfileError(saveError instanceof Error ? saveError.message : '保存管理员资料失败')
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
    } catch (saveError) {
      setPasswordError(saveError instanceof Error ? saveError.message : '更新密码失败')
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
      setDialogMode(null)
      message.success('头像已更新')
    } catch (uploadError) {
      setAvatarError(uploadError instanceof Error ? uploadError.message : '上传头像失败')
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
      setConfirmDeleteAvatarOpen(false)
      setDialogMode(null)
      message.success('头像已移除')
    } catch (deleteError) {
      setAvatarError(deleteError instanceof Error ? deleteError.message : '移除头像失败')
    } finally {
      setUploadingAvatar(false)
    }
  }

  function handleAvatarFile(file: File | null) {
    setSelectedFile(file)
    setAvatarError(null)
  }

  const profileItems: DescriptionsProps['items'] = [
    { key: 'username', label: '用户名', children: profile?.username || '--' },
    { key: 'displayName', label: '展示名称', children: profile?.displayName || '未设置' },
    { key: 'email', label: '邮箱', children: profile?.email || '未设置' },
  ]

  const securityItems: DescriptionsProps['items'] = [
    { key: 'updatedAt', label: '资料更新时间', children: profile?.updatedAt ? formatDateTimeZh(profile.updatedAt) : '--' },
    { key: 'avatarUpdatedAt', label: '头像更新时间', children: profile?.avatarUpdatedAt ? formatDateTimeZh(profile.avatarUpdatedAt) : '尚未更新头像' },
    { key: 'createdAt', label: '创建时间', children: profile?.createdAt ? formatDateTimeZh(profile.createdAt) : '--' },
  ]

  if (loading && !profile) {
    return (
      <div className="page-stack">
        <PageHeader title="账户" subtitle="加载中..." />
        <div className="page-content-wrapper" style={{ paddingInline: 'var(--nb-layout-gutter)' }}>
          <Flex vertical gap={24}>
            <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
              <SectionCard loading />
              <SectionCard loading />
            </div>
          </Flex>
        </div>
      </div>
    )
  }

  if (!profile) {
    return (
      <Flex vertical gap={24}>
        <PageHeader
          title="账户管理"
          subtitle="无法加载"
          actions={(
            <Button icon={<ReloadOutlined />} onClick={() => void loadProfile()}>
              刷新
            </Button>
          )}
        />
        <Alert type="error" showIcon message={profileError || '当前无法读取管理员资料。'} />
      </Flex>
    )
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="账户管理"
        subtitle="资料 · 安全 · 权限"
        actions={(
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void loadProfile()} disabled={loading}>
              刷新
            </Button>
            <Button 
              type="primary" 
              icon={<EditOutlined />} 
              onClick={openProfileDialog}
              style={{ borderRadius: 12 }}
            >
              编辑资料
            </Button>
          </Space>
        )}
      />

      <div className="page-content-wrapper" style={{ paddingInline: 'var(--nb-layout-gutter)', paddingBottom: 40 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {profileError && dialogMode !== 'profile' ? <Alert type="error" showIcon message={profileError} /> : null}

          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))' }}>
            <SectionCard title="当前管理员" description="账户身份与识别。">
              <Flex align="center" gap={32} wrap="wrap">
                <div style={{ position: 'relative' }}>
                  <Avatar
                    src={profile.avatarUrl || undefined}
                    alt={profileLabel(profile)}
                    size={120}
                    style={{
                      background: 'var(--nb-card-selected-bg)',
                      color: 'var(--nb-accent)',
                      fontSize: 48,
                      border: '4px solid var(--nb-card-subtle-border)',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.06)',
                    }}
                  >
                    {profileLabel(profile).charAt(0).toUpperCase()}
                  </Avatar>
                  <Button
                    icon={<CameraOutlined />}
                    size="small"
                    shape="circle"
                    style={{
                      position: 'absolute',
                      bottom: 4,
                      right: 4,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                    }}
                    onClick={openAvatarDialog}
                  />
                </div>

                <div style={{ minWidth: 0, flex: 1 }}>
                  <Flex vertical gap={12}>
                    <Flex gap={8} wrap="wrap" align="center">
                      <Typography.Title level={2} style={{ margin: 0, fontSize: 'var(--nb-title-lg)', letterSpacing: '-0.02em' }}>
                        {profile.username}
                      </Typography.Title>
                      <Tag color="gold" bordered={false} style={{ margin: 0, borderRadius: 6, fontWeight: 'var(--nb-font-weight-strong)' }}>ADMIN</Tag>
                    </Flex>

                    <Flex vertical gap={4}>
                      <Typography.Text strong style={{ fontSize: 'var(--nb-text-lg)' }}>
                        {profile.displayName || '未设置展示名称'}
                      </Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-sm)' }}>
                        {profile.email || '未设置邮箱地址'}
                      </Typography.Text>
                    </Flex>
                  </Flex>
                </div>
              </Flex>
            </SectionCard>

            <SectionCard title="安全摘要" description="鉴权状态与审计。">
              <Flex vertical gap={20}>
                <div
                  style={{
                    padding: '16px',
                    borderRadius: 16,
                    background: 'var(--nb-card-subtle-bg)',
                    border: '1px solid var(--nb-card-subtle-border)',
                  }}
                >
                  <Flex align="center" gap={10} style={{ marginBottom: 12 }}>
                    <SafetyCertificateOutlined style={{ color: 'var(--nb-success)' }} />
                    <Typography.Text strong>实例鉴权</Typography.Text>
                  </Flex>
                  <Typography.Paragraph type="secondary" style={{ margin: 0, fontSize: 'var(--nb-text-sm)', lineHeight: 1.6 }}>
                    当前实例由 Nanobot 管理，一个实例只能拥有一个主管理员。
                  </Typography.Paragraph>
                </div>

                <Descriptions
                  colon={false}
                  column={1}
                  size="small"
                  items={securityItems}
                  styles={{
                    label: { color: 'var(--nb-text-quaternary)', width: 120 },
                    content: { fontWeight: 'var(--nb-font-weight-medium)' },
                  }}
                />
              </Flex>
            </SectionCard>
          </div>

          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
            <SectionCard title="基本账户信息">
              <Descriptions
                colon={false}
                column={1}
                size="small"
                items={profileItems}
                styles={{
                  label: { color: 'var(--nb-text-quaternary)', width: 100 },
                }}
              />
            </SectionCard>

            <SectionCard title="安全与密码轮换">
              <Flex vertical gap={20}>
                <Typography.Paragraph type="secondary" style={{ margin: 0, fontSize: 'var(--nb-text-sm)', lineHeight: 1.6 }}>
                  为保护您的账户安全，建议开启高强度密码（12位+混合字符）并定期轮换。
                </Typography.Paragraph>
                <Button 
                  block 
                  icon={<LockOutlined />} 
                  onClick={openPasswordDialog}
                  style={{ borderRadius: 12, height: 44 }}
                >
                  轮换登录密码
                </Button>
              </Flex>
            </SectionCard>

            <SectionCard title="头像管理">
              <Flex vertical gap={20}>
                 <Descriptions
                  colon={false}
                  column={1}
                  size="small"
                  items={[
                    { key: 'avatarStatus', label: '状态', children: profile?.hasAvatar ? <Tag color="success" bordered={false}>已就绪</Tag> : <Tag bordered={false}>未设置</Tag> },
                    { key: 'avatarTime', label: '最近更新', children: profile?.avatarUpdatedAt ? formatDateTimeZh(profile.avatarUpdatedAt).split(' ')[0] : '无' },
                  ]}
                  styles={{
                    label: { color: 'var(--nb-text-quaternary)', width: 80 },
                  }}
                />
                <Button 
                  block 
                  icon={<UploadOutlined />} 
                  onClick={openAvatarDialog}
                  style={{ borderRadius: 12, height: 44 }}
                >
                  管理头像
                </Button>
              </Flex>
            </SectionCard>
          </div>
        </div>
      </div>

      {/* 编辑账户资料弹窗 */}
      <Modal
        open={dialogMode === 'profile'}
        title="编辑账户资料"
        okText="保存"
        cancelText="取消"
        destroyOnHidden
        centered
        confirmLoading={savingProfile}
        onOk={() => void handleSaveProfile()}
        onCancel={() => setDialogMode(null)}
      >
        <Flex vertical gap={16} style={{ marginTop: 8 }}>
          {profileError ? <Alert type="error" showIcon message={profileError} /> : null}

          <FieldGroup label="用户名">
            <Input
              aria-label="用户名"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              data-testid={testIds.profile.username}
            />
          </FieldGroup>

          <FieldGroup label="展示名称">
            <Input
              aria-label="展示名称"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              data-testid={testIds.profile.displayName}
            />
          </FieldGroup>

          <FieldGroup label="邮箱">
            <Input
              aria-label="邮箱"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              data-testid={testIds.profile.email}
            />
          </FieldGroup>
        </Flex>
      </Modal>

      {/* 修改密码弹窗 */}
      <Modal
        open={dialogMode === 'password'}
        title="修改密码"
        okText="更新密码"
        cancelText="取消"
        destroyOnHidden
        centered
        confirmLoading={savingPassword}
        onOk={() => void handleRotatePassword()}
        onCancel={() => setDialogMode(null)}
      >
        <Flex vertical gap={16} style={{ marginTop: 8 }}>
          {passwordError ? <Alert type="error" showIcon message={passwordError} /> : null}

          <FieldGroup label="当前密码">
            <Input.Password
              aria-label="当前密码"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              data-testid={testIds.profile.currentPassword}
            />
          </FieldGroup>

          <FieldGroup label="新密码">
            <Input.Password
              aria-label="新密码"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              data-testid={testIds.profile.newPassword}
            />
          </FieldGroup>

          <div
            style={{
              padding: 14,
              borderRadius: 14,
              border: `1px solid ${token.colorBorderSecondary}`,
              background: token.colorBgLayout,
            }}
          >
            <Flex justify="space-between" align="center" gap={12} wrap="wrap" style={{ marginBottom: 8 }}>
              <Typography.Text type="secondary">密码强度</Typography.Text>
              <Tag color={passwordStrength.color === 'success' ? 'green' : passwordStrength.color === 'error' ? 'red' : 'gold'}>
                {passwordStrength.label}
              </Tag>
            </Flex>
            <Progress
              percent={passwordStrength.percent}
              status={progressStatus(passwordStrength.color)}
              showInfo={false}
              size="small"
            />
          </div>

          <FieldGroup label="确认新密码">
            <Input.Password
              aria-label="确认新密码"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              data-testid={testIds.profile.confirmPassword}
            />
          </FieldGroup>
        </Flex>
      </Modal>

      {/* 头像管理弹窗 */}
      <Modal
        open={dialogMode === 'avatar'}
        title="头像管理"
        destroyOnHidden
        centered
        footer={(
          <Flex justify="space-between" align="center" gap={12} wrap="wrap">
            <Button
              danger
              icon={<DeleteOutlined />}
              onClick={() => setConfirmDeleteAvatarOpen(true)}
              disabled={!profile.hasAvatar || uploadingAvatar}
            >
              移除头像
            </Button>

            <Space>
              <Button onClick={() => setDialogMode(null)}>取消</Button>
              <Button
                type="primary"
                icon={<CameraOutlined />}
                loading={uploadingAvatar}
                onClick={() => void handleUploadAvatar()}
              >
                保存头像
              </Button>
            </Space>
          </Flex>
        )}
        onCancel={() => setDialogMode(null)}
      >
        <Flex vertical gap={16} style={{ marginTop: 8 }}>
          {avatarError ? <Alert type="error" showIcon message={avatarError} /> : null}

          <div
            onDragOver={(event) => {
              event.preventDefault()
              setDraggingOver(true)
            }}
            onDragLeave={(event) => {
              event.preventDefault()
              setDraggingOver(false)
            }}
            onDrop={(event) => {
              event.preventDefault()
              setDraggingOver(false)
              handleAvatarFile(event.dataTransfer.files?.[0] || null)
            }}
            style={{
              padding: 24,
              borderRadius: 20,
              border: `1px dashed ${draggingOver ? token.colorPrimary : token.colorBorderSecondary}`,
              background: draggingOver ? `${token.colorPrimary}12` : token.colorBgLayout,
            }}
          >
            <Flex vertical align="center" gap={16}>
              <Avatar
                src={profile.avatarUrl || undefined}
                alt={profileLabel(profile)}
                size={96}
                style={{
                  background: `${token.colorPrimary}16`,
                  color: token.colorPrimary,
                  fontSize: 32,
                }}
              >
                {profileLabel(profile).charAt(0).toUpperCase()}
              </Avatar>

              <Flex vertical align="center" gap={6}>
                <Typography.Text strong>拖拽图片到这里，或手动选择文件</Typography.Text>
                <Typography.Text type="secondary">
                  当前选择：{selectedFile ? selectedFile.name : '尚未选择新头像'}
                </Typography.Text>
              </Flex>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => handleAvatarFile(event.target.files?.[0] || null)}
              />

              <Button icon={<UploadOutlined />} onClick={() => fileInputRef.current?.click()}>
                选择图片
              </Button>
            </Flex>
          </div>
        </Flex>
      </Modal>

      {/* 删除头像确认弹窗 */}
      <Modal
        open={confirmDeleteAvatarOpen}
        title="移除头像"
        okText="移除"
        cancelText="取消"
        okButtonProps={{ danger: true, loading: uploadingAvatar }}
        destroyOnHidden
        centered
        onOk={() => void handleDeleteAvatar()}
        onCancel={() => setConfirmDeleteAvatarOpen(false)}
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, lineHeight: 1.6 }}>
          确定要移除当前头像吗？移除后将显示默认占位头像。
        </Typography.Paragraph>
      </Modal>
    </div>
  )
}
