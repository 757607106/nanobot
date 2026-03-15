import { Tabs } from 'antd'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'

const studioRoutes = [
  { key: '/studio/agents', label: 'AI员工' },
  { key: '/studio/teams', label: '团队' },
  { key: '/studio/runs', label: '执行记录' },
  { key: '/studio/knowledge', label: '知识库' },
]

function resolveActiveKey(pathname: string) {
  if (pathname === '/studio/memory' || pathname.startsWith('/studio/memory/')) {
    return '/studio/teams'
  }
  if (pathname === '/studio/templates' || pathname.startsWith('/studio/templates/')) {
    return '/studio/agents'
  }
  const matched = studioRoutes.find((item) => pathname === item.key || pathname.startsWith(`${item.key}/`))
  return matched?.key ?? '/studio/agents'
}

export default function StudioLayoutPage() {
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
          items={studioRoutes.map((item) => ({
            key: item.key,
            label: item.label,
          }))}
        />
      </div>
      <Outlet />
    </div>
  )
}
