import { describe, expect, it } from 'vitest'
import { buildPreviewHtmlDocument, resolvePreviewUrl } from './preview'

describe('resolvePreviewUrl', () => {
  it('resolves relative preview URLs against the provided base', () => {
    expect(resolvePreviewUrl('diagram.png', 'https://example.com/docs/', 'resource')).toBe('https://example.com/docs/diagram.png')
    expect(resolvePreviewUrl('../guide.md', 'https://example.com/docs/nested/', 'link')).toBe('https://example.com/docs/guide.md')
  })

  it('blocks dangerous URL schemes', () => {
    expect(resolvePreviewUrl('javascript:alert(1)', 'https://example.com/docs/', 'link')).toBeNull()
    expect(resolvePreviewUrl('file:///tmp/demo.png', 'https://example.com/docs/', 'resource')).toBeNull()
  })
})

describe('buildPreviewHtmlDocument', () => {
  it('strips active content and rewrites safe links and assets', () => {
    const output = buildPreviewHtmlDocument(
      `
        <html>
          <body>
            <script>alert(1)</script>
            <img src="diagram.png" onerror="evil()">
            <a href="guide.html">Guide</a>
            <a href="javascript:alert(1)">Bad</a>
          </body>
        </html>
      `,
      { baseUrl: 'https://example.com/docs/' },
    )

    const doc = new DOMParser().parseFromString(output, 'text/html')
    const image = doc.querySelector('img')
    const links = doc.querySelectorAll('a')

    expect(doc.querySelector('script')).toBeNull()
    expect(doc.querySelector('base')?.getAttribute('href')).toBe('https://example.com/docs/')
    expect(image?.getAttribute('src')).toBe('https://example.com/docs/diagram.png')
    expect(image?.getAttribute('onerror')).toBeNull()
    expect(links[0]?.getAttribute('href')).toBe('https://example.com/docs/guide.html')
    expect(links[0]?.getAttribute('target')).toBe('_blank')
    expect(links[1]?.getAttribute('href')).toBeNull()
  })
})
