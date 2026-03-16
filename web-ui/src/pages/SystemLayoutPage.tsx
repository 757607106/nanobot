import { useMemo } from 'react'
import { Tabs } from 'antd'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useDevMode } from '../devMode'

interface SystemRoute {
  key: string
  label: string
  devOnly?: boolean
}

const allSystemRoutes: SystemRoute[] = [
  { key: '/system', label: '系统状态' },
  { key: '/system/validation', label: '配置验证', devOnly: true },
  { key: '/system/automation', label: '自动化任务' },
  { key: '/system/templates', label: '模板' },
  { key: '/system/operations', label: '运维中心', devOnly: true },
  { key: '/system/admin', label: '账户管理' },
]

function resolveActiveKey(pathname: string, routes: SystemRoute[]) {
  const matched = routes.find((item) => pathname === item.key || pathname.startsWith(`${item.key}/`))
  return matched?.key ?? '/system'
}

export default function SystemLayoutPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { devMode } = useDevMode()

  const visibleRoutes = useMemo(
    () => allSystemRoutes.filter((item) => !item.devOnly || devMode),
    [devMode],
  )
  const activeKey = resolveActiveKey(location.pathname, visibleRoutes)

  return (
    <div className="page-stack">
      <div className="page-card tabs-shell">
        <Tabs
          className="console-tabs"
          activeKey={activeKey}
          onChange={(key) => navigate(key)}
          items={visibleRoutes.map((item) => ({
            key: item.key,
            label: item.label,
          }))}
        />
      </div>
      <Outlet />
    </div>
  )
}
