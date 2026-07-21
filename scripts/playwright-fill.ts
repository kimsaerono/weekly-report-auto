import { chromium } from 'playwright'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { execSync } from 'child_process'
import { setTimeout } from 'timers/promises'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

config()

const RULE_ID = process.env.FEISHU_REPORT_RULE_ID
if (!RULE_ID) { console.error('请配置 FEISHU_REPORT_RULE_ID'); process.exit(1) }
const REPORT_URL = `https://oa.feishu.cn/report/record/detail?ruleId=${RULE_ID}&routeFrom=/record/list`
const COOKIE_PATH = process.env.COOKIE_PATH || fileURLToPath(new URL('../.feishu-cookies.json', import.meta.url))
const TEMPLATE_PATH = fileURLToPath(new URL('../template.md', import.meta.url))

interface ReportContent {
  completed: string
  uncompleted: string
  nextPlan: string
  help: string
  reflection: string
}

// 解析 report.json（由 analyze.ts 生成）
function parseReportJson(reportPath: string): ReportContent | null {
  if (!existsSync(reportPath)) return null
  try {
    const data = JSON.parse(readFileSync(reportPath, 'utf-8'))
    return {
      completed: data.completed || '无',
      uncompleted: data.uncompleted || '无',
      nextPlan: data.nextPlan || '无',
      help: data.help || '无',
      reflection: data.reflection || '无',
    }
  } catch {
    return null
  }
}

