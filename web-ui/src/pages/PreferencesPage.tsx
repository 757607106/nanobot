import {
  CodeOutlined,
  DesktopOutlined,
  MoonOutlined,
  SunOutlined,
} from '@ant-design/icons'
import { Flex, Segmented, Switch, Typography, theme } from 'antd'
import PageHeader from '../components/console/PageHeader'
import SectionCard from '../components/console/SectionCard'
import { useDevMode } from '../devMode'
import { useThemeMode, type ThemePreference } from '../themeMode'

const themeOptions: { value: ThemePreference; label: string; icon: JSX.Element }[] = [
  { value: 'light', label: '浅色', icon: <SunOutlined /> },
  { value: 'dark', label: '深色', icon: <MoonOutlined /> },
  { value: 'system', label: '系统', icon: <DesktopOutlined /> },
]

export default function PreferencesPage() {
  const { token } = theme.useToken()
  const { devMode, setDevMode } = useDevMode()
  const { preference, setPreference } = useThemeMode()

  return (
    <div className="page-stack">
      <PageHeader
        title="偏好设置"
        subtitle="显示 · 主题 · 开发"
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

          <SectionCard 
            title="开发者预览" 
            description="显示额外的调试信息和运维入口"
          >
            <div
              style={{
                padding: '20px',
                borderRadius: 16,
                background: 'var(--nb-card-subtle-bg)',
                border: '1px solid var(--nb-card-subtle-border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 20,
              }}
            >
              <Flex vertical gap={4} style={{ minWidth: 0 }}>
                <Flex align="center" gap={10}>
                  <CodeOutlined style={{ color: 'var(--nb-accent)', fontSize: 'var(--nb-title-xs)' }} />
                  <Typography.Text strong style={{ fontSize: 'var(--nb-text-md)' }}>显示开发者视图</Typography.Text>
                </Flex>
                <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-sm)', opacity: 0.8 }}>
                  主要用于调试 MCP 接口和自动化工作流。
                </Typography.Text>
              </Flex>
              <Switch checked={devMode} onChange={setDevMode} />
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  )
}
