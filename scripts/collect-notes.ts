#!/usr/bin/env node
import { spawnSync } from 'child_process'
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'node:url'
import { getWeekRange } from './time-utils.ts'

interface FeishuNote {
  id: string
  title: string
  url: string
  type: string
  created_at: string
  edited_at: string
}

interface NotesResult {
  hasNotes: boolean
  authorized: boolean
  weekRange: { start: string; end: string }
  notes: FeishuNote[]
  workSummary: string[]
}

function collectNotes(): NotesResult {
  const weekOffset = Number(process.env.WEEK_OFFSET || 0)
  const { startStr, endStr, start, end } = getWeekRange({ weekOffset })
  console.log(`📓 采集飞书文档笔记 (${startStr} - ${endStr})...`)

  // 备忘类关键词：标题或内容包含这些词的文档视为个人随手记/备忘录
  const NOTE_KEYWORDS = /(备忘|随手记|待办|TODO|想法|灵感|日记|清单|note|memo|reminder|weekly|周记)/i

  // 使用 drive +search 检索本周创建/编辑的文档
  let attempts = 0
  const notes: FeishuNote[] = []
  let authorized = true

  try {
    const res = spawnSync('lark-cli', [
      'drive', '+search', '--as', 'user', '--mine', '--doc-types', 'docx,doc,sheet,bitable',
      '--created-since', startStr, '--created-until', endStr, '--format', 'json',
    ], { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 })
    if (res.status !== 0) throw new Error(`exit ${res.status}: ${res.stderr || res.stdout}`)
    const output = res.stdout
    const result = JSON.parse(output)
    const items = result?.data?.items || result?.items || result?.data?.docs || []
    for (const item of items) {
      const title = item?.title || item?.name || ''
      if (!title) continue
      if (!NOTE_KEYWORDS.test(title)) continue
      notes.push({
        id: item?.token || item?.obj_token || item?.id || '',
        title,
        url: item?.url || '',
        type: item?.type || item?.obj_type || 'docx',
        created_at: item?.created_time || '',
        edited_at: item?.modified_time || item?.edited_time || '',
      })
    }
    attempts++
  } catch (e: any) {
    // spawnSync 失败时，错误信息已合并到 message 中
    const out = String(e?.message || '')
    if (out.includes('missing_scope') || out.includes('unauthorized') || out.includes('authorization')) {
      authorized = false
      console.log('   ⚠️ 飞书文档搜索未授权（需 search:docs:read scope）')
      console.log(`     修复: 运行 lark-cli auth login --scope "search:docs:read drive:drive:readonly drive:drive opt_space_doc:read"`)
    } else {
      console.log(`   ⚠️ 飞书文档搜索失败: ${out.slice(0, 160)}`)
    }
  }

  if (authorized && attempts > 0) {
    console.log(`   ✅ ${notes.length} 篇备忘/笔记文档`)
  }

  const workSummary = notes.map(n => `[飞书笔记] ${n.title}`)
  const result: NotesResult = {
    hasNotes: notes.length > 0,
    authorized,
    weekRange: { start: startStr, end: endStr },
    notes,
    workSummary,
  }

  writeFileSync('notes-data.json', JSON.stringify(result, null, 2))
  console.log(`✅ 笔记数据已保存到 notes-data.json\n`)
  return result
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  collectNotes()
}

export { collectNotes }