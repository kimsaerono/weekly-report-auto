// 结构预过滤（仅有限结构规则，零语义、零业务词）：
// 1) 剥 URL/IP  2) 长度 3) 本人（需 FEISHU_OPEN_ID） 4) 去重 5) 上限
// 语义拦截与口语归一化由 AI 分析层（agent）完成，见 references/report-rules.md

import { config } from 'dotenv'
import { CONFIG } from './config.ts'
import { writeFileSync } from 'fs'

config()

const URL_RE = /(?:https?:\/\/|\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?)\S*/g

export function stripUrls(text: string): string {
  return (text || '').replace(/@/g, '').replace(URL_RE, '').trim()
}

export interface MessageCandidate {
  time?: string
  chat_name?: string
  chat_type?: string
  sender_name?: string
  content: string
}

export function prefilterMessages(
  messages: any[],
  opts: { openId?: string; minLen?: number; maxLen?: number; max?: number } = {},
): { candidates: MessageCandidate[]; stats: Record<string, number> } {
  const openId = opts.openId ?? process.env.FEISHU_OPEN_ID ?? ''
  const minLen = opts.minLen ?? CONFIG.generate.messageMinLen
  const maxLen = opts.maxLen ?? CONFIG.generate.messageMaxLen
  const max = opts.max ?? CONFIG.generate.messageMaxCandidates
  const candidates: MessageCandidate[] = []
  const seen = new Set<string>()
  const stats: Record<string, number> = {
    total: messages.length,
    notSelf: 0,
    tooShort: 0,
    tooLong: 0,
    empty: 0,
    dup: 0,
    kept: 0,
    cap: 0,
  }
  for (const msg of messages || []) {
    if (openId && msg.sender?.id && msg.sender.id !== openId) {
      stats.notSelf++
      continue
    }
    const content = stripUrls(msg.content || msg.text || '')
    if (!content) {
      stats.empty++
      continue
    }
    if (content.length < minLen) {
      stats.tooShort++
      continue
    }
    if (content.length > maxLen) {
      stats.tooLong++
      continue
    }
    const k = content.slice(0, 40).toLowerCase()
    if (k && seen.has(k)) {
      stats.dup++
      continue
    }
    if (k) seen.add(k)
    if (candidates.length >= max) {
      stats.cap++
      continue
    }
    candidates.push({
      time: msg.create_time,
      chat_name: msg.chat_name,
      chat_type: msg.chat_type,
      sender_name: msg.sender?.name,
      content,
    })
    stats.kept++
  }
  return { candidates, stats }
}