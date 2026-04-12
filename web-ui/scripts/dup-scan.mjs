import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const root = path.resolve(import.meta.dirname, '..')
const srcRoot = path.join(root, 'src')

const ignoreDirs = new Set(['node_modules', 'dist', 'public', '.git'])
const allowedExt = new Set(['.ts', '.tsx', '.css'])

async function* walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (ignoreDirs.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.isFile() && allowedExt.has(path.extname(entry.name))) yield full
  }
}

function normalize(lines) {
  return lines
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== '')
    .join('\n')
}

const windowSize = 10
const occurrences = new Map()

for await (const file of walk(srcRoot)) {
  const rel = path.relative(root, file)
  if (
    rel.endsWith('.test.ts') ||
    rel.endsWith('.test.tsx') ||
    rel.includes('/test/') ||
    rel.includes('/smoke/') ||
    rel.includes('/e2e/')
  ) {
    continue
  }
  const content = await fs.readFile(file, 'utf8')
  const lines = content.split('\n')
  for (let i = 0; i + windowSize <= lines.length; i += windowSize) {
    const block = normalize(lines.slice(i, i + windowSize))
    if (block.length < 200) continue
    const uniqueLineCount = new Set(block.split('\n')).size
    if (uniqueLineCount < 8) continue
    const hash = crypto.createHash('sha1').update(block).digest('hex')
    const list = occurrences.get(hash) || []
    list.push({ file: rel, start: i + 1 })
    occurrences.set(hash, list)
  }
}

const dups = []
for (const [hash, list] of occurrences) {
  if (list.length < 2) continue
  dups.push({ hash, count: list.length, list })
}

dups.sort((a, b) => b.count - a.count)

if (!dups.length) {
  console.log('No duplicates detected (window=10, minChars=200)')
  process.exit(0)
}

console.error(`Duplicate blocks detected: ${dups.length}`)
for (const item of dups.slice(0, 25)) {
  console.error(`- ${item.hash} (${item.count})`)
  for (const hit of item.list.slice(0, 8)) {
    console.error(`  - ${hit.file}:${hit.start}`)
  }
  if (item.list.length > 8) console.error(`  - ... +${item.list.length - 8} more`)
}

process.exit(1)
