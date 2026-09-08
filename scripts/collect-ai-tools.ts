#!/usr/bin/env node
import { execSync } from 'child_process'
import { writeFileSync, existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { getWeekRange } from './time-utils.ts'

interface AiSession {
  tool: string
  id: string
  title: string
  directory: string
  project: string
  time_created: string
  time_updated: string
  model?: string
}

interface AiToolResult {
  tool: string
  detected: boolean
  sessions: AiSession[]
  error?: string
}

interface AiToolsResult {
  hasAiTools: boolean
  weekRange: { start: string; end: string }
  tools: AiToolResult[]
  sessions: AiSession[]
  topSessions: AiSession[]
  workSummary: string[]
}

const home = homedir()

function detectPath(paths: string[]): string | null {
  for (const p of paths) {
    if (existsSync(p)) return p
  }
  return null
}

function cleanProjectPath(dir: string): string {
  const parts = (dir || '').split(/[\/\\]/).filter(Boolean)
  const skip = new Set(['hy', 'workspace', 'GitHub', '基建', '汇元', 'other', 'folders', 'Users', 'home', 'Users'])
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!skip.has(parts[i])) return parts[i]
  }
  return ''
}

function tsToString(ms: number | string | undefined): string {
  const n = Number(ms)
  if (!n || Number.isNaN(n)) return ''
  return new Date(n).toISOString().slice(0, 16).replace('T', ' ')
}

// ---------- opencode adapter ----------
function collectOpenCode(dbPath: string, startMs: number, endMs: number): AiSession[] {
  const sessions: AiSession[] = []
  const query = `SELECT id, COALESCE(parent_id,''), title, directory, project_id, time_created, time_updated
FROM session
WHERE time_created >= ${startMs} AND time_created < ${endMs}
  AND (parent_id IS NULL OR parent_id = '')
  AND title NOT LIKE 'New session%'
ORDER BY time_created DESC`
  let rowsRaw = ''
  try {
    rowsRaw = execSync(`sqlite3 -separator $'\\t' "${dbPath}" "${query}"`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 })
  } catch (e: any) {
    console.log(`   ⚠️ opencode 查询失败: ${e.message}`)
    return sessions
  }
  for (const line of rowsRaw.split('\n')) {
    if (!line) continue
    const [id, , title, directory, project_id, time_created, time_updated] = line.split('\t')
    sessions.push({
      tool: 'opencode', id: id || '', title: title || id || '',
      directory: directory || project_id || '', project: cleanProjectPath(directory || project_id || ''),
      time_created: tsToString(time_created), time_updated: tsToString(time_updated),
    })
  }
  return sessions
}

// ---------- Claude Code adapter (JSONL) ----------
function collectClaudeCode(baseDir: string, startMs: number, endMs: number): AiSession[] {
  const sessions: AiSession[] = []
  const projectsDir = join(baseDir, 'projects')
  if (!existsSync(projectsDir)) return sessions
  const projectDirs = readdirSync(projectsDir, { withFileTypes: true }).filter(d => d.isDirectory())
  for (const proj of projectDirs) {
    const projPath = join(projectsDir, proj.name)
    const sessionDir = join(projPath, 'sessions')
    const jsonlFiles: string[] = []
    if (existsSync(sessionDir)) {
      for (const f of readdirSync(sessionDir)) if (f.endsWith('.jsonl')) jsonlFiles.push(join(sessionDir, f))
    } else {
      for (const f of readdirSync(projPath)) if (f.endsWith('.jsonl')) jsonlFiles.push(join(projPath, f))
    }
    for (const file of jsonlFiles) {
      try {
        const raw = readFileSync(file, 'utf-8')
        let model = '', title = '', cwd = '', timeCreatedStr = ''
        for (const line of raw.split('\n')) {
          if (!line) continue
          try {
            const json = JSON.parse(line)
            if (!cwd && json.cwd) cwd = json.cwd
            if (!model && json.model) model = json.model
            if (json.isMeta || json.isSidechain) continue
            if (json.timestamp && !timeCreatedStr) timeCreatedStr = json.timestamp
            if (json.type === 'user' && json.message?.content && !title) {
              const c = json.message.content
              const text = typeof c === 'string' ? c : (Array.isArray(c) ? c.map((x: any) => x?.text || '').join(' ') : '')
              title = (text || '').slice(0, 100)
            }
          } catch { /* skip malformed line */ }
        }
        const st = statSync(file)
        const created = timeCreatedStr ? new Date(timeCreatedStr).getTime() : st.mtimeMs
        if (created >= startMs && created < endMs) {
          const dir = cwd || proj.name
          sessions.push({
            tool: 'claude-code', id: file.split('/').pop()?.replace('.jsonl', '') || '', title: title || proj.name,
            directory: dir, project: cleanProjectPath(dir), model,
            time_created: tsToString(created), time_updated: tsToString(st.mtimeMs),
          })
        }
      } catch (e: any) {
        console.log(`   ⚠️ claude-code 读取失败 ${file}: ${e.message}`)
      }
    }
  }
  return sessions
}

