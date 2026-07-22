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
}

interface ReportContent {
  completed: string
  uncompleted: string
  nextPlan: string
  help: string
  reflection: string
}

function loadJson(filePath: string): any {
  if (!existsSync(filePath)) return null
  return JSON.parse(readFileSync(filePath, 'utf-8'))
}

function loadTemplate(): string {
  if (!existsSync(TEMPLATE_PATH)) return ''
  return readFileSync(TEMPLATE_PATH, 'utf-8')
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

function analyzeGit(gitData: any): string[] {
  if (!gitData?.commits) return []

  return gitData.commits.map((c: any) => c.message || '无描述')
}

function extractProjectFromMessage(content: string): string | null {
  const projectPatterns = [
    /(?:完成|实现|优化|推进|开发|修复|新增|调整)(.+?)(?:功能|模块|页面|接口|组件|配置)/,
    /(?:项目|任务|需求|特性)[：:]\s*(.+?)(?:\s|$)/,
    /^[A-Za-z0-9_-]+/,
  ]

  for (const pattern of projectPatterns) {
    const match = content.match(pattern)
    if (match) return match[1] || match[0]
  }

  return content.substring(0, 30)
}

function generateCompletedSection(
  messages: Map<string, string[]>,
  tasks: { completed: string[] },
  gitItems: string[]
): string {
  const lines: string[] = []

  const verbMap: Record<string, string> = {
    '完成': '完成',
    '实现': '实现',
    '优化': '优化',
    '开发': '开发',
    '修复': '修复',
    '新增': '新增',
    '调整': '调整',
    '推进': '推进',
    '调研': '开展',
    '确认': '确认',
  }

  for (const task of tasks.completed.slice(0, 8)) {
    let verb = '完成'
    for (const [key, val] of Object.entries(verbMap)) {
      if (task.includes(key)) { verb = val; break }
    }
    lines.push(`${verb} ${task}`)
  }

  for (const commit of gitItems.slice(0, 5)) {
    const msg = commit.replace(/^(feat|fix|docs|refactor|chore|style|test):\s*/, '')
    if (!lines.some(l => l.includes(msg.substring(0, 10)))) {
      lines.push(msg)
    }
  }

  if (messages.size > 0) {
    const workKeywords = ['确认', '对齐', '评审', '梳理', '同步', '对接', '沟通']
    for (const [chat, msgs] of messages) {
      for (const msg of msgs.slice(0, 2)) {
        for (const kw of workKeywords) {
          if (msg.includes(kw)) {
            const short = msg.substring(0, 50).replace(/\n/g, ' ')
            if (!lines.some(l => l.includes(short.substring(0, 10)))) {
              lines.push(short)
            }
            break
          }
        }
      }
    }
  }

  if (lines.length === 0) {
    lines.push('本周进行了日常工作沟通和任务处理')
  }

  return lines.join('\n')
}

function generateUncompletedSection(tasks: { inProgress: string[] }): string {
  if (tasks.inProgress.length === 0) return '无'

  return tasks.inProgress.slice(0, 5).map(t => `${t} 进行中`).join('\n')
}

function generateNextPlanSection(tasks: { inProgress: string[] }): string {
  if (tasks.inProgress.length === 0) return '继续推进进行中的任务'

  return tasks.inProgress.slice(0, 4).map(t => `继续推进 ${t}`).join('\n')
}

function generateReport(data: ReportData, openId: string): ReportContent {
  const messages = analyzeUserMessages(data.messages || [], openId)
  const tasks = analyzeTasks(data.tasks || {})
  const gitItems = analyzeGit(data.git)

  const completed = generateCompletedSection(messages, tasks, gitItems)
  const uncompleted = generateUncompletedSection(tasks)
  const nextPlan = generateNextPlanSection(tasks)

  return {
    completed,
    uncompleted,
    nextPlan,
    help: '无',
    reflection: '本周保持高效沟通，持续推进各项任务'
  }
}

function main() {
  console.log('🤖 生成周报内容...\n')

  const template = loadTemplate()
  if (template) {
    console.log('📄 已加载 REPORT_TEMPLATE.md 模板')
  }

  const collectedData = loadJson('collected-data.json')
  const gitData = loadJson('git-commits.json')

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
    git: gitData
  }

  const report = generateReport(reportData, openId)

  writeFileSync('report.json', JSON.stringify(report, null, 2))
  console.log('✅ report.json 已生成\n')

  console.log('📋 周报内容预览:')
  console.log('─'.repeat(40))
  console.log('【本周完成】')
  console.log(report.completed.substring(0, 300) + (report.completed.length > 300 ? '...' : ''))
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
