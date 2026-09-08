#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'node:url'
import { execSync } from 'child_process'
import { config } from 'dotenv'

config()

const TEMPLATE_PATH = fileURLToPath(new URL('../REPORT_TEMPLATE.md', import.meta.url))

interface ReportData {
  weekRange: { start: string; end: string }
  messages: any[]
  calendar: any[]
  tasks: any
  git?: any
  opencode?: any
  notes?: any
}

interface ReportContent {
  completed: string
  uncompleted: string
  nextPlan: string
  help: string
  reflection: string
}

function loadJson(filePath: string): any {
  // 解析相对于项目根目录的路径
  const rootDir = fileURLToPath(new URL('..', import.meta.url))
  const fullPath = filePath.startsWith('/') ? filePath : `${rootDir}/${filePath}`
  if (!existsSync(fullPath)) return null
  return JSON.parse(readFileSync(fullPath, 'utf-8'))
}

function loadTemplate(): string {
  if (!existsSync(TEMPLATE_PATH)) return ''
  return readFileSync(TEMPLATE_PATH, 'utf-8')
}

// 从模板提取分类结构（一、业务&开发 / 二、团队效能与基础建设）
function parseTemplateCategories(template: string): string[] {
  if (!template) return []
  const cats: string[] = []
  for (const line of template.split('\n')) {
    const m = line.match(/^([一二三四五六七八九十]+)、(.*)$/)
    if (m) cats.push(m[1] + '、' + m[2].trim())
  }
  return cats
}

// 从模板提取分类 -> 关键字（用于项目归类），简化为按分类标题
function parseTemplateCategoryMap(template: string): Map<string, string> {
  const map = new Map<string, string>()
  if (!template) return map
  for (const line of template.split('\n')) {
    const m = line.match(/^([一二三四五六七八九十]+)、(.*)$/)
    if (m) map.set(m[1], m[2].trim())
  }
  return map
}

function analyzeUserMessages(messages: any[], openId: string): Map<string, string[]> {
  const chatMap = new Map<string, string[]>()
  const userMessages = messages.filter(m => m.sender?.id === openId && m.content && m.content.length > 5)

  for (const msg of userMessages) {
    const chat = msg.chat_name || '其他'
    const content = msg.content.trim()
    if (!chatMap.has(chat)) chatMap.set(chat, [])
    chatMap.get(chat)!.push(content)
  }

  return chatMap
}

function analyzeTasks(tasks: any): { completed: string[]; inProgress: string[] } {
  const completed: string[] = []
  const inProgress: string[] = []

  if (!tasks) return { completed, inProgress }

  for (const task of (tasks.completed || [])) {
    completed.push(task.summary || task.name || '未命名任务')
  }

  for (const task of (tasks.incomplete || [])) {
    inProgress.push(task.summary || task.name || '未命名任务')
  }

  return { completed, inProgress }
}

// ===== 核心：业务域映射与聚合逻辑 =====

// 仓库/项目名 -> 业务域映射（一级分组）
const REPO_TO_DOMAIN: Record<string, string> = {
  'mso-pc-admin': '权限系统',
  'agg-admin-web': '权限系统',
  'merchant-pc-admin': '权限系统',
  'login-dev-pc-component': '登录组件',
  'huiwork-web': 'huiwork-web',
  'cross-pay-ui': 'crosspay',
  'crosspay': 'crosspay',
  'hy-templates': '基础建设',
  'hyfe-node-dependencies': '基础建设',
  'svg-factory': '基础建设',
  'bloub': '团队效能',
  'hy-space': '团队效能',
  'hy-sdk': '基础建设',
}

// 大分类映射（二级分组标题）
const DOMAIN_TO_CATEGORY: Record<string, string> = {
  '权限系统': '业务 & 开发',
  '登录组件': '业务 & 开发',
  'huiwork-web': '业务 & 开发',
  'mso': '业务 & 开发',
  'crosspay': '业务 & 开发',
  'hy-templates': '团队效能与基础建设',
  'hyfe-node-dependencies': '团队效能与基础建设',
  'svg-factory': '团队效能与基础建设',
  '团队效能': '团队效能与基础建设',
  '基础建设': '团队效能与基础建设',
}

