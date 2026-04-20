import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Empty, Input, InputNumber, Segmented, Select, Space, Spin, Statistic, Tag, Typography, theme } from 'antd'
import { AimOutlined, ReloadOutlined, RightOutlined, SearchOutlined, ApartmentOutlined, ShareAltOutlined, DesktopOutlined, EyeInvisibleOutlined, FullscreenOutlined, FullscreenExitOutlined } from '@ant-design/icons'
import MetricCard from '../../components/console/MetricCard'
import type { KnowledgeGraphData, KnowledgeGraphEdge, KnowledgeGraphNode, KnowledgeGraphStats } from '../../types'

const { Paragraph, Text } = Typography

interface KnowledgeGraphTabProps {
  graphLabel: string
  graphDepth: number
  graphMaxNodes: number
  graphLoading: boolean
  graphData: KnowledgeGraphData | null
  graphStats: KnowledgeGraphStats | null
  onGraphLabelChange: (value: string) => void
  onGraphDepthChange: (value: number) => void
  onGraphMaxNodesChange: (value: number) => void
  onReload: () => void
}

type GraphViewMode = 'core' | 'all'
type GraphLayoutMode = 'circular' | 'circlepack' | 'random' | 'noverlap' | 'force' | 'forceAtlas' | 'dendrogram'

interface GraphRelationRecord {
  id: string
  sourceId: string
  targetId: string
  sourceLabel: string
  targetLabel: string
  sourceType: string
  targetType: string
  relationTitle: string
  relationSummary: string
  keywords: string[]
  weight: string
  filePath: string
}

interface SelectedNodeRelationRecord extends GraphRelationRecord {
  neighborId: string
  neighborLabel: string
  neighborType: string
}

interface GraphDisplayState {
  nodes: KnowledgeGraphNode[]
  edges: KnowledgeGraphEdge[]
  focusActive: boolean
}

function getGraphColors(token: ReturnType<typeof theme.useToken>['token']) {
  return {
    concept: token.colorSuccess,
    artifact: token.colorWarning,
    organization: token.colorInfo,
    person: token.purple,
    capability: token.cyan,
    data: token.colorTextSecondary,
    default: token.colorText,
  }
}

const LOW_SIGNAL_TYPES = new Set(['data', 'date', 'time', 'number', 'version'])
const LOW_SIGNAL_LABELS = ['markdown file', 'jsonl session', 'txt file', 'md file', 'docx file']
const GRAPH_LAYOUT_OPTIONS: Array<{ label: string; value: GraphLayoutMode }> = [
  { label: '力导向', value: 'force' },
  { label: '径向树', value: 'dendrogram' },
  { label: '圆形', value: 'circular' },
  { label: '圆形包装', value: 'circlepack' },
  { label: '随机', value: 'random' },
  { label: '不重叠', value: 'noverlap' },
  { label: '强制圈集', value: 'forceAtlas' },
]