// 解析 template.md 文件
function parseTemplate(templatePath: string): ReportContent {
  // 优先：report.json（由 analyze.ts 生成）
  const reportJson = parseReportJson(fileURLToPath(new URL('../report.json', import.meta.url)))
  if (reportJson) {
    console.log('使用 report.json 作为周报内容')
    return reportJson
  }

  if (!existsSync(templatePath)) {
    console.log('template.md 不存在，使用环境变量')
    return {
      completed: process.env.REPORT_COMPLETED || '无',
      uncompleted: process.env.REPORT_UNCOMPLETED || '无',
      nextPlan: process.env.REPORT_NEXT_PLAN || '无',
      help: process.env.REPORT_HELP || '无',
      reflection: process.env.REPORT_REFLECTION || '无',
    }
  }

  const content = readFileSync(templatePath, 'utf-8')
  
  // 定义标题到字段的映射（注意：长关键词要放在前面，避免"未完成"误匹配"完成"）
  const titleMap: Record<string, keyof ReportContent> = {
    '未完成': 'uncompleted',
    '完成': 'completed',
    '计划': 'nextPlan',
    '协调': 'help',
    '反思': 'reflection',
  }
  
  const result: ReportContent = {
    completed: '无',
    uncompleted: '无',
    nextPlan: '无',
    help: '无',
    reflection: '无',
  }
  
  // 按 ## 分割内容
  const sections = content.split(/^## /m).slice(1)
  
  for (const section of sections) {
    const lines = section.split('\n')
    const title = lines[0].trim()
    
    // 找到匹配的字段
    let fieldKey: keyof ReportContent | null = null
    for (const [keyword, key] of Object.entries(titleMap)) {
      if (title.includes(keyword)) {
        fieldKey = key
        break
      }
    }
    
    if (fieldKey) {
      // 解析内容：跳过注释行和空行，去掉 - 前缀
      const contentLines = lines.slice(1)
        .filter(line => !line.trim().startsWith('<!--'))
        .filter(line => line.trim())
        .map(line => line.replace(/^-\s*/, '').trim())
        .filter(line => line && line !== '-')
      
      if (contentLines.length > 0) {
        result[fieldKey] = contentLines.join('\n')
      }
    }
  }
  
  return result
}

async function fillReport(content: ReportContent) {
  // 自动安装 Chromium（若未安装）
  try { execSync('npx playwright install chromium 2>/dev/null', { stdio: 'pipe' }) } catch {}

  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()

  // 监听保存相关的网络请求
  const savedRequests: Array<{ url: string; method: string; body: string }> = []
  page.on('request', (request: any) => {
    const url = request.url()
    if (url.includes('DraftUserRuleWriteView')) {
      const body = request.postData() ? String(request.postData()) : 'null'
      savedRequests.push({ url: url.slice(0, 120), method: request.method(), body })
    }
  })

  let loggedIn = false

  if (existsSync(COOKIE_PATH)) {
    const cookies = JSON.parse(readFileSync(COOKIE_PATH, 'utf-8'))
    await context.addCookies(cookies)
    await page.goto(REPORT_URL, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {})
    await setTimeout(5000)
    if (page.url().includes('/report/')) {
      console.log('Cookie 有效')
      loggedIn = true
    }
  }

  if (!loggedIn) {
    console.log('需要扫码登录飞书')
    await page.goto(REPORT_URL, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {})
    await setTimeout(3000)
    if (page.url().includes('accounts') || page.url().includes('login')) {
      console.log('=== 请使用飞书手机端扫码登录 ===')
      await page.waitForURL('**/report/**', { timeout: 180000 }).catch(() => {})
      console.log('登录成功')
    }
    const cookies = await context.cookies()
    writeFileSync(COOKIE_PATH, JSON.stringify(cookies, null, 2))
    await setTimeout(5000)
  }

  if (!page.url().includes('/report/')) {
    await page.goto(REPORT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
    await setTimeout(5000)
  }

  if (!page.url().includes('/report/')) {
    console.log('无法进入报告页')
    await page.screenshot({ path: '/tmp/report-error.png', fullPage: true })
    await browser.close()
    return
  }

  await setTimeout(2000)

  const fields: Array<{ label: string; value: string }> = [
    { label: '本周完成工作', value: content.completed },
    { label: '本周未完成工作及原因', value: content.uncompleted },
    { label: '下周工作计划', value: content.nextPlan },
    { label: '需要协调与帮助', value: content.help },
    { label: '学习和反思', value: content.reflection },
  ]

  for (const field of fields) {
    // 跳过空内容（但"无"会被填入）
    if (!field.value) continue

    // 根据标签文本定位输入框
    const labelEl = page.locator(`text="${field.label}"`).first()
    if (!(await labelEl.count())) {
      console.log(`⚠ 未找到标签: ${field.label}，尝试模糊匹配`)
    }

    // 优先：在标签附近查找 contenteditable
    const editable = labelEl.locator('xpath=ancestor::*[.//contenteditable]//div[@contenteditable="true"] | following-sibling::*//div[@contenteditable="true"]').first()
    // 兜底：按索引定位
    const editableAlt = page.locator(`[contenteditable="true"]`).nth(fields.indexOf(field))

    let el = editable
    if (!(await el.count())) {
      console.log(`标签 "${field.label}" 附近未找到 contenteditable，使用索引定位`)
      el = editableAlt
    }

    if (!(await el.count())) {
      console.log(`⚠ 跳过: ${field.label}，找不到输入框`)
      continue
    }

    await el.click()
    await setTimeout(500)

    // 清空内容
    await page.keyboard.press('Meta+a')
    await setTimeout(200)
    await page.keyboard.press('Backspace')
    await setTimeout(200)

    // 输入纯文本内容（自动去掉序号前缀，防止与OA自动编号重复）
    const lines = field.value.split('\n').filter(Boolean).map(line => line.replace(/^\d+\.\s*/, ''))
    for (let j = 0; j < lines.length; j++) {
      await page.keyboard.type(lines[j], { delay: 3 })
      // 不是最后一行才按回车
      if (j < lines.length - 1) {
        await page.keyboard.press('Enter')
        await setTimeout(200)
      }
    }

    console.log(`已输入: ${field.label}`)
  }

  // 等待自动保存触发
  console.log('等待自动保存...')
  await setTimeout(8000)

  console.log(`保存请求数: ${savedRequests.length}`)

  if (savedRequests.some(r => r.url.includes('Draft'))) {
    console.log('✅ Draft 保存请求已发出')
  }

  await page.screenshot({ path: '/tmp/weekly-report-result.png', fullPage: true })
  console.log('截图已保存')

  await setTimeout(5000)
  await browser.close()
}

// 优先读取 template.md，否则使用环境变量
const content = parseTemplate(TEMPLATE_PATH)
console.log('周报内容:')
console.log('  完成:', content.completed.substring(0, 50) + '...')
console.log('  未完成:', content.uncompleted.substring(0, 50) + '...')
console.log('  计划:', content.nextPlan.substring(0, 50) + '...')
console.log('  协调:', content.help)
console.log('  反思:', content.reflection.substring(0, 50) + '...')

fillReport(content).catch(err => {
  console.error('失败:', err.message)
  process.exit(1)
})