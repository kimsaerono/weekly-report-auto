// 共享填单模块：编号列表按钮激活 + Enter/Tab/Shift+Tab 落 1./a./i. 层级
// skill-auto.ts 第 9 步 与 playwright-fill.ts（npm run fill）共用此实现，避免双份逻辑漂移
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'node:url'
import { setTimeout } from 'timers/promises'
import { config } from 'dotenv'
import { CONFIG } from './config.ts'

config()

const RULE_ID = process.env.FEISHU_REPORT_RULE_ID || CONFIG.feishu.reportRuleId
const REPORT_URL = `${CONFIG.feishu.oaReportUrlBase}${RULE_ID}${CONFIG.feishu.oaReportQuery}`
const COOKIE_PATH = process.env.COOKIE_PATH || fileURLToPath(new URL('../.feishu-cookies.json', import.meta.url))
const REPORT_JSON_PATH = fileURLToPath(new URL('../report.json', import.meta.url))

interface Line { text: string; level: number; title: boolean }

interface ReportContent {
  completed?: any
  uncompleted?: any
  nextPlan?: any
  help?: any
  reflection?: any
}

// 消费 report.json 的结构化数组 {title?, level?, text}；兼容旧版纯字符串（正则兜底）
export function buildLines(value: string | Array<{ title?: boolean; level?: number; text: string }>): Line[] {
  const out: Line[] = []
  if (Array.isArray(value)) {
    for (const raw of value) {
      if (!raw || !raw.text) continue
      const t = raw.text.replace(/@/g, '').trim()
      if (!t) continue
      if (raw.title === true) {
        out.push({ text: t, level: 1, title: true })
      } else {
        const level = raw.level === 3 ? 3 : raw.level === 2 ? 2 : 1
        out.push({ text: stripResidualNumber(t), level, title: false })
      }
    }
    return out
  }
  // 旧字符串格式兜底
  for (const raw of (value || '').split('\n')) {
    const line = raw.replace(/@/g, '').trimEnd()
    const t = line.trim()
    if (!t) continue
    if (/^[一二三四五六七八九十]+、/.test(t)) {
      out.push({ text: t, level: 1, title: true })
    } else if (/^(?:i|ii|iii|iv|v|vi|vii)\./.test(t)) {
      out.push({ text: stripResidualNumber(t), level: 3, title: false })
    } else if (/^[a-zA-Z]\./.test(t)) {
      out.push({ text: stripResidualNumber(t), level: 2, title: false })
    } else if (/^\d+\./.test(t)) {
      out.push({ text: stripResidualNumber(t), level: 1, title: false })
    } else {
      out.push({ text: t, level: 1, title: false })
    }
  }
  return out
}

// 防御性清理：去除文本行首的手写序号（防止 OA 重复编号），层级以结构化 level 为准
export function stripResidualNumber(t: string): string {
  return t.replace(/^(?:[一二三四五六七八九十]+、\s*|\d+[\.、]\s*|[a-zA-Z][\.、]\s*|[ivxlcdm]+[\.、]\s*)/i, '').trim()
}

