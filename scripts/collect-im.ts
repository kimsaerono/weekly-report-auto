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

  // 本周时间范围
  const now = new Date()
  const monday = new Date(now)
  monday.setDate(now.getDate() - now.getDay() + 1)
  monday.setHours(0, 0, 0, 0)
  const startTime = String(Math.floor(monday.getTime() / 1000))
  const endTime = String(Math.floor(now.getTime() / 1000))

  console.log(`采集时间范围: ${new Date(Number(startTime) * 1000).toLocaleString()} - ${new Date(endTime * 1000).toLocaleString()}`)

  // 检查是否有 user_access_token
  const userToken = await client.getUserToken()
  if (userToken) {
    console.log('✓ 使用用户身份采集（可读取所有群消息）')
  } else {
    console.log('⚠ 无用户 Token，使用机器人身份采集（仅能读取机器人所在群）')
    console.log('  运行 "npx tsx scripts/oauth.ts" 进行用户授权')
  }

  // 获取群列表
  const chats = await client.getChatList()
  console.log(`找到 ${chats.length} 个群`)

  const allMessages: Array<{ time: string; chatName: string; content: string }> = []

  for (const chat of chats) {
    const msgs = await client.getChatMessages(chat.chat_id, startTime, endTime)
    for (const msg of msgs) {
      // 只保留该用户发送的消息
      if (msg.sender?.sender_id?.open_id === openId && msg.msg_type === 'text') {
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

  console.log(`\n本周你发送了 ${allMessages.length} 条文本消息`)

  // 保存到 messages.json 供 analyze.ts 使用
  writeFileSync('messages.json', JSON.stringify(allMessages, null, 2))
  console.log('已保存到 messages.json')

  // 输出预览
  allMessages.slice(0, 5).forEach(m => {
    console.log(`[${m.chatName}] ${m.content.substring(0, 60)}`)
  })
}

main()
