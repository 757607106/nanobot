import { useMemo } from 'react'
import { Tag } from 'antd'
import { useNavigate, useSearchParams } from 'react-router-dom'
import SectionTabs from '../components/SectionTabs'
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
      <SectionTabs
        eyebrow="Automation"
        title="自动化任务"
        description="把日程提醒与定时任务统一收进系统自动化域，减少来回切页。"
        activeKey={activeTab}
        onChange={(key) => {
          navigate(`/system/automation?tab=${key}`)
        }}
        items={[
          { key: 'calendar', label: '日程', summary: '管理事件、提醒默认值与派生任务。' },
          { key: 'cron', label: '定时任务', summary: '配置周期任务、单次任务与手动触发。' },
        ]}
      />
      {content}
    </div>
  )
}