export async function fillField(page: any, ed: any, value: string | Array<{ title?: boolean; level?: number; text: string }>, fieldIdx: number) {
  const isEmpty = (Array.isArray(value) && value.length === 0) || (!Array.isArray(value) && !(value || '').trim())
  if (isEmpty) return
  await ed.click()
  await setTimeout(400)
  await page.keyboard.press('Meta+a')
  await setTimeout(250)
  await page.keyboard.press('Backspace')
  await setTimeout(250)

  // 定位「当前字段」自己的编号按钮（每个字段容器内恰好 1 个），避免依赖页面级 nth 顺序
  async function fieldListButtonIndex(): Promise<number> {
    const idx = await ed.evaluate((el: HTMLElement) => {
      let cur: HTMLElement | null = el.parentElement
      for (let d = 0; d < 10 && cur; d++) {
        const btn = Array.from(cur.querySelectorAll('div[adit-key="list"][adit-value="number"]'))[0] as HTMLElement | undefined
        if (btn) {
          const all = Array.from(document.querySelectorAll('div[adit-key="list"][adit-value="number"]'))
          return all.indexOf(btn)
        }
        cur = cur.parentElement
      }
      return -1
    })
    return idx
  }

  const lines = buildLines(value)
  if (lines.length === 0) return

  let cur = 0 // 0 = 列表外；≥1 = 列表层级
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (i > 0) { await page.keyboard.press('Enter'); await setTimeout(260) }

    if (l.title) {
      // 标题行：普通段落，不参与编号。若仍在列表内，先逐级升出列表
      while (cur > 0) {
        await page.keyboard.press('Shift+Tab')
        await setTimeout(200)
        cur--
      }
      await page.keyboard.type(l.text, { delay: 5 })
      await setTimeout(120)
      continue
    }

    // 非标题行：确保已进入编号列表
    if (cur === 0) {
      const btnIdx = await fieldListButtonIndex()
      const target = btnIdx >= 0 ? page.locator('div[adit-key="list"][adit-value="number"]').nth(btnIdx)
                                 : page.locator('div[adit-key="list"][adit-value="number"]').nth(fieldIdx)
      // 空编辑器上按钮点击可能不生效（典型场景：字段首行即列表项），带焦点重试并校验 <ol> 已出现
      let enteredList = false
      for (let attempt = 0; attempt < 3 && !enteredList; attempt++) {
        if (attempt > 0) {
          await ed.focus().catch(() => {})
          await setTimeout(150)
        }
        await target.click()
        await setTimeout(450)
        enteredList = await ed.evaluate((el: HTMLElement) => {
          for (let x = 0; x < el.children.length; x++) {
            if ((el.children[x] as HTMLElement).querySelector('ol')) return true
          }
          return false
        })
        if (!enteredList) console.log(`   [重试] 字段${fieldIdx} 编号按钮未生效，第 ${attempt + 1} 次重试`)
      }
      cur = 1
    }

    const diff = l.level - cur
    if (diff > 0) for (let t = 0; t < diff; t++) await page.keyboard.press('Tab')
    if (diff < 0) for (let t = 0; t < -diff; t++) await page.keyboard.press('Shift+Tab')
    await setTimeout(220)
    await page.keyboard.type(l.text, { delay: 5 })
    cur = l.level
    await setTimeout(140)
  }
}

// 回读 DOM 验证层级结构
export async function verifyHierarchy(page: any, fieldIdx: number): Promise<boolean> {
  try {
    const ed = page.locator('[contenteditable="true"]').nth(fieldIdx)
    const structure = await ed.evaluate((el: HTMLElement) => {
      const result: Array<{idx: number, className: string, text: string, level: number}> = []
      for (let i = 0; i < el.children.length; i++) {
        const c = el.children[i] as HTMLElement
        const className = c.className || ''
        const olClass = (c.querySelector('ol')?.className) || ''
        let level = 0
        if (/list-number(\d+)/.test(olClass)) {
          level = parseInt(olClass.match(/list-number(\d+)/)![1], 10)
        } else if (className.includes('text-indent')) {
          level = 2
        } else if (className.includes('list-div')) {
          level = 1
        } else if (className.includes('ace-line')) {
          level = 0 // 普通段落（标题/空行）
        }
        result.push({idx: i, className, text: c.innerText?.substring(0, 40) || '', level})
      }
      return result
    })
    console.log(`  [验证] 字段${fieldIdx} 共${structure.length}行:`)
    for (const row of structure) {
      console.log(`   L${row.level} :: ${row.text}`)
    }
    return true
  } catch (e: any) {
    console.log(`  [验证] 字段${fieldIdx} 失败: ${e.message}`)
    return false
  }
}

function loadReport(): ReportContent {
  if (!existsSync(REPORT_JSON_PATH)) {
    console.error('❌ 未找到 report.json，请先运行 generate-report.ts')
    process.exit(1)
  }
  return JSON.parse(readFileSync(REPORT_JSON_PATH, 'utf-8'))
}