// 提交/会话标题 -> 领域的二级分组（用于同域内的条目归类）
// 仅当该仓库有多个子业务时才用到（如 mso-pc-admin 既有权限又有进件）
const SUB_DOMAIN_RULES: Array<{regex: RegExp, domain: string, sub: string}> = [
  // mso-pc-admin: 既有权限又有进件/预发布
  {regex: /权限|permission|v4menuid|merchantid|loadPagePerm|双入口|来源判断/, domain: 'mso-pc-admin', sub: '权限系统'},
  {regex: /进件|预发布|main 分支/, domain: 'mso-pc-admin', sub: 'mso'},
  // login-dev-pc-component
  {regex: /登录|login|网关|proxy.*login|浮动标签|清空缓存|ElMessage|CSS.*内联/, domain: 'login-dev-pc-component', sub: '登录组件'},
  // huiwork-web
  {regex: /Electron|electron.*打包|mac.*win.*linux/, domain: 'huiwork-web', sub: 'huiwork-web'},
  {regex: /metaclaw|agent.*权限|二开/, domain: 'huiwork-web', sub: 'huiwork-web'},
  // crosspay
  {regex: /crosspay|fix 文件|安全修改/, domain: 'cross-pay-ui', sub: 'crosspay'},
  // bloub
  {regex: /代码库.*分析|知识图谱|AR 方案/, domain: 'bloub', sub: '团队效能'},
  // hy-space
  {regex: /ar\.md|AR 方案/, domain: 'hy-space', sub: '团队效能'},
  {regex: /统一用户中心|登录方向|前端承接/, domain: 'hy-space', sub: '团队效能'},
  // hy-templates: 权限模版、skill、登录包升级、网关代理、依赖、gitignore
  {regex: /模版.*权限|权限注入|skill/, domain: 'hy-templates', sub: 'hy-templates'},
  {regex: /升级.*login|login-dev-pc|网关.*代理|proxy/, domain: 'hy-templates', sub: 'hy-templates'},
  {regex: /hy-sdk|依赖.*调整|gitignore/, domain: 'hy-templates', sub: 'hy-templates'},
  // hyfe-node-dependencies
  {regex: /hy-sdk|依赖.*调整|gitignore/, domain: 'hyfe-node-dependencies', sub: 'hyfe-node-dependencies'},
  // svg-factory
  {regex: /SVG|svg.*下载/, domain: 'svg-factory', sub: 'svg-factory'},
  // agg-admin-web (权限相关)
  {regex: /权限|permission|menu.*id|菜单/, domain: 'agg-admin-web', sub: '权限系统'},
  // merchant-pc-admin: 登录组件相关
  {regex: /登录|login|网关|proxy.*login|私服包|代理/, domain: 'merchant-pc-admin', sub: '登录组件'},
  // merchant-pc-admin: 权限相关
  {regex: /权限|permission|menu.*id|菜单/, domain: 'merchant-pc-admin', sub: '权限系统'},
]

// 噪音过滤：无需出现在周报的提交/会话
const NOISE_PATTERNS: RegExp[] = [
  /^Merge branch/,
  /^Revert/,
  /^(chore|docs|style):/i,
  /^\s*(readme|README|Readme)\b/i,
  /^\s*report\b/i,
  /^\s*greeting\b/i,
  /^\s*Restoring/,
  /^\s*Loading.*skill/,
  /^\s*撰写周报/,
  /^\s*opencode报错/,
  /报错/,
  /错误/,
  /npm.*安装.*报错/,
  /^\s*$/,
  /^更新菜单/,
  /^feat[:：]\s*更新\s*$/,
  /^feat[:：]\s*更新\s+[a-zA-Z]+$/,
  /^chore[:：]\s*补充.*gitignore/,
  /^chore[:：]\s*停止跟踪/,
  /^feat[:：]\s*readme/i,
  /fear:/i,
  /electron.*build/i,
  /^\s*更新\s*$/,
  /^\s*readme\s*$/i,
]

