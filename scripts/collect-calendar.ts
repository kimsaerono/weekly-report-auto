import { config } from 'dotenv'
import { writeFileSync } from 'fs'

config()

const appId = process.env.FEISHU_APP_ID!
const appSecret = process.env.FEISHU_APP_SECRET!

// 获取 tenant_access_token
async function getTenantToken(): Promise<string> {
  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  })
  const data = await res.json() as { tenant_access_token: string }
  return data.tenant_access_token
}

// 获取本周时间范围
function getWeekRange(): { startTime: string; endTime: string } {
  const now = new Date()
  const dayOfWeek = now.getDay() || 7
  
  const monday = new Date(now)
  monday.setDate(now.getDate() - dayOfWeek + 1)
  monday.setHours(0, 0, 0, 0)
  
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)
  
  return {
    startTime: String(Math.floor(monday.getTime() / 1000)),
    endTime: String(Math.floor(sunday.getTime() / 1000)),
  }
}

interface CalendarEvent {
  summary: string
  description?: string
  start_time: string
  end_time: string
  attendees?: Array<{ display_name: string }>
}

async function main() {
  console.log('采集飞书日历事件...')
  
  const token = await getTenantToken()
  const { startTime, endTime } = getWeekRange()
  
  console.log(`时间范围: ${new Date(Number(startTime) * 1000).toLocaleDateString()} - ${new Date(Number(endTime) * 1000).toLocaleDateString()}`)
  
  // 获取日历列表
  const calRes = await fetch('https://open.feishu.cn/open-apis/calendar/v4/calendars', {
    headers: { Authorization: `Bearer ${token}` },
  })
  const calData = await calRes.json() as { code: number; data?: { calendar_list?: Array<{ calendar_id: string; summary: string }> } }
  
  if (calData.code !== 0 || !calData.data?.calendar_list) {
    console.log('无法获取日历列表，可能需要开通日历权限')
    writeFileSync('calendar.json', JSON.stringify([], null, 2))
    return
  }
  
  const allEvents: CalendarEvent[] = []
  
  for (const calendar of calData.data.calendar_list) {
    try {
      const eventRes = await fetch(
        `https://open.feishu.cn/open-apis/calendar/v4/calendars/${calendar.calendar_id}/events?start_time=${startTime}&end_time=${endTime}&page_size=50`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const eventData = await eventRes.json() as { code: number; data?: { items?: CalendarEvent[] } }
      
      if (eventData.code === 0 && eventData.data?.items) {
        allEvents.push(...eventData.data.items)
      }
    } catch (e) {
      // 跳过无权限的日历
    }
  }
  
  console.log(`共找到 ${allEvents.length} 个日历事件`)
  
  // 保存到 calendar.json
  writeFileSync('calendar.json', JSON.stringify(allEvents, null, 2))
  console.log('已保存到 calendar.json')
  
  // 输出预览
  allEvents.slice(0, 5).forEach(e => {
    console.log(`  - ${e.summary || '(无标题)'}`)
  })
}

main().catch(err => {
  console.error('失败:', err.message)
  process.exit(1)
})
