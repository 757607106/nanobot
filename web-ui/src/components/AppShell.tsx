import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import {
  ApiOutlined,
  BlockOutlined,
  ControlOutlined,
  DatabaseOutlined,
  FundProjectionScreenOutlined,
  LogoutOutlined,
  MenuOutlined,
  MessageOutlined,
  PartitionOutlined,
  SendOutlined,
  ThunderboltOutlined,
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
      label: '控制平面',
      routes: [
        {
          key: '/dashboard',
          icon: <FundProjectionScreenOutlined />,
          label: '数据看板',
          testId: testIds.app.navDashboard,
        },
      ],
    },
    {
      key: 'workspace',
      label: '工作空间',
      routes: [
        {
          key: '/chat',
          icon: <MessageOutlined />,
          label: '智能助手',
          testId: testIds.app.navChat,
        },
        {
          key: '/studio',
          icon: <PartitionOutlined />,
          label: 'Agent 工坊',
          testId: testIds.app.navStudio,
        },
        {
          key: '/channels',
          icon: <SendOutlined />,
          label: '分发渠道',
          testId: testIds.app.navChannels,
        },
        {
          key: '/knowledge',
          icon: <DatabaseOutlined />,
          label: '知识引擎',
          testId: testIds.app.navKnowledge,
        },
      ],
    },
    {
      key: 'build',
      label: '基础设施',
      routes: [
        {
          key: '/models',
          icon: <BlockOutlined />,
          label: '模型托管',
        },
        {
          key: '/skills',
          icon: <ThunderboltOutlined />,
          label: '扩展技能',
        },
        {
          key: '/mcp',
          icon: <ApiOutlined />,
          label: devMode ? 'MCP 协议' : '服务集成',
          testId: testIds.app.navMcp,
        },
      ],
    },
    {
      key: 'system',
      label: '管理后台',
      routes: [
        {
          key: '/system',
          icon: <ControlOutlined />,
          label: '系统偏好',
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
        <Flex align="center" gap={12} style={{ padding: '16px 20px' }}>
          <Avatar
            alt={PLATFORM_BRAND_NAME}
            src={PLATFORM_BRAND_LOGO_SRC}
            size={36}
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
              <Typography.Text type="secondary" style={{ display: 'block', fontSize: 11, letterSpacing: '0.04em' }}>
                Account
              </Typography.Text>
              <Typography.Text
                strong
                style={{ display: 'block', maxWidth: 140 }}
                ellipsis
              >
                {authStatus?.username || '—'}
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
            top: 16,
            height: 'calc(100vh - 32px)',
            marginLeft: 16,
            borderRadius: 24,
            overflow: 'auto',
            width: LAYOUT.siderWidth,
            background: 'var(--nb-sider-bg)',
            border: '1px solid var(--nb-sider-border)',
            boxShadow: 'var(--nb-sider-shadow)',
            backdropFilter: 'blur(32px) saturate(140%)',
            zIndex: 100,
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
        {!isDesktop && (
          <header
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              height: LAYOUT.headerHeight,
              paddingInline: 16,
              background: 'color-mix(in srgb, var(--nb-body-bg) 70%, transparent)',
              backdropFilter: 'blur(20px)',
              borderBottom: `1px solid color-mix(in srgb, var(--nb-border) 60%, transparent)`,
            }}
          >
            <Flex align="center" gap={12} style={{ minWidth: 0, flex: 1 }}>
              <Button
                type="text"
                icon={<MenuOutlined />}
                onClick={() => setMobileNavOpen(true)}
                aria-label="打开导航"
              />

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
          </header>
        )}

        <main
          className={`app-content ${isChatRoute ? 'app-content-chat' : ''}`}
          style={{
            flex: 1,
            minWidth: 0,
            padding: isChatRoute ? '12px 16px 16px' : '16px 20px 24px',
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