function isNoise(text: string): boolean {
  return NOISE_PATTERNS.some(r => r.test(text))
}

function stripCommitPrefix(msg: string): string {
  return msg
    .replace(/^(feat|fix|docs|refactor|chore|style|test|perf|build)(\([^)]+\))?\s*[:：]\s*/i, '')
    .trim()
}

function extractProjectName(pathOrRepo: string): string {
  if (!pathOrRepo) return '其他'
  const parts = pathOrRepo.split('/').filter(Boolean)
  const ignored = new Set(['workspace', 'hy', 'GitHub', '基建', '汇元', 'folders', 'kim', 'Users', 'home'])
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]
    if (p && !ignored.has(p)) return p
  }
  return parts[parts.length - 1] || '其他'
}

// 根据子域规则把条目归到具体的业务子域
function assignSubDomain(repo: string, text: string): string {
  for (const rule of SUB_DOMAIN_RULES) {
    if (rule.domain === repo && rule.regex.test(text)) {
      return rule.sub
    }
  }
  // 默认用仓库映射的大域
  return REPO_TO_DOMAIN[repo] || '其他'
}

// 按仓库分组 Git 提交
function groupGitByRepo(gitData: any): Map<string, Map<string, string[]>> {
  const map = new Map<string, Map<string, string[]>>() // repo -> subDomain -> items[]
  if (!gitData?.commits) return map

  const docFilesByRepo = new Map<string, Set<string>>()
  for (const c of gitData.commits) {
    const repo = extractProjectName(c.repo)
    for (const f of (c.files || [])) {
      if (!f.isDoc || !f.path) continue
      if (!docFilesByRepo.has(repo)) docFilesByRepo.set(repo, new Set())
      docFilesByRepo.get(repo)!.add(f.path)
    }
    const rawMsg = c.message || '无描述'
    if (isNoise(rawMsg)) continue
    const cleanMsg = stripCommitPrefix(rawMsg)
    if (isNoise(cleanMsg)) continue

    const subDomain = assignSubDomain(repo, cleanMsg)
    if (!map.has(repo)) map.set(repo, new Map())
    const repoMap = map.get(repo)!
    if (!repoMap.has(subDomain)) repoMap.set(subDomain, [])
    repoMap.get(subDomain)!.push(cleanMsg)
  }

  for (const [repo, paths] of docFilesByRepo) {
    if (!map.has(repo)) map.set(repo, new Map())
    const repoMap = map.get(repo)!
    const subDomain = '文档更新'
    if (!repoMap.has(subDomain)) repoMap.set(subDomain, [])
    repoMap.get(subDomain)!.push('更新文档 ' + [...paths].slice(0, 6).join(', '))
  }
  return map
}

// 按项目分组 opencode 会话
function groupOpencodeByProject(opencodeData: any): Map<string, Map<string, string[]>> {
  const map = new Map<string, Map<string, string[]>>()
  if (!opencodeData?.sessions) return map

  const toSkip = /subagent|Explore|Analyze|Load|greeting|Restoring|报错|New session|撰写周报|周报|knowledgeskill/i

  for (const s of opencodeData.sessions || []) {
    const title = (s.title || '').trim()
    if (!title || toSkip.test(title) || isNoise(title)) continue
    const dir = s.directory || ''
    const repo = extractProjectName(dir)
    const subDomain = assignSubDomain(repo, title)
    if (!map.has(repo)) map.set(repo, new Map())
    const repoMap = map.get(repo)!
    if (!repoMap.has(subDomain)) repoMap.set(subDomain, [])
    repoMap.get(subDomain)!.push(title)
  }
  return map
}

