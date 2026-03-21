import { Button } from 'antd'
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

  return (
    <div className="automation-hub-shell">
      <div className="automation-hub-topbar">
        <div className="automation-hub-title-chip">自动化管理</div>
        <div className="automation-hub-tabs">
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
      </div>

      <div className="automation-hub-description">
        保留当前项目的日程提醒与 Cron 任务能力，但页面布局参照参考项目的定时任务管理方式统一整理。
      </div>

      {activeTab === 'cron' ? <CronPage /> : <CalendarPage />}
    </div>
  )
}