// ---------- VS Code-family adapter (Cursor / Windsurf / Trae): state.vscdb SQLite ----------
// Reads ItemTable / cursorDiskKV key-value format shared by Cursor, Windsurf (VS Code forks).
function collectVSCodeFamily(toolName: string, storageRoot: string, startMs: number, endMs: number): AiSession[] {
  const sessions: AiSession[] = []
  const globalDb = join(storageRoot, 'User', 'globalStorage', 'state.vscdb')
  if (!existsSync(globalDb)) return sessions

  let db: DatabaseSync
  try {
    db = new DatabaseSync(`file:${globalDb}?mode=ro`, { readOnly: true })
  } catch (e: any) {
    console.log(`   ⚠️ ${toolName} 数据库不可读: ${e.message}`)
    return sessions
  }

  try {
    // composerData entries carry title + timestamps; bubbleId entries carry conversation text.
    const keys = db.prepare(`SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'`).all() as { key: string; value: any }[]
    for (const row of keys) {
      const id = row.key.split(':').pop() || ''
      let val: any = {}
      if (typeof row.value === 'string') { try { val = JSON.parse(row.value) } catch { val = {} } }
      else if (row.value instanceof Uint8Array || ArrayBuffer.isView(row.value)) { try { val = JSON.parse(Buffer.from(row.value as any).toString('utf-8')) } catch { val = {} } }
      else val = row.value || {}

      const createdRaw = val?.createdAt || val?.createdAtTime || val?.timestamp
      const updatedRaw = val?.lastActivityAt || val?.updatedAt || createdRaw
      const created = Number(createdRaw) || 0
      if (created < startMs || created >= endMs) continue

      const title = val?.title || val?.name || id
      const dir = val?.cwd || val?.workspace || ''
      sessions.push({
        tool: toolName, id, title: String(title).slice(0, 100), directory: String(dir),
        project: cleanProjectPath(String(dir)),
        time_created: tsToString(created), time_updated: tsToString(Number(updatedRaw) || created),
        model: val?.model || undefined,
      })
    }
  } catch (e: any) {
    console.log(`   ⚠️ ${toolName} 解析失败: ${e.message}`)
  } finally {
    try { db.close() } catch { /* ignore */ }
  }
  return sessions
}

