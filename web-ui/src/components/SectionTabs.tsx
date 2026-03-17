import { Tabs, Typography } from 'antd'
import { motion } from 'framer-motion'
import { staggerChildren, surfaceChild, surfaceReveal } from '../motionTokens'

export interface SectionTabItem {
  key: string
  label: string
  summary?: string
}

interface SectionTabsProps {
  eyebrow?: string
  title: string
  description?: string
  activeKey: string
  items: SectionTabItem[]
  onChange: (key: string) => void
}

export default function SectionTabs({
  eyebrow,
  title,
  activeKey,
  items,
  onChange,
}: SectionTabsProps) {
  return (
    <motion.section
      className="page-card section-tabs-shell"
      variants={surfaceReveal}
      initial="hidden"
      animate="visible"
    >
      <motion.div className="section-tabs-head" variants={staggerChildren}>
        <motion.div className="section-tabs-copy" variants={surfaceChild}>
          {eyebrow ? <span className="section-tabs-eyebrow">{eyebrow}</span> : null}
          <Typography.Title level={4}>{title}</Typography.Title>
        </motion.div>
      </motion.div>

      <Tabs
        className="console-tabs section-tabs"
        activeKey={activeKey}
        onChange={onChange}
        items={items.map((item) => ({
          key: item.key,
          label: (
            <span className="section-tab-label">
              <span className="section-tab-title">{item.label}</span>
            </span>
          ),
        }))}
      />
    </motion.section>
  )
}
