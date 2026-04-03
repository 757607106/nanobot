import { Button, theme } from 'antd'
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
  const { token } = theme.useToken()
  const activeTab = normalizeTab(searchParams.get('tab'))

  return (
    <div className="page-stack">
      <PageHeader
        title="自动化管理"
        subtitle="日程事项与定时任务配置"
        actions={
          <div className="flex gap-3 flex-wrap">
            <Button
              type={activeTab === 'calendar' ? 'primary' : 'default'}
              onClick={() => navigate('/system/automation?tab=calendar')}
            >
              日程
            </Button>
            <Button
              type={activeTab === 'cron' ? 'primary' : 'default'}
              onClick={() => navigate('/system/automation?tab=cron')}
            >
              定时任务
            </Button>
          </div>
        }
      />

      {activeTab === 'cron' ? <CronPage /> : <CalendarPage />}
    </div>
  )
}
