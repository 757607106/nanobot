import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

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

function manualChunks(id: string) {
  if (!id.includes('node_modules')) {
    return undefined
  }

  const pkg = getPackageName(id)
  if (!pkg) {
    return 'vendor'
  }

  if (['react', 'react-dom', 'scheduler'].includes(pkg)) {
    return 'react-core'
  }

  if (['react-router', 'react-router-dom', '@remix-run/router'].includes(pkg)) {
    return 'router'
  }

  if (
    pkg === '@ant-design/x' ||
    pkg === '@ant-design/x-sdk'
  ) {
    return 'ant-design-x'
  }

  if (
    pkg === 'antd' ||
    pkg === '@ant-design/cssinjs' ||
    pkg === '@ant-design/cssinjs-utils' ||
    pkg === '@ant-design/colors' ||
    pkg === '@ant-design/fast-color' ||
    pkg === '@ant-design/icons' ||
    pkg === '@ant-design/icons-svg' ||
    pkg.startsWith('@rc-component/') ||
    pkg.startsWith('rc-') ||
    pkg === '@emotion/hash' ||
    pkg === '@emotion/unitless'
  ) {
    return 'ant-design-core'
  }

  if (
    pkg === 'react-markdown' ||
    pkg === 'remark-gfm' ||
    pkg === 'unified' ||
    pkg.startsWith('remark-') ||
    pkg.startsWith('rehype-') ||
    pkg.startsWith('micromark') ||
    pkg.startsWith('mdast-') ||
    pkg.startsWith('hast-') ||
    pkg.startsWith('unist-') ||
    pkg.startsWith('vfile') ||
    pkg === 'property-information' ||
    pkg === 'comma-separated-tokens' ||
    pkg === 'space-separated-tokens' ||
    pkg === 'decode-named-character-reference'
  ) {
    return 'markdown'
  }

  return 'vendor'
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiOrigin = env.NANOBOT_API_ORIGIN || 'http://127.0.0.1:6788'
  const port = Number(env.NANOBOT_WEB_UI_PORT || '5173')

  return {
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks,
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
