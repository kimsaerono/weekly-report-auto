#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'node:url'
import { execSync } from 'child_process'
import { config } from 'dotenv'
// 项目名跨平台解析：正斜杠归一化 + 盘符/用户名过滤 + 业务归并（L1=业务名，多仓库三级排版）
import { deriveProjectName, resolveBusiness, toPosix } from './project-name.ts'
import { CONFIG } from './config.ts'

config()

const TEMPLATE_PATH = fileURLToPath(new URL('../REPORT_TEMPLATE.md', import.meta.url))

// ===== 结构化 Schema（编号由填单端生成，report.json 保持无序号干净数据）=====
interface ReportLine {
  title?: boolean // true = 分类标题（一、业务 & 开发），普通段落不编号
  level?: number // 1 = 一级 / 2 = 二级 / 3 = 三级，由填单端 Tab/Shift+Tab 精确落层级
  text: string
}

interface ReportContent {
  completed: ReportLine[]
  uncompleted: ReportLine[]
  nextPlan: ReportLine[]
  help: ReportLine[]
  reflection: ReportLine[]
}

interface ReportData {
  weekRange: { start: string; end: string }
  messages: any[]
  calendar: any[]
  tasks: any
  git?: any
  opencode?: any
  notes?: any
}

function loadJson(filePath: string): any {
  const rootDir = fileURLToPath(new URL('..', import.meta.url))
  const fullPath = filePath.startsWith('/') ? filePath : `${rootDir}/${filePath}`
  if (!existsSync(fullPath)) return null
  return JSON.parse(readFileSync(fullPath, 'utf-8'))
}

function loadTemplate(): string {
  if (!existsSync(TEMPLATE_PATH)) return ''
  return readFileSync(TEMPLATE_PATH, 'utf-8')
}

