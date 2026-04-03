import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Flex, Tabs } from 'antd'
import type { TabsProps } from 'antd'

const routes = [
  { key: '/channels/list', label: '渠道管理' },
  { key: '/channels/bindings', label: '消息路由' },
  { key: '/channels/audit', label: '渠道审计' },
]

function resolveActiveKey(pathname: string): string {
  const matched = routes.find(
    (item) => pathname === item.key || pathname.startsWith(`${item.key}/`),
  )
  return matched?.key ?? '/channels/list'
}

export default function ChannelsLayoutPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const activeKey = resolveActiveKey(location.pathname)

  const items: TabsProps['items'] = routes.map((item) => ({
    key: item.key,
    label: item.label,
  }))

  return (
    <Flex vertical gap={12}>
      <Tabs
        activeKey={activeKey}
        onChange={(key) => navigate(key)}
        items={items}
        size="middle"
        animated={{ inkBar: true, tabPane: false }}
        tabBarGutter={24}
      />
      <Outlet />
    </Flex>
  )
}