function normalizeText(value: unknown) {
  return String(value || '')
    .replace(/^"+|"+$/g, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncateText(value: string, limit = 96) {
  const normalized = normalizeText(value)
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, Math.max(0, limit - 1))}…`
}

function getNodeLabel(node: KnowledgeGraphNode) {
  return normalizeText(node.title || node.properties?.entity_id || node.properties?.name || node.id)
}

function getNodeType(node: KnowledgeGraphNode) {
  return normalizeText(node.properties?.entity_type || node.labels[0] || 'entity').toLowerCase() || 'entity'
}

function getNodeTypeLabel(node: KnowledgeGraphNode) {
  const value = getNodeType(node)
  if (!value) return 'Entity'
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function getNodeDescription(node: KnowledgeGraphNode) {
  return normalizeText(node.properties?.description)
}

function getNodeFilePath(node: KnowledgeGraphNode) {
  return normalizeText(node.properties?.file_path)
}

function getNodeId(node: KnowledgeGraphNode) {
  return normalizeText(node.properties?.entity_id || node.id)
}

function isDateLike(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) || /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(value)
}

function isLowSignalNode(node: KnowledgeGraphNode) {
  const label = getNodeLabel(node).toLowerCase()
  const type = getNodeType(node)
  if (!label) return true
  if (LOW_SIGNAL_TYPES.has(type)) return true
  if (LOW_SIGNAL_LABELS.includes(label)) return true
  if (isDateLike(label)) return true
  if (/^v?\d+(\.\d+){1,3}$/.test(label)) return true
  return false
}

function getEdgeKeywords(edge: KnowledgeGraphEdge) {
  return normalizeText(edge.properties?.keywords)
    .split(/[，,]/)
    .map((item) => normalizeText(item))
    .filter(Boolean)
}

function getEdgeSummary(edge: KnowledgeGraphEdge) {
  const description = normalizeText(edge.properties?.description)
  if (description) return description
  const keywords = getEdgeKeywords(edge)
  if (keywords.length > 0) return keywords.join(' / ')
  return normalizeText(edge.type || 'related')
}

function getEdgeTitle(edge: KnowledgeGraphEdge) {
  const keywords = getEdgeKeywords(edge)
  if (keywords.length > 0) return keywords[0]
  const type = normalizeText(edge.type)
  if (type && type.toLowerCase() !== 'related') return type
  return '关联'
}

function getEdgeWeight(edge: KnowledgeGraphEdge) {
  return normalizeText(edge.properties?.weight)
}

function getEdgeFilePath(edge: KnowledgeGraphEdge) {
  return normalizeText(edge.properties?.file_path)
}

function getFileName(value: string) {
  const normalized = normalizeText(value)
  if (!normalized) return ''
  return normalized.split('/').pop() || normalized
}

function getColorForType(type: string, colors: ReturnType<typeof getGraphColors>) {
  const key = type as keyof ReturnType<typeof getGraphColors>
  return colors[key] || colors.default
}

function getDisplayNodeLabel(node: KnowledgeGraphNode, showFull = false) {
  return truncateText(getNodeLabel(node), showFull ? 28 : 18)
}

function getGraphNodeSize(degree: number, isCenter: boolean, focusActive: boolean) {
  if (isCenter) return 48
  if (focusActive) return Math.min(26 + degree * 1.6, 34)
  return Math.min(18 + degree * 2.4, 34)
}

function getGraphLayoutLabel(layoutMode: GraphLayoutMode) {
  return GRAPH_LAYOUT_OPTIONS.find((option) => option.value === layoutMode)?.label || '力导向'
}

function getGraphLayoutConfig(_mode: GraphLayoutMode, _width: number, _height: number, nodeCount = 0) {
  // Spread nodes wide so labels are readable, not clumped in a ball.
  // Large graphs use slightly weaker force but still strong enough to separate.
  const isLarge = nodeCount > 150
  return {
    type: 'd3-force',
    link: {
      distance: isLarge ? 200 : 280,
    },
    charge: {
      strength: isLarge ? -800 : -1200,
      distanceMax: 1200,
    },
    collide: {
      radius: isLarge ? 50 : 60,
      strength: 0.9,
    },
    simulation: {
      alphaDecay: isLarge ? 0.04 : 0.015,
      velocityDecay: 0.35,
    },
  }
}

function getGraphNodeConfig(_mode: GraphLayoutMode, token: any, nodeCount = 0): any {
  const commonState = {
    active: { opacity: 1, shadowColor: 'rgba(0,0,0,0.1)', shadowBlur: 10 },
    inactive: { opacity: 0.3 },
    neighbor: { opacity: 0.9, lineWidth: 2, stroke: token.colorPrimary },
    selected: { opacity: 1, lineWidth: 3, stroke: token.colorPrimary },
    dimmed: { opacity: 0.35 }
  }

  return {
    style: {
      labelText: (d: any) => d.data?.label || d.id,
      size: (d: any) => d.data?.size || 16,
      ports: [],
    },
    palette: {
      type: 'group',
      field: 'cluster',
    },
    // Disable enter/exit animations for large graphs to prevent jank
    animation: nodeCount > 100 ? { enter: false, exit: false, update: false } : undefined,
    state: commonState,
  }
}

function getGraphBehaviorsConfig() {
  return [
    'zoom-canvas',
    'drag-canvas',
    'drag-element',
    {
      type: 'hover-activate',
      degree: 1,
    },
  ]
}

export function KnowledgeGraphTab({
  graphLabel,
  graphDepth,
  graphMaxNodes,
  graphLoading,
  graphData,
  graphStats,
  onGraphLabelChange,
  onGraphDepthChange,
  onGraphMaxNodesChange,
  onReload,
}: KnowledgeGraphTabProps) {
  const { token } = theme.useToken()
  const graphColors = useMemo(() => getGraphColors(token), [token])
  const containerRef = useRef<HTMLDivElement | null>(null)
  const browserRef = useRef<HTMLDivElement | null>(null)
  const graphRef = useRef<any>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<GraphViewMode>('core')
  const [layoutMode, setLayoutMode] = useState<GraphLayoutMode>('force')
  const hasGraph = Boolean(graphData && graphData.nodes.length > 0)

  const nodesById = useMemo(() => {
    const entries = (graphData?.nodes || []).map((node) => [node.id, node] as const)
    return new Map(entries)
  }, [graphData])

  const filteredGraphData = useMemo(() => {
    if (!graphData) {
      return {
        nodes: [] as KnowledgeGraphNode[],
        edges: [] as KnowledgeGraphEdge[],
        hiddenNodeCount: 0,
        hiddenEdgeCount: 0,
      }
    }

    if (viewMode === 'all') {
      return {
        nodes: graphData.nodes,
        edges: graphData.edges,
        hiddenNodeCount: 0,
        hiddenEdgeCount: 0,
      }
    }

    const allowedNodeIds = new Set(graphData.nodes.filter((node) => !isLowSignalNode(node)).map((node) => node.id))
    const edges = graphData.edges.filter((edge) => allowedNodeIds.has(edge.source) && allowedNodeIds.has(edge.target))
    const connectedNodeIds = new Set<string>()
    for (const edge of edges) {
      connectedNodeIds.add(edge.source)
      connectedNodeIds.add(edge.target)
    }
    const nodes = graphData.nodes.filter((node) => allowedNodeIds.has(node.id) && (connectedNodeIds.size === 0 || connectedNodeIds.has(node.id)))
    return {
      nodes,
      edges,
      hiddenNodeCount: Math.max(0, graphData.nodes.length - nodes.length),
      hiddenEdgeCount: Math.max(0, graphData.edges.length - edges.length),
    }
  }, [graphData, viewMode])

  const allRelations = useMemo<GraphRelationRecord[]>(() => {
    return filteredGraphData.edges
      .map((edge) => {
        const sourceNode = nodesById.get(edge.source)
        const targetNode = nodesById.get(edge.target)
        if (!sourceNode || !targetNode) return null
        return {
          id: edge.id,
          sourceId: edge.source,
          targetId: edge.target,
          sourceLabel: getNodeLabel(sourceNode),
          targetLabel: getNodeLabel(targetNode),
          sourceType: getNodeTypeLabel(sourceNode),
          targetType: getNodeTypeLabel(targetNode),
          relationTitle: truncateText(getEdgeTitle(edge), 20),
          relationSummary: truncateText(getEdgeSummary(edge), 92),
          keywords: getEdgeKeywords(edge),
          weight: getEdgeWeight(edge),
          filePath: getEdgeFilePath(edge),
        }
      })
      .filter((item): item is GraphRelationRecord => Boolean(item))
      .sort((left, right) => (Number(right.weight || 0) + right.keywords.length) - (Number(left.weight || 0) + left.keywords.length))
  }, [filteredGraphData.edges, nodesById])

  const relationCountByNode = useMemo(() => {
    const counts = new Map<string, number>()
    for (const relation of allRelations) {
      counts.set(relation.sourceId, (counts.get(relation.sourceId) || 0) + 1)
      counts.set(relation.targetId, (counts.get(relation.targetId) || 0) + 1)
    }
    return counts
  }, [allRelations])

  const selectedNode = useMemo(
    () => filteredGraphData.nodes.find((node) => node.id === selectedNodeId) || null,
    [filteredGraphData.nodes, selectedNodeId],
  )

  const selectedRelation = useMemo(
    () => allRelations.find((relation) => relation.id === selectedEdgeId) || null,
    [allRelations, selectedEdgeId],
  )

  const focusRelations = useMemo(() => {
    if (selectedNodeId) {
      return allRelations.filter((relation) => relation.sourceId === selectedNodeId || relation.targetId === selectedNodeId)
    }
    if (selectedEdgeId && selectedRelation) {
      return [selectedRelation]
    }
    return allRelations
  }, [allRelations, selectedEdgeId, selectedNodeId, selectedRelation])

  const focusState = useMemo(() => {
    if (!selectedNodeId && !selectedEdgeId) {
      return { active: false, nodeIds: new Set<string>(), edgeIds: new Set<string>() }
    }
    const nodeIds = new Set<string>()
    const edgeIds = new Set<string>()
    for (const relation of focusRelations) {
      nodeIds.add(relation.sourceId)
      nodeIds.add(relation.targetId)
      edgeIds.add(relation.id)
    }
    if (selectedNodeId) nodeIds.add(selectedNodeId)
    return { active: true, nodeIds, edgeIds }
  }, [focusRelations, selectedEdgeId, selectedNodeId])

  const selectedNodeRelations = useMemo<SelectedNodeRelationRecord[]>(() => {
    if (!selectedNode) return []
    return focusRelations.map((relation) => ({
      ...relation,
      neighborId: relation.sourceId === selectedNode.id ? relation.targetId : relation.sourceId,
      neighborLabel: relation.sourceId === selectedNode.id ? relation.targetLabel : relation.sourceLabel,
      neighborType: relation.sourceId === selectedNode.id ? relation.targetType : relation.sourceType,
    }))
  }, [focusRelations, selectedNode])

  const relationPanelItems = useMemo<Array<GraphRelationRecord | SelectedNodeRelationRecord>>(
    () => (selectedNode ? selectedNodeRelations : focusRelations.slice(0, 6)),
    [focusRelations, selectedNode, selectedNodeRelations],
  )

  const baseGraphPayload = useMemo(() => {
    const degreeMap = new Map<string, number>()
    const childrenMap = new Map<string, Set<string>>()
    
    for (const edge of filteredGraphData.edges) {
      if (!childrenMap.has(edge.source)) {
        childrenMap.set(edge.source, new Set<string>())
      }
      childrenMap.get(edge.source)!.add(edge.target)
    }

    for (const node of filteredGraphData.nodes) {
      degreeMap.set(node.id, relationCountByNode.get(node.id) || 0)
    }

    const topDegreeNodeIds = new Set(
      [...filteredGraphData.nodes]
        .sort((left, right) => (degreeMap.get(right.id) || 0) - (degreeMap.get(left.id) || 0))
        .slice(0, 16)
        .map((node) => node.id),
    )

      return {
          nodes: filteredGraphData.nodes.map((node) => {
        const degree = degreeMap.get(node.id) || 0
        const size = Math.max(12, Math.min(16 + degree * 3, 48))
        return {
          id: node.id,
          data: {
            cluster: getNodeType(node),
            label: truncateText(getNodeLabel(node), 36),
            size,
            degree,
            description: truncateText(getNodeDescription(node), 80),
            entityType: getNodeTypeLabel(node),
          },
          children: Array.from(childrenMap.get(node.id) || []),
        }
      }),
      edges: filteredGraphData.edges.map((edge) => {
        const keywords = getEdgeKeywords(edge)
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          data: {
            label: truncateText(keywords[0] || getEdgeTitle(edge), 12),
          },
        }
      }),
    }
  }, [filteredGraphData, graphColors, relationCountByNode])

  useEffect(() => {
    if (selectedNodeId && !filteredGraphData.nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(null)
    }
    if (selectedEdgeId && !filteredGraphData.edges.some((edge) => edge.id === selectedEdgeId)) {
      setSelectedEdgeId(null)
    }
  }, [filteredGraphData.edges, filteredGraphData.nodes, selectedEdgeId, selectedNodeId])

  useEffect(() => {
    function onFullscreenChange() {
      const nextFullscreen = !!document.fullscreenElement
      setIsFullscreen(nextFullscreen)
      // Critical: after fullscreen transition, resize the G6 canvas to match
      // the new container dimensions and re-fit the view.
      setTimeout(() => {
        if (containerRef.current && graphRef.current) {
          const w = containerRef.current.clientWidth
          const h = containerRef.current.clientHeight
          if (w > 0 && h > 0) {
            graphRef.current.setSize(w, h)
            void graphRef.current.fitView?.()
          }
        }
      }, 300)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      if (browserRef.current?.requestFullscreen) {
        browserRef.current.requestFullscreen().catch((err) => {
          console.error(`Error attempting to enable fullscreen: ${err.message}`)
        })
      }
    } else if (document.exitFullscreen) {
      document.exitFullscreen().catch((err) => {
        console.error(`Error attempting to exit fullscreen: ${err.message}`)
      })
    }
  }

  useEffect(() => {
    let disposed = false

    let retryCount = 0
    const MAX_RETRIES = 5

    async function renderGraph() {
      if (!containerRef.current || baseGraphPayload.nodes.length === 0) {
        if (graphRef.current) {
          graphRef.current.destroy()
          graphRef.current = null
        }
        setRenderError(null)
        return
      }

      try {
        const { Graph } = await import('@antv/g6')
        if (disposed || !containerRef.current) return

        const width = Math.max(containerRef.current.clientWidth, 200)
        const height = Math.max(containerRef.current.clientHeight, 300)

        // Zero-dimension retry (inspired by Yuxi GraphCanvas)
        if (width <= 0 || height <= 0) {
          if (retryCount < MAX_RETRIES) {
            retryCount++
            setTimeout(() => { if (!disposed) void renderGraph() }, 200)
          }
          return
        }
        retryCount = 0

        if (graphRef.current) {
          graphRef.current.destroy()
          graphRef.current = null
        }

        const instance = new Graph({
          container: containerRef.current,
          width,
          height,
          data: baseGraphPayload,
          autoFit: 'view',
          animation: baseGraphPayload.nodes.length > 100 ? false : undefined,
          layout: getGraphLayoutConfig(layoutMode, width, height, baseGraphPayload.nodes.length),
          node: getGraphNodeConfig(layoutMode, token, baseGraphPayload.nodes.length),
          edge: {
            // Keep edge incredibly clean, just provide state targets so selection highlights work!
            state: {
              active: { opacity: 0.9, lineWidth: 2, stroke: token.colorTextSecondary },
              inactive: { opacity: 0.3 },
              neighbor: { opacity: 0.8, lineWidth: 2, stroke: token.colorPrimaryText },
              selected: { stroke: token.colorPrimary, lineWidth: 2.5, opacity: 1 },
              dimmed: { opacity: 0.15 }
            }
          },
          behaviors: getGraphBehaviorsConfig(),
        })

        instance.on('node:click', (event: any) => {
          const nodeId = event.target?.id
          setSelectedEdgeId(null)
          setSelectedNodeId(nodeId ? String(nodeId) : null)
        })

        instance.on('edge:click', (event: any) => {
          const edgeId = event.target?.id
          setSelectedEdgeId(edgeId ? String(edgeId) : null)
        })

        instance.on('canvas:click', () => {
          setSelectedNodeId(null)
          setSelectedEdgeId(null)
        })

        await instance.render()
        await instance.fitView()
        if (disposed) {
          instance.destroy()
          return
        }

        setRenderError(null)
        graphRef.current = instance

        resizeObserverRef.current?.disconnect()
        resizeObserverRef.current = new ResizeObserver((entries) => {
          const entry = entries[0]
          if (!entry || !graphRef.current) return
          const nextWidth = Math.max(entry.contentRect.width, 200)
          const nextHeight = Math.max(entry.contentRect.height, 300)
          graphRef.current.setSize(nextWidth, nextHeight)
          void graphRef.current.fitView?.()
        })
        resizeObserverRef.current.observe(containerRef.current)
      } catch (error) {
        if (graphRef.current) {
          graphRef.current.destroy()
          graphRef.current = null
        }
        if (!disposed) {
          const message = error instanceof Error ? error.message : String(error || '知识图谱渲染失败')
          setRenderError(message)
        }
      }
    }

    void renderGraph()

    return () => {
      disposed = true
      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = null
      if (graphRef.current) {
        graphRef.current.destroy()
        graphRef.current = null
      }
    }
  }, [baseGraphPayload, layoutMode, token])
  useEffect(() => {
    if (!graphRef.current || !hasGraph) return
    const graph = graphRef.current

    if (!focusState.active) {
       // Clear ALL states (including hover-activate residual states)
       const updates: Record<string, string[]> = {}
       for (const node of baseGraphPayload.nodes) updates[node.id] = []
       for (const edge of baseGraphPayload.edges) updates[edge.id] = []
       try {
         graph.setElementState(updates)
         void graph.draw?.()
       } catch (e) {}
       return
    }

    const updates: Record<string, string[]> = {}
    for (const node of baseGraphPayload.nodes) {
       if (node.id === selectedNodeId) {
           updates[node.id] = ['selected']
       } else if (focusState.nodeIds.has(node.id)) {
           updates[node.id] = ['neighbor']
       } else {
           updates[node.id] = ['dimmed']
       }
    }
    for (const edge of baseGraphPayload.edges) {
       if (edge.id === selectedEdgeId) {
           updates[edge.id] = ['selected']
       } else if (focusState.edgeIds.has(edge.id)) {
           updates[edge.id] = ['neighbor']
       } else {
           updates[edge.id] = ['dimmed']
       }
    }
    try {
        graph.setElementState(updates)
    } catch (e) {}
  }, [focusState, selectedNodeId, selectedEdgeId, baseGraphPayload, hasGraph])

  const selectedTypeCount = useMemo(() => {
    if (!selectedNode) return ''
    return String(selectedNodeRelations.length)
  }, [selectedNode, selectedNodeRelations.length])

  // Collect unique entity types for the color legend
  const entityTypes = useMemo(() => {
    const typeSet = new Set<string>()
    for (const node of filteredGraphData.nodes) {
      typeSet.add(getNodeTypeLabel(node))
    }
    return Array.from(typeSet).slice(0, 10)
  }, [filteredGraphData.nodes])

  const graphSummary = useMemo(() => {
    const nodeCount = baseGraphPayload.nodes.length
    const edgeCount = baseGraphPayload.edges.length
    return `${nodeCount} 个实体 · ${edgeCount} 条关系 · ${entityTypes.length} 种类型`
  }, [baseGraphPayload.nodes.length, baseGraphPayload.edges.length, entityTypes.length])

  const handleViewModeChange = (value: GraphViewMode) => {
    setViewMode(value)
    if (value === 'all') {
      // "全部实体" bypasses depth/maxNodes limits
      onGraphDepthChange(10)
      onGraphMaxNodesChange(9999)
      // Trigger reload after config change propagates
      setTimeout(() => onReload(), 50)
    }
  }

  const handleFitView = () => {
    if (graphRef.current) {
      void graphRef.current.fitView?.()
    }
  }

  return (
    <div className="knowledge-tab-panel knowledge-graph-tab-panel">
      <div className="knowledge-graph-toolbar knowledge-graph-toolbar-compact">
        <Input
          value={graphLabel}
          onChange={(event) => onGraphLabelChange(event.target.value || '*')}
          prefix={<SearchOutlined />}
          placeholder="搜索实体"
        />
        {viewMode !== 'all' ? (
          <>
            <Space.Compact>
              <Button disabled>层级</Button>
              <InputNumber min={1} max={5} value={graphDepth} onChange={(value) => onGraphDepthChange(Number(value || 2))} />
            </Space.Compact>
            <Space.Compact>
              <Button disabled>实体数</Button>
              <InputNumber min={10} max={300} value={graphMaxNodes} onChange={(value) => onGraphMaxNodesChange(Number(value || 50))} />
            </Space.Compact>
          </>
        ) : null}
        <Segmented
          value={viewMode}
          onChange={(value) => handleViewModeChange(value as GraphViewMode)}
          options={[
            { label: '核心关系', value: 'core' },
            { label: '全部实体', value: 'all' },
          ]}
        />
        <Button icon={<AimOutlined />} onClick={handleFitView}>
          优化显示
        </Button>
        <Button icon={<ReloadOutlined />} loading={graphLoading} onClick={onReload}>
          刷新图谱
        </Button>
      </div>



      {!graphLoading && hasGraph && viewMode === 'core' && !focusState.active && (filteredGraphData.hiddenNodeCount > 0 || filteredGraphData.hiddenEdgeCount > 0) ? (
        <Alert
          type="info"
          showIcon
          className="knowledge-graph-filter-alert"
          message={`已隐藏 ${filteredGraphData.hiddenNodeCount} 个低信息实体，让图谱更聚焦核心关系。`}
        />
      ) : null}

      {graphLoading ? (
        <div className="knowledge-loading-panel"><Spin /></div>
      ) : baseGraphPayload.nodes.length > 0 ? (
        <div 
          ref={browserRef} 
          className={[
            'knowledge-graph-browser',
            isFullscreen ? 'knowledge-graph-browser-fullscreen' : '',
            sidebarOpen ? '' : 'knowledge-graph-browser-sidebar-hidden',
          ].filter(Boolean).join(' ')}
          style={{ backgroundColor: isFullscreen ? token.colorBgContainer : undefined }}
        >
          <div className="knowledge-graph-browser-stage" style={isFullscreen ? { height: '100%', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 } : undefined}>
            <div className="knowledge-graph-canvas-shell knowledge-graph-browser-shell" style={isFullscreen ? { flex: 1, height: '100%', minHeight: 0 } : undefined}>
              {renderError ? (
                <Alert
                  type="error"
                  showIcon
                  message="知识图谱渲染失败"
                  description={renderError}
                  style={{ margin: 12 }}
                />
              ) : null}
              <div className="knowledge-graph-floating-tools">
                <Button size="small" icon={<AimOutlined />} title="适配视图" onClick={() => void graphRef.current?.fitView?.()} />
                <Button
                  size="small"
                  icon={sidebarOpen ? <EyeInvisibleOutlined /> : <DesktopOutlined />}
                  title={sidebarOpen ? '隐藏侧栏' : '显示侧栏'}
                  onClick={() => {
                    setSidebarOpen((prev) => !prev)
                    // 等布局稳定后再 fit 一次，避免出现“只在局部可拖拽”的错觉
                    setTimeout(() => void graphRef.current?.fitView?.(), 0)
                  }}
                />
                <Button 
                  size="small" 
                  icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />} 
                  title={isFullscreen ? '退出全屏' : '全屏预览'} 
                  onClick={toggleFullscreen} 
                />
                <Button size="small" onClick={() => {
                  setSelectedNodeId(null)
                  setSelectedEdgeId(null)
                }}>
                  清空
                </Button>
                <Button size="small" icon={<ReloadOutlined />} title="刷新图谱" loading={graphLoading} onClick={onReload} />
              </div>
              <div ref={containerRef} className="knowledge-graph-canvas" />
            </div>
            <div className="knowledge-graph-stage-footer">
              <Text type="secondary">
                {focusState.active
                  ? `焦点视图：${selectedNode ? getNodeLabel(selectedNode) : '当前关系'}`
                  : graphSummary}
              </Text>
              <div className="knowledge-graph-legend">
                {entityTypes.map((type) => (
                  <Tag key={type} bordered={false} style={{ fontSize: 11 }}>{type}</Tag>
                ))}
              </div>
              {focusState.active ? (
                <Button
                  size="small"
                  onClick={() => {
                    setSelectedNodeId(null)
                    setSelectedEdgeId(null)
                  }}
                >
                  返回全图
                </Button>
              ) : null}
            </div>
          </div>

          <aside className="knowledge-graph-browser-sidebar">
            <div className="knowledge-graph-inspector-shell">
              <div className="knowledge-graph-side-panel knowledge-graph-relations-panel">
                <div className="knowledge-graph-relations-header">
                  <Text strong>{selectedNode ? '实体关系' : '核心关系'}</Text>
                  <Text type="secondary">{relationPanelItems.length} 条</Text>
                </div>
                <div className="knowledge-graph-relations-list">
                  {relationPanelItems.map((relation) => {
                    const isNodeScoped = selectedNode && 'neighborLabel' in relation
                    const leftLabel = selectedNode ? getNodeLabel(selectedNode) : relation.sourceLabel
                    const rightLabel = isNodeScoped ? relation.neighborLabel : relation.targetLabel
                    const rightType = isNodeScoped ? relation.neighborType : relation.targetType
                    const isActive = relation.id === selectedEdgeId

                    return (
                      <div key={relation.id} className={`knowledge-graph-relation-row ${isActive ? 'is-active' : ''}`}>
                        <button
                          type="button"
                          className="knowledge-graph-relation-toggle"
                          onClick={() => {
                            setSelectedEdgeId(isActive ? null : relation.id)
                            if (selectedNode) {
                              setSelectedNodeId(selectedNode.id)
                            }
                          }}
                        >
                          <div className="knowledge-graph-relation-head">
                            <strong>{truncateText(leftLabel, 14)}</strong>
                            <Tag>{relation.relationTitle}</Tag>
                            <strong>{truncateText(rightLabel, 14)}</strong>
                          </div>
                          <div className="knowledge-graph-relation-toggle-icon">
                            <Tag>{rightType}</Tag>
                            <RightOutlined className={isActive ? 'is-open' : ''} />
                          </div>
                        </button>

                        {isActive ? (
                          <div className="knowledge-graph-relation-body">
                            <Text type="secondary" className="knowledge-graph-relation-summary">
                              {relation.relationSummary}
                            </Text>
                            <div className="knowledge-graph-relation-meta">
                              {relation.filePath ? <Tag>{truncateText(getFileName(relation.filePath), 22)}</Tag> : null}
                              {relation.weight ? <Tag>{`权重 ${relation.weight}`}</Tag> : null}
                              {relation.keywords.slice(0, 3).map((keyword) => (
                                <Tag key={keyword}>{truncateText(keyword, 10)}</Tag>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </aside>
        </div>
      ) : (
        <div className="knowledge-loading-panel">
          <Empty description="知识图谱暂时为空" image={false} className="minimal-empty" />
        </div>
      )}
    </div>
  )
}
