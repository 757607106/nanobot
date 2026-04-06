import { useEffect, useState } from 'react'
import { Tabs } from 'antd'
import {
  ClockCircleOutlined,
  ApartmentOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons'
import { useParams } from 'react-router-dom'
import { api } from '../../api'
import { useDevMode } from '../../devMode'
import type {
  AgentRunSummary,
  AgentRunTreeNode,
  RunArtifactDetail,
  RunBoundaryAudit,
} from '../../types'
import RunsList from './RunsList'
import RunDetail from './RunDetail'
import RunTimeline from './RunTimeline'
import RunBoundaryAuditPanel from './RunBoundaryAudit'
import RunTree from './RunTree'
import RunArtifactPanel from './RunArtifact'
import { getErrorMessage, isActiveStatus, isCancelable } from './utils'
import { useToast } from '../../toast'

export default function RunsPage() {
  const { devMode } = useDevMode()
  const message = useToast()
  const { runId } = useParams()
  const selectedRunId = runId || null

  const [runs, setRuns] = useState<AgentRunSummary[]>([])
  const [selectedRun, setSelectedRun] = useState<AgentRunSummary | null>(null)
  const [runTree, setRunTree] = useState<AgentRunTreeNode | null>(null)
  const [artifact, setArtifact] = useState<RunArtifactDetail | null>(null)
  const [boundaryAudit, setBoundaryAudit] = useState<RunBoundaryAudit | null>(null)

  const [loadingRuns, setLoadingRuns] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [loadingArtifact, setLoadingArtifact] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [artifactAction, setArtifactAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void loadRuns()
  }, [])

  useEffect(() => {
    if (!selectedRunId) {
      setSelectedRun(null)
      setRunTree(null)
      setArtifact(null)
      setBoundaryAudit(null)
      return
    }
    void loadRunDetail(selectedRunId)
  }, [selectedRunId])

  useEffect(() => {
    if (!selectedRunId || !selectedRun || !isActiveStatus(selectedRun.status)) {
      return
    }
    const timer = window.setInterval(() => {
      void loadRuns()
      void loadRunDetail(selectedRunId)
    }, 2500)
    return () => window.clearInterval(timer)
  }, [selectedRun, selectedRunId])

  async function loadRuns(filters?: { agentId?: string }) {
    try {
      setLoadingRuns(true)
      const queryParams = new URLSearchParams(window.location.search)
      const urlAgentId = queryParams.get('agentId')
      
      const agentId = filters !== undefined && 'agentId' in filters 
        ? filters.agentId 
        : (urlAgentId || undefined)
      
      const payload = await api.getRuns({ 
        limit: 80,
        agentId 
      })
      setRuns(payload.items)
      setError(null)
    } catch (loadError) {
      setError(getErrorMessage(loadError, '加载运行列表失败'))
    } finally {
      setLoadingRuns(false)
    }
  }

  async function loadRunDetail(nextRunId: string) {
    try {
      setLoadingDetail(true)
      const [run, tree] = await Promise.all([
        api.getRun(nextRunId),
        api.getRunTree(nextRunId),
      ])
      setSelectedRun(run)
      setRunTree(tree)

      try {
        setBoundaryAudit(await api.getRunBoundaryAudit(nextRunId))
      } catch {
        setBoundaryAudit(null)
      }

      if (run.artifactPath) {
        setLoadingArtifact(true)
        try {
          const artifactDetail = await api.getRunArtifact(nextRunId)
          setArtifact(artifactDetail)
        } catch {
          setArtifact(null)
        } finally {
          setLoadingArtifact(false)
        }
      } else {
        setArtifact(null)
      }
      setError(null)
    } catch (loadError) {
      setError(getErrorMessage(loadError, '加载运行详情失败'))
    } finally {
      setLoadingDetail(false)
    }
  }

  function handleDownloadArtifact() {
    if (!artifact) return
    const blob = new Blob([artifact.content], { type: artifact.contentType || 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = artifact.fileName || `${artifact.runId}.md`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  async function handleArtifactLifecycle(action: 'archive' | 'quarantine' | 'restore' | 'delete') {
    if (!selectedRun) return
    if (action !== 'restore') {
      const messageText =
        action === 'archive' ? '确认归档该运行产物？' :
        action === 'quarantine' ? '确认隔离该运行产物？' :
        '确认删除该运行产物？'
      if (!window.confirm(messageText)) return
    }
    try {
      setArtifactAction(action)
      if (action === 'archive') {
        await api.archiveRunArtifact(selectedRun.runId, 'RunsPage artifact governance')
        message.success('运行产物已归档')
      } else if (action === 'quarantine') {
        await api.quarantineRunArtifact(selectedRun.runId, 'RunsPage artifact governance')
        message.success('运行产物已隔离')
      } else if (action === 'restore') {
        await api.restoreRunArtifact(selectedRun.runId, 'RunsPage artifact governance')
        message.success('运行产物已恢复')
      } else {
        await api.deleteRunArtifact(selectedRun.runId, 'RunsPage artifact governance')
        message.success('运行产物已删除')
      }
      await loadRuns()
      await loadRunDetail(selectedRun.runId)
    } catch (artifactError) {
      setError(getErrorMessage(artifactError, '更新运行产物治理状态失败'))
    } finally {
      setArtifactAction(null)
    }
  }

  async function handleArtifactRetentionPolicy(action: 'set' | 'clear' | 'apply') {
    if (!selectedRun) return
    const artifactAudit = artifact?.audit || boundaryAudit?.artifact || null
    const currentPolicy = artifactAudit?.retentionPolicy || null
    try {
      setArtifactAction(`policy_${action}`)
      if (action === 'set') {
        const archiveInput = window.prompt(
          '设置归档天数，留空表示不自动归档。',
          currentPolicy?.archiveAfterDays != null ? String(currentPolicy.archiveAfterDays) : '',
        )
        if (archiveInput === null) return
        const deleteInput = window.prompt(
          '设置删除天数，留空表示不自动删除。',
          currentPolicy?.deleteAfterDays != null ? String(currentPolicy.deleteAfterDays) : '',
        )
        if (deleteInput === null) return
        const parseDays = (value: string) => {
          const trimmed = value.trim()
          if (!trimmed) return null
          const normalized = Number(trimmed)
          if (!Number.isInteger(normalized) || normalized < 0) {
            throw new Error('请输入 0 或正整数天数')
          }
          return normalized
        }
        await api.setRunArtifactRetentionPolicy(selectedRun.runId, {
          archiveAfterDays: parseDays(archiveInput),
          deleteAfterDays: parseDays(deleteInput),
          reason: 'RunsPage retention policy',
        })
        message.success('产物保留策略已更新')
      } else if (action === 'clear') {
        if (!window.confirm('确认清除该运行产物的保留策略？')) return
        await api.setRunArtifactRetentionPolicy(selectedRun.runId, {
          archiveAfterDays: null,
          deleteAfterDays: null,
          reason: 'RunsPage retention policy cleared',
        })
        message.success('产物保留策略已清除')
      } else {
        const result = await api.applyRunArtifactRetentionPolicy(selectedRun.runId, {
          reason: 'RunsPage retention policy apply',
        })
        if (result.applied) {
          message.success(result.action === 'archive' ? '已执行自动归档规则' : '已执行自动删除规则')
        } else {
          message.info('当前没有到期的保留策略动作')
        }
      }
      await loadRuns()
      await loadRunDetail(selectedRun.runId)
    } catch (artifactError) {
      setError(getErrorMessage(artifactError, '更新运行产物保留策略失败'))
    } finally {
      setArtifactAction(null)
    }
  }

  async function handleCancelRun() {
    if (!selectedRun) return
    try {
      setCancelling(true)
      const cancelled = await api.cancelRun(selectedRun.runId)
      message.success(cancelled.taskCancellationSent ? '已向运行时发送取消请求' : '已标记为取消请求')
      await loadRuns()
      await loadRunDetail(selectedRun.runId)
    } catch (cancelError) {
      setError(getErrorMessage(cancelError, '取消运行失败'))
    } finally {
      setCancelling(false)
    }
  }

  if (selectedRunId && selectedRun) {
    const tabItems = [
      {
        key: 'timeline',
        label: '时间线',
        icon: <ClockCircleOutlined />,
        children: <RunTimeline run={selectedRun} devMode={devMode} />,
      },
      // 审计 Tab 仅 devMode 显示
      ...(devMode ? [{
        key: 'boundary',
        label: '审计',
        icon: <InfoCircleOutlined />,
        children: <RunBoundaryAuditPanel audit={boundaryAudit} devMode={devMode} />,
      }] : []),
      {
        key: 'tree',
        label: '任务树',
        icon: <ApartmentOutlined />,
        children: <RunTree tree={runTree} selectedRunId={selectedRunId} />,
      },
    ]

    if (selectedRun.artifactPath) {
      tabItems.push({
        key: 'artifact',
        label: '产物',
        icon: <FileTextOutlined />,
        children: (
          <RunArtifactPanel
            run={selectedRun}
            artifact={artifact}
            boundaryAudit={boundaryAudit}
            loading={loadingArtifact}
            action={artifactAction}
            onDownload={handleDownloadArtifact}
            onLifecycle={handleArtifactLifecycle}
            onRetentionPolicy={handleArtifactRetentionPolicy}
          />
        ),
      })
    }

    return (
      <RunDetail
        run={selectedRun}
        loading={loadingDetail}
        cancelling={cancelling}
        onRefresh={() => loadRunDetail(selectedRun.runId)}
        onCancel={handleCancelRun}
      >
        <Tabs items={tabItems} defaultActiveKey="timeline" type="card" className="commercial-tabs" />
      </RunDetail>
    )
  }

  return <RunsList runs={runs} loading={loadingRuns} error={error} onRefresh={loadRuns} />
}
