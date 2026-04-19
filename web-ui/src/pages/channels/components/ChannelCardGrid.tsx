import { Empty, Flex, Tag, Typography } from 'antd'
import { motion } from 'framer-motion'
import { ChannelAvatar } from '../shared'

export default function ChannelCardGrid({
  channels,
  selectedChannel,
  onSelect
}: {
  channels: any[]
  selectedChannel: string | null
  onSelect: (name: string) => void
}) {
  if (channels.length === 0) {
    return <Empty description="无匹配项" />
  }

  return (
    <div className="channel-card-grid">
      {channels.map((channel, index) => (
        <motion.button
          key={channel.key}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.04, duration: 0.2 }}
          type="button"
          onClick={() => onSelect(channel.name)}
          className={`channel-card interactive-lift focus-ring ${selectedChannel === channel.name ? 'is-selected' : ''}`}
        >
          {/* 图标 + 状态 */}
          <Flex align="flex-start" justify="space-between">
            <ChannelAvatar channelName={channel.name} label={channel.label} size={44} />
            <Tag
              bordered={false}
              color={channel.enabled ? 'success' : channel.configured ? 'processing' : 'default'}
              className="channel-status-pill"
            >
              {channel.enabled ? '运行中' : channel.configured ? '已配置' : '未配置'}
            </Tag>
          </Flex>

          {/* 渠道名 */}
          <Typography.Text strong className="channel-card-title">
            {channel.label}
          </Typography.Text>

          <Typography.Text type="secondary" className="channel-card-description">
            {channel.description}
          </Typography.Text>
        </motion.button>
      ))}
    </div>
  )
}
