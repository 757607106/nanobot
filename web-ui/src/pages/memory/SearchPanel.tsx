import { SearchOutlined } from '@ant-design/icons'
import { Alert, Button, Empty, Flex, Input, Select, Space, Tag } from 'antd'
import SectionCard from '../../components/console/SectionCard'
import ItemCard from './ItemCard'
import SourcePreview from './SourcePreview'
import { memorySearchModeOptions } from './types'
import type { SearchPanelProps } from './types'
import type { AgentDefinition, MemorySourceDetail } from '../../types'

interface ExtendedSearchPanelProps extends Omit<SearchPanelProps, 'currentAgent'> {
  selectedSource: MemorySourceDetail | null
  currentAgent: AgentDefinition | null
}

export default function SearchPanel({
  query,
  mode,
  results,
  searching,
  error,
  currentAgent,
  onQueryChange,
  onModeChange,
  onSearch,
  onPreviewSource,
  selectedSource,
}: ExtendedSearchPanelProps) {
  return (
    <Flex vertical gap={16}>
      <SectionCard title="检索">
        <Flex vertical gap={16}>
          <div
            style={{
              display: 'grid',
              gap: 12,
              gridTemplateColumns: 'minmax(0, 1fr) 180px auto',
              alignItems: 'start',
            }}
          >
            <Input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="检索关键词"
              disabled={!currentAgent}
              aria-label="检索关键词"
            />
            <Select
              value={mode}
              onChange={onModeChange}
              options={memorySearchModeOptions}
              disabled={!currentAgent}
              aria-label="检索模式"
            />
            <Button
              type="primary"
              icon={<SearchOutlined />}
              onClick={onSearch}
              disabled={!currentAgent || searching}
              loading={searching}
            >
              检索
            </Button>
          </div>

          {error ? <Alert type="error" message={error} showIcon /> : null}
        </Flex>
      </SectionCard>

      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        }}
      >
        <SectionCard title="结果">
          {results.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无检索结果。" />
          ) : (
            <Flex vertical gap={12}>
              {results.map((item) => (
                <ItemCard
                  key={`${item.sourceType}:${item.sourceId}`}
                  title={item.title}
                  tags={(
                    <Space wrap size={[8, 8]}>
                      <Tag color="processing">{`score ${item.score}`}</Tag>
                      <Tag>{item.sourceType}</Tag>
                    </Space>
                  )}
                  description={item.preview}
                  footer={(
                    <Button
                      size="small"
                      onClick={() => onPreviewSource(item.sourceType, item.sourceId)}
                    >
                      查看全文
                    </Button>
                  )}
                />
              ))}
            </Flex>
          )}
        </SectionCard>

        <SectionCard title="预览">
          <SourcePreview source={selectedSource} emptyText="选择结果后显示全文" />
        </SectionCard>
      </div>
    </Flex>
  )
}
