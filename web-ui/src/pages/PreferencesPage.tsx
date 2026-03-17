import { Card, Segmented, Space, Switch, Tag, Typography } from 'antd'
import { DesktopOutlined, MoonOutlined, SettingOutlined, SunOutlined } from '@ant-design/icons'
import { MotionGroup, MotionPanel } from '../components/MotionSurface'
import PageHero from '../components/PageHero'
import { useDevMode } from '../devMode'
import { useThemeMode, type ThemePreference } from '../themeMode'

const { Text } = Typography

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
        eyebrow="界面偏好"
        title="界面与开发模式"
        description="统一管理主题和高级模式。"
        badges={[
          <Tag key="scope">全局设置</Tag>,
          <Tag key="theme">{resolvedTheme === 'dark' ? '深色渲染' : '浅色渲染'}</Tag>,
        ]}
        stats={[
          { label: '主题选择', value: themeLabels[preference] },
          { label: '当前渲染', value: resolvedTheme === 'dark' ? '深色' : '浅色' },
          { label: '开发模式', value: devMode ? '开启' : '关闭' },
        ]}
      />

      <MotionGroup className="page-grid preferences-page-grid">
        <MotionPanel hover={false}>
          <Card className="config-panel-card preference-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>外观主题</Typography.Title>
                <Text type="secondary">主题切换立即生效。</Text>
              </div>
              <Tag icon={<SettingOutlined />}>外观</Tag>
            </div>

            <div className="page-stack">
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

              <div className="page-meta-grid preference-preview-grid">
                <div className="page-meta-card">
                  <span>当前风格</span>
                  <strong>{resolvedTheme === 'dark' ? '静夜玻璃' : '雾感浅昼'}</strong>
                </div>
                <div className="page-meta-card">
                  <span>主色倾向</span>
                  <strong>鼠尾草绿</strong>
                </div>
                <div className="page-meta-card">
                  <span>界面密度</span>
                  <strong>舒展</strong>
                </div>
              </div>
            </div>
          </Card>
        </MotionPanel>

        <MotionPanel hover={false}>
          <Card className="config-panel-card preference-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>开发模式</Typography.Title>
                <Text type="secondary">高级诊断与运维入口。</Text>
              </div>
              <Tag color={devMode ? 'processing' : 'default'}>{devMode ? '已开启' : '已关闭'}</Tag>
            </div>

            <div className="page-stack">
              <div className="preference-switch-row">
                <div className="page-stack preference-switch-copy">
                  <strong>显示开发者视图</strong>
                  <Text type="secondary">开启后显示配置验证、运维中心和更多调试信息。</Text>
                </div>
                <Switch checked={devMode} onChange={setDevMode} />
              </div>

              <Space wrap size={8}>
                <Tag>验证结果</Tag>
                <Tag>运维中心</Tag>
                <Tag>高级运行信息</Tag>
              </Space>
            </div>
          </Card>
        </MotionPanel>
      </MotionGroup>
    </div>
  )
}
