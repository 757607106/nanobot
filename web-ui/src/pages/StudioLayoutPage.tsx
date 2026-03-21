import { Grid } from 'antd'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import SectionTabs from '../components/SectionTabs'

const studioRoutes = [
  { key: '/studio/agents', label: 'AI 员工', shortLabel: '员工' },
  { key: '/studio/teams', label: '团队', shortLabel: '团队' },
  { key: '/studio/runs', label: '执行记录', shortLabel: '记录' },
]

function resolveActiveKey(pathname: string) {
  if (pathname === '/studio/memory' || pathname.startsWith('/studio/memory/')) {
    return '/studio/teams'
  }
  const matched = studioRoutes.find((item) => pathname === item.key || pathname.startsWith(`${item.key}/`))
  return matched?.key ?? '/studio/agents'
}

export default function StudioLayoutPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const screens = Grid.useBreakpoint()
  const useCompactLabels = !screens.sm
  const activeKey = resolveActiveKey(location.pathname)
  const items = studioRoutes.map((item) => ({
    ...item,
    label: useCompactLabels ? item.shortLabel : item.label,
  }))

  return (
    <div className="page-stack">
      <SectionTabs
        title="协作工作台"
        activeKey={activeKey}
        onChange={(key) => navigate(key)}
        items={items}
      />
      <Outlet />
    </div>
  )
}
