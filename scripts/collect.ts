import { FeishuClient } from './feishu-client.ts'

const appId = process.env.FEISHU_APP_ID!
const appSecret = process.env.FEISHU_APP_SECRET!
const openId = process.env.FEISHU_OPEN_ID

if (!openId) {
  console.error('请配置 FEISHU_OPEN_ID')
  process.exit(1)
}

const client = new FeishuClient({ appId, appSecret })

// 本周一到现在的时间范围
const now = new Date()
const monday = new Date(now)
monday.setDate(now.getDate() - now.getDay() + 1)
monday.setHours(0, 0, 0, 0)

const startTime = monday.getTime()
const endTime = now.getTime()

console.log(`采集时间范围: ${new Date(startTime).toLocaleString()} - ${new Date(endTime).toLocaleString()}`)

const messageIds = await client.searchMessages(openId, startTime, endTime)
console.log(`找到 ${messageIds.length} 条消息`)

const messages: string[] = []
for (const id of messageIds) {
  const content = await client.getMessageContent(id)
  if (content) messages.push(content)
}

console.log(`\n=== 消息内容 ===\n`)
console.log(messages.join('\n---\n'))
