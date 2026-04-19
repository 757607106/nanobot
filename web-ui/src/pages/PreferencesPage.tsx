import {
  DesktopOutlined,
  MoonOutlined,
  SunOutlined,
} from '@ant-design/icons'
import { Flex, Segmented, Typography } from 'antd'
import PageHeader from '../components/console/PageHeader'
import SectionCard from '../components/console/SectionCard'
import { useThemeMode, type ThemePreference } from '../themeMode'

const themeOptions: { value: ThemePreference; label: string; icon: JSX.Element }[] = [
  { value: 'light', label: '浅色', icon: <SunOutlined /> },
  { value: 'dark', label: '深色', icon: <MoonOutlined /> },
  { value: 'system', label: '系统', icon: <DesktopOutlined /> },
]

export default function PreferencesPage() {
  const { preference, setPreference } = useThemeMode()

  return (
    <div className="page-stack">
      <PageHeader
        title="偏好设置"
        subtitle="显示 · 主题"
      />

      <div className="page-content-wrapper" style={{ paddingInline: 'var(--nb-layout-gutter)' }}>
        <div 
          style={{
            display: 'grid',
            gap: 20,
            gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
          }}
        >
          <SectionCard 
            title="显示主题" 
            description="选择界面外观，或跟随系统"
          >
            <Flex vertical gap={16}>
              <Segmented
                block
                value={preference}
                onChange={(value) => setPreference(value as ThemePreference)}
                options={themeOptions.map(({ value, label, icon }) => ({
                  value,
                  icon: <span style={{ fontSize: 'var(--nb-text-lg)' }}>{icon}</span>,
                  label: <span style={{ fontSize: 'var(--nb-text-sm)', fontWeight: 'var(--nb-font-weight-medium)' }}>{label}</span>,
                }))}
                style={{ borderRadius: 12, padding: 4 }}
              />
            </Flex>
          </SectionCard>
        </div>
      </div>
    </div>
  )
}
