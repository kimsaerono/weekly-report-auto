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

  const message = `本周完成: ${truncate(report.completed)}\n下周计划: ${truncate(report.nextPlan)}`
  SystemNotifier.notify('📋 周报已生成', message)
  SystemNotifier.playSound()
  console.log('✅ 系统通知已发送')
}

main()