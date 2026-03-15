import { Button, Card, Space, Tag, Typography } from 'antd'
import { LinkOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import PageHero from '../components/PageHero'

interface CollaborationPlaceholderPageProps {
  eyebrow: string
  title: string
  description: string
  nextStep: string
}

export default function CollaborationPlaceholderPage({
  eyebrow,
  title,
  description,
  nextStep,
}: CollaborationPlaceholderPageProps) {
  const navigate = useNavigate()

  return (
    <div className="page-stack">
      <PageHero
        className="page-hero-compact"
        eyebrow={eyebrow}
        title={title}
        description={description}
        badges={[
          <Tag key="phase" color="processing">按阶段推进</Tag>,
          <Tag key="state">当前为预留入口</Tag>,
        ]}
        actions={(
          <Space wrap>
            <Button type="primary" icon={<LinkOutlined />} onClick={() => navigate('/studio/agents')}>
              先去配置 Agents
            </Button>
          </Space>
        )}
      />

      <Card className="config-panel-card studio-placeholder-card">
        <div className="page-section-title">
          <Typography.Title level={4}>当前阶段说明</Typography.Title>
          <Typography.Text type="secondary">{nextStep}</Typography.Text>
        </div>
      </Card>
    </div>
  )
}
