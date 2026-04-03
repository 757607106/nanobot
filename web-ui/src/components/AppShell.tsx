import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import {
  ApiOutlined,
  AppstoreOutlined,
  BookOutlined,
  ClusterOutlined,
  DashboardOutlined,
  ExperimentOutlined,
  LogoutOutlined,
  MenuOutlined,
  MessageOutlined,
  RobotOutlined,
  SettingOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { Avatar, Button, Drawer, Flex, Menu, Typography, theme } from 'antd'
import type { MenuProps } from 'antd'
import { AnimatePresence, motion } from 'framer-motion'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { PLATFORM_BRAND_LOGO_SRC, PLATFORM_BRAND_NAME } from '../branding'
import { useDevMode } from '../devMode'
import { shellSpring } from '../motionTokens'
import { testIds } from '../testIds'
import { useThemeMode } from '../themeMode'
import { LAYOUT } from '../ui/tokens'

const DESKTOP_BREAKPOINT = '(min-width: 992px)'

type AppRoute = {
  key: string
  icon: ReactNode
  label: string
  testId?: string
}

type AppRouteSection = {
  key: string
  label: string
  routes: AppRoute[]
}

function buildRouteSections(devMode: boolean): AppRouteSection[] {
  return [
    {
      key: 'overview',
      label: '总览',
      routes: [
        {
          key: '/dashboard',
          icon: <DashboardOutlined />,
          label: '平台总览',
          testId: testIds.app.navDashboard,
        },
      ],
    },
    {
      key: 'workspace',
      label: '工作台',
      routes: [
        {
          key: '/chat',
          icon: <MessageOutlined />,
          label: '对话工作台',
          testId: testIds.app.navChat,
        },
        {
          key: '/studio',
          icon: <RobotOutlined />,
          label: 'Agent Studio',
          testId: testIds.app.navStudio,
        },
        {
          key: '/channels',
          icon: <ClusterOutlined />,
          label: '渠道注册表',
          testId: testIds.app.navChannels,
        },
        {
          key: '/knowledge',
          icon: <BookOutlined />,
          label: '知识工作区',
          testId: testIds.app.navKnowledge,
        },
      ],
    },
    {
      key: 'build',
      label: '配置',
      routes: [
        {
          key: '/models',
          icon: <ExperimentOutlined />,
          label: '模型与绑定',
        },
        {
          key: '/skills',
          icon: <AppstoreOutlined />,
          label: '技能中心',
        },
        {
          key: '/mcp',
          icon: <ApiOutlined />,
          label: devMode ? 'MCP 扩展' : '连接管理',
          testId: testIds.app.navMcp,
        },
      ],
    },
    {
      key: 'system',
      label: '系统',
      routes: [
        {
          key: '/system',
          icon: <SettingOutlined />,
          label: '实例设置',
        },
      ],
    },
  ]
}

function routeIsActive(pathname: string, routeKey: string) {
  return pathname === routeKey || pathname.startsWith(`${routeKey}/`)
}

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined') {
      return true
    }
    return window.matchMedia(DESKTOP_BREAKPOINT).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }

    const mediaQuery = window.matchMedia(DESKTOP_BREAKPOINT)
    const handleChange = (event: MediaQueryListEvent) => {
      setIsDesktop(event.matches)
    }

    setIsDesktop(mediaQuery.matches)
    mediaQuery.addEventListener('change', handleChange)

    return () => {
      mediaQuery.removeEventListener('change', handleChange)
    }
  }, [])

  return isDesktop
}

