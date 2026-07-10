import { FeishuClient } from './feishu-client.ts'

const appId = process.env.FEISHU_APP_ID!
const appSecret = process.env.FEISHU_APP_SECRET!

const client = new FeishuClient({ appId, appSecret })
const token = await client.getTenantToken()

// 本周时间范围
const now = new Date()
const monday = new Date(now)
monday.setDate(now.getDate() - now.getDay() + 1)
monday.setHours(0, 0, 0, 0)
const startTime = String(Math.floor(monday.getTime() / 1000))
const endTime = String(Math.floor(now.getTime() / 1000))

// 获取群列表
const chatsRes = await fetch('https://open.feishu.cn/open-apis/im/v1/chats?page_size=50', {
  headers: { 'Authorization': `Bearer ${token}` }
})
const chatsData = await chatsRes.json() as { code: number; data?: { items?: Array<{ chat_id: string; name: string }> } }

if (chatsData.code !== 0 || !chatsData.data?.items) {
  console.error('获取群列表失败')
  process.exit(1)
}

const allMessages: string[] = []

for (const chat of chatsData.data.items) {
  const chatName = chat.name || '未命名群'
  const msgRes = await fetch(
    `https://open.feishu.cn/open-apis/im/v1/messages?container_id_type=chat&container_id=${chat.chat_id}&start_time=${startTime}&end_time=${endTime}&page_size=50`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  )
  const msgData = await msgRes.json() as { code: number; data?: { items?: Array<{ body?: { content?: string }; msg_type?: string }> } }

  if (msgData.code === 0 && msgData.data?.items) {
    for (const msg of msgData.data.items) {
      if (msg.msg_type === 'text') {
        try {
          const content = JSON.parse(msg.body?.content || '{}').text || ''
          if (content && content.length > 5) {
            allMessages.push(`[${chatName}] ${content}`)
          }
        } catch {}
      }
    }
  }
}

console.log(`本周共 ${allMessages.length} 条文本消息:\n`)
console.log(allMessages.join('\n'))
