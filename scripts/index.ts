import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { config } from 'dotenv'

config()

function run(script: string, args: string = '') {
  console.log(`\n========== 执行 ${script} ==========`)
  try {
    execSync(`npx tsx scripts/${script} ${args}`, { stdio: 'inherit', cwd: process.cwd() })
  } catch (e) {
    console.error(`${script} 执行失败`)
    process.exit(1)
  }
}

async function main() {
  console.log('飞书周报自动生成工具')
  console.log('====================')

  // 步骤1: 采集消息
  run('collect-all.ts')

  // 步骤2: AI 分析生成周报
  if (!existsSync('messages.json')) {
    console.error('消息采集失败，未找到 messages.json')
    process.exit(1)
  }
  run('analyze.ts', 'messages.json')

  // 步骤3: 填写周报
  if (!existsSync('report.json')) {
    console.error('周报生成失败，未找到 report.json')
    process.exit(1)
  }

  const report = JSON.parse(readFileSync('report.json', 'utf-8'))

  // 设置环境变量并执行填写
  const env = {
    ...process.env,
    REPORT_COMPLETED: report.completed || '',
    REPORT_UNCOMPLETED: report.uncompleted || '',
    REPORT_NEXT_PLAN: report.nextPlan || '',
    REPORT_HELP: report.help || '',
    REPORT_REFLECTION: report.reflection || '',
  }

  console.log('\n========== 填写周报 ==========')
  const { execSync: exec } = await import('child_process')
  exec('npx tsx scripts/playwright-fill.ts', {
    stdio: 'inherit',
    cwd: process.cwd(),
    env,
  })

  console.log('\n========== 完成 ==========')
  console.log('周报已自动填写到飞书')
}

main().catch(err => {
  console.error('失败:', err.message)
  process.exit(1)
})
