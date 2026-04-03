import { SearchOutlined } from '@ant-design/icons'
import { Button, Empty, Flex, Input, Space, Tag, theme, Typography } from 'antd'
import type { AgentListProps } from './types'
import { scopeLabel } from './types'
import SectionCard from '../../components/console/SectionCard'

export default function AgentList({
  agents,
  selectedAgentId,
  agentSearch,
  onAgentSearchChange,
  onSelectAgent,
}: AgentListProps) {
  const { token } = theme.useToken()

  const visibleAgents = agents.filter((item) => {
    const query = agentSearch.trim().toLowerCase()
    if (!query) return true
    return (
      item.name.toLowerCase().includes(query)
      || item.agentId.toLowerCase().includes(query)
      || (item.memoryScope || '').toLowerCase().includes(query)
    )
  })

  return (
    <SectionCard title="员工">
      <Flex vertical gap={16}>
        <Input
          value={agentSearch}
          onChange={(event) => onAgentSearchChange(event.target.value)}
          placeholder="搜索员工"
          allowClear
          prefix={<SearchOutlined />}
        />

        {visibleAgents.length === 0 ? (
          <Empty image={false} className="minimal-empty" description="暂无符合条件的员工。" />
        ) : (
          <Flex vertical gap={12}>
            {visibleAgents.map((item) => (
              <Button
                key={item.agentId}
                type={selectedAgentId === item.agentId ? 'primary' : 'default'}
                block
                onClick={() => onSelectAgent(item.agentId)}
                style={{ height: 'auto', padding: 0, textAlign: 'left' }}
              >
                <div
                  style={{
                    padding: 16,
                    width: '100%',
                    borderRadius: token.borderRadiusLG,
                  }}
                >
                  <Flex vertical gap={12}>
                    <Typography.Text
                      strong
                      style={{ color: selectedAgentId === item.agentId ? token.colorWhite : undefined }}
                    >
                      {item.name}
                    </Typography.Text>
                    <Space wrap size={[8, 8]}>
                      <Tag color={item.enabled ? 'success' : 'default'}>
                        {item.enabled ? '启用' : '停用'}
                      </Tag>
                      <Tag>{`${item.toolAllowlist.length} 个工具`}</Tag>
                      <Tag>{scopeLabel(item.memoryScope)}</Tag>
                    </Space>
                  </Flex>
                </div>
              </Button>
            ))}
          </Flex>
        )}
      </Flex>
    </SectionCard>
  )
}
