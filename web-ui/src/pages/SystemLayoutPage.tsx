import { useMemo } from 'react'
import { Grid } from 'antd'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import SectionTabs from '../components/SectionTabs'
import { useDevMode } from '../devMode'

interface SystemRoute {
  key: string
  label: string
  shortLabel: string
  summary: string
  devOnly?: boolean
}

const allSystemRoutes: SystemRoute[] = [
  { key: '/system', label: '系统状态', shortLabel: '状态', summary: '查看实例绑定、健康度与运行环境。' },
  { key: '/system/preferences', label: '界面偏好', shortLabel: '偏好', summary: '主题、开发模式与全局偏好。' },
  { key: '/system/validation', label: '配置验证', shortLabel: '验证', summary: '集中查看阻塞项、提醒项与修复入口。', devOnly: true },
  { key: '/system/automation', label: '自动化任务', shortLabel: '任务', summary: '管理日程提醒与定时任务调度。' },
  { key: '/system/operations', label: '运维中心', shortLabel: '运维', summary: '查看日志尾部与可执行运维动作。', devOnly: true },
  { key: '/system/admin', label: '账户管理', shortLabel: '账户', summary: '维护管理员资料、头像与登录安全。' },
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
        eyebrow="System"
        title="系统与账户"
        description="系统状态、偏好与账户。"
        activeKey={activeKey}
        onChange={(key) => navigate(key)}
        items={visibleRoutes}
      />
      <Outlet />
    </div>
  )
}
