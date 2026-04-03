import { Segmented, theme } from 'antd'
import { useNavigate, useSearchParams } from 'react-router-dom'
import PageHeader from '../components/console/PageHeader'
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

  return (
    <div className="page-stack">
      <PageHeader
        title="自动化管理"
        subtitle="日程事项与定时任务配置"
        actions={
          <Segmented
            value={activeTab}
            options={[
              { label: '日程', value: 'calendar' },
              { label: '定时任务', value: 'cron' },
            ]}
            onChange={(value) => navigate(`/system/automation?tab=${value}`)}
          />
        }
      />

      {activeTab === 'cron' ? <CronPage /> : <CalendarPage />}
    </div>
  )
}
