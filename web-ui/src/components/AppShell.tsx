import { useEffect, useMemo, useState } from 'react'
import { Button, Drawer, Grid, Layout, Menu, Typography } from 'antd'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ApiOutlined,
  ApartmentOutlined,
  BookOutlined,
  ClusterOutlined,
  DesktopOutlined,
  LogoutOutlined,
  MenuOutlined,
  MessageOutlined,
  ProfileOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import {
  PLATFORM_BADGE_LABEL,
  PLATFORM_BRAND_MARK,
  PLATFORM_BRAND_NAME,
} from '../branding'
import { useDevMode } from '../devMode'
import { shellSpring, surfaceReveal } from '../motionTokens'
import { testIds } from '../testIds'
import { useThemeMode } from '../themeMode'

const { Header, Sider, Content } = Layout

type AppRoute = {
  key: string
  icon: JSX.Element
  label: string
  summary: string
  sectionLabel: string
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
          key: '/chat',
          icon: <MessageOutlined />,
          label: '对话',
          summary: '工作区会话、附件与上下文协作入口。',
          sectionLabel: '工作区',
          testId: testIds.app.navChat,
        },
        {
          key: '/studio',
          icon: <ApartmentOutlined />,
          label: '协作',
          summary: '员工、团队、知识库与执行协作工作台。',
          sectionLabel: '工作区',
          testId: testIds.app.navStudio,
        },
        {
          key: '/channels',
          icon: <ClusterOutlined />,
          label: '渠道',
          summary: '渠道接入、路由规则与对外消息流转。',
          sectionLabel: '工作区',
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
          summary: '默认模型、供应商连接与推理参数。',
          sectionLabel: '构建',
        },
        {
          key: '/skills',
          icon: <BookOutlined />,
          label: '技能',
          summary: '安装、筛选并管理可复用能力扩展。',
          sectionLabel: '构建',
        },
        {
          key: '/mcp',
          icon: <ApiOutlined />,
          label: devMode ? 'MCP 扩展' : '外部连接',
          summary: devMode ? '登记、探测并测试 MCP 服务。' : '维护第三方服务连接与状态。',
          sectionLabel: '构建',
          testId: testIds.app.navMcp,
        },
        {
          key: '/prompt',
          icon: <ProfileOutlined />,
          label: '行为引导',
          summary: '维护工作区引导文件与长期记忆文档。',
          sectionLabel: '构建',
        },
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
          summary: '系统状态、自动化、验证与账户管理。',
          sectionLabel: '系统',
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
  const navWidth = 224
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
        <div className="brand-chip">{PLATFORM_BADGE_LABEL}</div>
        <div className="brand-head">
          <div className="brand-mark">{PLATFORM_BRAND_MARK}</div>
          <div className="brand-copy">
            <Typography.Title level={2}>{PLATFORM_BRAND_NAME}</Typography.Title>
          </div>
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
        <Typography.Text type="secondary">管理员</Typography.Text>
        <div className="mono-block mono-block-tight">
          {authStatus?.username || '未登录'}
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
          width={navWidth}
          closable={false}
          rootClassName="mobile-nav-drawer"
        >
          {navigationContent}
        </Drawer>
      ) : null}

      <Layout className={`app-main-layout ${isChatRoute ? 'app-main-layout-chat' : ''}`}>
        <Header className={`app-header ${isChatRoute ? 'app-header-chat' : ''}`}>
          <motion.div
            className="app-header-shell"
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={shellSpring}
          >
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
                  <div className="header-title-meta">
                    <span className="header-context-chip">{activeRoute.sectionLabel}</span>
                  </div>
                  <Typography.Title level={5}>{activeRoute.label}</Typography.Title>
                </div>
              </div>
            </div>

            <div className="header-actions">
              {isDesktop && !isChatRoute ? (
                <div className="header-admin-chip">
                  <div>
                    <div className="header-admin-label">管理员</div>
                    <strong>{authStatus?.username || '未登录'}</strong>
                  </div>
                </div>
              ) : null}
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
          </motion.div>
        </Header>
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
