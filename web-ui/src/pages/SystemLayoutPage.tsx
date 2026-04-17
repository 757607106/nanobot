import { useMemo } from 'react'
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
  { key: '/system/tenants', label: '租户管理', shortLabel: '租户' },
  { key: '/system/preferences', label: '界面偏好', shortLabel: '偏好' },
  { key: '/system/validation', label: '配置验证', shortLabel: '验证', devOnly: true },
  { key: '/system/automation', label: '自动化任务', shortLabel: '任务' },
  { key: '/system/operations', label: '运维中心', shortLabel: '运维', devOnly: true },
  { key: '/system/admin', label: '账户管理', shortLabel: '账户' },
]

function resolveActiveKey(pathname: string, routes: SystemRoute[]) {
  // 优先精确匹配
  const exactMatch = routes.find((item) => pathname === item.key)
  if (exactMatch) {
    return exactMatch.key
  }
  
  // 然后降级为基于最长前缀的模糊匹配
  const prefixMatch = [...routes]
    .sort((a, b) => b.key.length - a.key.length)
    .find((item) => pathname.startsWith(`${item.key}/`))
    
  return prefixMatch?.key ?? '/system'
}

export default function SystemLayoutPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { devMode } = useDevMode()

  const visibleRoutes = useMemo(
    () =>
      allSystemRoutes
        .filter((item) => !item.devOnly || devMode)
        .map((item) => ({
          key: item.key,
          label: item.label,
        })),
    [devMode],
  )
  const activeKey = resolveActiveKey(location.pathname, allSystemRoutes.filter((item) => !item.devOnly || devMode))

  return (
    <div className="page-stack">
      <SectionTabs
        activeKey={activeKey}
        onChange={(key) => navigate(key)}
        items={visibleRoutes}
      />
      <Outlet />
    </div>
  )
}