// 变量暂存，避免 ESM 顶层循环依赖

// 主入口：读取 report.json（或传入 content）→ 打开 OA 草稿 → 逐字段两阶段填写 → 验证层级 → 截图
export async function fillReportToOA(opts?: { holdMs?: number; keepOpen?: boolean; content?: ReportContent }): Promise<void> {
  try { execSync('npx playwright install chromium 2>/dev/null', { stdio: 'pipe' }) } catch {}

  const report = opts?.content || loadReport()

  const normalizeField = (v: any): string | Array<{ title?: boolean; level?: number; text: string }> => {
    if (Array.isArray(v)) return v.map((l: any) => (typeof l === 'string' ? { level: 1, text: l } : l))
    return v || ''
  }

  const fieldMap: Array<{ label: string; value: string | Array<{ title?: boolean; level?: number; text: string }> }> = CONFIG.oa.fields.map(f => ({
    label: f.label,
    value: normalizeField((report as any)[f.key]),
  }))

  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({ viewport: { width: 1280, height: 920 } })
  const page = await context.newPage()

  let loggedIn = false
  if (existsSync(COOKIE_PATH)) {
    const cookies = JSON.parse(readFileSync(COOKIE_PATH, 'utf-8'))
    await context.addCookies(cookies).catch(() => {})
    await page.goto(REPORT_URL, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {})
    await setTimeout(6000)
    if (page.url().includes('/report/')) {
      console.log('Cookie 有效')
      loggedIn = true
    }
  }

  if (!loggedIn) {
    console.log('需要扫码登录飞书...')
    await page.goto(REPORT_URL, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {})
    await setTimeout(3000)
    if (page.url().includes('accounts') || page.url().includes('login')) {
      console.log('=== 请使用飞书手机端扫码登录 ===')
      await page.waitForURL('**/report/**', { timeout: 180000 }).catch(() => {})
      console.log('登录成功')
    }
    try {
      const cookies = await context.cookies()
      const { writeFileSync } = await import('fs')
      writeFileSync(COOKIE_PATH, JSON.stringify(cookies, null, 2))
      console.log('Cookie 已保存')
    } catch {}
    await setTimeout(5000)
  }

  if (!page.url().includes('/report/')) {
    await page.goto(REPORT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
    await setTimeout(5000)
  }

  for (let i = 0; i < fieldMap.length; i++) {
    const f = fieldMap[i]
    let editable = page.locator(`text="${f.label}"`).first().locator('xpath=following::div[@contenteditable="true"]').first()
    let located = false

    if (await editable.count()) {
      const vis = await editable.isVisible().catch(() => false)
      if (vis) { located = true; console.log(`  [定位] ${f.label} → 标签精确定位`) }
    }

    if (!located) {
      editable = page.locator('[contenteditable="true"]').nth(i)
      if (await editable.count()) {
        const vis = await editable.isVisible().catch(() => false)
        if (vis) { located = true; console.log(`  [定位] ${f.label} → 索引定位 (nth=${i})`) }
      }
    }

    if (!located) {
      console.log(`⚠ 找不到 ${f.label} 输入框，跳过`)
      continue
    }

    console.log(`\n=== 填入: ${f.label} ===`)
    await fillField(page, editable, f.value, i)

    // 填入后验证
    await verifyHierarchy(page, i)
  }

  console.log('\n全部字段填充完成，等待自动保存...')
  await setTimeout(8000)

  // 截图留存
  try {
    await page.screenshot({ path: process.env.SCREENSHOT_PATH || '/tmp/weekly-report-result.png', fullPage: true })
    console.log('📸 截图已保存到 /tmp/weekly-report-result.png')
  } catch {}

  if (opts?.keepOpen === false) {
    await setTimeout(3000)
    await browser.close()
    return
  }

  console.log(`\n⏸ 浏览器保持开启 ${((opts?.holdMs ?? 60000) / 1000)} 秒供人工核对渲染...`)
  await setTimeout(opts?.holdMs ?? 60000)
  await browser.close()
}