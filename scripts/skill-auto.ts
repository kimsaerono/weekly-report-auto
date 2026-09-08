#!/usr/bin/env node
import { execSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'

config()

interface SkillResult {
  success: boolean
  message: string
  data?: any
  nextStep?: string
  needUserAction?: boolean
}

class SkillAutomation {
  static async run(): Promise<SkillResult> {
    console.log('🚀 周报自动化 Skill 启动\n')

    // 1. 检查依赖
    if (!existsSync('node_modules')) {
      console.log('📦 安装依赖...')
      try {
        execSync('npm install', { stdio: 'inherit' })
        console.log('✅ 依赖安装完成\n')
      } catch {
        return { success: false, message: '依赖安装失败', nextStep: '请手动运行: npm install', needUserAction: true }
      }
    }

    // 2. 检查飞书应用配置
    const appConfig = this.checkAppConfig()
    if (!appConfig) {
      console.log('📱 首次使用，需要创建飞书应用...')
      try {
        execSync('npx tsx scripts/register-app.ts', { stdio: 'inherit' })
      } catch (error: any) {
        return { success: false, message: `应用创建失败: ${error.message}`, needUserAction: true }
      }
    }

    // 3. 检查 lark-cli 登录状态
    const loginCheck = this.checkLogin()
    if (!loginCheck.valid) {
      console.log('🔐 需要登录飞书...')
      try {
        // 获取 device code
        const loginResult = JSON.parse(execSync('lark-cli auth login --domain im,calendar,task,contact --no-wait --json', { encoding: 'utf-8' }))
        
        if (!loginResult.device_code || !loginResult.verification_url) {
          throw new Error('获取登录信息失败')
        }

        // 打开浏览器
        console.log('🌐 正在打开浏览器...')
        execSync(`open "${loginResult.verification_url}"`, { stdio: 'pipe' })
        console.log('✅ 已打开浏览器，请扫码授权')
        console.log(`⏰ 授权码 ${loginResult.expires_in} 秒后过期`)

        // 等待用户授权完成
        console.log('⏳ 等待授权中...')
        execSync(`lark-cli auth login --device-code ${loginResult.device_code}`, { timeout: loginResult.expires_in * 1000 })
        console.log('✅ 登录成功')
      } catch (error: any) {
        return { success: false, message: `登录失败: ${error.message}`, needUserAction: true }
      }
    }

    // 4. 获取 OpenID
    const openIdCheck = await this.ensureOpenId()
    if (!openIdCheck.valid) {
      return { success: false, message: openIdCheck.message!, needUserAction: true }
    }
    console.log('✅ 已配置 OpenID\n')

    // 5. 采集飞书数据
    console.log('📊 采集飞书数据...')
    try { execSync('npx tsx scripts/collect-lark.ts', { stdio: 'inherit' }) } catch { console.log('⚠️  飞书数据采集部分失败，继续...') }

    // 6. 采集 Git 数据
    console.log('📊 采集 Git 数据...')
    try { execSync('npx tsx scripts/collect-git.ts', { stdio: 'inherit' }) } catch { console.log('⚠️  Git 数据采集部分失败，继续...') }

    // 6.5 采集 AI 工具会话历史（opencode / Claude Code / Cursor / Windsurf / Trae / Codeium）
    console.log('📊 采集 AI 工具会话历史...')
    try { execSync('npx tsx scripts/collect-ai-tools.ts', { stdio: 'inherit' }) } catch { console.log('⚠️  AI 工具数据采集部分失败，继续...') }

    // 6.6 采集飞书文档笔记（未授权时优雅跳过）
    console.log('📓 采集飞书文档笔记...')
    try { execSync('npx tsx scripts/collect-notes.ts', { stdio: 'inherit' }) } catch { console.log('⚠️  笔记数据采集部分失败，继续...') }

    // 6.7 若本周无数据（如周一时本周才刚开始），自动回退采集上周数据
    if (!this.hasWeekData()) {
      console.log('\n📅 本周数据为空，自动回退采集上周数据...\n')
      const envLastWeek = { ...process.env, WEEK_OFFSET: '1' }
      const collectWithEnv = (script: string) => {
        try { execSync(`npx tsx scripts/${script}`, { stdio: 'inherit', env: envLastWeek }) } catch {}
      }
      collectWithEnv('collect-lark.ts')
      collectWithEnv('collect-git.ts')
      collectWithEnv('collect-ai-tools.ts')
      collectWithEnv('collect-notes.ts')
    }

    // 7. 生成周报内容
    console.log('🤖 生成周报内容...')
    try { execSync('npx tsx scripts/generate-report.ts', { stdio: 'inherit' }) } catch { console.log('⚠️  报告生成部分失败，继续...') }

    // 8. 飞书消息推送
    const data = this.prepareReportData()
    await this.sendReportMessage(data)

    // 9. 填入 OA 草稿（自动分层编号：Tab 降级，Shift+Tab 升级）
    console.log('📝 填入飞书 OA 草稿（自动分层编号）...')
    try {
      await this.fillReportToOA()
    } catch (error: any) {
      return { success: false, message: `填入失败: ${error.message}` }
    }

    // 10. 系统通知
    console.log('📢 发送系统通知...')
    try { execSync('npx tsx scripts/notify-final.ts', { stdio: 'inherit' }) } catch { console.log('⚠️  通知发送失败') }

    return { success: true, message: '周报自动化完成', data }
  }

  private static checkAppConfig(): boolean {
    return !!(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET)
  }

  private static async sendReportMessage(report: any): Promise<void> {
    try {
      const output = execSync('lark-cli contact +get-user', { encoding: 'utf-8' })
      const result = JSON.parse(output)
      const currentOpenId = result?.data?.user?.open_id
      if (!currentOpenId) {
        console.log('⚠️  无法获取当前用户open_id，跳过飞书消息推送')
        return
      }

      const ruleId = process.env.FEISHU_REPORT_RULE_ID || '7179489743821406210'
      const message = `周报已生成完成\n本周完成: ${report.completed?.substring(0, 80) || '已生成'}\nOA草稿: https://oa.feishu.cn/report/record/detail?ruleId=${ruleId}&routeFrom=/record/list`

      const tempFile = '/tmp/lark-message.txt'
      writeFileSync(tempFile, message)
      
      try {
        execSync(`lark-cli im +messages-send --user-id "${currentOpenId}" --text "$(cat ${tempFile})"`, { stdio: 'ignore' })
        console.log('✅ 飞书消息已推送至个人端')
      } finally {
        try { require('fs').unlinkSync(tempFile) } catch {}
      }
    } catch (error: any) {
      console.log('⚠️  飞书消息推送失败:', error.message)
    }
  }

  private static checkLogin(): { valid: boolean } {
    try { execSync('lark-cli config show', { stdio: 'ignore' }); return { valid: true } } catch { return { valid: false } }
  }

  private static async ensureOpenId(): Promise<{ valid: boolean; message?: string }> {
    const existingOpenId = this.getExistingOpenId()
    if (existingOpenId) return { valid: true }

    console.log('🔍 自动获取 OpenID...')
    try {
      const output = execSync('lark-cli contact +get-user', { encoding: 'utf-8' })
      const result = JSON.parse(output)
      const openId = result?.data?.user?.open_id
      if (openId) { this.saveOpenIdToEnv(openId); return { valid: true } }
    } catch (error: any) {
      return { valid: false, message: `获取 OpenID 失败: ${error.message}` }
    }
    return { valid: false, message: '无法获取 OpenID' }
  }

  private static getExistingOpenId(): string | null {
    if (!existsSync('.env')) return null
    const env = readFileSync('.env', 'utf-8')
    const match = env.match(/FEISHU_OPEN_ID="?([^"\n]+)"?/)
    return match?.[1] || null
  }

  private static saveOpenIdToEnv(openId: string): void {
    let env = ''
    if (existsSync('.env')) {
      env = readFileSync('.env', 'utf-8')
      if (env.includes('FEISHU_OPEN_ID=')) {
        env = env.replace(/FEISHU_OPEN_ID=.*/, `FEISHU_OPEN_ID="${openId}"`)
      } else {
        env += `\nFEISHU_OPEN_ID="${openId}"\n`
      }
      // 确保 FEISHU_REPORT_RULE_ID 存在
      if (!env.includes('FEISHU_REPORT_RULE_ID=')) {
        env += `FEISHU_REPORT_RULE_ID="7179489743821406210"\n`
      }
    } else {
      env = `FEISHU_OPEN_ID="${openId}"\nFEISHU_REPORT_RULE_ID="7179489743821406210"\n`
    }
    writeFileSync('.env', env)
    console.log('✅ OpenID 已自动保存')
  }

  private static prepareReportData(): any {
    const data: any = {}
    if (existsSync('collected-data.json')) Object.assign(data, JSON.parse(readFileSync('collected-data.json', 'utf-8')))
    if (existsSync('git-commits.json')) Object.assign(data, { git: JSON.parse(readFileSync('git-commits.json', 'utf-8')) })
    if (existsSync('ai-data.json')) Object.assign(data, { ai: JSON.parse(readFileSync('ai-data.json', 'utf-8')) })
    if (existsSync('notes-data.json')) Object.assign(data, { notes: JSON.parse(readFileSync('notes-data.json', 'utf-8')) })
    return data
  }

  // 判断本周是否已有可用数据（git 提交 / opencode 会话 / 任务 有内容即视为有效；聊天消息不算工作数据）
  private static hasWeekData(): boolean {
    try {
      if (existsSync('git-commits.json')) {
        const git = JSON.parse(readFileSync('git-commits.json', 'utf-8'))
        if (git?.commits?.length > 0) return true
      }
      if (existsSync('ai-data.json')) {
        const ai = JSON.parse(readFileSync('ai-data.json', 'utf-8'))
        if (ai?.sessions?.length > 0) return true
      }
      if (existsSync('notes-data.json')) {
        const notes = JSON.parse(readFileSync('notes-data.json', 'utf-8'))
        if (notes?.notes?.length > 0) return true
      }
      if (existsSync('collected-data.json')) {
        const c = JSON.parse(readFileSync('collected-data.json', 'utf-8'))
        if (c?.tasks?.completed?.length > 0 || c?.tasks?.incomplete?.length > 0) return true
      }
      return false
    } catch { return false }
  }

  private static async fillReportToOA(): Promise<void> {
    const { chromium } = await import('playwright')
    const { readFileSync, existsSync } = await import('fs')
    const { setTimeout } = await import('timers/promises')
    const { config } = await import('dotenv')
    config()

    const RULE_ID = process.env.FEISHU_REPORT_RULE_ID
    const REPORT_URL = `https://oa.feishu.cn/report/record/detail?ruleId=${RULE_ID}&routeFrom=/record/list`
    const COOKIE = new URL('../.feishu-cookies.json', import.meta.url).pathname

    interface Line { text: string; level: number; title: boolean }

    function buildLines(value: string): Line[] {
      const out: Line[] = []
      for (const raw of value.split('\n')) {
        const line = raw.replace(/@/g, '').trimEnd()
        const t = line.trim()
        if (!t) continue
        if (/^[一二三四五六七八九十]+、/.test(t)) {
          out.push({ text: t, level: 1, title: true })
        } else if (/^(?:i|ii|iii|iv|v|vi|vii)\./.test(t)) {
          out.push({ text: t.replace(/^[ivxlcdm]+\.\s*/i, ''), level: 3, title: false })
        } else if (/^[a-zA-Z]\./.test(t)) {
          out.push({ text: t.replace(/^[a-zA-Z]\.\s*/, ''), level: 2, title: false })
        } else if (/^\d+\./.test(t)) {
          out.push({ text: t.replace(/^\d+\.\s*/, ''), level: 1, title: false })
        } else {
          out.push({ text: t, level: 1, title: false })
        }
      }
      return out
    }

    async function fillField(page: any, ed: any, value: string, fieldIdx: number) {
      if (!value || value.trim() === '') return
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
          await target.click()
          await setTimeout(500)
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
    async function verifyHierarchy(page: any, fieldIdx: number): Promise<boolean> {
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

    const report = JSON.parse(readFileSync(new URL('../report.json', import.meta.url), 'utf-8'))
    const fieldMap: Array<{ label: string; value: string }> = [
      { label: '本周完成工作', value: report.completed || '' },
      { label: '本周未完成工作及原因', value: report.uncompleted || '' },
      { label: '下周工作计划', value: report.nextPlan || '' },
      { label: '需要协调与帮助', value: report.help || '' },
      { label: '学习和反思', value: report.reflection || '' },
    ]

    const browser = await chromium.launch({ headless: false })
    const context = await browser.newContext({ viewport: { width: 1280, height: 920 } })
    const page = await context.newPage()
    if (existsSync(COOKIE)) { const c = JSON.parse(readFileSync(COOKIE, 'utf-8')); await context.addCookies(c) }
    await page.goto(REPORT_URL, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {})
    await setTimeout(6000)

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
      await page.screenshot({ path: '/tmp/weekly-report-result.png', fullPage: true })
      console.log('📸 截图已保存到 /tmp/weekly-report-result.png')
    } catch {}

    console.log('\n⏸ 浏览器保持开启 60 秒供人工核对渲染...')
    await setTimeout(60000)
    await browser.close()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  SkillAutomation.run().then(result => {
    console.log('\n' + '='.repeat(50))
    if (result.success) { console.log('✅ 成功') } else { console.log('❌ 需要用户操作') }
    console.log(result.message)
    if (result.nextStep) console.log(`\n👉 ${result.nextStep}`)
    process.exit(result.success ? 0 : 1)
  })
}

export { SkillAutomation }
