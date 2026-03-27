import { Grid } from 'antd'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import SectionTabs from '../components/SectionTabs'

const channelsRoutes = [
  { key: '/channels/list', label: '渠道管理', shortLabel: '渠道' },
  { key: '/channels/bindings', label: '消息路由', shortLabel: '路由' },
  { key: '/channels/audit', label: '渠道审计', shortLabel: '审计' },
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
  const screens = Grid.useBreakpoint()
  const useCompactLabels = !screens.sm
  const activeKey = resolveActiveKey(location.pathname)
  const items = channelsRoutes.map((item) => ({
    ...item,
    label: useCompactLabels ? item.shortLabel : item.label,
  }))

  return (
    <div className="page-stack">
      <SectionTabs
        title="渠道与消息路由"
        activeKey={activeKey}
        onChange={(key) => navigate(key)}
        items={items}
      />
      <Outlet />
    </div>
  )
}
