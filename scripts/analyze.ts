import { readFileSync, writeFileSync, existsSync } from 'fs'
import { config } from 'dotenv'

config()

const FEISHU_APP_ID = process.env.FEISHU_APP_ID
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET
const AILY_APP_ID = process.env.FEISHU_AILY_APP_ID
const LLM_API_KEY = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY
const LLM_API_BASE = process.env.LLM_API_BASE || 'https://api.openai.com/v1'
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini'

interface Message {
  time: string
  chatName: string
  content: string
}

interface Report {
  completed: string
  uncompleted: string
  nextPlan: string
  help: string
  reflection: string
}

async function getTenantToken(): Promise<string> {
  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET }),
  })
  const data = await res.json() as { tenant_access_token: string }
  return data.tenant_access_token
}

async function askAily(token: string, messages: Message[]): Promise<string> {
  const prompt = await buildReportPrompt(messages)
  const appId = AILY_APP_ID || FEISHU_APP_ID
  console.log(`使用 app_id: ${appId}`)

  const res = await fetch(`https://open.feishu.cn/open-apis/aily/v1/apps/${appId}/knowledges/ask`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: { content: prompt },
    }),
  })

  const data = await res.json() as any
  if (data.code !== 0) {
    console.error('Aily API 错误:', data)
    throw new Error(`Aily API 返回错误: ${data.msg}`)
  }
  if (data.data?.message?.content) return data.data.message.content
  if (data.data?.status === 'processing') {
    console.log('知识问答处理中，等待结果...')
    return ''
  }
  return JSON.stringify(data.data)
}

async function buildReportPrompt(messages: Message[]): Promise<string> {
  let extra = ''
  try {
    const parts: string[] = []
    if (existsSync('tasks.json')) {
      const tasks = JSON.parse(readFileSync('tasks.json', 'utf-8'))
      const done = (tasks.completed || []).map((t: any) => t.summary)
      if (done.length) parts.push('已完成任务:\n' + done.map((t: string) => `- ${t}`).join('\n'))
    }
    if (existsSync('calendar.json')) {
      const events = JSON.parse(readFileSync('calendar.json', 'utf-8'))
      if (events.length) parts.push('日历事件:\n' + events.map((e: any) => `- ${e.summary}`).join('\n'))
    }
    if (existsSync('docs.json')) {
      const d = JSON.parse(readFileSync('docs.json', 'utf-8'))
      if (d.length) parts.push('编辑的文档:\n' + d.slice(0, 10).map((x: any) => `- ${x.title}`).join('\n'))
    }
    if (parts.length) extra = '\n\n以下是其他数据源（日历、任务、文档），用于辅助分析：\n' + parts.join('\n\n')
  } catch {}

  const messagesText = messages.map(m => `[${m.time}] ${m.chatName}: ${m.content}`).join('\n')

  return `你是一个周报生成助手。请根据以下群聊消息，生成一份工作周报。

要求：
1. 从消息中提取与工作相关的内容，忽略闲聊、表情、链接等无关内容
2. 归纳为以下几个维度：
   - 本周完成工作：列出本周完成的具体工作事项
   - 本周未完成工作及原因：未完成的事项及原因
   - 下周工作计划：下周的计划安排
   - 需要协调与帮助：需要他人协助的事项
   - 学习和反思：本周的学习收获和反思

3. 输出格式必须是 JSON，格式如下：
{
  "completed": "内容1\\n内容2",
  "uncompleted": "内容1\\n内容2",
  "nextPlan": "内容1\\n内容2",
  "help": "内容1\\n内容2",
  "reflection": "内容1\\n内容2"
}

4. 每个维度至少列出 1-3 条内容，条目要精简、有整合、不要原文照搬
5. 内容不要带序号（不要写 1. 2. 3.），直接写内容
6. 只输出 JSON，不要其他内容${extra}

群聊消息：
${messagesText}`
}