// ---------- main orchestration ----------
function collectAllTools(): AiToolsResult {
  const weekOffset = Number(process.env.WEEK_OFFSET || 0)
  const { startStr, endStr, start, end } = getWeekRange({ weekOffset })
  console.log(`📊 采集 AI 工具会话历史 (${startStr} - ${endStr})...`)
  const startMs = start
  const endMs = end

  const toolsResults: AiToolResult[] = []

  // 1. opencode
  const ocPath = detectPath([join(home, '.local/share/opencode/opencode.db')])
  if (ocPath) {
    const sessions = collectOpenCode(ocPath, startMs, endMs)
    console.log(`   ✅ [opencode] ${sessions.length} 个会话`)
    toolsResults.push({ tool: 'opencode', detected: true, sessions })
  } else {
    toolsResults.push({ tool: 'opencode', detected: false, sessions: [] })
    console.log('   ⏭ [opencode] 未检测到')
  }

  // 2. Claude Code
  const claudeDir = detectPath([join(home, '.claude')])
  if (claudeDir) {
    const sessions = collectClaudeCode(claudeDir, startMs, endMs)
    console.log(`   ✅ [claude-code] ${sessions.length} 个会话`)
    toolsResults.push({ tool: 'claude-code', detected: true, sessions })
  } else {
    toolsResults.push({ tool: 'claude-code', detected: false, sessions: [] })
    console.log('   ⏭ [claude-code] 未检测到')
  }

  // 3. Cursor
  const cursorRoot = detectPath([join(home, 'Library/Application Support/Cursor')])
  if (cursorRoot) {
    const sessions = collectVSCodeFamily('cursor', cursorRoot, startMs, endMs)
    console.log(`   ✅ [cursor] ${sessions.length} 个会话`)
    toolsResults.push({ tool: 'cursor', detected: true, sessions })
  } else {
    toolsResults.push({ tool: 'cursor', detected: false, sessions: [] })
    console.log('   ⏭ [cursor] 未检测到')
  }

  // 4. Windsurf
  const windsurfRoot = detectPath([join(home, 'Library/Application Support/Windsurf')])
  if (windsurfRoot) {
    const sessions = collectVSCodeFamily('windsurf', windsurfRoot, startMs, endMs)
    console.log(`   ✅ [windsurf] ${sessions.length} 个会话`)
    toolsResults.push({ tool: 'windsurf', detected: true, sessions })
  } else {
    toolsResults.push({ tool: 'windsurf', detected: false, sessions: [] })
    console.log('   ⏭ [windsurf] 未检测到')
  }

  // 5. Trae
  const traeRoot = detectPath([join(home, 'Library/Application Support/Trae')])
  if (traeRoot) {
    const sessions = collectVSCodeFamily('trae', traeRoot, startMs, endMs)
    console.log(`   ✅ [trae] ${sessions.length} 个会话`)
    toolsResults.push({ tool: 'trae', detected: true, sessions })
  } else {
    toolsResults.push({ tool: 'trae', detected: false, sessions: [] })
    console.log('   ⏭ [trae] 未检测到')
  }

  // 6. Codeium (plugin/windsurf)
  const codeiumDir = detectPath([join(home, '.codeium')])
  if (codeiumDir) {
    // Codeium ships with Windsurf; standalone sessions not reliably parseable — mark detected if dir exists.
    console.log('   ⏭ [codeium] 检测到目录但无独立可解析会话（随 Windsurf 存储）')
    toolsResults.push({ tool: 'codeium', detected: true, sessions: [] })
  } else {
    toolsResults.push({ tool: 'codeium', detected: false, sessions: [] })
    console.log('   ⏭ [codeium] 未检测到')
  }

  const allSessions = toolsResults.flatMap(t => t.sessions)
  const topSessions = allSessions.slice(0, 50)
  const workSummary = topSessions
    .filter(s => s.title && !s.title.toLowerCase().includes('subagent') && !s.title.toLowerCase().includes('explore') && !s.title.toLowerCase().includes('analyze'))
    .map(s => `[${s.project || s.tool}] ${s.title}`)

  const result: AiToolsResult = {
    hasAiTools: allSessions.length > 0,
    weekRange: { start: startStr, end: endStr },
    tools: toolsResults,
    sessions: allSessions,
    topSessions,
    workSummary,
  }

  writeFileSync('ai-data.json', JSON.stringify(result, null, 2))
  console.log(`\n📋 AI 会话摘要:`)
  for (const w of workSummary.slice(0, 20)) console.log(`   • ${w}`)
  console.log(`\n✅ AI 工具数据已保存到 ai-data.json\n`)
  return result
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  collectAllTools()
}

export { collectAllTools }
