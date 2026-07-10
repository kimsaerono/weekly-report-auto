import { FeishuClient } from './feishu-client.ts'

const appId = process.env.FEISHU_APP_ID!
const appSecret = process.env.FEISHU_APP_SECRET!
const openId = process.env.FEISHU_OPEN_ID!

const client = new FeishuClient({ appId, appSecret })
const token = await client.getTenantToken()

// 获取用户所在的群列表
const chatsRes = await fetch('https://open.feishu.cn/open-apis/im/v1/chats?page_size=50', {
  headers: { 'Authorization': `Bearer ${token}` }
})
const chatsData = await chatsRes.json() as { code: number; data?: { items?: Array<{ chat_id: string; name: string }> } }

if (chatsData.code !== 0 || !chatsData.data?.items) {
  console.error('获取群列表失败:', JSON.stringify(chatsData))
  process.exit(1)
}

console.log(`找到 ${chatsData.data.items.length} 个群`)

// 本周时间范围
const now = new Date()
const monday = new Date(now)
monday.setDate(now.getDate() - now.getDay() + 1)
monday.setHours(0, 0, 0, 0)
const startTime = String(Math.floor(monday.getTime() / 1000))
const endTime = String(Math.floor(now.getTime() / 1000))

const allMessages: string[] = []

for (const chat of chatsData.data.items) {
  const msgRes = await fetch(
    `https://open.feishu.cn/open-apis/im/v1/messages?container_id_type=chat&container_id=${chat.chat_id}&start_time=${startTime}&end_time=${endTime}&page_size=50`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  )
  const msgData = await msgRes.json() as { code: number; data?: { items?: Array<{ body?: { content?: string }; msg_type?: string; sender?: { sender_id?: { open_id?: string } } }> } }

  if (msgData.code === 0 && msgData.data?.items) {
    for (const msg of msgData.data.items) {
      // 只保留该用户发送的消息
      if (msg.sender?.sender_id?.open_id === openId && msg.msg_type === 'text') {
        try {
          const content = JSON.parse(msg.body?.content || '{}').text || ''
          if (content) allMessages.push(`[${chat.name}] ${content}`)
        } catch {}
      }
    }
  }
}

console.log(`\n本周你发送了 ${allMessages.length} 条文本消息:\n`)
console.log(allMessages.join('\n'))
