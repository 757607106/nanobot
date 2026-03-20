import { useEffect, useId, useState } from 'react'
import { Button } from 'antd'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

async function copyText(text: string) {
  if (!text.trim() || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    return
  }
  await navigator.clipboard.writeText(text)
}

function MermaidBlock({ code }: { code: string }) {
  const graphId = useId().replace(/:/g, '-')
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function renderGraph() {
      setSvg('')
      setError('')

      try {
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'neutral',
        })
        const rendered = await mermaid.render(`nanobot-mermaid-${graphId}`, code)
        if (!cancelled) {
          setSvg(rendered.svg)
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : 'Mermaid 渲染失败')
        }
      }
    }

    void renderGraph()

    return () => {
      cancelled = true
    }
  }, [code, graphId])

  return (
    <div className="chat-mermaid-card">
      <div className="chat-mermaid-card-head">
        <span>Mermaid 图表</span>
        <Button size="small" type="text" onClick={() => void copyText(code)}>
          复制源码
        </Button>
      </div>

      {svg ? (
        <div className="chat-mermaid-canvas" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : error ? (
        <div className="chat-mermaid-error">
          <div>图表渲染失败，已回退为源码。</div>
          <pre>{code}</pre>
        </div>
      ) : (
        <div className="chat-mermaid-loading">正在渲染图表...</div>
      )}

      <details className="chat-mermaid-source">
        <summary>查看源码</summary>
        <pre>{code}</pre>
      </details>
    </div>
  )
}

function MarkdownCode({
  inline,
  className,
  children,
  ...props
}: React.ComponentProps<'code'> & { inline?: boolean }) {
  const language = className?.replace('language-', '').toLowerCase()
  const code = String(children ?? '').replace(/\n$/, '')

  if (!inline && language === 'mermaid') {
    return <MermaidBlock code={code} />
  }

  if (!inline) {
    return (
      <pre className="markdown-code-block">
        <code className={className} {...props}>
          {children}
        </code>
      </pre>
    )
  }

  return (
    <code className={className} {...props}>
      {children}
    </code>
  )
}

export default function ChatMarkdown({ content }: { content: string }) {
  return (
    <div className="markdown-bubble">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre({ children }) {
            return <>{children}</>
          },
          code: MarkdownCode,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
