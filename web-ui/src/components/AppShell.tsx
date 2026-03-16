import { useEffect, useMemo, useState } from 'react'
import { Button, Drawer, Grid, Layout, Menu, Segmented, Switch, Typography } from 'antd'
import {
  ApiOutlined,
  ApartmentOutlined,
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
import {
  PLATFORM_BADGE_LABEL,
  PLATFORM_BRAND_MARK,
  PLATFORM_BRAND_NAME,
  PLATFORM_SUBTITLE,
} from '../branding'
import { useDevMode } from '../devMode'
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

function buildPrimaryRoutes(devMode: boolean): AppRoute[] {
  return [
    {
      key: '/chat',
      icon: <MessageOutlined />,
      label: '对话',
      summary: '与 AI 员工实时对话交流。',
      testId: testIds.app.navChat,
    },
    {
      key: '/studio',
      icon: <ApartmentOutlined />,
      label: '协作',
      summary: '管理 AI 员工、团队与知识库。',
      testId: testIds.app.navStudio,
    },
    {
      key: '/models',
      icon: <SettingOutlined />,
      label: '模型',
      summary: '选择和配置 AI 模型服务。',
    },
    {
      key: '/channels',
      icon: <ClusterOutlined />,
      label: '渠道',
      summary: '连接外部消息渠道与路由。',
      testId: testIds.app.navChannels,
    },
    {
      key: '/skills',
      icon: <BookOutlined />,
      label: '技能',
      summary: '为 AI 员工安装能力扩展。',
    },
    {
      key: '/mcp',
      icon: <ApiOutlined />,
      label: devMode ? 'MCP 扩展' : '外部连接',
      summary: devMode ? '管理 MCP 服务目录与安装。' : '管理第三方服务对接。',
      testId: testIds.app.navMcp,
    },
    {
      key: '/prompt',
      icon: <ProfileOutlined />,
      label: '行为引导',
      summary: '定义 AI 的工作方式与长期记忆。',
    },
    {
      key: '/system',
      icon: <DesktopOutlined />,
      label: '系统',
      summary: '系统状态、自动化与账户管理。',
    },
  ]
}

export default function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const screens = Grid.useBreakpoint()
  const isDesktop = Boolean(screens.lg)
  const navWidth = 264
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const { preference, resolvedTheme, setPreference } = useThemeMode()
  const { logout, status: authStatus, submitting } = useAuth()
  const { devMode, setDevMode } = useDevMode()
  const menuTheme = resolvedTheme === 'dark' ? 'dark' : 'light'

  const primaryRoutes = useMemo(() => buildPrimaryRoutes(devMode), [devMode])

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname, isDesktop])

  const activeRoute = useMemo(
    () => primaryRoutes.find((item) => location.pathname.startsWith(item.key)) ?? primaryRoutes[0],
    [location.pathname, primaryRoutes],
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
        <div className="brand-chip">{PLATFORM_BADGE_LABEL}</div>
        <div className="brand-head">
          <div className="brand-mark">{PLATFORM_BRAND_MARK}</div>
          <div className="brand-copy">
            <Typography.Title level={2}>{PLATFORM_BRAND_NAME}</Typography.Title>
            <Typography.Text type="secondary">{PLATFORM_SUBTITLE}</Typography.Text>
          </div>
        </div>
      </div>

      <div className="nav-sections">
        <div className="nav-section" key="primary">
          <Typography.Text className="nav-section-label">功能导航</Typography.Text>
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
        <div className="sidebar-dev-toggle">
          <Typography.Text>开发者模式</Typography.Text>
          <Switch size="small" checked={devMode} onChange={setDevMode} />
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
