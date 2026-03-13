import { Tabs } from 'antd'
import { useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import CalendarPage from './CalendarPage'
import CronPage from './CronPage'

type AutomationTabKey = 'calendar' | 'cron'

function normalizeTab(value: string | null): AutomationTabKey {
  return value === 'cron' ? 'cron' : 'calendar'
}

export default function AutomationPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const activeTab = normalizeTab(searchParams.get('tab'))

  const content = useMemo(
    () => (activeTab === 'cron' ? <CronPage /> : <CalendarPage />),
    [activeTab],
  )

  return (
    <div className="page-stack">
      <div className="page-card tabs-shell">
        <Tabs
          className="console-tabs"
          activeKey={activeTab}
          onChange={(key) => {
            navigate(`/system/automation?tab=${key}`)
          }}
          items={[
            { key: 'calendar', label: '日程' },
            { key: 'cron', label: '定时任务' },
          ]}
        />
      </div>
      {content}
    </div>
  )
}
