#!/usr/bin/env node
// 对应关系检查：验证 git-commits.json 中 仓库 ↔ 提交 ↔ 文件 的归属是否一致、有无串项，
// 并校验跨平台项目名解析（含 Windows 驱动盘路径 + titleRoots 语义化）输出。
// 用法: npx tsx scripts/check-git-mapping.ts
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'node:url'
import { CONFIG } from './config.ts'
import type { BusinessDef } from './config.ts'
import { deriveProjectName, repoBaseName, toPosix } from './project-name.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const readJson = (name: string): any => {
  const p = `${ROOT}/${name}`
  if (!existsSync(p)) return null
  return JSON.parse(readFileSync(p, 'utf-8'))
}

let issues = 0
const warn = (msg: string) => { issues++; console.log(`  ⚠️  ${msg}`) }

console.log('=== 1. 仓库 ↔ 提交 ↔ 文件 对照 ===')
const git = readJson('git-commits.json')
const byRepo = new Map<string, any[]>()
if (!git?.commits?.length) console.log('  （无提交数据）')
for (const c of git?.commits || []) {
  if (!c.repo) { warn(`提交 ${c.hash} 缺少 repo`); continue }
  if (!byRepo.has(c.repo)) byRepo.set(c.repo, [])
  byRepo.get(c.repo)!.push(c)
}
for (const [repo, commits] of byRepo) {
  console.log(`\n仓库: ${repo}（L1 → ${deriveProjectName(repo)}）`)
  for (const c of commits) {
    const files = c.files || []
    if (files.length === 0) warn(`提交 ${c.hash} 「${c.message}」无文件明细（可能为空提交/被 --no-merges 过滤）`)
    console.log(`  • ${c.hash} ${c.message}`)
    for (const f of files) {
      console.log(`      ${f.status} ${f.path}${f.isDoc ? ' [doc]' : ''}`)
    }
  }
}

console.log(`\n=== 2. AI 会话归属（应与仓库 L1 对齐） ===`)
const ai = readJson('ai-data.json')
if (!ai?.sessions?.length) console.log('  （无会话数据）')
const sessionByProject = new Map<string, string[]>()
for (const s of ai?.sessions || []) {
  const folder = deriveProjectName(s.directory || s.project || '')
  if (!sessionByProject.has(folder)) sessionByProject.set(folder, [])
  sessionByProject.get(folder)!.push(`${s.tool}: ${s.title}`)
}
for (const [project, sessions] of sessionByProject) {
  console.log(`\nL1 → ${project}`)
  for (const t of sessions.slice(0, 10)) console.log(`  • ${t}`)
}

console.log(`\n=== 3. Windows 驱动盘路径解析单测（业务归并 + 多仓库三级） ===`)
const WINDOWS_SAMPLE = `E:\\hy\\业务板块A\\repo-uni`
const cases: Array<{ path: string; businesses: BusinessDef[]; expectLabel?: string }> = [
  { path: WINDOWS_SAMPLE, businesses: [], expectLabel: 'repo-uni' },
  { path: WINDOWS_SAMPLE, businesses: [{ label: '板块A', roots: ['业务板块A'] }], expectLabel: '板块A' },
  {
    path: WINDOWS_SAMPLE,
    businesses: [{ label: '板块B', roots: ['业务板块B'] }, { label: '板块A', roots: ['业务板块A'] }],
    expectLabel: '板块A',
  },
  { path: `E:\\hy\\业务板块B\\repo-applet`, businesses: [{ label: '板块B', roots: ['业务板块B'] }], expectLabel: '板块B' },
  { path: `/home/user/workspace/hy/业务板块C/platform-ui`, businesses: [], expectLabel: 'platform-ui' },
  { path: `/home/user/workspace/hy/业务板块C/platform-ui`, businesses: [{ label: '板块C', roots: ['业务板块C'] }], expectLabel: '板块C' },
  { path: `/home/user`, businesses: [], expectLabel: 'user' },
  // 多仓库同业务：repos 命中最优先，同业务不同仓库归并到同一 label
  { path: `E:\\hy\\业务板块D\\repo-a`, businesses: [{ label: '板块D', roots: ['业务板块D'], repos: ['repo-a', 'repo-b'] }], expectLabel: '板块D' },
  { path: `/home/user/workspace/hy/业务板块D/repo-b`, businesses: [{ label: '板块D', roots: ['业务板块D'], repos: ['repo-a', 'repo-b'] }], expectLabel: '板块D' },
]
for (const c of cases) {
  const base = repoBaseName(c.path)
  const label = deriveProjectName(c.path, c.businesses)
  const isPathLike = /[\\/]/.test(label) && !label.includes('（')
  if (isPathLike) warn(`「${c.path}」仍解析出盘符/路径样式: ${label}`)
  if (c.expectLabel !== undefined && label !== c.expectLabel) warn(`「${c.path}」预期 L1=${c.expectLabel}，实际=${label}`)
  console.log(`  ${c.path}`)
  console.log(`      businesses=${JSON.stringify(c.businesses.map(b => b.label))} → base=${base}`)
  console.log(`      businesses=${JSON.stringify(c.businesses.map(b => b.label))} → L1=${label}${isPathLike ? '  ⚠️ 含路径!' : ''}`)
}

const currentBusinesses = CONFIG.project.businesses
console.log(`\n当前配置 project.businesses = ${JSON.stringify(currentBusinesses)}`)
if (currentBusinesses.length === 0) {
  console.log('  ℹ️  未配置业务归并，L1 全部回退仓库名直出（可在 config.local.json 配置 businesses）')
}

console.log(`\n${issues === 0 ? '✅ 未发现归属问题' : `❌ 发现 ${issues} 处问题`}\n`)
process.exit(issues === 0 ? 0 : 1)