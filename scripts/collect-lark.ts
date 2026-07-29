#!/usr/bin/env node
import { execSync } from 'child_process'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'node:url'
import { getWeekRange, formatTimestamp, isThisWeek } from './time-utils.ts'

console.log('🚀 使用 lark-cli 采集数据...\n')

const { start, end, startStr, endStr } = getWeekRange()
console.log(`📅 时间范围: ${startStr} - ${endStr}\n`)

const startTimeISO = formatTimestamp(start)
const endTimeISO = formatTimestamp(end)
const startTimeSec = String(Math.floor(start / 1000))
const endTimeSec = String(Math.floor(end / 1000))

function execLarkCli(command: string): any {
  try {
    const result = execSync(`lark-cli ${command} --json`, { encoding: 'utf-8' })
    return JSON.parse(result)
  } catch (error: any) {
    console.error(`❌ lark-cli 命令失败: ${command}`)
    console.error(error.message)
    return null
  }
}

async function collectData() {
  const data: any = {
    weekRange: { start: startStr, end: endStr },
    collectedAt: new Date().toISOString(),
  }

  // 采集消息
  console.log('📨 采集消息...')
  try {
    const messages = await collectMessages()
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

  // 采集任务
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
}

async function collectMessages(): Promise<any[]> {
  const allMessages: any[] = []
  const seenIds = new Set<string>()

  function pushMessage(msg: any, chatId: string, chatName: string, chatType: string) {
    if (seenIds.has(msg.message_id)) return
    seenIds.add(msg.message_id)
    allMessages.push({
      chat_id: chatId,
      chat_name: chatName || '未知',
      chat_type: chatType,
      content: msg.content || '',
      create_time: msg.create_time,
      message_id: msg.message_id,
      sender: {
        id: msg.sender?.id,
        id_type: msg.sender?.id_type,
        name: msg.sender?.name || msg.sender?.id,
        sender_type: msg.sender?.sender_type,
      },
    })
  }

  // 群聊消息
  const chatListRes = execLarkCli('im +chat-list --page-size 100')
  if (chatListRes?.ok) {
    const chats = chatListRes.data?.chats || []
    console.log(`📋 找到 ${chats.length} 个群`)

    for (const chat of chats) {
      if (!chat.chat_id) continue
      try {
        const messagesRes = execLarkCli(`im +messages-search --chat-id ${chat.chat_id} --start "${startTimeISO}" --end "${endTimeISO}" --page-size 50`)
        if (messagesRes?.ok) {
          for (const msg of (messagesRes.data?.messages || [])) {
            pushMessage(msg, chat.chat_id, chat.name || '未知', chat.chat_mode || 'group')
          }
        }
      } catch {}
    }
  }

  // 私聊消息（不指定 chat-id 全量搜索，过滤出 p2p 类型）
  const allSearchRes = execLarkCli(`im +messages-search --start "${startTimeISO}" --end "${endTimeISO}" --page-size 100`)
  if (allSearchRes?.ok) {
    for (const msg of (allSearchRes.data?.messages || [])) {
      const chatType = msg.chat_type || msg.chat_mode || ''
      if (chatType === 'p2p' || chatType === 'private') {
        pushMessage(msg, msg.chat_id || '', msg.chat_name || '私聊', 'p2p')
      }
    }
  }

  return allMessages
}

async function collectCalendarEvents(): Promise<any[]> {
  const allEvents: any[] = []

  // 获取日历列表
  const calendarListRes = execLarkCli('calendar calendars list')
  if (!calendarListRes?.ok) {
    throw new Error('获取日历列表失败')
  }

  const calendars = calendarListRes.data?.calendar_list || []
  console.log(`📅 找到 ${calendars.length} 个日历`)

  for (const calendar of calendars) {
    if (!calendar.calendar_id) continue

    try {
      // 获取日历事件
      const eventsRes = execLarkCli(`calendar events instance_view --calendar-id ${calendar.calendar_id} --start-time ${startTimeSec} --end-time ${endTimeSec}`)
      
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

  // 获取任务列表
  const tasksRes = execLarkCli('task +get-my-tasks')
  if (!tasksRes?.ok) {
    throw new Error('获取任务列表失败')
  }

  const tasks = tasksRes.data?.items || []
  console.log(`✅ 找到 ${tasks.length} 个任务`)

  for (const task of tasks) {
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

  // 只保留本周有活动的任务
  const isDateThisWeek = (dateStr: string | null | undefined): boolean => {
    if (!dateStr) return false
    try { return isThisWeek(new Date(dateStr)) } catch { return false }
  }

  return {
    completed: completed.filter(t => isDateThisWeek(t.completed_at)),
    incomplete: incomplete.filter(t => isDateThisWeek(t.updated_at) || isDateThisWeek(t.created_at)),
  }
}

collectData().catch(err => {
  console.error('❌ 采集失败:', err.message)
  process.exit(1)
})