import { useMemo } from 'react'
import { Grid } from 'antd'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import SectionTabs from '../components/SectionTabs'
import { useDevMode } from '../devMode'

interface SystemRoute {
  key: string
  label: string
  shortLabel: string
  devOnly?: boolean
}

const allSystemRoutes: SystemRoute[] = [
  { key: '/system', label: '系统状态', shortLabel: '状态' },
  { key: '/system/preferences', label: '界面偏好', shortLabel: '偏好' },
  { key: '/system/validation', label: '配置验证', shortLabel: '验证', devOnly: true },
  { key: '/system/automation', label: '自动化任务', shortLabel: '任务' },
  { key: '/system/operations', label: '运维中心', shortLabel: '运维', devOnly: true },
  { key: '/system/admin', label: '账户管理', shortLabel: '账户' },
]

function resolveActiveKey(pathname: string, routes: SystemRoute[]) {
  const matched = routes.find((item) => pathname === item.key || pathname.startsWith(`${item.key}/`))
  return matched?.key ?? '/system'
}

export default function SystemLayoutPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const screens = Grid.useBreakpoint()
  const { devMode } = useDevMode()
  const useCompactLabels = !screens.sm

  const visibleRoutes = useMemo(
    () =>
      allSystemRoutes
        .filter((item) => !item.devOnly || devMode)
        .map((item) => ({
          ...item,
          label: useCompactLabels ? item.shortLabel : item.label,
        })),
    [devMode, useCompactLabels],
  )
  const activeKey = resolveActiveKey(location.pathname, visibleRoutes)

  return (
    <div className="page-stack">
      <SectionTabs
        title="系统与账户"
        activeKey={activeKey}
        onChange={(key) => navigate(key)}
        items={visibleRoutes}
      />
      <Outlet />
    </div>
  )
}