export default function AppShell() {
  const { token } = theme.useToken()
  const location = useLocation()
  const navigate = useNavigate()
  const isDesktop = useIsDesktop()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const { resolvedTheme } = useThemeMode()
  const { logout, status: authStatus, submitting } = useAuth()
  const { devMode } = useDevMode()

  const routeSections = useMemo(() => buildRouteSections(devMode), [devMode])
  const primaryRoutes = useMemo(() => routeSections.flatMap((section) => section.routes), [routeSections])
  const activeRoute = useMemo(
    () => primaryRoutes.find((item) => routeIsActive(location.pathname, item.key)) ?? primaryRoutes[0],
    [location.pathname, primaryRoutes],
  )
  const activeSection = useMemo(
    () =>
      routeSections.find((section) => section.routes.some((item) => routeIsActive(location.pathname, item.key)))
      ?? routeSections[0],
    [location.pathname, routeSections],
  )
  const isChatRoute = activeRoute.key === '/chat' || location.pathname.includes('/chat')

  useEffect(() => {
    setMobileNavOpen(false)
  }, [isDesktop, location.pathname])

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  function renderNavigation() {
    return (
      <Flex vertical style={{ height: '100%' }}>
        {/* Logo 区域 */}
        <Flex align="center" gap={12} style={{ padding: '16px 24px' }}>
          <Avatar
            alt={PLATFORM_BRAND_NAME}
            src={PLATFORM_BRAND_LOGO_SRC}
            size={40}
            shape="square"
            style={{ flexShrink: 0 }}
          />
          <div style={{ minWidth: 0 }}>
            <Typography.Title level={5} style={{ margin: 0, fontSize: 15 }}>
              {PLATFORM_BRAND_NAME}
            </Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              Operations Console
            </Typography.Text>
          </div>
        </Flex>

        {/* 菜单区域 */}
        <Flex vertical gap={10} style={{ flex: 1, padding: '8px 12px 0' }}>
          {routeSections.map((section) => {
            const selectedKey = section.routes.find((item) => routeIsActive(location.pathname, item.key))?.key
            const items: MenuProps['items'] = section.routes.map((item) => ({
              key: item.key,
              icon: item.icon,
              label: item.testId ? <span data-testid={item.testId}>{item.label}</span> : item.label,
            }))

            return (
              <div key={section.key}>
                <Typography.Text
                  type="secondary"
                  style={{
                    display: 'block',
                    paddingInline: 12,
                    marginBottom: 4,
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                  }}
                >
                  {section.label}
                </Typography.Text>
                <Menu
                  mode="inline"
                  selectedKeys={selectedKey ? [selectedKey] : []}
                  items={items}
                  onClick={({ key }) => navigate(String(key))}
                  style={{
                    background: 'transparent',
                    borderInlineEnd: 'none',
                  }}
                />
              </div>
            )
          })}
        </Flex>

        {/* 用户区域 */}
        <Flex
          vertical
          gap={10}
          style={{ padding: '16px 12px 12px', borderTop: `1px solid ${token.colorBorderSecondary}` }}
        >
          <Flex align="center" gap={12}>
            <Avatar
              icon={<UserOutlined />}
              style={{
                backgroundColor: token.colorPrimaryBg,
                color: token.colorPrimary,
              }}
            >
              {authStatus?.username?.slice(0, 1).toUpperCase()}
            </Avatar>
            <div style={{ minWidth: 0 }}>
              <Typography.Text type="secondary" style={{ display: 'block', fontSize: 11 }}>
                当前用户
              </Typography.Text>
              <Typography.Text
                strong
                style={{ display: 'block', maxWidth: 180 }}
                ellipsis
              >
                {authStatus?.username || '未登录'}
              </Typography.Text>
            </div>
          </Flex>

          <Button
            type="text"
            icon={<LogoutOutlined />}
            loading={submitting}
            onClick={() => void handleLogout()}
            data-testid={testIds.app.logout}
            style={{ justifyContent: 'flex-start', paddingInline: 8 }}
          >
            退出登录
          </Button>
        </Flex>
      </Flex>
    )
  }

  return (
    <div
      className={`app-shell theme-${resolvedTheme} ${isChatRoute ? 'app-shell-chat' : ''}`}
      style={{ background: token.colorBgLayout, display: 'flex', height: '100vh' }}
    >
      {isDesktop ? (
        <aside
          style={{
            position: 'sticky',
            top: 0,
            height: '100vh',
            overflow: 'auto',
            width: LAYOUT.siderWidth,
            background: token.colorBgContainer,
            borderRight: `1px solid ${token.colorBorderSecondary}`,
            boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.03)',
          }}
        >
          {renderNavigation()}
        </aside>
      ) : (
        <Drawer
          placement="left"
          open={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
          width={LAYOUT.siderWidth}
          closable={false}
          styles={{
            body: {
              padding: 0,
              background: token.colorBgContainer,
            },
          }}
        >
          {renderNavigation()}
        </Drawer>
      )}

      <div className={`app-main-layout ${isChatRoute ? 'app-main-layout-chat' : ''}`} style={{ display: 'flex', flex: 1, flexDirection: 'column', minWidth: 0 }}>
        <header
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: LAYOUT.headerHeight,
            paddingInline: isDesktop ? 24 : 16,
            background: token.colorBgContainer,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <Flex align="center" gap={12} style={{ minWidth: 0, flex: 1 }}>
            {!isDesktop ? (
              <Button
                type="text"
                icon={<MenuOutlined />}
                onClick={() => setMobileNavOpen(true)}
                aria-label="打开导航"
              />
            ) : null}

            <div style={{ minWidth: 0 }}>
              <Typography.Text
                type="secondary"
                style={{
                  display: 'block',
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}
              >
                {activeSection.label}
              </Typography.Text>
              <Typography.Text
                strong
                style={{
                  display: 'block',
                  marginTop: 2,
                  fontSize: 14,
                  lineHeight: 1.2,
                }}
              >
                {activeRoute.label}
              </Typography.Text>
            </div>
          </Flex>

          {isDesktop ? (
            <Flex align="center" gap={16} style={{ minWidth: 0 }}>
              <Avatar
                icon={<UserOutlined />}
                onClick={() => navigate('/system/admin')}
                style={{
                  backgroundColor: token.colorPrimaryBg,
                  color: token.colorPrimary,
                  cursor: 'pointer',
                  border: `1px solid ${token.colorBorderSecondary}`
                }}
              >
                {authStatus?.username?.slice(0, 1).toUpperCase()}
              </Avatar>
            </Flex>
          ) : null}
        </header>

        <main
          className={`app-content ${isChatRoute ? 'app-content-chat' : ''}`}
          style={{
            flex: 1,
            minWidth: 0,
            padding: isChatRoute ? '16px 18px 22px' : '22px 22px 28px',
          }}
        >
          <AnimatePresence initial={false} mode="wait">
            <motion.div
              key={location.pathname}
              className="app-content-motion"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={shellSpring}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  )
}
