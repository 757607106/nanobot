import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, Drawer, Grid, Layout, Menu, Segmented, Typography } from 'antd'
import {
  BookOutlined,
  ClockCircleOutlined,
  DashboardOutlined,
  DesktopOutlined,
  MenuOutlined,
  MessageOutlined,
  MoonOutlined,
  ProfileOutlined,
  SettingOutlined,
  SunOutlined,
} from '@ant-design/icons'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useThemeMode, type ThemePreference } from '../themeMode'
import type { SystemStatus } from '../types'

const { Header, Sider, Content } = Layout

const routes = [
  {
    key: '/chat',
    icon: <MessageOutlined />,
    label: '对话',
    summary: '围绕当前工作区会话、流式回复与运行时上下文展开协作。',
  },
  {
    key: '/cron',
    icon: <ClockCircleOutlined />,
    label: '定时任务',
    summary: '安排自动化执行窗口，查看状态、投递和调度详情。',
  },
  {
    key: '/skills',
    icon: <BookOutlined />,
    label: '技能',
    summary: '查看当前工作区技能资产，维护可复用的扩展能力。',
  },
  {
    key: '/prompt',
    icon: <ProfileOutlined />,
    label: '主提示词',
    summary: '维护 AGENTS.md 与主引导上下文，控制默认行为边界。',
  },
  {
    key: '/config',
    icon: <SettingOutlined />,
    label: '配置',
    summary: '统一配置供应商、频道、工具安全和运行时默认值。',
  },
  {
    key: '/system',
    icon: <DashboardOutlined />,
    label: '系统',
    summary: '查看后端状态、运行环境、频道健康度与调度概况。',
  },
]

function compactPath(value?: string) {
  if (!value) {
    return '--'
  }
  if (value.length <= 42) {
    return value
  }
  return `${value.slice(0, 18)}...${value.slice(-18)}`
}

export default function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const screens = Grid.useBreakpoint()
  const isDesktop = Boolean(screens.lg)
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const { preference, resolvedTheme, setPreference } = useThemeMode()

  useEffect(() => {
    let active = true
    void api.getSystemStatus()
      .then((result) => {
        if (active) {
          setStatus(result)
        }
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname, isDesktop])

  const activeRoute = useMemo(
    () => routes.find((item) => location.pathname.startsWith(item.key)) ?? routes[0],
    [location.pathname],
  )

  const online = Boolean(status)

  const menuItems = useMemo(
    () =>
      routes.map((item) => ({
        key: item.key,
        icon: item.icon,
        label: (
          <div className="nav-item-copy">
            <span className="nav-item-title">{item.label}</span>
            <span className="nav-item-summary">{item.summary}</span>
          </div>
        ),
      })),
    [],
  )

  const themeOptions = useMemo(
    () => [
      {
        value: 'light',
        label: (
          <span className="theme-option-label">
            <SunOutlined />
            <span>浅色</span>
          </span>
        ),
      },
      {
        value: 'dark',
        label: (
          <span className="theme-option-label">
            <MoonOutlined />
            <span>深色</span>
          </span>
        ),
      },
      {
        value: 'system',
        label: (
          <span className="theme-option-label">
            <DesktopOutlined />
            <span>跟随系统</span>
          </span>
        ),
      },
    ],
    [],
  )

  const navigationContent = (
    <div className="app-sider-panel">
      <div className="brand-block">
        <div className="brand-chip">NANOBOT CONSOLE</div>
        <div className="brand-head">
          <div className="brand-mark">N</div>
          <div className="brand-copy">
            <Typography.Title level={2}>nanobot</Typography.Title>
            <Typography.Text>围绕当前后端能力构建的中文工作台。</Typography.Text>
          </div>
        </div>
      </div>

      <div className="sidebar-runtime-card">
        <div className="runtime-card-head">
          <Typography.Text strong>运行概览</Typography.Text>
          <Badge status={online ? 'processing' : 'default'} text={online ? '在线' : '未连接'} />
        </div>
        <div className="runtime-pill-grid">
          <div className="runtime-pill">
            <span className="runtime-pill-label">供应商</span>
            <span className="runtime-pill-value">{status?.web.provider ?? '--'}</span>
          </div>
          <div className="runtime-pill">
            <span className="runtime-pill-label">模型</span>
            <span className="runtime-pill-value">{status ? compactPath(status.web.model) : '--'}</span>
          </div>
          <div className="runtime-pill">
            <span className="runtime-pill-label">频道</span>
            <span className="runtime-pill-value">{status?.stats.enabledChannelCount ?? 0}</span>
          </div>
          <div className="runtime-pill">
            <span className="runtime-pill-label">任务</span>
            <span className="runtime-pill-value">{status?.stats.scheduledJobs ?? 0}</span>
          </div>
        </div>
      </div>

      <Menu
        mode="inline"
        theme="dark"
        selectedKeys={[activeRoute.key]}
        items={menuItems}
        onClick={({ key }) => navigate(key)}
        className="nav-menu"
      />

      <div className="sidebar-footer">
        <Typography.Text type="secondary">工作区</Typography.Text>
        <div className="mono-block mono-block-tight">
          {status ? compactPath(status.web.workspace) : '等待后端状态'}
        </div>
      </div>
    </div>
  )

  return (
    <Layout className={`app-shell theme-${resolvedTheme}`}>
      {isDesktop ? (
        <Sider width={312} theme="dark" className="app-sider">
          {navigationContent}
        </Sider>
      ) : null}

      {!isDesktop ? (
        <Drawer
          open={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
          placement="left"
          width={312}
          closable={false}
          rootClassName="mobile-nav-drawer"
        >
          {navigationContent}
        </Drawer>
      ) : null}

      <Layout className="app-main-layout">
        <Header className="app-header">
          <div className="header-copy">
            <div className="header-title-row">
              {!isDesktop ? (
                <Button
                  type="text"
                  icon={<MenuOutlined />}
                  className="header-icon-button"
                  onClick={() => setMobileNavOpen(true)}
                />
              ) : null}
              <Typography.Title level={4}>{activeRoute.label}</Typography.Title>
              <span className={`header-live-pill${online ? ' is-online' : ''}`}>
                {online ? '后端已连接' : '等待连接'}
              </span>
            </div>
          </div>

          <div className="header-actions">
            <Segmented
              className="theme-segmented"
              size="middle"
              value={preference}
              options={themeOptions}
              onChange={(value) => setPreference(value as ThemePreference)}
            />
          </div>
        </Header>
        <Content className="app-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
