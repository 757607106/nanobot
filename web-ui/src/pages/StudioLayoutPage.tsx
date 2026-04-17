import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import SectionTabs from '../components/SectionTabs'

const studioRoutes = [
  { key: '/studio/agents', label: 'AI 员工' },
  { key: '/studio/templates', label: '资源蓝图' },
  { key: '/studio/memory', label: '记忆审计' },
  { key: '/studio/runs', label: '执行记录' },
]

function resolveActiveKey(pathname: string) {
  if (pathname.startsWith('/studio/memory/agents/')) {
    return '/studio/memory'
  }
  if (pathname === '/studio/memory' || pathname.startsWith('/studio/memory/')) {
    return '/studio/memory'
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
      <SectionTabs
        activeKey={activeKey}
        onChange={(key) => navigate(key)}
        items={studioRoutes}
      />
      <Outlet />
    </div>
  )
}
