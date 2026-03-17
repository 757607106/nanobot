import { Grid } from 'antd'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import SectionTabs from '../components/SectionTabs'

const channelsRoutes = [
  { key: '/channels/list', label: '渠道管理', shortLabel: '渠道', summary: '查看接入状态、投递策略与单渠道配置。' },
  { key: '/channels/bindings', label: '消息路由', shortLabel: '路由', summary: '维护渠道到员工或团队的路由规则。' },
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
        eyebrow="Channels"
        title="渠道与消息路由"
        description="先看渠道接入，再管理消息分发规则，让配置路径更直接。"
        activeKey={activeKey}
        onChange={(key) => navigate(key)}
        items={items}
      />
      <Outlet />
    </div>
  )
}
