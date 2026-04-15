import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Alert, Button, Empty, Segmented, Space, Spin, Tag, Typography } from 'antd'
import { DownloadOutlined, FileSearchOutlined } from '@ant-design/icons'
import { useParams } from 'react-router-dom'
import type { ComponentProps as XMarkdownComponentProps } from '@ant-design/x-markdown'
import { XMarkdown } from '@ant-design/x-markdown'
import { api } from '../../api'
import { getErrorMessage } from '../../errorMessage'
import type { KnowledgeFilePreview } from '../../types'
import { buildPreviewHtmlDocument, resolvePreviewUrl } from './preview'
import './knowledge.css'

const { Paragraph, Text, Title } = Typography

const PREVIEW_KIND_LABELS: Record<KnowledgeFilePreview['previewKind'], string> = {
  image: '图片',
  pdf: 'PDF',
  html: 'HTML',
  markdown: 'Markdown',
  text: '文本',
  unsupported: '暂不支持',
}

const TEXTUAL_PREVIEW_KINDS: KnowledgeFilePreview['previewKind'][] = ['html', 'markdown', 'text']

type MarkdownAnchorProps = XMarkdownComponentProps & {
  href?: string
  children?: ReactNode
  class?: string
}

type MarkdownImageProps = XMarkdownComponentProps & {
  src?: string
  alt?: string
  class?: string
}

