export type PreviewUrlKind = 'link' | 'resource'

const BLOCKED_TAGS = ['script', 'iframe', 'object', 'embed', 'form', 'base', 'meta[http-equiv="refresh"]']
const RESOURCE_ATTRS = ['src', 'poster']
const LINK_ATTRS = ['href']
const XLINK_ATTR = 'xlink:href'
const SRCSET_ATTR = 'srcset'

function readScheme(value: string): string | null {
  const match = value.match(/^([a-zA-Z][a-zA-Z\d+.-]*):/)
  return match ? match[1].toLowerCase() : null
}

function isAllowedScheme(scheme: string | null, kind: PreviewUrlKind) {
  if (!scheme) return true
  if (kind === 'resource') {
    return ['http', 'https', 'data', 'blob'].includes(scheme)
  }
  return ['http', 'https', 'mailto', 'tel'].includes(scheme)
}

export function resolvePreviewUrl(
  value: string | null | undefined,
  baseUrl?: string | null,
  kind: PreviewUrlKind = 'link',
): string | null {
  const trimmed = String(value || '').trim()
  if (!trimmed) return null
  if (trimmed.startsWith('#')) {
    return kind === 'link' ? trimmed : null
  }

  const scheme = readScheme(trimmed)
  if (!isAllowedScheme(scheme, kind)) {
    return null
  }

  if (scheme) {
    return trimmed
  }

  if (trimmed.startsWith('//')) {
    return baseUrl ? new URL(trimmed, baseUrl).toString() : trimmed
  }

  if (!baseUrl) {
    return trimmed
  }

  try {
    return new URL(trimmed, baseUrl).toString()
  } catch {
    return null
  }
}

function sanitizeAttributeValue(element: Element, attributeName: string, baseUrl?: string | null, kind: PreviewUrlKind = 'resource') {
  const current = element.getAttribute(attributeName)
  if (!current) return
  const resolved = resolvePreviewUrl(current, baseUrl, kind)
  if (!resolved) {
    element.removeAttribute(attributeName)
    return
  }
  element.setAttribute(attributeName, resolved)
}

function sanitizeSrcset(element: Element, baseUrl?: string | null) {
  const raw = element.getAttribute(SRCSET_ATTR)
  if (!raw) return
  const sanitized = raw
    .split(',')
    .map((candidate) => {
      const trimmed = candidate.trim()
      if (!trimmed) return null
      const [url, descriptor] = trimmed.split(/\s+/, 2)
      const resolved = resolvePreviewUrl(url, baseUrl, 'resource')
      if (!resolved) return null
      return descriptor ? `${resolved} ${descriptor}` : resolved
    })
    .filter((item): item is string => Boolean(item))
    .join(', ')

  if (!sanitized) {
    element.removeAttribute(SRCSET_ATTR)
    return
  }
  element.setAttribute(SRCSET_ATTR, sanitized)
}

export function buildPreviewHtmlDocument(rawHtml: string, options?: { baseUrl?: string | null }) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(rawHtml || '<!doctype html><html><body></body></html>', 'text/html')
  const { baseUrl } = options || {}

  doc.querySelectorAll(BLOCKED_TAGS.join(',')).forEach((node) => node.remove())
  doc.querySelectorAll('*').forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase()
      if (name.startsWith('on')) {
        element.removeAttribute(attribute.name)
      }
    })
  })

  doc.querySelectorAll('*').forEach((element) => {
    RESOURCE_ATTRS.forEach((attributeName) => sanitizeAttributeValue(element, attributeName, baseUrl, 'resource'))
    LINK_ATTRS.forEach((attributeName) => sanitizeAttributeValue(element, attributeName, baseUrl, 'link'))
    sanitizeAttributeValue(element, XLINK_ATTR, baseUrl, 'resource')
    sanitizeSrcset(element, baseUrl)
  })

  doc.querySelectorAll('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href') || ''
    if (!href || href.startsWith('#')) {
      anchor.removeAttribute('target')
      return
    }
    anchor.setAttribute('target', '_blank')
    anchor.setAttribute('rel', 'noopener noreferrer')
  })

  const head = doc.head || doc.createElement('head')
  if (!doc.head) {
    doc.documentElement.insertBefore(head, doc.body || null)
  }

  const charset = doc.createElement('meta')
  charset.setAttribute('charset', 'utf-8')
  head.prepend(charset)

  const csp = doc.createElement('meta')
  csp.setAttribute('http-equiv', 'Content-Security-Policy')
  csp.setAttribute(
    'content',
    "default-src 'none'; img-src data: blob: http: https:; media-src data: blob: http: https:; font-src data: http: https:; style-src 'unsafe-inline' http: https:; object-src 'none'; script-src 'none'; connect-src 'none'; form-action 'none'",
  )
  head.appendChild(csp)

  if (baseUrl) {
    const base = doc.createElement('base')
    base.setAttribute('href', baseUrl)
    head.appendChild(base)
  }

  const style = doc.createElement('style')
  style.textContent = `
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #1f2937;
      font: 15px/1.65 "SF Pro Text", "PingFang SC", "Hiragino Sans GB", sans-serif;
    }
    body {
      padding: 24px;
      word-break: break-word;
    }
    img, video, canvas, svg, table {
      max-width: 100%;
      height: auto;
    }
    pre {
      white-space: pre-wrap;
      word-break: break-word;
    }
    a {
      color: #1d4ed8;
    }
  `
  head.appendChild(style)

  return `<!doctype html>\n${doc.documentElement.outerHTML}`
}
