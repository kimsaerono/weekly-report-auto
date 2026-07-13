import { execSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { config } from 'dotenv'

config()

function run(script: string, args: string = '') {
  console.log(`\n========== 执行 ${script} ==========`)
  try {
    execSync(`npx tsx scripts/${script} ${args}`, { stdio: 'inherit', cwd: process.cwd() })
  } catch (e) {
    console.error(`${script} 执行失败，继续下一步...`)
  }
}

function mergeData(): string {
  const dataParts: string[] = []
  
  // 1. 消息数据
  if (existsSync('messages.json')) {
    const messages = JSON.parse(readFileSync('messages.json', 'utf-8'))
    const msgText = messages.map((m: any) => `[${m.time}] ${m.chatName}: ${m.content}`).join('\n')
    dataParts.push(`## 群聊消息\n${msgText}`)
  }
  
  // 2. 日历事件
  if (existsSync('calendar.json')) {
    const events = JSON.parse(readFileSync('calendar.json', 'utf-8'))
    if (events.length > 0) {
      const eventsText = events.map((e: any) => `- ${e.summary || '(无标题)'}`).join('\n')
      dataParts.push(`## 日历会议\n${eventsText}`)
    }
  }
  
  // 3. 任务
  if (existsSync('tasks.json')) {
    const tasks = JSON.parse(readFileSync('tasks.json', 'utf-8'))
    if (tasks.completed?.length > 0) {
      const completedText = tasks.completed.map((t: any) => `- ${t.summary}`).join('\n')
      dataParts.push(`## 已完成任务\n${completedText}`)
    }
    if (tasks.pending?.length > 0) {
      const pendingText = tasks.pending.map((t: any) => `- ${t.summary}`).join('\n')
      dataParts.push(`## 进行中任务\n${pendingText}`)
    }
  }
  
  // 4. 文档
  if (existsSync('docs.json')) {
    const docs = JSON.parse(readFileSync('docs.json', 'utf-8'))
    if (docs.length > 0) {
      const docsText = docs.map((d: any) => `- ${d.title || '(无标题)'}`).join('\n')
      dataParts.push(`## 编辑的文档\n${docsText}`)
    }
  }
  
  const mergedData = dataParts.join('\n\n')
  writeFileSync('merged-data.json', JSON.stringify({ content: mergedData }, null, 2))
  return mergedData
}

async function main() {
  console.log('飞书周报自动生成工具')
  console.log('====================')

  // 步骤1: 采集各类数据
  run('collect-all.ts')
  run('collect-calendar.ts')
  run('collect-tasks.ts')
  run('collect-docs.ts')
  
  // 步骤2: 合并数据
  console.log('\n========== 合并数据 ==========')
  const mergedData = mergeData()
  console.log(`合并完成，共 ${mergedData.length} 字符`)

  // 步骤3: 填写周报
  console.log('\n========== 填写周报 ==========')
  const { execSync: exec } = await import('child_process')
  exec('npx tsx scripts/playwright-fill.ts', {
    stdio: 'inherit',
    cwd: process.cwd(),
  })

  console.log('\n========== 完成 ==========')
  console.log('周报已自动填写到飞书')
}

main().catch(err => {
  console.error('失败:', err.message)
  process.exit(1)
})
