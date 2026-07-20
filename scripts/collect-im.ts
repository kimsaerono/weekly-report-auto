import { config } from 'dotenv'
import { FeishuClient } from './feishu-client.ts'
import { writeFileSync } from 'fs'

config()

const appId = process.env.FEISHU_APP_ID!
const appSecret = process.env.FEISHU_APP_SECRET!
const openId = process.env.FEISHU_OPEN_ID!

if (!openId) {
  console.error('请配置 FEISHU_OPEN_ID')
  process.exit(1)
}

async function main() {
  const client = new FeishuClient({ appId, appSecret })

  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  sevenDaysAgo.setHours(0, 0, 0, 0)
  const startTime = String(Math.floor(sevenDaysAgo.getTime() / 1000))
  const endTime = String(Math.floor(now.getTime() / 1000))

  console.log(`采集时间范围: ${new Date(Number(startTime) * 1000).toLocaleString()} - ${new Date(endTime * 1000).toLocaleString()}`)

  const userToken = await client.getUserToken()
  if (userToken) {
    console.log('✓ 使用用户身份采集（可读取所有群消息）')
  } else {
    console.log('⚠ 无用户 Token，使用机器人身份采集（仅能读取机器人所在群）')
  }

  const chats = await client.getChatList()
  console.log(`找到 ${chats.length} 个群`)

  const allMessages: Array<{ time: string; chatName: string; content: string }> = []

  for (const chat of chats) {
    const msgs = await client.getChatMessages(chat.chat_id, startTime, endTime)
    for (const msg of msgs) {
      if (msg.sender?.id === openId && msg.msg_type === 'text') {
        try {
          const content = JSON.parse(msg.body?.content || '{}').text || ''
          if (content) {
            const time = msg.create_time ? new Date(Number(msg.create_time) * 1000).toLocaleString('zh-CN') : ''
            allMessages.push({ time, chatName: chat.name || '未命名群', content })
          }
        } catch {}
      }
    }
  }

  console.log(`找到 ${allMessages.length} 条本人发送的文本消息`)

  writeFileSync('messages.json', JSON.stringify(allMessages, null, 2))

  allMessages.slice(0, 5).forEach(m => {
    console.log(`[${m.chatName}] ${m.content.substring(0, 50)}`)
  })
}

main()
