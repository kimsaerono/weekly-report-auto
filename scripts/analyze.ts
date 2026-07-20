import { readFileSync, writeFileSync, existsSync } from 'fs'
import { config } from 'dotenv'

config()

const FEISHU_APP_ID = process.env.FEISHU_APP_ID
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET
const AILY_APP_ID = process.env.FEISHU_AILY_APP_ID

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
  const messagesText = messages.map(m => `[${m.time}] ${m.chatName}: ${m.content}`).join('\n')

  const prompt = `你是一个周报生成助手。请根据以下群聊消息，生成一份工作周报。

要求：
1. 从消息中提取与工作相关的内容
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

4. 每个维度至少列出 1-3 条内容，每条内容单独一行（用 \\n 分隔）
5. 内容不要带序号（不要写 1. 2. 3.），直接写内容
6. 只输出 JSON，不要其他内容

群聊消息：
${messagesText}`

  // 使用飞书应用的 token 调用 Aily API
  const appId = AILY_APP_ID || FEISHU_APP_ID

  console.log(`使用 app_id: ${appId}`)

  const res = await fetch(`https://open.feishu.cn/open-apis/aily/v1/apps/${appId}/knowledges/ask`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        content: prompt,
      },
    }),
  })

  const data = await res.json() as any

  if (data.code !== 0) {
    console.error('Aily API 错误:', data)
    throw new Error(`Aily API 返回错误: ${data.msg}`)
  }

  // 解析 SSE 响应或直接返回
  if (data.data?.message?.content) {
    return data.data.message.content
  }

  // 如果是 SSE 流式响应，需要特殊处理
  if (data.data?.status === 'processing') {
    console.log('知识问答处理中，等待结果...')
    // 实际项目中需要轮询或使用 SSE 客户端
    return ''
  }

  return JSON.stringify(data.data)
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
  // 过滤掉 @_all 广播、纯表情、过短内容
  const workKeywords = ['完成', '上线', '发布', '部署', '修复', 'bug', '需求', '开发', '对接', '接口', '重构', '优化', '提测', '合并', '联调', '修复', '解决', '推进', 'review', '测试', '设计', '方案', '任务', '迭代']
  const relevant = messages.filter(m => {
    const c = m.content
    if (c.includes('@_all')) return false
    if (c.length < 8) return false
    return workKeywords.some(k => c.toLowerCase().includes(k.toLowerCase()))
  })

  // 提取前 15 条相关工作消息作为"本周完成"
  const completed = relevant.slice(0, 15).map(m => `- ${m.content.replace(/\n/g, ' ').slice(0, 80)}`).join('\n')

  return {
    completed: completed || '本周无明确工作记录',
    uncompleted: '（待补充）',
    nextPlan: '（待补充）',
    help: '（待补充）',
    reflection: '（待补充）',
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
    console.log(`\n⚠ AI 分析失败（${e instanceof Error ? e.message : '未知错误'}），使用本地关键词提取兜底`)
    report = fallbackReport(messages)
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
