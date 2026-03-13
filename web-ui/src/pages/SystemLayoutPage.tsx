import { Tabs } from 'antd'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'

const systemRoutes = [
  { key: '/system', label: '健康' },
  { key: '/system/validation', label: '验证' },
  { key: '/system/automation', label: '自动化' },
  { key: '/system/templates', label: '模板' },
  { key: '/system/operations', label: '日志与运维动作' },
  { key: '/system/admin', label: '管理员' },
]

function resolveActiveKey(pathname: string) {
  const matched = systemRoutes.find((item) => pathname === item.key || pathname.startsWith(`${item.key}/`))
  return matched?.key ?? '/system'
}

export default function SystemLayoutPage() {
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
          items={systemRoutes.map((item) => ({
            key: item.key,
            label: item.label,
          }))}
        />
      </div>
      <Outlet />
    </div>
  )
}
