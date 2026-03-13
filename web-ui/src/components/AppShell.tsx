import { useEffect, useMemo, useState } from 'react'
import { Button, Drawer, Grid, Layout, Menu, Segmented, Typography } from 'antd'
import {
  ApiOutlined,
  BookOutlined,
  ClusterOutlined,
  DesktopOutlined,
  LogoutOutlined,
  MenuOutlined,
  MessageOutlined,
  MoonOutlined,
  ProfileOutlined,
  SettingOutlined,
  SunOutlined,
} from '@ant-design/icons'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { testIds } from '../testIds'
import { useThemeMode, type ThemePreference } from '../themeMode'

const { Header, Sider, Content } = Layout

type AppRoute = {
  key: string
  icon: JSX.Element
  label: string
  summary: string
  testId?: string
}

const primaryRoutes: AppRoute[] = [
  {
    key: '/chat',
    icon: <MessageOutlined />,
    label: '对话',
    summary: '围绕当前工作区会话开展对话。',
    testId: testIds.app.navChat,
  },
  {
    key: '/models',
    icon: <SettingOutlined />,
    label: '模型',
    summary: '维护默认供应商、Base URL、API Key 与模型。',
  },
  {
    key: '/channels',
    icon: <ClusterOutlined />,
    label: '渠道',
    summary: '管理聊天渠道接入、状态与配置入口。',
    testId: testIds.app.navChannels,
  },
  {
    key: '/skills',
    icon: <BookOutlined />,
    label: '技能',
    summary: '管理当前工作区可用技能。',
  },
  {
    key: '/mcp',
    icon: <ApiOutlined />,
    label: 'MCP',
    summary: '管理 MCP 服务目录、安装与启停。',
    testId: testIds.app.navMcp,
  },
  {
    key: '/prompt',
    icon: <ProfileOutlined />,
    label: '提示词与记忆',
    summary: '维护工作区引导与记忆文档。',
  },
  {
    key: '/system',
    icon: <DesktopOutlined />,
    label: '系统',
    summary: '查看健康、验证、自动化和管理员设置。',
  },
]

export default function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const screens = Grid.useBreakpoint()
  const isDesktop = Boolean(screens.lg)
  const navWidth = 264
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const { preference, resolvedTheme, setPreference } = useThemeMode()
  const { logout, status: authStatus, submitting } = useAuth()
  const menuTheme = resolvedTheme === 'dark' ? 'dark' : 'light'

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname, isDesktop])

  const activeRoute = useMemo(
    () => primaryRoutes.find((item) => location.pathname.startsWith(item.key)) ?? primaryRoutes[0],
    [location.pathname],
  )
  const isChatRoute = activeRoute.key === '/chat'

  function buildMenuItems(items: AppRoute[]) {
    return items.map((item) => ({
      key: item.key,
      icon: item.icon,
      label: (
        <div className="nav-item-copy" data-testid={item.testId}>
          <span className="nav-item-title">{item.label}</span>
          <span className="nav-item-summary">{item.summary}</span>
        </div>
      ),
    }))
  }

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
          </div>
        </div>
      </div>

      <div className="nav-sections">
        <div className="nav-section" key="primary">
          <Typography.Text className="nav-section-label">主路径</Typography.Text>
          <Menu
            mode="inline"
            theme={menuTheme}
            selectedKeys={[activeRoute.key]}
            items={buildMenuItems(primaryRoutes)}
            onClick={({ key }) => navigate(key)}
            className="nav-menu"
          />
        </div>
      </div>

      <div className="sidebar-footer">
        <Typography.Text type="secondary">管理员</Typography.Text>
        <div className="mono-block mono-block-tight">
          {authStatus?.username || '未登录'}
        </div>
      </div>
    </div>
  )

  return (
    <Layout className={`app-shell theme-${resolvedTheme} ${isChatRoute ? 'app-shell-chat' : ''}`}>
      {isDesktop ? (
        <Sider width={navWidth} theme={menuTheme} className={`app-sider ${isChatRoute ? 'app-sider-chat' : ''}`}>
          {navigationContent}
        </Sider>
      ) : null}

      {!isDesktop ? (
        <Drawer
          open={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
          placement="left"
          width={navWidth}
          closable={false}
          rootClassName="mobile-nav-drawer"
        >
          {navigationContent}
        </Drawer>
      ) : null}

      <Layout className={`app-main-layout ${isChatRoute ? 'app-main-layout-chat' : ''}`}>
        <Header className={`app-header ${isChatRoute ? 'app-header-chat' : ''}`}>
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
                <Typography.Title level={5}>{activeRoute.label}</Typography.Title>
              </div>
              <span className="header-live-pill is-online">{isChatRoute ? '实例' : '当前实例'}</span>
            </div>
          </div>

          <div className="header-actions">
            <Segmented
              className="theme-segmented"
              size={isChatRoute ? 'small' : 'middle'}
              value={preference}
              options={themeOptions}
              onChange={(value) => setPreference(value as ThemePreference)}
            />
            <Button
              icon={<LogoutOutlined />}
              loading={submitting}
              className={`header-logout-button ${isChatRoute ? 'is-compact' : ''}`}
              onClick={() => void handleLogout()}
              data-testid={testIds.app.logout}
            >
              {isChatRoute ? null : '退出'}
            </Button>
          </div>
        </Header>
        <Content className={`app-content ${isChatRoute ? 'app-content-chat' : ''}`}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
