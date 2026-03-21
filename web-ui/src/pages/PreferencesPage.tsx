import { Card, Segmented, Switch, Tag, Typography } from 'antd'
import { DesktopOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons'
import { MotionGroup, MotionPanel } from '../components/MotionSurface'
import PageHero from '../components/PageHero'
import { useDevMode } from '../devMode'
import { useThemeMode, type ThemePreference } from '../themeMode'

const themeLabels: Record<ThemePreference, string> = {
  light: '浅色',
  dark: '深色',
  system: '跟随系统',
}

export default function PreferencesPage() {
  const { devMode, setDevMode } = useDevMode()
  const { preference, resolvedTheme, setPreference } = useThemeMode()

  return (
    <div className="page-stack">
      <PageHero
        className="page-hero-compact studio-hero"
        title="界面与开发模式"
      />

      <MotionGroup className="page-grid preferences-page-grid">
        <MotionPanel hover={false}>
          <Card className="config-panel-card preference-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>界面设置</Typography.Title>
              </div>
              <Tag color={devMode ? 'processing' : 'default'}>{devMode ? '开发模式已开启' : '开发模式已关闭'}</Tag>
            </div>

            <div className="page-stack">
              <div className="page-section-title">
                <Typography.Title level={4}>主题</Typography.Title>
              </div>
              <Segmented
                className="theme-segmented preferences-theme-segmented"
                value={preference}
                options={[
                  {
                    value: 'light',
                    label: (
                      <span className="theme-option-label">
                        <SunOutlined />
                        <span>浅色</span>
                      </span>
                    ),
                  },
                  {
                    value: 'dark',
                    label: (
                      <span className="theme-option-label">
                        <MoonOutlined />
                        <span>深色</span>
                      </span>
                    ),
                  },
                  {
                    value: 'system',
                    label: (
                      <span className="theme-option-label">
                        <DesktopOutlined />
                        <span>跟随系统</span>
                      </span>
                    ),
                  },
                ]}
                onChange={(value) => setPreference(value as ThemePreference)}
              />

              <div className="page-meta-grid">
                <div className="page-meta-card">
                  <span>主题选择</span>
                  <strong>{themeLabels[preference]}</strong>
                </div>
                <div className="page-meta-card">
                  <span>当前渲染</span>
                  <strong>{resolvedTheme === 'dark' ? '深色' : '浅色'}</strong>
                </div>
              </div>

              <div className="page-section-title">
                <Typography.Title level={4}>开发模式</Typography.Title>
              </div>
              <div className="preference-switch-row">
                <div className="page-stack preference-switch-copy">
                  <strong>显示开发者视图</strong>
                </div>
                <Switch checked={devMode} onChange={setDevMode} />
              </div>
            </div>
          </Card>
        </MotionPanel>
      </MotionGroup>
    </div>
  )
}
