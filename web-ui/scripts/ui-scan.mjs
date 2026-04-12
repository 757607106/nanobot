import fs from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const srcRoot = path.join(root, 'src')

const allowedExt = new Set(['.ts', '.tsx', '.css'])
const ignoreDirs = new Set(['node_modules', 'dist', 'public', '.git'])

async function* walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (ignoreDirs.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(full)
    } else if (entry.isFile()) {
      if (allowedExt.has(path.extname(entry.name))) yield full
    }
  }
}

function hasTailwindLikeClassName(text) {
  return /className\s*=\s*["'][^"']*(sm:|md:|lg:|xl:|2xl:|\[[^\]]+]|![-a-zA-Z]+|\bgap-\d+\b|\bgrid-cols-\d+\b|\bpx-\d+\b|\bpy-\d+\b)["']/.test(
    text,
  )
}

function hasGoogleFontImport(text) {
  return /fonts\.googleapis\.com\/css2\?/.test(text)
}

function hasTailwindImport(text) {
  return /@import\s+["']tailwindcss["']|@tailwind\s+/.test(text)
}

const issues = []

for await (const file of walk(srcRoot)) {
  const rel = path.relative(root, file)
  const content = await fs.readFile(file, 'utf8')
  if (file.endsWith('.css')) {
    if (hasGoogleFontImport(content)) issues.push({ file: rel, rule: 'no-google-font-import' })
    if (hasTailwindImport(content)) issues.push({ file: rel, rule: 'no-tailwind-import' })
  } else {
    if (hasTailwindLikeClassName(content)) issues.push({ file: rel, rule: 'no-tailwind-like-classname' })
  }
}

if (issues.length) {
  const grouped = issues.reduce((acc, item) => {
    acc[item.rule] ||= []
    acc[item.rule].push(item.file)
    return acc
  }, {})

  console.error('UI scan failed:')
  for (const [rule, files] of Object.entries(grouped)) {
    console.error(`- ${rule}:`)
    for (const f of files) console.error(`  - ${f}`)
  }
  process.exit(1)
}

console.log('UI scan passed')