// 合并同源数据，去重，输出最终结构
function mergeSources(
  gitByRepo: Map<string, Map<string, string[]>>,
  opencodeByProject: Map<string, Map<string, string[]>>,
  tasksCompleted: string[],
  notes: string[] = []
): Map<string, Map<string, string[]>> { // category -> subDomain -> items[]
  const result = new Map<string, Map<string, string[]>>()

  function addItem(category: string, subDomain: string, item: string) {
    if (!result.has(category)) result.set(category, new Map())
    const catMap = result.get(category)!
    if (!catMap.has(subDomain)) catMap.set(subDomain, [])
    const items = catMap.get(subDomain)!
    // 简单去重：前 30 字符
    const key = item.substring(0, 30)
    if (!items.some(existing => existing.substring(0, 30) === key)) {
      items.push(item)
    }
  }

  // Git 数据
  for (const [repo, subMap] of gitByRepo) {
    for (const [subDomain, items] of subMap) {
      const category = DOMAIN_TO_CATEGORY[subDomain] || (subDomain === 'mso' ? '业务 & 开发' : '业务 & 开发')
      for (const item of items.slice(0, 5)) {
        addItem(category, subDomain, item)
      }
    }
  }

  // Opencode 数据
  for (const [repo, subMap] of opencodeByProject) {
    for (const [subDomain, items] of subMap) {
      const category = DOMAIN_TO_CATEGORY[subDomain] || (subDomain === 'mso' ? '业务 & 开发' : '业务 & 开发')
      for (const item of items.slice(0, 3)) {
        addItem(category, subDomain, item)
      }
    }
  }

  // Lark 任务
  for (const task of tasksCompleted) {
    addItem('业务 & 开发', '其他任务', task)
  }

  // 飞书笔记/随手记
  for (const note of notes) {
    addItem('二、团队效能与基础建设', '随手记', note)
  }

  return result
}

// 格式化输出（分类顺序取自 REPORT_TEMPLATE.md）
function formatSections(merged: Map<string, Map<string, string[]>>, template: string): string {
  const lines: string[] = []
  const cats = parseTemplateCategories(template)
  const categoryOrder = cats.length > 0 ? cats : ['一、业务&开发', '二、团队效能与基础建设']

  // 子域排序：业务 & 开发里的固定顺序
  const bizSubDomains = ['AI', 'Huiworker', '知识库', 'crosspay', '权限系统', '登录组件', 'huiwork-web', 'mso', '用户后台', '其他任务', '文档更新']
  const effSubDomains = ['团队效能', 'hy-templates', 'hyfe-node-dependencies', 'svg-factory', '基础建设']

  for (const catTitle of categoryOrder) {
    const catName = catTitle.replace(/^[一二三四五六七八九十]+、\s*/, '')
    const catMap = merged.get(catName) || new Map<string, string[]>()
    if (catMap.size === 0) continue

    lines.push('一、业务 & 开发'.startsWith(catTitle) ? catTitle.replace('业务&开发', '业务 & 开发').replace('团队效能与基础建设', '团队效能与基础建设') : catTitle)

    const subDomains = catName.includes('业务') ? bizSubDomains : effSubDomains

    let projectIdx = 0
    for (const sub of subDomains) {
      const items = catMap.get(sub)
      if (!items || items.length === 0) continue
      projectIdx++
      lines.push(`  ${projectIdx}. ${sub}`)
      items.slice(0, 4).forEach((item, ii) => {
        lines.push(`    ${['a', 'b', 'c', 'd'][ii]}. ${item}`)
      })
    }
  }

  if (lines.length === 0) {
    lines.push('一、业务 & 开发')
    lines.push('  1. 接入并推进日常业务开发，详见 Git 提交与 AI 会话记录')
  }

  return lines.join('\n')
}

function generateUncompletedSection(tasks: { inProgress: string[] }): string {
  if (tasks.inProgress.length === 0) return '/'
  return tasks.inProgress.slice(0, 5).map(t => `${t} 进行中`).join('\n')
}

