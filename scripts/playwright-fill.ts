// npm run fill 独立入口：解析内容（report.json → template.md → 环境变量），复用 scripts/oa-fill.ts 共享填单逻辑
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { fillReportToOA } from './oa-fill.ts'

config()

const TEMPLATE_PATH = fileURLToPath(new URL('../template.md', import.meta.url))
const REPORT_JSON_PATH = fileURLToPath(new URL('../report.json', import.meta.url))

interface ReportContent {
  completed?: any
  uncompleted?: any
  nextPlan?: any
  help?: any
  reflection?: any
}

// 解析 report.json（由 generate-report.ts 生成，结构化数组；兼容旧字符串）
function parseReportJson(reportPath: string): ReportContent | null {
  if (!existsSync(reportPath)) return null
  try {
    const data = JSON.parse(readFileSync(reportPath, 'utf-8'))
    const norm = (v: any): any => {
      if (Array.isArray(v)) return v.map((l: any) => (typeof l === 'string' ? { level: 1, text: l } : l))
      return v || ''
    }
    return {
      completed: norm(data.completed),
      uncompleted: norm(data.uncompleted),
      nextPlan: norm(data.nextPlan),
      help: norm(data.help),
      reflection: norm(data.reflection),
    }
  } catch {
    return null
  }
}

export function parseTemplate(templatePath: string): ReportContent {
  // 优先：report.json（由 generate-report.ts 生成）
  const reportJson = parseReportJson(REPORT_JSON_PATH)
  if (reportJson) {
    console.log('使用 report.json 作为周报内容')
    return reportJson
  }

  if (!existsSync(templatePath)) {
    console.log('template.md 不存在，使用环境变量')
    return {
      completed: process.env.REPORT_COMPLETED || '无',
      uncompleted: process.env.REPORT_UNCOMPLETED || '无',
      nextPlan: process.env.REPORT_NEXT_PLAN || '无',
      help: process.env.REPORT_HELP || '无',
      reflection: process.env.REPORT_REFLECTION || '无',
    }
  }

  const content = readFileSync(templatePath, 'utf-8')

  // 定义标题到字段的映射（注意：长关键词要放在前面，避免"未完成"误匹配"完成"）
  const titleMap: Record<string, keyof ReportContent> = {
    '未完成': 'uncompleted',
    '完成': 'completed',
    '计划': 'nextPlan',
    '协调': 'help',
    '反思': 'reflection',
  }

  const result: ReportContent = {
    completed: '无',
    uncompleted: '无',
    nextPlan: '无',
    help: '无',
    reflection: '无',
  }

  // 按 ## 分割内容
  const sections = content.split(/^## /m).slice(1)

  for (const section of sections) {
    const lines = section.split('\n')
    const title = lines[0].trim()

    // 找到匹配的字段
    let fieldKey: keyof ReportContent | null = null
    for (const [keyword, key] of Object.entries(titleMap)) {
      if (title.includes(keyword)) {
        fieldKey = key
        break
      }
    }

    if (fieldKey) {
      // 解析内容：跳过注释行和空行，去掉 - 前缀
      const contentLines = lines.slice(1)
        .filter(line => !line.trim().startsWith('<!--'))
        .filter(line => line.trim())
        .map(line => line.replace(/^-\s*/, '').trim())
        .filter(line => line && line !== '-')

      if (contentLines.length > 0) {
        result[fieldKey] = contentLines.join('\n')
      }
    }
  }

  return result
}

const content = parseTemplate(TEMPLATE_PATH)
const preview = (v: any) => {
  if (Array.isArray(v)) return (v.map((l: any) => l?.text || '').join('；') || '无').substring(0, 50)
  return String(v || '无').substring(0, 50)
}
console.log('周报内容:')
console.log('  完成:', preview(content.completed))
console.log('  未完成:', preview(content.uncompleted))
console.log('  计划:', preview(content.nextPlan))
console.log('  协调:', preview(content.help))
console.log('  反思:', preview(content.reflection))

fillReportToOA({ content }).catch(err => {
  console.error('失败:', err.message)
  process.exit(1)
})