import { useEffect, useMemo, useState } from 'react'
import { Button, Drawer, Grid, Layout, Menu, Typography } from 'antd'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ApiOutlined,
  ApartmentOutlined,
  BookOutlined,
  ClusterOutlined,
  DatabaseOutlined,
  DashboardOutlined,
  DesktopOutlined,
  LogoutOutlined,
  MessageOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { PLATFORM_BRAND_LOGO_SRC, PLATFORM_BRAND_NAME } from '../branding'
import { useDevMode } from '../devMode'
import { shellSpring, surfaceReveal } from '../motionTokens'
import { testIds } from '../testIds'
import { useThemeMode } from '../themeMode'

const { Sider, Content } = Layout

type AppRoute = {
  key: string
  icon: JSX.Element
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
      key: 'workspace',
      label: '工作区',
      routes: [
        {
          key: '/dashboard',
          icon: <DashboardOutlined />,
          label: '看板',
          testId: testIds.app.navDashboard,
        },
        {
          key: '/chat',
          icon: <MessageOutlined />,
          label: '对话',
          testId: testIds.app.navChat,
        },
        {
          key: '/studio',
          icon: <ApartmentOutlined />,
          label: '协作',
          testId: testIds.app.navStudio,
        },
        {
          key: '/channels',
          icon: <ClusterOutlined />,
          label: '渠道',
          testId: testIds.app.navChannels,
        },
      ],
    },
    {
      key: 'builder',
      label: '构建',
      routes: [
        {
          key: '/models',
          icon: <SettingOutlined />,
          label: '模型',
        },
        {
          key: '/skills',
          icon: <BookOutlined />,
          label: '技能',
        },
        {
          key: '/mcp',
          icon: <ApiOutlined />,
          label: devMode ? 'MCP 扩展' : '连接',
          testId: testIds.app.navMcp,
        },
        {
          key: '/knowledge',
          icon: <DatabaseOutlined />,
          label: '知识库',
          testId: testIds.app.navKnowledge,
        },
        // 暂时隐藏“行为引导”页面入口，保留实现便于后续恢复。
        // {
        //   key: '/prompt',
        //   icon: <ProfileOutlined />,
        //   label: '行为引导',
        //   summary: '维护工作区引导文件与长期记忆文档。',
        // },
      ],
    },
    {
      key: 'system',
      label: '系统',
      routes: [
        {
          key: '/system',
          icon: <DesktopOutlined />,
          label: '系统',
        },
      ],
    },
  ]
}

export default function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const screens = Grid.useBreakpoint()
  const isDesktop = Boolean(screens.lg)
  const navWidth = 216
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const { resolvedTheme } = useThemeMode()
  const { logout, status: authStatus, submitting } = useAuth()
  const { devMode } = useDevMode()
  const menuTheme = resolvedTheme === 'dark' ? 'dark' : 'light'

  const routeSections = useMemo(() => buildRouteSections(devMode), [devMode])
  const primaryRoutes = useMemo(
    () => routeSections.flatMap((section) => section.routes),
    [routeSections],
  )

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
        </div>
      ),
    }))
  }

  const contentVariants = isChatRoute
    ? {
        hidden: { opacity: 0, y: 8 },
        visible: { opacity: 1, y: 0, transition: shellSpring },
        exit: { opacity: 0, y: -6, transition: { duration: 0.14 } },
      }
    : surfaceReveal

  const navigationContent = (
    <motion.div
      className="app-sider-panel"
      initial={{ opacity: 0, x: -22 }}
      animate={{ opacity: 1, x: 0 }}
      transition={shellSpring}
    >
      <div className="brand-block">
        <div className="brand-head">
          <img className="brand-logo" src={PLATFORM_BRAND_LOGO_SRC} alt={PLATFORM_BRAND_NAME} />
        </div>
      </div>

      <div className="nav-sections">
        {routeSections.map((section) => (
          <div className="nav-section" key={section.key}>
            <Typography.Text className="nav-section-label">{section.label}</Typography.Text>
            <Menu
              mode="inline"
              theme={menuTheme}
              selectedKeys={[activeRoute.key]}
              items={buildMenuItems(section.routes)}
              onClick={({ key }) => navigate(key)}
              className="nav-menu"
            />
          </div>
        ))}
      </div>

      <div className="sidebar-footer">
        <div className="sidebar-account-card">
          <div className="sidebar-account-copy">
            <span className="sidebar-account-label">当前用户</span>
            <div className="mono-block mono-block-tight">
              {authStatus?.username || '未登录'}
            </div>
          </div>
          <Button
            type="text"
            size="small"
            icon={<LogoutOutlined />}
            loading={submitting}
            onClick={() => void handleLogout()}
            data-testid={testIds.app.logout}
            className="sidebar-account-action"
          />
        </div>
      </div>
    </motion.div>
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
          width={`min(${navWidth}px, calc(100vw - 16px))`}
          closable={false}
          rootClassName="mobile-nav-drawer"
        >
          {navigationContent}
        </Drawer>
      ) : null}

      <Layout className={`app-main-layout ${isChatRoute ? 'app-main-layout-chat' : ''}`}>
        <Content className={`app-content ${isChatRoute ? 'app-content-chat' : ''}`}>
          <AnimatePresence initial={false} mode="wait">
            <motion.div
              key={location.pathname}
              className="app-content-motion"
              variants={contentVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </Content>
      </Layout>
    </Layout>
  )
}
