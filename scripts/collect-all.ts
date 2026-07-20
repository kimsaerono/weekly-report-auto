import { FeishuClient } from './feishu-client.ts'
import { writeFileSync } from 'fs'
import { config } from 'dotenv'

config()

const appId = process.env.FEISHU_APP_ID!
const appSecret = process.env.FEISHU_APP_SECRET!

async function main() {
  const client = new FeishuClient({ appId, appSecret })

  // 检查是否有 user_access_token
  const userToken = await client.getUserToken()
  if (userToken) {
    console.log('✓ 使用用户身份采集（可读取所有群消息）')
  } else {
    console.log('⚠ 无用户 Token，使用机器人身份采集（仅能读取机器人所在群）')
    console.log('  运行 "npx tsx scripts/oauth.ts" 进行用户授权')
  }

  // 时间范围：默认采集本周（周一到至今）
  const now = new Date()
  const dayOfWeek = now.getDay() || 7

  // 如果指定 --last-week 参数，采集本周；否则采集上周
  const thisWeek = !process.argv.includes('--last-week')

  let monday: Date
  if (thisWeek) {
    monday = new Date(now)
    monday.setDate(now.getDate() - dayOfWeek + 1)
  } else {
    // 上周
    monday = new Date(now)
    monday.setDate(now.getDate() - dayOfWeek - 6)
  }
  monday.setHours(0, 0, 0, 0)

  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)

  const startTime = String(Math.floor(monday.getTime() / 1000))
  const endTime = thisWeek ? String(Math.floor(now.getTime() / 1000)) : String(Math.floor(sunday.getTime() / 1000))

  console.log(`采集时间: ${monday.toLocaleDateString()} - ${thisWeek ? '至今' : sunday.toLocaleDateString()}`)

  // 获取群列表
  const chats = await client.getChatList()
  if (chats.length === 0) {
    console.error('获取群列表失败')
    process.exit(1)
  }

  console.log(`找到 ${chats.length} 个群`)

  const allMessages: Array<{ time: string; chatName: string; content: string }> = []

  for (const chat of chats) {
    const msgs = await client.getChatMessages(chat.chat_id, startTime, endTime)
    for (const msg of msgs) {
      if (msg.msg_type === 'text') {
        try {
          const content = JSON.parse(msg.body?.content || '{}').text || ''
          if (content && content.length > 3) {
            const time = msg.create_time ? new Date(Number(msg.create_time) * 1000).toLocaleString('zh-CN') : ''
            allMessages.push({ time, chatName: chat.name || '未命名群', content })
          }
        } catch {}
      }
    }
  }

  console.log(`共 ${allMessages.length} 条文本消息`)

  // 保存到 messages.json 供 analyze.ts 使用
  writeFileSync('messages.json', JSON.stringify(allMessages, null, 2))
  console.log('已保存到 messages.json')

  // 输出消息预览
  allMessages.slice(0, 5).forEach(m => {
    console.log(`[${m.chatName}] ${m.content.substring(0, 50)}`)
  })
}

main()
