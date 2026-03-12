import { Layout, Menu, Typography } from 'antd'
import {
  BookOutlined,
  ClockCircleOutlined,
  DashboardOutlined,
  MessageOutlined,
  ProfileOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'

const { Header, Sider, Content } = Layout

const items = [
  { key: '/chat', icon: <MessageOutlined />, label: 'Chat' },
  { key: '/cron', icon: <ClockCircleOutlined />, label: 'Cron' },
  { key: '/skills', icon: <BookOutlined />, label: 'Skills' },
  { key: '/prompt', icon: <ProfileOutlined />, label: 'Agent Prompt' },
  { key: '/config', icon: <SettingOutlined />, label: 'Config' },
  { key: '/system', icon: <DashboardOutlined />, label: 'System' },
]

export default function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <Layout className="app-shell">
      <Sider breakpoint="lg" collapsedWidth="0" width={260} theme="light" className="app-sider">
        <div className="brand-block">
          <Typography.Title level={3}>nanobot</Typography.Title>
          <Typography.Text type="secondary">
            Web console for the current nanobot backend.
          </Typography.Text>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={items}
          onClick={({ key }) => navigate(key)}
          className="nav-menu"
        />
      </Sider>
      <Layout>
        <Header className="app-header">
          <div className="header-glow" />
          <Typography.Text className="header-title">
            Chat, scheduling, skills, prompt, config, and runtime status
          </Typography.Text>
        </Header>
        <Content className="app-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