export default function KnowledgeFilePreviewPage() {
  const { kbId = '', fileId = '' } = useParams()
  const [preview, setPreview] = useState<KnowledgeFilePreview | null>(null)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [htmlPreviewMode, setHtmlPreviewMode] = useState<'render' | 'source'>('render')

  const inlineUrl = kbId && fileId ? api.downloadKnowledgeFileUrl(kbId, fileId, 'preview', 'inline') : ''

  const htmlDocument = useMemo(
    () =>
      preview?.previewKind === 'html' && htmlPreviewMode === 'render'
        ? buildPreviewHtmlDocument(content, { baseUrl: preview.baseUrl })
        : '',
    [content, htmlPreviewMode, preview],
  )
  const markdownComponents = useMemo<Record<string, React.ComponentType<XMarkdownComponentProps>>>(
    () => ({
      a: ((props: XMarkdownComponentProps) => {
        const { href, children, class: htmlClass, ...rest } = props as MarkdownAnchorProps
        const resolvedHref = resolvePreviewUrl(href, preview?.baseUrl, 'link')
        const isFragment = typeof resolvedHref === 'string' && resolvedHref.startsWith('#')
        if (!resolvedHref) {
          return <span {...rest} className={htmlClass}>{children}</span>
        }
        return (
          <a
            {...rest}
            className={htmlClass}
            href={resolvedHref}
            target={isFragment ? undefined : '_blank'}
            rel={isFragment ? undefined : 'noopener noreferrer'}
          >
            {children}
          </a>
        )
      }) as React.ComponentType<XMarkdownComponentProps>,
      img: ((props: XMarkdownComponentProps) => {
        const { src, alt, class: htmlClass, ...rest } = props as MarkdownImageProps
        const resolvedSrc = resolvePreviewUrl(src, preview?.baseUrl, 'resource')
        if (!resolvedSrc) {
          return <Text type="secondary">[图片资源不可用]</Text>
        }
        return <img {...rest} className={htmlClass} src={resolvedSrc} alt={alt || ''} loading="lazy" />
      }) as React.ComponentType<XMarkdownComponentProps>,
    }),
    [preview?.baseUrl],
  )

  useEffect(() => {
    setHtmlPreviewMode('render')
  }, [fileId, kbId, preview?.file.fileId])

  useEffect(() => {
    if (!kbId || !fileId) {
      setPreview(null)
      setContent('')
      setError('缺少知识库或文件标识，无法预览原文件。')
      setLoading(false)
      return
    }

    const controller = new AbortController()
    let active = true

    async function loadPreview() {
      setLoading(true)
      setError(null)
      try {
        const nextPreview = await api.getKnowledgeFilePreview(kbId, fileId)
        let nextContent = ''
        if (TEXTUAL_PREVIEW_KINDS.includes(nextPreview.previewKind)) {
          nextContent = await api.getKnowledgeFileRawText(kbId, fileId, controller.signal)
        }
        if (!active) return
        setPreview(nextPreview)
        setContent(nextContent)
      } catch (loadError) {
        if (!active || controller.signal.aborted) return
        setPreview(null)
        setContent('')
        setError(getErrorMessage(loadError, '加载原文件预览失败'))
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void loadPreview()

    return () => {
      active = false
      controller.abort()
    }
  }, [fileId, kbId])

  function renderMarkdownPreview() {
    return (
      <div className="knowledge-file-preview-markdown">
        <XMarkdown
          content={content}
          className="x-markdown-light"
          components={markdownComponents}
          openLinksInNewTab
          escapeRawHtml
        />
      </div>
    )
  }

  function renderPreviewBody(data: KnowledgeFilePreview) {
    if (data.previewKind === 'image') {
      return (
        <div className="knowledge-file-preview-image-shell">
          <img className="knowledge-file-preview-image" src={inlineUrl} alt={data.file.filename} />
        </div>
      )
    }

    if (data.previewKind === 'pdf') {
      return (
        <iframe
          className="knowledge-file-preview-frame"
          src={inlineUrl}
          title={data.file.filename}
        />
      )
    }

    if (data.previewKind === 'html') {
      if (htmlPreviewMode === 'source') {
        return <pre className="knowledge-file-preview-text">{content}</pre>
      }
      return (
        <iframe
          className="knowledge-file-preview-frame"
          sandbox="allow-popups allow-downloads"
          srcDoc={htmlDocument}
          title={data.file.filename}
        />
      )
    }

    if (data.previewKind === 'markdown') {
      return renderMarkdownPreview()
    }

    if (data.previewKind === 'text') {
      return <pre className="knowledge-file-preview-text">{content}</pre>
    }

    return (
      <Empty
        image={false}
        className="minimal-empty"
        description="当前文件类型暂不支持保真预览，请使用下载查看原文件。"
      />
    )
  }

  return (
    <div className="knowledge-file-preview-page">
      <div className="knowledge-file-preview-header">
        <div className="knowledge-file-preview-title">
          <Title level={3} style={{ margin: 0 }}>
            {preview?.file.filename || '原文件预览'}
          </Title>
          <Paragraph type="secondary" style={{ margin: '6px 0 0' }}>
            保真预览原文件内容；知识库解析稿和分块仍可在文件详情中查看。
          </Paragraph>
          {preview ? (
            <Space wrap size={[8, 8]}>
              <Tag>{PREVIEW_KIND_LABELS[preview.previewKind]}</Tag>
              <Tag>{preview.contentType || 'application/octet-stream'}</Tag>
            </Space>
          ) : null}
        </div>
        <Space wrap align="start">
          {preview?.previewKind === 'html' ? (
            <Segmented
              value={htmlPreviewMode}
              onChange={(value) => setHtmlPreviewMode(value as 'render' | 'source')}
              options={[
                { label: '预览', value: 'render' },
                { label: '源码', value: 'source' },
              ]}
            />
          ) : null}
          <Button
            icon={<DownloadOutlined />}
            disabled={!kbId || !fileId}
            onClick={() => window.open(api.downloadKnowledgeFileUrl(kbId, fileId, 'raw'), '_blank', 'noopener')}
          >
            下载原文
          </Button>
          {preview?.file.markdownFile ? (
            <Button
              icon={<FileSearchOutlined />}
              onClick={() => window.open(api.downloadKnowledgeFileUrl(kbId, fileId, 'parsed'), '_blank', 'noopener')}
            >
              下载解析稿
            </Button>
          ) : null}
        </Space>
      </div>

      {error ? (
        <Alert type="error" showIcon message="原文件预览加载失败" description={error} />
      ) : null}

      <div className="knowledge-file-preview-stage">
        {loading ? (
          <div className="knowledge-loading-panel is-large">
            <Spin size="large" />
          </div>
        ) : preview ? (
          renderPreviewBody(preview)
        ) : (
          <Empty image={false} className="minimal-empty" description="暂无可预览内容" />
        )}
      </div>
    </div>
  )
}
