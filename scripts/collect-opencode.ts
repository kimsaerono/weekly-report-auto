#!/usr/bin/env node
import { execSync } from 'child_process'
import { writeFileSync, existsSync, readFileSync } from 'fs'
import { fileURLToPath } from 'node:url'
import { getWeekRange } from './time-utils.ts'

const DB_PATH = `${process.env.HOME}/.local/share/opencode/opencode.db`

interface OpenCodeSession {
  id: string
  title: string
  directory: string
  project_id: string
  time_created: string
  time_updated: string
  cost: number
  tokens_input: number
  tokens_output: number
  parent_id?: string
}

interface CollectResult {
  hasOpenCode: boolean
  weekRange: { start: string; end: string }
  sessions: OpenCodeSession[]
  topSessions: OpenCodeSession[]
  workSummary: string[]
  raw: string | null
}

async function collectOpenCode(): Promise<CollectResult> {
  const weekOffset = Number(process.env.WEEK_OFFSET || 0)
  const { startStr, endStr, start, end } = getWeekRange({ weekOffset })
  console.log(`📊 采集 opencode/AI 对话历史 (${startStr} - ${endStr})...`)

  if (!existsSync(DB_PATH)) {
    console.log(`⚠️  未找到 opencode 数据库: ${DB_PATH}\n`)
    return { hasOpenCode: false, weekRange: { start: startStr, end: endStr }, sessions: [], topSessions: [], workSummary: [], raw: null }
  }

  const startMs = start
  const endMs = end

  const query = `SELECT id, COALESCE(parent_id,''), title, directory, project_id, time_created, time_updated, cost, tokens_input, tokens_output
FROM session
WHERE time_created >= ${startMs} AND time_created < ${endMs}
  AND (parent_id IS NULL OR parent_id = '')
  AND title NOT LIKE 'New session%'
ORDER BY time_created DESC`

  let rowsRaw = ''
  try {
    rowsRaw = execSync(`sqlite3 -separator $'\\t' "${DB_PATH}" "${query}"`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 })
  } catch (e: any) {
    console.log(`⚠️  查询 opencode 数据库失败: ${e.message}\n`)
    return { hasOpenCode: false, weekRange: { start: startStr, end: endStr }, sessions: [], topSessions: [], workSummary: [], raw: null }
  }

  const sessions: OpenCodeSession[] = rowsRaw.split('\n').filter(Boolean).map(line => {
    const [id, parent_id, title, directory, project_id, time_created, time_updated, cost, tokens_input, tokens_output] = line.split('\t')
    return {
      id: id || '',
      parent_id: parent_id || undefined,
      title: title || id || '',
      directory: directory || '',
      project_id: project_id || '',
      time_created: new Date(Number(time_created)).toISOString().slice(0, 16).replace('T', ' '),
      time_updated: new Date(Number(time_updated)).toISOString().slice(0, 16).replace('T', ' '),
      cost: Number(cost) || 0,
      tokens_input: Number(tokens_input) || 0,
      tokens_output: Number(tokens_output) || 0,
    }
  })

  console.log(`✅ 找到 ${sessions.length} 个 AI 会话`)

  const topSessions = sessions.slice(0, 50)

  const workSummary: string[] = []
  for (const s of topSessions) {
    if (!s.title || s.title.includes('subagent') || s.title.includes('Explore') || s.title.includes('Analyze')) continue
    const proj = cleanProjectPath(s)
    const line = `${proj ? `[${proj}] ` : ''}${s.title}`
    workSummary.push(line)
  }

  writeFileSync('opencode-data.json', JSON.stringify({ hasOpenCode: true, weekRange: { start: startStr, end: endStr }, sessions, topSessions, workSummary }, null, 2))
  console.log(`✅ opencode 数据已保存到 opencode-data.json\n`)
  console.log('📋 AI 会话摘要:')
  for (const w of workSummary.slice(0, 20)) {
    console.log(`   • ${w}`)
  }
  console.log('')

  return {
    hasOpenCode: true,
    weekRange: { start: startStr, end: endStr },
    sessions,
    topSessions,
    workSummary,
    raw: rowsRaw,
  }
}

function cleanProjectPath(s: OpenCodeSession): string {
  const dir = s.directory || s.project_id || ''
  const parts = dir.split('/').filter(Boolean)
  // 取项目根/仓库名
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] !== 'hy' && parts[i] !== 'workspace' && parts[i] !== 'GitHub' && parts[i] !== '基建' && parts[i] !== '汇元' && parts[i] !== 'other' && parts[i] !== 'folders') {
      return parts[i]
    }
  }
  return ''
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  collectOpenCode().catch(err => { console.error('❌ 采集失败:', err.message); process.exit(1) })
}

export { collectOpenCode }
