import { Tabs } from 'antd'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'

const studioRoutes = [
  { key: '/studio/agents', label: 'Agents' },
  { key: '/studio/teams', label: 'Teams' },
  { key: '/studio/memory', label: '记忆' },
  { key: '/studio/runs', label: 'Runs' },
  { key: '/studio/knowledge', label: '知识库' },
  { key: '/studio/templates', label: '模板' },
]

function resolveActiveKey(pathname: string) {
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