// 子域 -> 下周计划措辞（参照 REPORT_TEMPLATE.md 的简洁风格）
const NEXT_PLAN_VERBS: Record<string, string> = {
  'AI': '推进 AI 相关项目落地与垂直领域探索',
  'Huiworker': '推进 Huiworker 客户端调研与开发',
  '知识库': '推进知识库与对话模块能力建设',
  'crosspay': '继续 crosspay 前端迭代与支付对接',
  '权限系统': '继续权限系统相关功能开发与维护',
  '登录组件': '推进登录组件持续优化与升级',
  'huiwork-web': '推进 huiwork-web Electron 客户端维护',
  'mso': '推进 mso 进件运营后台更新',
  '用户后台': '推进用户后台项目沟通',
  'hy-templates': '推进 hy-templates 模板更新与权限功能注入',
  'hyfe-node-dependencies': '继续 node 依赖包维护与升级',
  'svg-factory': '推进 svg-factory 下载与操作优化',
  '团队效能': '推进知识库与飞书桥接能力建设、skills 平台维护',
  '基础建设': '推进基础建设相关事项',
  '其他任务': '推进日常业务开发与任务维护',
}

function generateNextPlanSection(
  merged: Map<string, Map<string, string[]>>,
  tasks: { inProgress: string[] }
): string {
  const plans: string[] = []

  // 1) 进行中的任务优先
  for (const t of tasks.inProgress.slice(0, 4)) {
    plans.push(`继续推进 ${t}`)
  }

  // 2) 基于本周完成的业务子域推导下周继续方向（保持模板式一句一行，无编号）
  const NEXT_PLAN_ORDER = ['AI', 'Huiworker', '知识库', 'crosspay', '权限系统', '登录组件', 'huiwork-web', 'mso', '用户后台', 'hy-templates', 'hyfe-node-dependencies', 'svg-factory', '团队效能', '基础建设', '其他任务']
  const subSet = new Set<string>()
  for (const [, subMap] of merged) {
    for (const sub of subMap.keys()) subSet.add(sub)
  }
  const orderedSubs = NEXT_PLAN_ORDER.filter(sub => subSet.has(sub))

  for (const sub of orderedSubs) {
    const plan = NEXT_PLAN_VERBS[sub]
    if (plan) plans.push(plan)
  }

  return plans.slice(0, 8).join('\n') || '继续推进进行中的任务'
}

function generateReport(data: ReportData, openId: string, template: string): ReportContent {
  const messages = analyzeUserMessages(data.messages || [], openId)
  const tasks = analyzeTasks(data.tasks || {})
  const gitByRepo = groupGitByRepo(data.git)
  const opencodeByProject = groupOpencodeByProject(data.opencode)
  const noteItems = (data.notes?.workSummary || []).map((n: string) => {
    const m = n.match(/\[飞书笔记\] (.+)/)
    return m ? m[1] : n
  })

  const merged = mergeSources(gitByRepo, opencodeByProject, tasks.completed, noteItems)
  const completed = formatSections(merged, template)
  const uncompleted = generateUncompletedSection(tasks)
  const nextPlan = generateNextPlanSection(merged, tasks)

  return {
    completed,
    uncompleted,
    nextPlan,
    help: '/',
    reflection: '本周聚焦核心业务推进与基础建设，多项目并行，保持提交粒度与联调节奏'
  }
}

function main() {
  console.log('🤖 生成周报内容...\n')

  const template = loadTemplate()
  if (template) {
    const cats = parseTemplateCategories(template)
    console.log(`📄 已加载 REPORT_TEMPLATE.md 模板（分类: ${cats.length > 0 ? cats.join(' / ') : '未识别，使用默认分类'}）`)
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

  if (!openId) {
    console.error('❌ 无法获取 OpenID')
    process.exit(1)
  }

  const reportData: ReportData = {
    ...collectedData,
    git: gitData,
    opencode: aiData,
    notes: notesData
  }

  const report = generateReport(reportData, openId, template)

  writeFileSync('report.json', JSON.stringify(report, null, 2))
  console.log('✅ report.json 已生成\n')

  console.log('📋 周报内容预览:')
  console.log('─'.repeat(40))
  console.log('【本周完成】')
  console.log(report.completed.substring(0, 800) + (report.completed.length > 800 ? '...' : ''))
  console.log('\n【未完成】')
  console.log(report.uncompleted)
  console.log('\n【下周计划】')
  console.log(report.nextPlan)
  console.log('\n【需要协调】')
  console.log(report.help)
  console.log('\n【反思】')
  console.log(report.reflection)
  console.log('─'.repeat(40))
}

main()