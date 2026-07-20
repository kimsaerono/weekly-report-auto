import { config } from 'dotenv'
import { writeFileSync } from 'fs'
import { FeishuClient } from './feishu-client.ts'

config()

const appId = process.env.FEISHU_APP_ID!
const appSecret = process.env.FEISHU_APP_SECRET!

const client = new FeishuClient({ appId, appSecret })

function getWeekRange(): { startTime: number; endTime: number } {
  const now = new Date()
  const dayOfWeek = now.getDay() || 7

  const monday = new Date(now)
  monday.setDate(now.getDate() - dayOfWeek + 1)
  monday.setHours(0, 0, 0, 0)

  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)

  return {
    startTime: Math.floor(monday.getTime() / 1000),
    endTime: Math.floor(sunday.getTime() / 1000),
  }
}

interface Task {
  task_id: string
  summary: string
  description?: string
  due?: { timestamp: string }
  completed_at?: string
  status: string
  members?: Array<{ id: string; type: string }>
}

async function main() {
  console.log('采集飞书任务...')

  const token = await client.getBestToken()
  const { startTime, endTime } = getWeekRange()

  console.log(`时间范围: ${new Date(startTime * 1000).toLocaleDateString()} - ${new Date(endTime * 1000).toLocaleDateString()}`)

  // 飞书任务 API 推荐使用 user_access_token，用 tenant_token 可能无权限
  const taskRes = await fetch('https://open.feishu.cn/open-apis/task/v2/tasks?page_size=50', {
    headers: { Authorization: `Bearer ${token}` },
  })
  const taskData = await taskRes.json() as { code: number; data?: { items?: Task[] }; msg?: string }

  if (taskData.code !== 0) {
    console.log('获取任务失败:', taskData.msg || '可能需要开通任务权限或使用用户身份授权')
    writeFileSync('tasks.json', JSON.stringify([], null, 2))
    return
  }

  const tasks = taskData.data?.items || []
  console.log(`共找到 ${tasks.length} 个任务`)

  const completedTasks = tasks.filter(t => t.status === 'completed' || t.completed_at)
  const pendingTasks = tasks.filter(t => t.status !== 'completed' && !t.completed_at)

  console.log(`  已完成: ${completedTasks.length} 个`)
  console.log(`  进行中: ${pendingTasks.length} 个`)

  writeFileSync('tasks.json', JSON.stringify({ completed: completedTasks, pending: pendingTasks }, null, 2))
  console.log('已保存到 tasks.json')

  completedTasks.slice(0, 3).forEach(t => {
    console.log(`  ✓ ${t.summary}`)
  })
  pendingTasks.slice(0, 3).forEach(t => {
    console.log(`  ○ ${t.summary}`)
  })
}

main().catch(err => {
  console.error('失败:', err.message)
  process.exit(1)
})
