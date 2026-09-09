#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'node:url'
import { execSync } from 'child_process'
import { homedir } from 'os'
import { config } from 'dotenv'
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

// 项目名从路径直出：忽略目录结构与本机用户名，其余取最后一段
const USERNAME = (homedir().split('/').pop() || '').toLowerCase()
const IGNORED_DIRS = new Set([...CONFIG.project.skipDirs, USERNAME])

function extractProjectName(pathOrRepo: string): string {
  if (!pathOrRepo) return '其他'
  const parts = pathOrRepo.split('/').filter(Boolean)
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]
    if (p && !IGNORED_DIRS.has(p)) return p
  }
  return parts[parts.length - 1] || '其他'
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

// 归一组内去重 + 包含合并：同组内若一条完整包含另一条（归一化后子串），保留更长一条
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
  return entries.filter(([k]) => !dropped.has(k)).map(([, v]) => v).slice(0, max)
}

// git 非文档提交：项目 -> 加工后的条目（同项目多条聚合）
function groupCommitsByProject(gitData: any): Map<string, string[]> {
  const map = new Map<string, string[]>()
  if (!gitData?.commits) return map
  for (const c of gitData.commits || []) {
    const docFiles = (c.files || []).filter((f: any) => f.isDoc && f.path && f.status !== 'D')
    if (docFiles.length > 0) continue // 文档提交归入「文档更新」分组
    const project = extractProjectName(c.repo)
    const raw = c.message || '无描述'
    if (isNoise(raw)) continue
    const item = rewriteCommit(raw)
    if (!map.has(project)) map.set(project, [])
    map.get(project)!.push(item)
  }
  for (const [project, items] of map) map.set(project, mergeGroup(items))
  return map
}

// git 文档提交：按项目产出「完善 {项目} 文档：文件名…」，全局合并
function collectDocItems(gitData: any): string[] {
  const byProject = new Map<string, string[]>()
  const seenFiles = new Set<string>()
  if (!gitData?.commits) return []
  for (const c of gitData.commits || []) {
    const project = extractProjectName(c.repo)
    const docFiles = (c.files || []).filter((f: any) => f.isDoc && f.path && f.status !== 'D')
    if (docFiles.length === 0) continue
    if (!byProject.has(project)) byProject.set(project, [])
    for (const f of docFiles) {
      const name = (f.path || '').split('/').pop() || ''
      if (seenFiles.has(name)) continue
      seenFiles.add(name)
      byProject.get(project)!.push(name.replace(/\.md$/i, ''))
    }
  }
  const items: string[] = []
  for (const [project, names] of byProject) {
    const n = names.length > 4 ? [...names.slice(0, 4), `等 ${names.length - 4} 个文档`] : names
    items.push(`完善 ${project} 文档：${n.join('、')}`)
  }
  return mergeGroup(items, 6)
}

// AI 会话：项目 -> 标题加工
function groupSessionsByProject(opencodeData: any): Map<string, string[]> {
  const map = new Map<string, string[]>()
  if (!opencodeData?.sessions) return map
  const toSkip = new RegExp(CONFIG.generate.sessionSkipPattern, 'i')
  for (const s of opencodeData.sessions || []) {
    const title = (s.title || '').trim()
    if (!title || toSkip.test(title) || isNoise(title)) continue
    const project = s.project || extractProjectName(s.directory || '')
    const item = rewriteSession(title)
    if (!map.has(project)) map.set(project, [])
    map.get(project)!.push(item)
  }
  for (const [project, items] of map) map.set(project, mergeGroup(items))
  return map
}

// ===== 飞书消息：提取本人发出的工作消息（严格过滤，只保留自述工作状态）=====

const MESSAGE_NOISE_RE = new RegExp(`(${CONFIG.generate.messageNoiseWords.join('|')})`)
// 缺少动词或过短的消息不算
const MESSAGE_STRONG_VERB_RE = new RegExp(`(${CONFIG.generate.messageStrongVerbs.join('|')})`)

function analyzeUserMessages(messages: any[], openId: string): string[] {
  const items: string[] = []
  if (!messages?.length || !openId) return items
  for (const msg of messages) {
    const isMine = msg.sender?.id === openId
    if (!isMine) continue
    const content = (msg.content || '').trim().replace(/@/g, '')
    if (content.length < 8 || content.length > 50) continue
    if (MESSAGE_NOISE_RE.test(content)) continue
    if (!MESSAGE_STRONG_VERB_RE.test(content)) continue
    if (/^(好的|收到|ok|嗯|好|赞|👍|OK|了解|明白|谢谢|图|📖)/i.test(content)) continue
    items.push(content)
  }
  return items
}

// ===== 分类与合并（分类结构来自模板，无写死映射）=====

type GroupMap = Map<string, Map<string, string[]>> // 分类标题 -> 项目 -> 条目

// 通用归类规则：项目/任务/消息 → 第一个分类；文档/笔记 → 第二个分类（若无则并入第一个）
function mergeSources(
  gitProjects: Map<string, string[]>,
  sessions: Map<string, string[]>,
  tasksCompleted: string[],
  workMessages: string[],
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

  for (const [project, items] of gitProjects) {
    const bucket = ensure(mainCat, project)
    bucket.push(...items)
  }
  for (const [project, items] of sessions) {
    const bucket = ensure(mainCat, project)
    bucket.push(...items)
  }
  const taskItems: string[] = []
  for (const t of tasksCompleted) {
    const clean = t.trim().replace(/[。.;；]+$/, '')
    if (clean) taskItems.push(clean)
  }
  for (const msg of workMessages) taskItems.push(msg)
  if (taskItems.length > 0) ensure(mainCat, '任务').push(...taskItems)
  if (docItems.length > 0) {
    ensure(docsCat, '文档更新').push(...docItems)
  }

  // 每个项目桶：跨源最终合并（归一化去重 + 包含合并）
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
    if (plain) {
      for (const [project, items] of plain) {
        lines.push({ level: 1, text: project })
        for (const item of items) lines.push({ level: 2, text: item })
      }
    }
    return lines
  }

  for (const catTitle of cats) {
    const catMap = merged.get(catTitle) || new Map<string, string[]>()
    if (catMap.size === 0) continue
    lines.push({ title: true, text: catTitle })
    for (const [project, items] of catMap) {
      lines.push({ level: 1, text: project })
      for (const item of items) lines.push({ level: 2, text: item })
    }
  }
  return lines
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
  const workMessages = analyzeUserMessages(data.messages || [], openId)
  const noteItems = (data.notes?.workSummary || []).map((n: string) => n.replace(/^\[.*?\]\s*/, '')).filter(Boolean)

  const merged = mergeSources(gitProjects, sessions, tasks.completed, [...workMessages, ...noteItems], docItems, template)
  const completed = buildCompletedLines(merged, template)

  const projects: string[] = []
  for (const catMap of merged.values()) {
    for (const project of catMap.keys()) {
      if (project !== '文档更新' && project !== '任务') projects.push(project)
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
      const output = execSync('lark-cli contact +get-user', { encoding: 'utf-8' })
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