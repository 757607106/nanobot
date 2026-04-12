import fs from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const distAssets = path.join(root, 'dist', 'assets')
const outFile = path.join(root, 'docs', 'ui', 'ui-consistency-audit.md')

function formatBytes(bytes) {
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(2)} MB`
}

async function listAssets() {
  const entries = await fs.readdir(distAssets, { withFileTypes: true })
  const files = []
  for (const e of entries) {
    if (!e.isFile()) continue
    const full = path.join(distAssets, e.name)
    const stat = await fs.stat(full)
    files.push({ name: e.name, bytes: stat.size })
  }
  files.sort((a, b) => b.bytes - a.bytes)
  return files
}

async function main() {
  let assets = []
  try {
    assets = await listAssets()
  } catch {
    console.error('dist/assets not found. Run `npm run build` first.')
    process.exit(1)
  }

  const large = assets.filter((a) => a.bytes > 500 * 1024)
  const lines = []
  lines.push('# UI 一致性与性能审计报告')
  lines.push('')
  lines.push('## 构建产物体积（dist/assets）')
  lines.push('')
  lines.push('| 文件 | 体积 |')
  lines.push('|---|---:|')
  for (const a of assets.slice(0, 25)) {
    lines.push(`| ${a.name} | ${formatBytes(a.bytes)} |`)
  }
  lines.push('')
  lines.push(`- >500KB 文件数：${large.length}`)
  if (large.length) {
    lines.push('')
    lines.push('## 建议')
    lines.push('')
    lines.push('- 优先把 markdown/highlight/katex/antv 等重依赖收敛到路由级按需加载边界')
    lines.push('- 保持 antd 独立 chunk，避免与 markdown 产生循环依赖')
  }

  await fs.mkdir(path.dirname(outFile), { recursive: true })
  await fs.writeFile(outFile, `${lines.join('\n')}\n`, 'utf8')
  console.log(`Wrote ${path.relative(root, outFile)}`)
}

await main()

