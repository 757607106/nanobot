import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Empty, Space, Spin, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import type { KnowledgeMindmapNode } from '../../types'

const { Text } = Typography

interface KnowledgeMindmapTabProps {
  mindmapLoading: boolean
  mindmap: KnowledgeMindmapNode | null
  onRegenerate: () => void
}

function mindmapToMarkdown(node: KnowledgeMindmapNode | null | undefined, level = 1): string {
  if (!node?.content) {
    return ''
  }
  const heading = `${'#'.repeat(level)} ${node.content}\n\n`
  const children = (node.children || []).map((child) => mindmapToMarkdown(child, level + 1)).join('')
  return `${heading}${children}`
}

export function KnowledgeMindmapTab({ mindmapLoading, mindmap, onRegenerate }: KnowledgeMindmapTabProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const markmapRef = useRef<any>(null)
  const [rendering, setRendering] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)
  const markdown = useMemo(() => mindmapToMarkdown(mindmap), [mindmap])

  useEffect(() => {
    let disposed = false

    async function renderMindmap() {
      if (!svgRef.current || !markdown.trim()) {
        if (markmapRef.current) {
          markmapRef.current.destroy()
          markmapRef.current = null
        }
        return
      }

      try {
        setRendering(true)
        setRenderError(null)
        const [{ Transformer }, { Markmap }] = await Promise.all([
          import('markmap-lib'),
          import('markmap-view'),
        ])
        if (disposed || !svgRef.current) return

        markmapRef.current?.destroy?.()
        const transformer = new Transformer()
        const { root } = transformer.transform(markdown)
        markmapRef.current = Markmap.create(svgRef.current, {
          duration: 300,
          maxWidth: 220,
          nodeMinHeight: 24,
          paddingX: 8,
          spacingVertical: 6,
          spacingHorizontal: 72,
        })
        markmapRef.current.setData(root)
        markmapRef.current.fit?.()
        window.setTimeout(() => {
          markmapRef.current?.fit?.()
        }, 200)
      } catch (error) {
        setRenderError(error instanceof Error ? error.message : '思维导图渲染失败')
      } finally {
        if (!disposed) {
          setRendering(false)
        }
      }
    }

    void renderMindmap()

    return () => {
      disposed = true
      markmapRef.current?.destroy?.()
      markmapRef.current = null
    }
  }, [markdown])

  return (
    <div className="knowledge-tab-panel">
      <div className="knowledge-query-actions">
        <Space wrap>
          <Button icon={<ReloadOutlined />} loading={mindmapLoading} onClick={onRegenerate}>
            重新生成导图
          </Button>
          <Button disabled={!mindmap || rendering} onClick={() => markmapRef.current?.fit?.()}>
            适应视图
          </Button>
        </Space>
      </div>

      <div style={{ position: 'relative', width: '100%' }}>
        {mindmapLoading || rendering ? (
          <div className="knowledge-loading-panel" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10, background: 'rgba(var(--ant-color-bg-base), 0.7)' }}>
            <Spin />
          </div>
        ) : null}

        <div style={{ visibility: (mindmap && !mindmapLoading) ? 'visible' : 'hidden' }}>
          <div className="knowledge-mindmap-shell">
            <div className="knowledge-mindmap-canvas">
              <svg ref={svgRef} className="knowledge-mindmap-svg" />
            </div>
            <Text type="secondary">支持缩放和适应视图，方便快速浏览知识结构。</Text>
          </div>
        </div>

        {!mindmap && !mindmapLoading && !rendering && (
          <div className="knowledge-loading-panel">
            <Empty description="暂无知识导图" image={false} className="minimal-empty" />
          </div>
        )}
      </div>

      {renderError ? <Text type="danger">{renderError}</Text> : null}
    </div>
  )
}
