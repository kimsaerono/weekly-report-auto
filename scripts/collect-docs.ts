import { config } from 'dotenv'
import { writeFileSync } from 'fs'
import { FeishuClient } from './feishu-client.ts'

config()

const appId = process.env.FEISHU_APP_ID!
const appSecret = process.env.FEISHU_APP_SECRET!

const client = new FeishuClient({ appId, appSecret })

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

interface DocMeta {
  doc_token: string
  title: string
  doc_type: string
  owner_id?: string
  create_time?: string
  latest_modify_time?: string
}

async function main() {
  console.log('采集飞书文档...')

  const token = await client.getBestToken()
  const { startTime, endTime } = getWeekRange()

  console.log(`时间范围: ${new Date(Number(startTime) * 1000).toLocaleDateString()} - ${new Date(Number(endTime) * 1000).toLocaleDateString()}`)

  // 使用搜索 API 获取最近编辑的文档（推荐使用用户身份）
  const searchRes = await fetch('https://open.feishu.cn/open-apis/suite/docs-api/search/object', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      search_key: '',
      count: 50,
      offset: 0,
      owner_ids: [],
      chat_ids: [],
      docs_types: [],
    }),
  })
  const searchData = await searchRes.json() as { code: number; data?: { docs_entities?: DocMeta[] }; msg?: string }

  if (searchData.code !== 0) {
    console.log('搜索文档失败:', searchData.msg || '可能需要开通文档权限或使用用户身份授权')
    writeFileSync('docs.json', JSON.stringify([], null, 2))
    return
  }

  const docs = searchData.data?.docs_entities || []

  const weekDocs = docs.filter(d => {
    if (!d.latest_modify_time) return true
    const modTime = Number(d.latest_modify_time)
    return modTime >= Number(startTime) && modTime <= Number(endTime)
  })

  console.log(`共找到 ${weekDocs.length} 个本周编辑的文档`)

  writeFileSync('docs.json', JSON.stringify(weekDocs, null, 2))
  console.log('已保存到 docs.json')

  weekDocs.slice(0, 5).forEach(d => {
    console.log(`  - ${d.title || '(无标题)'}`)
  })
}

main().catch(err => {
  console.error('失败:', err.message)
  process.exit(1)
})
