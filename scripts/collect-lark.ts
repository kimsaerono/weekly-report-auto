#!/usr/bin/env node
import { execSync } from 'child_process'
import { writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'node:url'
import { getWeekRange, formatTimestamp, isThisWeek } from './time-utils.ts'
import { config } from 'dotenv'
import { prefilterMessages } from './message-filter.ts'

config()

console.log('🚀 使用 lark-cli 采集数据...\n')

const weekOffset = Number(process.env.WEEK_OFFSET || 0)
const { start, end, startStr, endStr } = getWeekRange({ weekOffset })
console.log(`📅 时间范围: ${startStr} - ${endStr}（周偏移: ${weekOffset}）\n`)

const startTimeISO = formatTimestamp(start)
const endTimeISO = formatTimestamp(end)
const startTimeSec = String(Math.floor(start / 1000))
const endTimeSec = String(Math.floor(end / 1000))

function execLarkCli(command: string): any {
  try {
    const result = execSync(`${command} --json`, { encoding: 'utf-8', maxBuffer: 128 * 1024 * 1024 })
    return JSON.parse(result)
  } catch (error: any) {
    console.error(`❌ lark-cli 命令失败: ${command}`)
    return null
  }
}

async function collectData() {
  const data: any = {
    weekRange: { start: startStr, end: endStr },
    collectedAt: new Date().toISOString(),
  }

  // 采集消息（全局搜索，含群聊与私聊，快速）
  console.log('📨 采集消息...')
  try {
    const messages = await collectMessagesGlobal()
    data.messages = messages
    console.log(`✅ ${messages.length} 条消息\n`)
  } catch (error: any) {
    console.log(`⚠️  消息采集失败: ${error.message}\n`)
    data.messages = []
  }

  // 采集日历
  console.log('📅 采集日历...')
  try {
    const events = await collectCalendarEvents()
    data.calendar = events
    console.log(`✅ ${events.length} 个事件\n`)
  } catch (error: any) {
    console.log(`⚠️  日历采集失败: ${error.message}\n`)
    data.calendar = []
  }

  // 采集任务（我分配的 + 我创建的 + 相关的）
  console.log('✅ 采集任务...')
  try {
    const tasks = await collectTasks()
    data.tasks = tasks
    console.log(`✅ 已完成: ${tasks.completed.length}, 进行中: ${tasks.incomplete.length}\n`)
  } catch (error: any) {
    console.log(`⚠️  任务采集失败: ${error.message}\n`)
    data.tasks = { completed: [], incomplete: [] }
  }

  writeFileSync('collected-data.json', JSON.stringify(data, null, 2))
  console.log('✅ 数据采集完成！\n📁 数据已保存到 collected-data.json')

  // 结构预过滤：产出 messages-candidates.json（仅结构规则，零语义）
  const { candidates, stats } = prefilterMessages(data.messages || [])
  writeFileSync('messages-candidates.json', JSON.stringify({ weekRange: data.weekRange, collectedAt: data.collectedAt, stats, messages: candidates }, null, 2))
  console.log(`📨 结构预过滤: 保留 ${stats.kept}/${stats.total} 条候选（其余: 非本人 ${stats.notSelf} / 过短 ${stats.tooShort} / 过长 ${stats.tooLong} / 空 ${stats.empty} / 重复 ${stats.dup} / 上限 ${stats.cap}）`)
}

async function collectMessagesGlobal(): Promise<any[]> {
  const allMessages: any[] = []
  const seenIds = new Set<string>()

  function pushMessage(msg: any) {
    if (!msg || seenIds.has(msg.message_id)) return
    seenIds.add(msg.message_id)
    allMessages.push({
      chat_id: msg.chat_id || '',
      chat_name: msg.chat_name || msg.chat_id?.substring(0, 10) || '未知',
      chat_type: msg.chat_type || msg.chat_mode || 'group',
      content: msg.content || msg.text || '',
      create_time: msg.create_time,
      message_id: msg.message_id,
      sender: {
        id: msg.sender?.id || msg.sender_id,
        id_type: msg.sender?.id_type,
        name: msg.sender?.name || msg.sender?.sender_type || msg.sender?.id?.substring(0, 8) || '未知',
        sender_type: msg.sender?.sender_type,
      },
    })
  }

  // 群聊 + 私聊一次搜索抓全（--page-all 自动翻页）
  for (const chatType of ['group', 'p2p']) {
    try {
      const res = execLarkCli(`lark-cli im +messages-search --start "${startTimeISO}" --end "${endTimeISO}" --chat-type ${chatType} --page-size 50 --page-all --as user`)
      if (res?.ok) {
        const msgs = res.data?.messages || []
        for (const msg of msgs) pushMessage(msg)
      }
    } catch {}
  }

  return allMessages
}

async function collectCalendarEvents(): Promise<any[]> {
  const allEvents: any[] = []

  const calendarListRes = execLarkCli('lark-cli calendar calendars list')
  if (!calendarListRes?.ok) {
    throw new Error('获取日历列表失败')
  }

  const calendars = calendarListRes.data?.calendar_list || []
  console.log(`📅 找到 ${calendars.length} 个日历`)

  for (const calendar of calendars) {
    if (!calendar.calendar_id) continue
    try {
      const eventsRes = execLarkCli(`lark-cli calendar events instance_view --calendar-id ${calendar.calendar_id} --start-time ${startTimeSec} --end-time ${endTimeSec}`)
      if (!eventsRes?.ok) continue

      const events = eventsRes.data?.items || []
      for (const event of events) {
        allEvents.push({
          calendar_id: calendar.calendar_id,
          summary: event.summary,
          description: event.description,
          start_time: event.start_time,
          end_time: event.end_time,
          status: event.status,
        })
      }
    } catch {}
  }

  return allEvents
}

async function collectTasks(): Promise<{ completed: any[]; incomplete: any[] }> {
  const completed: any[] = []
  const incomplete: any[] = []
  const seenGuids = new Set<string>()

  const pushTask = (task: any) => {
    if (!task || seenGuids.has(task.guid)) return
    seenGuids.add(task.guid)
    const taskData = {
      guid: task.guid,
      summary: task.summary,
      description: task.description,
      due: task.due || task.due_at,
      completed_at: task.completed_at,
      created_at: task.created_at,
      updated_at: task.updated_at,
      url: task.url,
    }

    if (task.completed) {
      completed.push(taskData)
    } else {
      incomplete.push(taskData)
    }
  }

  // 我分配给我的任务
  const myTasksRes = execLarkCli('lark-cli task +get-my-tasks --page-all --as user')
  if (myTasksRes?.ok) {
    for (const task of (myTasksRes.data?.items || [])) pushTask(task)
  }

  // 与我相关的任务（含我创建的）
  const relatedRes = execLarkCli('lark-cli task +get-related-tasks --page-all --as user')
  if (relatedRes?.ok) {
    for (const task of (relatedRes.data?.items || [])) pushTask(task)
  }

  // 只保留本周有活动的任务
  const isDateThisWeek = (dateStr: string | null | undefined): boolean => {
    if (!dateStr) return false
    try { return isThisWeek(new Date(dateStr)) } catch { return false }
  }

  return {
    completed: completed.filter(t => isDateThisWeek(t.completed_at) || isDateThisWeek(t.updated_at) || isDateThisWeek(t.created_at)),
    incomplete: incomplete.filter(t => isDateThisWeek(t.updated_at) || isDateThisWeek(t.created_at)),
  }
}

collectData().catch(err => {
  console.error('❌ 采集失败:', err.message)
  process.exit(1)
})
