import { useEffect, useMemo, useState } from 'react'
import { Button, Drawer, Grid, Layout, Menu, Segmented, Typography } from 'antd'
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
  const menuTheme = resolvedTheme === 'dark' ? 'dark' : 'light'

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
  const runtimeSummary = status
    ? [
        `工作区 ${compactPath(status.web.workspace)}`,
        `供应商 ${status.web.provider}`,
        `模型 ${compactPath(status.web.model)}`,
      ]
    : ['等待后端状态同步']

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

      <div className="sidebar-status-row">
        <span className={`sidebar-status-chip${online ? ' is-online' : ''}`}>
          {online ? '在线' : '未连接'}
        </span>
        <span className="sidebar-status-text">
          {status ? `${status.stats.enabledChannelCount} 个频道 · ${status.stats.scheduledJobs} 个任务` : '等待系统状态'}
        </span>
      </div>

      <Menu
        mode="inline"
        theme={menuTheme}
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
        <Sider width={312} theme={menuTheme} className="app-sider">
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
              <div className="header-title-block">
                <Typography.Title level={4}>{activeRoute.label}</Typography.Title>
                <Typography.Text className="header-summary">{activeRoute.summary}</Typography.Text>
              </div>
              <span className={`header-live-pill${online ? ' is-online' : ''}`}>
                {online ? '后端已连接' : '等待连接'}
              </span>
            </div>
            <div className="header-runtime-inline">
              {runtimeSummary.map((item) => (
                <span key={item}>{item}</span>
              ))}
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
