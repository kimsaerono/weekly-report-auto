#!/usr/bin/env node
import { readFileSync } from 'fs'
import { config } from 'dotenv'
import { SystemNotifier } from './notify-system.ts'

config()

function main() {
  let report: any
  try {
    report = JSON.parse(readFileSync('report.json', 'utf-8'))
  } catch {
    console.log('⚠️  未找到 report.json')
    return
  }

  const truncate = (text: string, maxLen: number = 50) =>
    text.length > maxLen ? text.substring(0, maxLen) + '...' : text

  // report.json 是结构化数组 {title?, level?, text}，取非标题行的文本拼成摘要
  const excerpt = (lines: any, max: number = 4): string => {
    const texts = (Array.isArray(lines) ? lines : [])
      .filter((l: any) => l && l.text && !l.title)
      .map((l: any) => l.text)
      .slice(0, max)
    return texts.length ? texts.join(' · ') : '无'
  }

  const message = `本周完成: ${truncate(excerpt(report.completed), 60)}\n下周计划: ${truncate(excerpt(report.nextPlan), 60)}`
  SystemNotifier.notify('📋 周报已生成', message)
  SystemNotifier.playSound()
  console.log('✅ 系统通知已发送')
}

main()