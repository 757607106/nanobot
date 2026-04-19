import { useMemo } from 'react'
import { Flex } from 'antd'
import DevOnly from '../../components/DevOnly'
import type { AgentTemplateTool, InstalledSkill, KnowledgeBaseDefinition, McpServerEntry } from '../../types'
import type { AgentFormState } from './types'
import CapabilitySection from './CapabilitySection'

interface CapabilitiesTabProps {
  form: AgentFormState
  validTools: AgentTemplateTool[]
  skills: InstalledSkill[]
  mcpServers: McpServerEntry[]
  knowledgeBases: KnowledgeBaseDefinition[]
  onToggleArrayItem: (
    key: 'toolAllowlist' | 'skillIds' | 'mcpServerIds' | 'knowledgeBindingIds',
    item: string,
  ) => void
}

export default function CapabilitiesTab({
  form,
  validTools,
  skills,
  mcpServers,
  knowledgeBases,
  onToggleArrayItem,
}: CapabilitiesTabProps) {
  const toolItems = useMemo(() => {
    const map = new Map(validTools.map((item) => [item.name, { name: item.name, description: item.description, isOrphan: false }]))
    for (const toolName of form.toolAllowlist) {
      if (!map.has(toolName)) {
        map.set(toolName, { name: toolName, description: '该工具已不存在，建议移除。', isOrphan: true })
      }
    }
    return Array.from(map.entries()).map(([key, meta]) => ({ key, ...meta }))
  }, [form.toolAllowlist, validTools])

  const skillItems = useMemo(() => {
    const map = new Map(skills.map((item) => [item.id, { name: item.name, description: item.description || item.name, isOrphan: false }]))
    for (const skillId of form.skillIds) {
      if (!map.has(skillId)) {
        map.set(skillId, { name: skillId, description: '该技能已不存在，建议移除。', isOrphan: true })
      }
    }
    return Array.from(map.entries()).map(([key, meta]) => ({ key, ...meta }))
  }, [form.skillIds, skills])

  const mcpItems = useMemo(() => {
    const map = new Map(mcpServers.map((item) => [item.name, {
      name: item.displayName || item.name,
      description: `${item.toolCount ?? 0} 个工具`,
      isOrphan: false,
    }]))
    for (const serverId of form.mcpServerIds) {
      if (!map.has(serverId)) {
        map.set(serverId, { name: serverId, description: '该连接已不存在，建议移除。', isOrphan: true })
      }
    }
    return Array.from(map.entries()).map(([key, meta]) => ({ key, ...meta }))
  }, [form.mcpServerIds, mcpServers])

  const knowledgeItems = useMemo(() => {
    const map = new Map(knowledgeBases.map((item) => [item.kbId, {
      name: item.name,
      description: item.description || '知识库',
      isOrphan: false,
    }]))
    for (const kbId of form.knowledgeBindingIds) {
      if (!map.has(kbId)) {
        map.set(kbId, { name: kbId, description: '该知识库已不存在，建议移除。', isOrphan: true })
      }
    }
    return Array.from(map.entries()).map(([key, meta]) => ({ key, ...meta }))
  }, [form.knowledgeBindingIds, knowledgeBases])

  const orphanCount = useMemo(
    () => [toolItems, skillItems, mcpItems, knowledgeItems]
      .flat()
      .filter((item) => item.isOrphan)
      .length,
    [knowledgeItems, mcpItems, skillItems, toolItems],
  )

  const selectedCapabilityCount = form.toolAllowlist.length
    + form.skillIds.length
    + form.mcpServerIds.length
    + form.knowledgeBindingIds.length

  return (
    <Flex vertical gap={6}>
      <DevOnly>
        <CapabilitySection
          title={`工具（${form.toolAllowlist.length}）`}
          description="仅用于高级配置。一般情况下无需手动选择。"
          items={toolItems}
          selectedKeys={form.toolAllowlist}
          onToggle={(key) => onToggleArrayItem('toolAllowlist', key)}
          emptyText="暂无可用工具。"
        />
        <CapabilitySection
          title={`技能（${form.skillIds.length}）`}
          description="仅用于高级配置。一般情况下无需手动选择。"
          items={skillItems}
          selectedKeys={form.skillIds}
          onToggle={(key) => onToggleArrayItem('skillIds', key)}
          emptyText="暂无可用技能。"
        />
      </DevOnly>
      <CapabilitySection
        title={`连接（${form.mcpServerIds.length}）`}
        items={mcpItems}
        selectedKeys={form.mcpServerIds}
        onToggle={(key) => onToggleArrayItem('mcpServerIds', key)}
        emptyText="暂无可用连接。"
      />
      <CapabilitySection
        title={`知识库（${form.knowledgeBindingIds.length}）`}
        items={knowledgeItems}
        selectedKeys={form.knowledgeBindingIds}
        onToggle={(key) => onToggleArrayItem('knowledgeBindingIds', key)}
        emptyText="暂无可用知识库。"
      />
    </Flex>
  )
}
