import { chromium } from 'playwright'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { execSync } from 'child_process'
import { setTimeout } from 'timers/promises'

const RULE_ID = process.env.FEISHU_REPORT_RULE_ID
if (!RULE_ID) { console.error('请配置 FEISHU_REPORT_RULE_ID'); process.exit(1) }
const REPORT_URL = `https://oa.feishu.cn/report/record/detail?ruleId=${RULE_ID}&routeFrom=/record/list`
const COOKIE_PATH = process.env.COOKIE_PATH || new URL('../.feishu-cookies.json', import.meta.url).pathname

interface ReportContent {
  completed: string
  uncompleted: string
  nextPlan: string
  help: string
  reflection: string
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
      // 搜索关键字段内容
      const hasFieldValues = body.includes('fieldValues') || body.includes('fieldValue')
      const hasContent = body.includes('本周完成') || body.includes('性能优化') || body.includes('Playwright')
      console.log(`\n=== Draft 请求 (hasFieldValues=${hasFieldValues}, hasContent=${hasContent}) ===`)
      console.log(`body length: ${body.length}`)
      if (hasFieldValues) {
        const idx = body.indexOf('fieldValues')
        console.log('fieldValues 附近:', body.slice(Math.max(0, idx - 50), idx + 300))
      }
      if (hasContent) {
        console.log('包含内容位置:', body.indexOf('本周完成'), body.indexOf('性能优化'))
      } else {
        console.log('body:', body.slice(body.length - 500))
      }
      savedRequests.push({ url: url.slice(0, 120), method: request.method(), body })
    }
  })

  page.on('response', (response: any) => {
    const url = response.url()
    if (url.includes('DraftUserRuleWriteView') || url.includes('SubmitUserRuleWriteView')) {
      response.text().then((t: string) => {
        console.log('保存响应:', t.slice(0, 300))
      }).catch(() => {})
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

  const editables = page.locator('[contenteditable="true"]')

  for (let i = 0; i < Math.min(await editables.count(), fields.length); i++) {
    const field = fields[i]
    if (!field.value) continue

    const el = editables.nth(i)
    await el.click()
    await setTimeout(500)
    await page.keyboard.press('Meta+a')
    await setTimeout(200)
    await page.keyboard.type(field.value, { delay: 3 })
    console.log(`已输入: ${field.label}`)
  }

  // 等待自动保存触发（不要点击返回，避免导航）
  console.log('等待自动保存...')
  await setTimeout(8000)

  console.log(`保存请求数: ${savedRequests.length}`)
  for (const r of savedRequests) {
    console.log(`  [${r.method}] ${r.url}`)
    console.log(`  body: ${r.body.slice(0, 300)}`)
  }

  if (savedRequests.some(r => r.url.includes('Draft'))) {
    console.log('✅ Draft 保存请求已发出')
  }

  await page.screenshot({ path: '/tmp/weekly-report-result.png', fullPage: true })
  console.log('截图已保存')

  // 等待额外时间确保保存完成
  await setTimeout(5000)
  await browser.close()
}

const content: ReportContent = {
  completed: process.env.REPORT_COMPLETED || '',
  uncompleted: process.env.REPORT_UNCOMPLETED || '',
  nextPlan: process.env.REPORT_NEXT_PLAN || '',
  help: process.env.REPORT_HELP || '',
  reflection: process.env.REPORT_REFLECTION || '',
}

fillReport(content).catch(err => {
  console.error('失败:', err.message)
  process.exit(1)
})
