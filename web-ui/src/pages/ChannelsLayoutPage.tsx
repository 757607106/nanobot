import { Tabs } from 'antd'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'

const channelsRoutes = [
  { key: '/channels/list', label: '渠道管理' },
  { key: '/channels/bindings', label: '消息路由' },
]

function resolveActiveKey(pathname: string) {
  const matched = channelsRoutes.find(
    (item) => pathname === item.key || pathname.startsWith(`${item.key}/`),
  )
  return matched?.key ?? '/channels/list'
}

export default function ChannelsLayoutPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const activeKey = resolveActiveKey(location.pathname)

  return (
    <div className="page-stack">
      <div className="page-card tabs-shell">
        <Tabs
          className="console-tabs"
          activeKey={activeKey}
          onChange={(key) => navigate(key)}
          items={channelsRoutes.map((item) => ({
            key: item.key,
            label: item.label,
          }))}
        />
      </div>
      <Outlet />
    </div>
  )
}