async function askLLM(messages: Message[]): Promise<string> {
  const prompt = await buildReportPrompt(messages)

  const res = await fetch(LLM_API_BASE + '/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LLM_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 2000,
    }),
  })

  const data = await res.json() as any
  if (data.error) throw new Error(`LLM API 错误: ${data.error.message || JSON.stringify(data.error)}`)
  return data.choices?.[0]?.message?.content || ''
}

function parseReport(content: string): Report {
  // 尝试从内容中提取 JSON
  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0])
    } catch (e) {
      console.log('JSON 解析失败，使用默认格式')
    }
  }

  // 如果不是 JSON，将内容平均分配到各字段
  const lines = content.split('\n').filter(l => l.trim())
  const chunkSize = Math.ceil(lines.length / 5)

  return {
    completed: lines.slice(0, chunkSize).join('\n'),
    uncompleted: lines.slice(chunkSize, chunkSize * 2).join('\n'),
    nextPlan: lines.slice(chunkSize * 2, chunkSize * 3).join('\n'),
    help: lines.slice(chunkSize * 3, chunkSize * 4).join('\n'),
    reflection: lines.slice(chunkSize * 4).join('\n'),
  }
}

function fallbackReport(messages: Message[]): Report {
  // 读取其他数据源
  let completedTasks: string[] = []
  let pendingTasks: string[] = []
  let calendarEvents: string[] = []
  let docs: string[] = []

  try {
    if (existsSync('tasks.json')) {
      const tasks = JSON.parse(readFileSync('tasks.json', 'utf-8'))
      completedTasks = (tasks.completed || []).map((t: any) => t.summary)
      pendingTasks = (tasks.pending || []).map((t: any) => t.summary)
    }
    if (existsSync('calendar.json')) {
      const events = JSON.parse(readFileSync('calendar.json', 'utf-8'))
      calendarEvents = events.map((e: any) => e.summary || '(无标题)')
    }
    if (existsSync('docs.json')) {
      const d = JSON.parse(readFileSync('docs.json', 'utf-8'))
      docs = d.map((x: any) => x.title || '(无标题)').slice(0, 10)
    }
  } catch {}

  // 按语义分类消息
  const categories = {
    completed: [] as string[],
    uncompleted: [] as string[],
    nextPlan: [] as string[],
    help: [] as string[],
    reflection: [] as string[],
  }

  const completeKeywords = ['完成', '上线', '发布', '部署', '提测', '合并', '修复了', '解决了', '搞定了', '做好了', '已经', '已提交', '已合并', '已部署', '已上线', '测试通过', '验收通过', '搞定', '搞完', '做完', '弄完']
  const uncompleteKeywords = ['没完成', '还没', '未完成', '来不及', '卡在', '阻塞', '延期', '推迟', '下周再', '还没搞', '没做完', '暂停']
  const planKeywords = ['计划', '打算', '下周', '接下来', '安排', '准备做', '要搞', '需要做', '后续', '待办']
  const helpKeywords = ['求助', '帮忙', '协助', '谁可以', '能不能', '需要支持', '拉会', '一起', '帮我看', '请教', '怎么搞', '不知道']
  const reflectionKeywords = ['学到', '发现', '原来', '总结', '反思', '优化', '重构', '改进', '文档', '方案', '设计', '思考', '考虑', '讨论', '确认', '了解']

  for (const m of messages) {
    const c = m.content
    if (c.includes('@_all') || c.length < 6) continue

    // 去除链接、纯转发等噪音
    const clean = c.replace(/https?:\/\/\S+/g, '').trim()
    if (clean.length < 4) continue

    // 按关键词分类 (一条消息可能归属多个类别)
    const lower = c.toLowerCase()
    if (completeKeywords.some(k => lower.includes(k))) {
      categories.completed.push(clean)
    }
    if (uncompleteKeywords.some(k => lower.includes(k))) {
      categories.uncompleted.push(clean)
    }
    if (planKeywords.some(k => lower.includes(k))) {
      categories.nextPlan.push(clean)
    }
    if (helpKeywords.some(k => lower.includes(k))) {
      categories.help.push(clean)
    }
    if (reflectionKeywords.some(k => lower.includes(k))) {
      categories.reflection.push(clean)
    }

    // 通用工作关键词：也归入已完成
    const workKeywords = ['bug', '需求', '开发', '对接', '接口', '联调', '测试', 'review', '方案', '迭代', '项目', '功能', '分支', 'pr', 'commit', 'push', '代码', '配置']
    if (workKeywords.some(k => lower.includes(k))) {
      categories.completed.push(clean)
    }
  }

  // 去重辅助函数
  const unique = (arr: string[]) => {
    const seen = new Set<string>()
    return arr.filter(x => {
      const key = x.slice(0, 20)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  // 最多取 8 条消息
  const take = (arr: string[], n: number) => unique(arr).slice(0, n)

  // 整理"本周完成"：任务优先 + 消息归类
  const completedParts: string[] = []
  for (const task of completedTasks.slice(0, 15)) {
    completedParts.push(task)
  }
  for (const msg of take(categories.completed, 8)) {
    if (!completedParts.some(p => p.includes(msg.slice(0, 15)))) {
      completedParts.push(msg)
    }
  }

  // 整理日历（作为工作内容补充）
  const eventParts = calendarEvents.map((e: string) => `参加「${e}」`)

  // 去重合并
  const dedup = (items: string[]) => {
    const seen = new Set<string>()
    return items.filter(x => {
      const key = x.slice(0, 10)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  return {
    completed: dedup([...completedParts, ...eventParts]).join('\n') || '本周无明确工作记录',
    uncompleted: take(categories.uncompleted, 5).join('\n') || '（待补充）',
    nextPlan: [...take(categories.nextPlan, 5), ...pendingTasks.slice(0, 5)].join('\n') || '（待补充）',
    help: take(categories.help, 5).join('\n') || '（待补充）',
    reflection: [...take(categories.reflection, 5), ...take(docs, 5)].join('\n') || '（待补充）',
  }
}

async function main() {
  const messagesPath = process.argv[2] || 'messages.json'

  if (!existsSync(messagesPath)) {
    console.error(`消息文件不存在: ${messagesPath}`)
    process.exit(1)
  }

  const messages: Message[] = JSON.parse(readFileSync(messagesPath, 'utf-8'))
  console.log(`读取 ${messages.length} 条消息`)

  let report: Report

  try {
    console.log('获取飞书 token...')
    const token = await getTenantToken()
    console.log('调用飞书知识问答 API...')
    const content = await askAily(token, messages)
    console.log('解析周报内容...')
    report = parseReport(content)
  } catch (e) {
    if (LLM_API_KEY) {
      try {
        console.log(`Aily 失败，尝试 LLM API (${LLM_MODEL})...`)
        const content = await askLLM(messages)
        report = parseReport(content)
        console.log('✓ LLM 分析成功')
      } catch (llmErr) {
        console.log(`\n⚠ LLM 也失败（${llmErr instanceof Error ? llmErr.message : '未知错误'}），使用本地关键词提取兜底`)
        report = fallbackReport(messages)
      }
    } else {
      console.log(`\n⚠ AI 分析失败（${e instanceof Error ? e.message : '未知错误'}），使用本地关键词提取兜底`)
      console.log('  提示: 配置 LLM_API_KEY 可使用 AI 分析')
      report = fallbackReport(messages)
    }
  }

  const outputPath = 'report.json'
  writeFileSync(outputPath, JSON.stringify(report, null, 2))
  console.log(`周报已保存到 ${outputPath}`)

  // 输出周报内容供检查
  console.log('\n生成的周报内容:')
  console.log('本周完成:', report.completed.slice(0, 100))
  console.log('未完成:', report.uncompleted)
  console.log('下周计划:', report.nextPlan)
  console.log('需要协调:', report.help)
  console.log('学习反思:', report.reflection)
}

main().catch(err => {
  console.error('失败:', err.message)
  process.exit(1)
})
