#!/usr/bin/env node
import { LarkCLI } from './lark-cli-wrapper.ts'
import { getWeekRange, formatTimestamp } from './time-utils.ts'
import { writeFileSync } from 'fs'

console.log('🚀 使用 Lark CLI 采集数据...\n')

const { start, end, startStr, endStr } = getWeekRange()
console.log(`📅 时间范围: ${startStr} - ${endStr}\n`)

const startTime = formatTimestamp(start)
const endTime = formatTimestamp(end)

const data: any = {
  weekRange: { start: startStr, end: endStr },
  collectedAt: new Date().toISOString(),
}

console.log('📨 采集消息...')
try {
  const result = LarkCLI.getMessages({ startTime, endTime, limit: 100 })
  data.messages = result?.data?.messages || []
  console.log(`✅ ${data.messages.length} 条消息\n`)
} catch (error: any) {
  console.log(`⚠️  消息采集失败: ${error.message}\n`)
  data.messages = []
}

console.log('📅 采集日历...')
try {
  const result = LarkCLI.getCalendarEvents({ startTime, endTime })
  data.calendar = result?.data?.items || []
  console.log(`✅ ${data.calendar.length} 个事件\n`)
} catch (error: any) {
  console.log(`⚠️  日历采集失败: ${error.message}\n`)
  data.calendar = []
}

console.log('✅ 采集任务...')
try {
  const completedResult = LarkCLI.getTasks({ status: 'completed' })
  const incompleteResult = LarkCLI.getTasks({ status: 'incomplete' })
  data.tasks = {
    completed: completedResult?.data?.items || [],
    incomplete: incompleteResult?.data?.items || [],
  }
  console.log(`✅ 已完成: ${data.tasks.completed.length}, 进行中: ${data.tasks.incomplete.length}\n`)
} catch (error: any) {
  console.log(`⚠️  任务采集失败: ${error.message}\n`)
  data.tasks = { completed: [], incomplete: [] }
}

writeFileSync('collected-data.json', JSON.stringify(data, null, 2))
console.log('✅ 数据采集完成！\n📁 数据已保存到 collected-data.json')
