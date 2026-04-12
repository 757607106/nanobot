import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const reactCorePackages = new Set(['react', 'react-dom', 'scheduler'])
const routerPackages = new Set(['react-router', 'react-router-dom', '@remix-run/router'])
const sharedRuntimePackages = new Set([
  '@babel/runtime',
  'tslib',
])
const heavyPackageNames = new Set([
  'bubblesets-js',
  'd3',
  'dagre',
  'gl-matrix',
  'highlight.js',
  'html2canvas',
  'katex',
  'lodash',
  'markmap-common',
  'markmap-html-parser',
  'markmap-lib',
  'markmap-view',
  'markdown-it',
  'markdown-it-ins',
  'markdown-it-mark',
  'markdown-it-sub',
  'markdown-it-sup',
  'ml-matrix',
  'prismjs',
  'yaml',
  '@vscode/markdown-it-katex',
])
const markdownPackages = new Set([
  'react-markdown',
  'remark-gfm',
  'unified',
  'devlop',
  'hast-util-to-jsx-runtime',
  'html-url-attributes',
  'mdast-util-to-hast',
  'remark-parse',
  'remark-rehype',
  'unist-util-visit',
  'property-information',
  'comma-separated-tokens',
  'space-separated-tokens',
  'decode-named-character-reference',
])

function getPackageName(id: string) {
  const normalized = id.replace(/\\/g, '/').split('?')[0]
  const nodeModulesPath = normalized.split('/node_modules/').pop()

  if (!nodeModulesPath) {
    return null
  }

  const segments = nodeModulesPath.split('/')
  if (segments[0].startsWith('@') && segments.length > 1) {
    return `${segments[0]}/${segments[1]}`
  }

  return segments[0]
}

function getPackageChunkName(pkg: string) {
  return `pkg-${pkg.replace(/^@/, '').replace(/[\\/]/g, '-')}`
}

function manualChunks(id: string) {
  if (!id.includes('node_modules')) {
    return undefined
  }

  const pkg = getPackageName(id)
  if (!pkg) {
    return 'vendor'
  }

  if (reactCorePackages.has(pkg)) {
    return 'react-core'
  }

  if (routerPackages.has(pkg)) {
    return 'router'
  }

  if (sharedRuntimePackages.has(pkg)) {
    return 'shared-runtime'
  }

  if (
    markdownPackages.has(pkg) ||
    pkg.startsWith('remark-') ||
    pkg.startsWith('rehype-') ||
    pkg.startsWith('micromark') ||
    pkg.startsWith('mdast-') ||
    pkg.startsWith('hast-') ||
    pkg.startsWith('unist-') ||
    pkg.startsWith('vfile')
  ) {
    return 'vendor'
  }

  if (
    pkg.startsWith('@antv/') ||
    pkg.startsWith('markmap-') ||
    heavyPackageNames.has(pkg)
  ) {
    return getPackageChunkName(pkg)
  }

  if (
    pkg === 'antd' ||
    pkg.startsWith('@ant-design/') ||
    pkg.startsWith('@rc-component/') ||
    pkg.startsWith('rc-')
  ) {
    return 'antd'
  }

  return 'vendor'
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiOrigin = env.NANOBOT_API_ORIGIN || 'http://127.0.0.1:6788'
  const port = Number(env.NANOBOT_WEB_UI_PORT || '5173')

  return {
    plugins: [react()],
    ssr: {
      noExternal: [
        'antd',
        '@ant-design/icons',
        '@ant-design/x',
        '@ant-design/x-sdk',
      ],
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks,
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/test/setup.ts',
      css: true,
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      exclude: [
        'node_modules/**',
        'e2e/**',
        'playwright.config.ts',
      ],
      server: {
        deps: {
          inline: [
            'antd',
            /^@ant-design\//,
            /^@rc-component\//,
            /^rc-/,
          ],
        },
      },
    },
    server: {
      port,
      proxy: {
        '/api': {
          target: apiOrigin,
          changeOrigin: true,
        },
      },
    },
  }
})