function parseTemplateCategories(template: string): string[] {
  if (!template) return []
  const cats: string[] = []
  const seen = new Set<string>()
  // 只解析「分类结构」章节（## 格式规范 → ### 写作风格 之间的 - 列表项）
  const section = template.split('\n')
  let inStruct = false
  for (const line of section) {
    if (/^###\s*分类结构/.test(line)) inStruct = true
    else if (inStruct && /^#{2,3}\s/.test(line) && !/分类结构/.test(line)) break
    if (!inStruct) continue
    const m = line.match(/^[-*]\s*([一二三四五六七八九十]+)、(.*)$/)
    if (m) {
      const norm = normalizeCatTitle(`${m[1]}、${m[2].trim()}`)
      if (!seen.has(norm)) {
        seen.add(norm)
        cats.push(norm)
      }
    }
  }
  return cats
}

function normalizeCatTitle(title: string): string {
  return title.replace(/&/g, ' & ').replace(/\s+/g, ' ').replace(/&\s+&/, '&').trim()
}

// ===== 通用处理（无公司/项目声明，全部从数据本身推断）=====
// 规则来源：scripts/config.ts（可本地覆盖），仅保留普适噪音（合并/回退/空提交等），不含业务关键词

const NOISE_PATTERNS: RegExp[] = CONFIG.generate.noisePatterns.map(p => new RegExp(p, 'i'))

function isNoise(text: string): boolean {
  return NOISE_PATTERNS.some(r => r.test(text))
}

function stripCommitPrefix(msg: string): string {
  return msg
    .replace(/^(feat|fix|docs|refactor|chore|style|test|perf|build)(\([^)]+\))?\s*[:：]\s*/i, '')
    .trim()
}

// 项目名统一走 project-name.ts：Windows 反斜杠/盘符/用户名已处理；titleRoots 命中语义名（仓库名）
function extractProjectName(pathOrRepo: string): string {
  return deriveProjectName(pathOrRepo)
}

function toPosixPath(p: string): string {
  return toPosix(p)
}

// git 提交类型 → 动词前缀（feat/fix/refactor/docs/... 通用字段，无业务映射）
const COMMIT_VERB: Record<string, string> = CONFIG.generate.commitVerbs

function gitTypeOf(message: string): string {
  const m = message.toLowerCase()
  if (/^fix|修复/.test(m)) return 'fix'
  if (/^feat|^feature|新增|实现/.test(m)) return 'feat'
  if (/refactor|重构/.test(m)) return 'refactor'
  if (/^docs|文档/.test(m)) return 'docs'
  if (/^test|测试/.test(m)) return 'test'
  if (/^perf|性能/.test(m)) return 'perf'
  if (/^chore|维护/.test(m)) return 'chore'
  if (/^style|样式/.test(m)) return 'style'
  return ''
}

const WORK_VERB_RE = new RegExp(`^(${CONFIG.generate.workVerbs.join('|')})`)

function rewriteCommit(msg: string): string {
  const type = gitTypeOf(msg)
  const clean = stripCommitPrefix(msg).replace(/[。.;；\s]+$/g, '')
  if (WORK_VERB_RE.test(clean)) return clean
  const verb = COMMIT_VERB[type] || '实现'
  return `${verb} ${clean}`
}

function rewriteSession(title: string): string {
  const trimmed = title.replace(/[。.;；\s]+$/g, '')
  if (WORK_VERB_RE.test(trimmed)) return trimmed
  if (CONFIG.generate.sessionDoneMarkers.some(m => trimmed.includes(m))) return `完成 ${trimmed}`
  return `${CONFIG.generate.sessionDefaultVerb} ${trimmed}`
}

function normalizeKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[。，、；：,.;:"'`~!@#$%^&*()\[\]{}\s]+/g, '')
}

// 归一组内去重 + 包含合并：同组内若一条完整包含另一条（归一化后子串），保留更长一条。
// 超出上限不静默丢弃：尾部折叠为「等 N 项」，避免真实工作项从兜底报告消失。
function mergeGroup(items: string[], max = 4): string[] {
  const cleaned = items
    .map(i => i.replace(/[。.;；\s]+$/g, '').trim())
    .filter(Boolean)
  const seen = new Map<string, string>()
  for (const it of cleaned) {
    const k = normalizeKey(it)
    if (!seen.has(k)) seen.set(k, it)
  }
  const entries = Array.from(seen.entries())
  const dropped = new Set<string>()
  for (let i = 0; i < entries.length; i++) {
    const [ki] = entries[i]
    if (dropped.has(ki)) continue
    for (let j = 0; j < entries.length; j++) {
      if (i === j) continue
      const [kj] = entries[j]
      if (kj && ki !== kj && ki.length >= 4 && kj.includes(ki)) {
        dropped.add(ki)
        break
      }
    }
  }
  const list = entries.filter(([k]) => !dropped.has(k)).map(([, v]) => v)
  if (list.length <= max) return list
  // 超出上限：内联折叠到最后一条（「…等 N 项」），避免出现孤立的「等 N 项」列表项
  const kept = list.slice(0, max - 1)
  const tail = kept[kept.length - 1]
  return [...kept.slice(0, -1), `${tail} 等 ${list.length - (max - 1)} 项`]
}

// git 非文档提交：业务名 -> 仓库 -> 加工后的条目（同业务多仓库归并，保留仓库归属）
function groupCommitsByProject(gitData: any): Map<string, Map<string, string[]>> {
  const map = new Map<string, Map<string, string[]>>()
  if (!gitData?.commits) return map
  for (const c of gitData.commits || []) {
    const docFiles = (c.files || []).filter((f: any) => f.isDoc && f.path && f.status !== 'D')
    if (docFiles.length > 0) continue // 文档提交归入「文档更新」分组
    const { label, repo } = resolveBusiness(c.repo)
    const raw = c.message || '无描述'
    if (isNoise(raw)) continue
    const item = rewriteCommit(raw)
    if (!map.has(label)) map.set(label, new Map())
    const repoMap = map.get(label)!
    if (!repoMap.has(repo)) repoMap.set(repo, [])
    repoMap.get(repo)!.push(item)
  }
  for (const repoMap of map.values()) {
    for (const [repo, items] of repoMap) repoMap.set(repo, mergeGroup(items))
  }
  return map
}

// git 文档提交：按项目产出「完善 {项目} 文档：文件名…」，全局合并；同名文件按项目独立去重（跨仓库不串）
function collectDocItems(gitData: any): string[] {
  const byProject = new Map<string, string[]>()
  const seenByProject = new Map<string, Set<string>>()
  if (!gitData?.commits) return []
  for (const c of gitData.commits || []) {
    const project = extractProjectName(c.repo)
    const docFiles = (c.files || []).filter((f: any) => f.isDoc && f.path && f.status !== 'D')
    if (docFiles.length === 0) continue
    if (!byProject.has(project)) byProject.set(project, [])
    if (!seenByProject.has(project)) seenByProject.set(project, new Set())
    const seen = seenByProject.get(project)!
    for (const f of docFiles) {
      const name = toPosixPath(f.path || '').split('/').pop() || ''
      if (!name || seen.has(name)) continue
      seen.add(name)
      byProject.get(project)!.push(name.replace(/\.md$/i, ''))
    }
  }
  const items: string[] = []
  for (const [project, names] of byProject) {
    if (names.length === 0) continue
    const n = names.length > 4 ? [...names.slice(0, 4), `等 ${names.length - 4} 个文档`] : names
    items.push(`完善 ${project} 文档：${n.join('、')}`)
  }
  return mergeGroup(items, 6)
}

// AI 会话：业务名 -> 仓库 -> 标题加工（仓库名与 git 同源解析，保证会话与提交落到同一业务 L1）
function groupSessionsByProject(opencodeData: any): Map<string, Map<string, string[]>> {
  const map = new Map<string, Map<string, string[]>>()
  if (!opencodeData?.sessions) return map
  const skipPattern = CONFIG.generate.sessionSkipPattern
  const toSkip = skipPattern ? new RegExp(skipPattern, 'i') : null
  for (const s of opencodeData.sessions || []) {
    const title = (s.title || '').trim()
    if (!title || (toSkip && toSkip.test(title)) || isNoise(title)) continue
    const { label, repo: rRepo } = resolveBusiness(s.directory || s.project || '')
    const repo = label === '其他' ? '' : rRepo
    const item = rewriteSession(title)
    if (!map.has(label)) map.set(label, new Map())
    const repoMap = map.get(label)!
    if (!repoMap.has(repo)) repoMap.set(repo, [])
    repoMap.get(repo)!.push(item)
  }
  for (const repoMap of map.values()) {
    for (const [repo, items] of repoMap) repoMap.set(repo, mergeGroup(items))
  }
  return map
}

// ===== 飞书消息：已下沉到 agent 分析层（自然语言归一），规则引擎兜底不再自动接入聊天 =====

// ===== 分类与合并（分类结构来自模板，无写死映射）=====

type GroupMap = Map<string, Map<string, string[]>> // 分类标题 -> 桶key(label+repo) -> 条目

// 桶 key 编码业务名与仓库归属；伪桶（任务/文档更新）不含仓库段
const BUCKET_SEP = '\u0001'
const bucketKey = (label: string, repo: string) => (repo ? `${label}${BUCKET_SEP}${repo}` : label)
const bucketLabel = (key: string) => (key.includes(BUCKET_SEP) ? key.slice(0, key.indexOf(BUCKET_SEP)) : key)

// 通用归类规则：业务桶（多仓库可三级的 label+repo）→ 第一个分类；
// 任务/消息 → 第一个分类的「任务」桶（仅飞书任务，聊天由 AI 分析层归一后写入 report.json）；
// 文档/笔记 → 第二个分类的「文档更新」桶
function mergeSources(
  gitBuckets: Map<string, Map<string, string[]>>,
  sessionBuckets: Map<string, Map<string, string[]>>,
  tasksCompleted: string[],
  docItems: string[],
  template: string,
): GroupMap {
  const cats = parseTemplateCategories(template)
  const mainCat = cats[0] || '__plain__'
  const docsCat = cats.length >= 2 ? cats[1] : mainCat

  const result: GroupMap = new Map()
  const ensure = (cat: string, bucket: string): string[] => {
    if (!result.has(cat)) result.set(cat, new Map())
    const catMap = result.get(cat)!
    if (!catMap.has(bucket)) catMap.set(bucket, [])
    return catMap.get(bucket)!
  }
  const addBuckets = (maps: Map<string, Map<string, string[]>>) => {
    for (const [label, repoMap] of maps) {
      for (const [repo, items] of repoMap) {
        ensure(mainCat, bucketKey(label, repo)).push(...items)
      }
    }
  }

  addBuckets(gitBuckets)
  addBuckets(sessionBuckets)

  const taskItems: string[] = []
  for (const t of tasksCompleted) {
    const clean = t.trim().replace(/[。.;；]+$/, '')
    if (clean) taskItems.push(clean)
  }
  if (taskItems.length > 0) ensure(mainCat, '任务').push(...taskItems)
  if (docItems.length > 0) {
    ensure(docsCat, '文档更新').push(...docItems)
  }

  // 每个桶：跨源最终合并（归一化去重 + 包含合并）
  for (const catMap of result.values()) {
    for (const [bucket, items] of catMap) {
      catMap.set(bucket, mergeGroup(items, bucket === '文档更新' ? 6 : 4))
    }
  }
  return result
}

// ===== 结构化输出（title/level/text）=====

function buildCompletedLines(merged: GroupMap, template: string): ReportLine[] {
  const lines: ReportLine[] = []
  const cats = parseTemplateCategories(template)
  if (cats.length === 0) {
    const plain = merged.get('__plain__')
    if (plain) appendBucketLines(lines, plain)
    return lines
  }

  for (const catTitle of cats) {
    const catMap = merged.get(catTitle) || new Map<string, string[]>()
    if (catMap.size === 0) continue
    lines.push({ title: true, text: catTitle })
    appendBucketLines(lines, catMap)
  }
  return lines
}

// 业务桶排版：同业务多仓库 → 三级（业务名/仓库/条目）；单仓库或伪桶 → 两级（业务名/条目）
function appendBucketLines(lines: ReportLine[], catMap: Map<string, string[]>): void {
  const byLabel = new Map<string, Array<{ repo: string; items: string[] }>>()
  for (const [key, items] of catMap) {
    const label = bucketLabel(key)
    const repo = key.includes(BUCKET_SEP) ? key.slice(key.indexOf(BUCKET_SEP) + 1) : ''
    if (!byLabel.has(label)) byLabel.set(label, [])
    byLabel.get(label)!.push({ repo, items })
  }
  for (const [label, entries] of byLabel) {
    const multiRepo = new Set(entries.filter(e => e.repo).map(e => e.repo.toLowerCase())).size > 1
    if (multiRepo) {
      lines.push({ level: 1, text: label })
      for (const e of entries) {
        lines.push({ level: 2, text: e.repo })
        for (const item of e.items) lines.push({ level: 3, text: item })
      }
    } else {
      lines.push({ level: 1, text: label })
      for (const e of entries) for (const item of e.items) lines.push({ level: 2, text: item })
    }
  }
}

function buildPlainLines(lines: string[]): ReportLine[] {
  return lines.filter(Boolean).map(text => ({ level: 1, text }))
}

function generateUncompletedLines(tasks: { inProgress: string[] }): ReportLine[] {
  if (tasks.inProgress.length === 0) return []
  return tasks.inProgress.slice(0, 5).map(t => ({ level: 1, text: `${t} 进行中` }))
}

function generateNextPlanLines(projects: string[], tasks: { inProgress: string[] }): ReportLine[] {
  const plans: string[] = []
  for (const t of tasks.inProgress.slice(0, 4)) plans.push(`继续推进 ${t}`)
  for (const p of projects.slice(0, 4)) {
    const key = normalizeKey(p)
    const already = plans.some(x => normalizeKey(x).includes(key))
    if (!already) plans.push(`继续推进 ${p} 相关工作`)
  }
  const dedupKeys = new Set<string>()
  const unique = plans.filter(p => {
    const k = normalizeKey(p)
    if (dedupKeys.has(k)) return false
    dedupKeys.add(k)
    return true
  })
  return buildPlainLines(unique.slice(0, 8))
}

function generateReflectionLines(projects: string[]): ReportLine[] {
  const list = Array.from(new Set(projects)).slice(0, 3).join('、')
  const text = list ? `本周聚焦 ${list} 相关工作，持续推进并按计划交付` : '保持稳定推进节奏，持续产出并按计划交付'
  return [{ level: 1, text }]
}

function generateReportRuleBased(data: ReportData, openId: string, template: string): ReportContent {
  const tasks = analyzeTasks(data.tasks || {})
  const gitProjects = groupCommitsByProject(data.git)
  const docItems = collectDocItems(data.git)
  const sessions = groupSessionsByProject(data.opencode)
  const noteItems = (data.notes?.workSummary || []).map((n: string) => n.replace(/^\[.*?\]\s*/, '')).filter(Boolean)

  const merged = mergeSources(gitProjects, sessions, [...tasks.completed, ...noteItems], docItems, template)
  const completed = buildCompletedLines(merged, template)

  const projects: string[] = []
  for (const catMap of merged.values()) {
    for (const key of catMap.keys()) {
      const label = bucketLabel(key)
      if (label !== '文档更新' && label !== '任务') projects.push(label)
    }
  }

  return {
    completed,
    uncompleted: generateUncompletedLines(tasks),
    nextPlan: generateNextPlanLines(projects, tasks),
    help: [],
    reflection: generateReflectionLines(projects),
  }
}

function analyzeTasks(tasks: any): { completed: string[]; inProgress: string[] } {
  const completed: string[] = []
  const inProgress: string[] = []
  if (!tasks) return { completed, inProgress }
  for (const task of (tasks.completed || [])) completed.push(task.summary || task.name || '未命名任务')
  for (const task of (tasks.incomplete || [])) inProgress.push(task.summary || task.name || '未命名任务')
  return { completed, inProgress }
}

const WEAK_ITEM_RE = /^(接入并推进日常业务开发|详见 Git|详见 AI|待补充|略)/

function hasContent(report: ReportContent): boolean {
  return report.completed.some(l => !l.title && !WEAK_ITEM_RE.test(l.text) && l.text.length > 3)
}

function emptyReport(): ReportContent {
  return { completed: [], uncompleted: [], nextPlan: [], help: [], reflection: [] }
}

async function generateReport(data: ReportData, openId: string, template: string): Promise<ReportContent> {
  console.log('🤖 开始生成周报内容...')
  console.log('📄 使用通用规则引擎生成周报内容（数据驱动，无业务映射）...')
  const report = generateReportRuleBased(data, openId, template)
  if (!hasContent(report)) {
    console.log('⚠️  本周无有效工作数据，返回空报告')
    return emptyReport()
  }
  return report
}

// ===== 预览与主流程 =====

function renderPreview(report: ReportContent): string {
  const render = (lines: ReportLine[]): string => lines.map(l => {
    if (l.title) return l.text
    const bullet = l.level === 3 ? '  · ' : l.level === 2 ? '    - ' : '  · '
    return `${bullet}${l.text}`
  }).join('\n')
  const parts = [
    '【本周完成】',
    render(report.completed) || '/',
    '\n【未完成】',
    render(report.uncompleted) || '/',
    '\n【下周计划】',
    render(report.nextPlan) || '/',
    '\n【需要协调】',
    render(report.help) || '/',
    '\n【反思】',
    render(report.reflection) || '/',
  ]
  return parts.join('\n')
}

function main() {
  console.log('🤖 生成周报内容...\n')

  const template = loadTemplate()
  if (template) {
    const cats = parseTemplateCategories(template)
    console.log(`📄 已加载 REPORT_TEMPLATE.md 模板（分类: ${cats.length > 0 ? cats.join(' / ') : '未识别，直接按项目平铺'}）`)
  }

  const collectedData = loadJson('collected-data.json')
  const gitData = loadJson('git-commits.json')
  const aiData = loadJson('ai-data.json')
  const notesData = loadJson('notes-data.json')

  if (!collectedData) {
    console.error('❌ 未找到 collected-data.json，请先运行 collect-lark.ts')
    process.exit(1)
  }

  let openId = process.env.FEISHU_OPEN_ID
  if (!openId) {
    try {
      const output = execSync('lark-cli contact +get-user --as user', { encoding: 'utf-8' })
      const result = JSON.parse(output)
      openId = result?.data?.user?.open_id
    } catch {}
  }

  const reportData: ReportData = {
    ...collectedData,
    git: gitData,
    opencode: aiData,
    notes: notesData,
  }

  generateReport(reportData, openId || '', template).then(report => {
    writeFileSync('report.json', JSON.stringify(report, null, 2))
    console.log('✅ report.json 已生成\n')

    console.log('📋 周报内容预览:')
    console.log('─'.repeat(40))
    console.log(renderPreview(report))
    console.log('─'.repeat(40))
  }).catch(err => {
    console.error('❌ 生成失败:', err.message)
    process.exit(1)
  })
}

main()

export { generateReport, renderPreview }