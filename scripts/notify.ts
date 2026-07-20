import { readFileSync, existsSync } from 'fs'

interface ReportContent {
  completed: string
  uncompleted: string
  nextPlan: string
  help: string
  reflection: string
}

function parseTemplate(templatePath: string): ReportContent {
  if (!existsSync(templatePath)) {
    return {
      completed: process.env.REPORT_COMPLETED || '无',
      uncompleted: process.env.REPORT_UNCOMPLETED || '无',
      nextPlan: process.env.REPORT_NEXT_PLAN || '无',
      help: process.env.REPORT_HELP || '无',
      reflection: process.env.REPORT_REFLECTION || '无',
    }
  }

  const content = readFileSync(templatePath, 'utf-8')
  const titleMap: Record<string, keyof ReportContent> = {
    '未完成': 'uncompleted',
    '完成': 'completed',
    '计划': 'nextPlan',
    '协调': 'help',
    '反思': 'reflection',
  }
  const result: ReportContent = { completed: '无', uncompleted: '无', nextPlan: '无', help: '无', reflection: '无' }
  const sections = content.split(/^## /m).slice(1)
  for (const section of sections) {
    const lines = section.split('\n')
    const title = lines[0].trim()
    let fieldKey: keyof ReportContent | null = null
    for (const [keyword, key] of Object.entries(titleMap)) {
      if (title.includes(keyword)) { fieldKey = key; break }
    }
    if (fieldKey) {
      const contentLines = lines.slice(1)
        .filter(line => !line.trim().startsWith('<!--'))
        .filter(line => line.trim())
        .map(line => line.replace(/^-\s*/, '').trim())
        .filter(line => line && line !== '-')
      if (contentLines.length > 0) result[fieldKey] = contentLines.join('\n')
    }
  }
  return result
}

async function sendCard(openId: string, content: ReportContent) {
  const appId = process.env.FEISHU_APP_ID!
  const appSecret = process.env.FEISHU_APP_SECRET!
  const ruleId = process.env.FEISHU_REPORT_RULE_ID!

  const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  })
  const { tenant_access_token: token } = await tokenRes.json() as { tenant_access_token: string }

  const card = {
    elements: [
      { tag: 'markdown', content: `**本周完成工作**\n${content.completed || '（无）'}` },
      { tag: 'markdown', content: `**本周未完成工作及原因**\n${content.uncompleted || '（无）'}` },
      { tag: 'markdown', content: `**下周工作计划**\n${content.nextPlan || '（无）'}` },
      { tag: 'markdown', content: `**需要协调与帮助**\n${content.help || '（无）'}` },
      { tag: 'markdown', content: `**学习和反思**\n${content.reflection || '（无）'}` },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '✏️ 编辑草稿' },
            url: `https://oa.feishu.cn/report/record/detail?ruleId=${ruleId}&routeFrom=/record/list`,
            type: 'default'
          }
        ]
      }
    ],
    header: {
      title: { tag: 'plain_text', content: '本周周报已生成' },
      template: 'blue'
    }
  }

  const body = {
    receive_id: openId,
    msg_type: 'interactive',
    content: JSON.stringify(card)
  }

  const res = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  const data = await res.json() as { code: number }
  if (data.code !== 0) {
    console.error('通知发送失败:', JSON.stringify(data))
    process.exit(1)
  }
  console.log('通知已发送')
}

const TEMPLATE_PATH = new URL('../template.md', import.meta.url).pathname
const REPORT_PATH = new URL('../report.json', import.meta.url).pathname

// 优先使用 report.json（AI 生成的报告），否则退回到 template.md 或环境变量
let content: ReportContent
if (existsSync(REPORT_PATH)) {
  const report = JSON.parse(readFileSync(REPORT_PATH, 'utf-8'))
  content = {
    completed: report.completed || '无',
    uncompleted: report.uncompleted || '无',
    nextPlan: report.nextPlan || '无',
    help: report.help || '无',
    reflection: report.reflection || '无',
  }
} else {
  content = parseTemplate(TEMPLATE_PATH)
}

const openId = process.env.FEISHU_OPEN_ID
if (!openId) {
  console.log('FEISHU_OPEN_ID 未配置，跳过通知')
  process.exit(0)
}
sendCard(openId, content)
