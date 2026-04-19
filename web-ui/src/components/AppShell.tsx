import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import {
  ApartmentOutlined,
  AppstoreOutlined,
  BookOutlined,
  CloudServerOutlined,
  LinkOutlined,
  LogoutOutlined,
  MenuOutlined,
  MessageOutlined,
  PieChartOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { Avatar, Button, Drawer, Flex, Menu, Typography, theme } from 'antd'
import type { MenuProps } from 'antd'
import { AnimatePresence, motion } from 'framer-motion'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { PLATFORM_BRAND_NAME } from '../branding'
import { useDevMode } from '../devMode'
import { framerMotion } from '../ui/design/tokens'

const shellSpring = framerMotion.spring
import { testIds } from '../testIds'
import { useThemeMode } from '../themeMode'
import { designTokens } from '../ui/design/tokens'
import { AnimatedLogo } from './AnimatedLogo'

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
      label: '运营洞察',
      routes: [
        {
          key: '/dashboard',
          icon: <PieChartOutlined />,
          label: '效能面板',
          testId: testIds.app.navDashboard,
        },
      ],
    },
    {
      key: 'workspace',
      label: '智能体编排',
      routes: [
        {
          key: '/chat',
          icon: <MessageOutlined />,
          label: '数字专员',
          testId: testIds.app.navChat,
        },
        {
          key: '/studio',
          icon: <TeamOutlined />,
          label: '业务编排',
          testId: testIds.app.navStudio,
        },
        {
          key: '/channels',
          icon: <ApartmentOutlined />,
          label: '多端接入',
          testId: testIds.app.navChannels,
        },
        {
          key: '/knowledge',
          icon: <BookOutlined />,
          label: '企业知识库',
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
          icon: <CloudServerOutlined />,
          label: '模型配置',
        },
        {
          key: '/skills',
          icon: <AppstoreOutlined />,
          label: '技能中心',
        },
        {
          key: '/mcp',
          icon: <LinkOutlined />,
          label: '服务集成',
          testId: testIds.app.navMcp,
        },
      ],
    },
    {
      key: 'system',
      label: '系统管理',
      routes: [
        {
          key: '/system',
          icon: <SettingOutlined />,
          label: '全局配置',
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
      <>
        {/* Logo 区域 */}
        <div className="app-sidebar-header" onClick={() => navigate('/dashboard')}>
          <div style={{ flexShrink: 0 }}>
            <AnimatedLogo size={32} />
          </div>
          <div style={{ minWidth: 0 }}>
            <Typography.Title level={5} className="app-sidebar-header-title">
              {PLATFORM_BRAND_NAME}
            </Typography.Title>
            <Typography.Text type="secondary" className="app-sidebar-header-subtitle">
              运营控制台
            </Typography.Text>
          </div>
        </div>

        {/* 菜单区域 */}
        <div className="app-sidebar-menu-area">
          {routeSections.map((section) => {
            const selectedKey = section.routes.find((item) => routeIsActive(location.pathname, item.key))?.key
            const items: MenuProps['items'] = section.routes.map((item) => ({
              key: item.key,
              icon: item.icon,
              label: item.testId ? <span data-testid={item.testId}>{item.label}</span> : item.label,
            }))

            return (
              <div key={section.key}>
                <Typography.Text type="secondary" className="app-sidebar-section-title">
                  {section.label}
                </Typography.Text>
                <Menu
                  className="app-sidebar-menu"
                  mode="inline"
                  selectedKeys={selectedKey ? [selectedKey] : []}
                  items={items}
                  onClick={({ key }) => navigate(String(key))}
                />
              </div>
            )
          })}
        </div>

        {/* 用户区域 */}
        <div className="app-sidebar-footer">
          <Flex align="center" gap={10} justify="space-between">
            <Flex align="center" gap={10} style={{ minWidth: 0, flex: 1 }}>
              <Avatar
                icon={<UserOutlined />}
                style={{ backgroundColor: token.colorPrimaryBg, color: token.colorPrimary, flexShrink: 0 }}
              >
                {authStatus?.username?.slice(0, 1).toUpperCase()}
              </Avatar>
              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-2xs)', letterSpacing: '0.04em', lineHeight: 1.1 }}>
                  当前账号
                </Typography.Text>
                <Typography.Text strong className="app-sidebar-user-name" ellipsis style={{ lineHeight: 1.15 }}>
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
              title="退出登录"
              style={{ color: 'var(--nb-muted)' }}
            />
          </Flex>
        </div>
      </>
    )
  }

  return (
    <div
      className={`app-shell theme-${resolvedTheme} ${isChatRoute ? 'app-shell-chat' : ''}`}
    >
      {isDesktop ? (
        <aside className="app-sidebar" style={{ '--nb-sider-width': `${designTokens.layout.siderWidth}px` } as any}>
          {renderNavigation()}
        </aside>
      ) : (
        <Drawer
          placement="left"
          open={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
          width={designTokens.layout.siderWidth}
          closable={false}
          styles={{ body: { padding: 0, background: token.colorBgContainer } }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {renderNavigation()}
          </div>
        </Drawer>
      )}

      <div className={`app-main-layout ${isChatRoute ? 'app-main-layout-chat' : ''}`}>
        {!isDesktop && (
          <header className="app-mobile-header" style={{ '--nb-header-height': `${designTokens.layout.headerHeight}px` } as any}>
            <Flex align="center" gap={12} style={{ minWidth: 0, flex: 1 }}>
              <Button
                type="text"
                icon={<MenuOutlined />}
                onClick={() => setMobileNavOpen(true)}
                aria-label="打开导航"
              />

              <div style={{ minWidth: 0 }}>
                <Typography.Text type="secondary" className="app-sidebar-section-title" style={{ paddingInline: 0 }}>
                  {activeSection.label}
                </Typography.Text>
                <Typography.Text strong style={{ display: 'block', marginTop: 2, fontSize: 'var(--nb-text-sm)', lineHeight: 1.2 }}>
                  {activeRoute.label}
                </Typography.Text>
              </div>
            </Flex>
          </header>
        )}

        <main
          className={`app-content ${isChatRoute ? 'app-content-chat' : ''}`}
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
              {isChatRoute ? (
                <Outlet />
              ) : (
                <div
                  className="page-content-wrapper"
                  style={
                    {
                      ['--nb-layout-content-max-width' as any]: `${designTokens.layout.contentMaxWidth}px`,
                    } as CSSProperties
                  }
                >
                  <Outlet />
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  )
}
