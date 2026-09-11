#!/usr/bin/env node
import { execSync } from 'child_process'
import { writeFileSync, existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { getWeekRange } from './time-utils.ts'
import { CONFIG, resolvePaths } from './config.ts'
import { locateRepo, repoBaseName } from './project-name.ts'

interface AiSession {
  tool: string
  id: string
  title: string
  directory: string
  project: string
  time_created: string
  time_updated: string
  model?: string
  origin?: string
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

function detectPath(paths: string[]): string | null {
  for (const p of paths) {
    if (existsSync(p)) return p
  }
  return null
}

function tsToString(ms: number | string | undefined): string {
  const n = Number(ms)
  if (!n || Number.isNaN(n)) return ''
  return new Date(n).toISOString().slice(0, 16).replace('T', ' ')
}

// 归因会话到真实仓库：directory 提升为所属仓库路径，project 取仓库名；定位不到视为非项目（其他）。
function attachRepo(s: AiSession): AiSession {
  const loc = locateRepo(s.directory)
  if (loc) return { ...s, directory: loc, project: repoBaseName(loc) }
  return { ...s, origin: s.directory, directory: '', project: '' }
}

// opencode：挖掘 part 表里实际改动的文件，反推所属仓库（多数投票）。仅当会话目录不是 git 仓库时才需要。
type RepoVotes = Map<string, string | null> // session_id -> 所属仓库全路径（或 null）
function locateRepoFromParts(dbPath: string, sessionIds: string[]): RepoVotes {
  const result: RepoVotes = new Map()
  for (const id of sessionIds) result.set(id, null)
  if (sessionIds.length === 0) return result

  let db: DatabaseSync
  try {
    db = new DatabaseSync(`file:${dbPath}?mode=ro`, { readOnly: true })
  } catch (e: any) {
    console.log(`   ⚠️ opencode part 表不可读: ${e.message}`)
    return result
  }

  try {
    const ids = sessionIds.map(id => `'${id.replace(/'/g, "''")}'`).join(',')
    const rows = db.prepare(`SELECT session_id, data FROM part WHERE session_id IN (${ids})`).all() as { session_id: string; data: any }[]
    const votes = new Map<string, Map<string, number>>()
    for (const id of sessionIds) votes.set(id, new Map())

    for (const row of rows) {
      let d: any = {}
      try { d = typeof row.data === 'string' ? JSON.parse(row.data) : row.data } catch { continue }
      const fps: string[] = []
      const fp = d?.state?.input?.filePath
      if (typeof fp === 'string') fps.push(fp)
      else if (Array.isArray(fp)) fps.push(...fp.filter((x: any) => typeof x === 'string'))
      const fd = d?.state?.metadata?.filediff?.file
      if (typeof fd === 'string') fps.push(fd)

      const map = votes.get(row.session_id)
      if (!map) continue
      for (const f of fps) {
        if (!f) continue
        const repo = locateRepo(f)
        if (!repo) continue
        map.set(repo, (map.get(repo) || 0) + 1)
      }
    }

    for (const [id, map] of votes) {
      let best: string | null = null
      let bestN = 0
      for (const [repo, n] of map) {
        if (n > bestN) { best = repo; bestN = n }
      }
      result.set(id, best)
    }
  } catch (e: any) {
    console.log(`   ⚠️ opencode part 表解析失败: ${e.message}`)
  } finally {
    try { db.close() } catch { /* ignore */ }
  }
  return result
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
      directory: directory || project_id || '', project: '',
      time_created: tsToString(time_created), time_updated: tsToString(time_updated),
    })
  }

  // 归属真实仓库：目录已是 git 仓库 → 直接用；否则挖掘 part 表实际改动文件反推（多数投票）
  const base = sessions.map(attachRepo)
  const needsMining = base.filter(s => !s.directory)
  if (needsMining.length > 0) {
    const mined = locateRepoFromParts(dbPath, needsMining.map(s => s.id))
    for (const s of needsMining) {
      const winner = mined.get(s.id)
      if (winner) { s.directory = winner; s.project = repoBaseName(winner) }
    }
  }
  return base
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
          sessions.push(attachRepo({
            tool: 'claude-code', id: file.split('/').pop()?.replace('.jsonl', '') || '', title: title || proj.name,
            directory: dir, project: '', model,
            time_created: tsToString(created), time_updated: tsToString(st.mtimeMs),
          }))
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
      sessions.push(attachRepo({
        tool: toolName, id, title: String(title).slice(0, 100), directory: String(dir),
        project: '',
        time_created: tsToString(created), time_updated: tsToString(Number(updatedRaw) || created),
        model: val?.model || undefined,
      }))
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

  for (const tool of CONFIG.aiTools.tools) {
    if (tool.enabled === false) {
      toolsResults.push({ tool: tool.name, detected: false, sessions: [] })
      console.log(`   ⏭ [${tool.name}] 已禁用`)
      continue
    }

    const detectedPath = detectPath(resolvePaths(tool.paths))
    if (!detectedPath) {
      toolsResults.push({ tool: tool.name, detected: false, sessions: [] })
      console.log(`   ⏭ [${tool.name}] 未检测到`)
      continue
    }

    let sessions: AiSession[] = []
    switch (tool.adapter) {
      case 'opencode':
        sessions = collectOpenCode(detectedPath, startMs, endMs)
        break
      case 'claude-code':
        sessions = collectClaudeCode(detectedPath, startMs, endMs)
        break
      case 'vscode-family':
        sessions = collectVSCodeFamily(tool.name, detectedPath, startMs, endMs)
        break
      case 'codeium':
        console.log(`   ⏭ [${tool.name}] 检测到目录但无独立可解析会话（随 Windsurf 存储）`)
        toolsResults.push({ tool: tool.name, detected: true, sessions: [] })
        continue
    }
    console.log(`   ✅ [${tool.name}] ${sessions.length} 个会话`)
    toolsResults.push({ tool: tool.name, detected: true, sessions })
  }

  const allSessions = toolsResults.flatMap(t => t.sessions)
  const topSessions = allSessions.slice(0, 50)
  const skipKeywords = CONFIG.aiTools.titleSkipKeywords.map(k => k.toLowerCase())
  const workSummary = topSessions
    .filter(s => {
      const t = s.title.toLowerCase()
      return s.title && !skipKeywords.some(k => t.includes(k))
    })
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
