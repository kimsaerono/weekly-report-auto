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

    if (!existsSync('node_modules')) {
      console.log('📦 安装依赖...')
      try {
        execSync('npm install', { stdio: 'inherit' })
        console.log('✅ 依赖安装完成\n')
      } catch {
        return { success: false, message: '依赖安装失败', nextStep: '请手动运行: npm install', needUserAction: true }
      }
    }

    const loginCheck = this.checkLogin()
    if (!loginCheck.valid) {
      return { success: false, message: '需要登录飞书', nextStep: '请运行: npm run lark:login（扫码登录）', needUserAction: true }
    }

    const openIdCheck = await this.ensureOpenId()
    if (!openIdCheck.valid) {
      return { success: false, message: openIdCheck.message!, needUserAction: true }
    }
    console.log('✅ 已配置 OpenID\n')

    console.log('📊 采集飞书数据...')
    try { execSync('npx tsx scripts/collect-lark.ts', { stdio: 'inherit' }) } catch { console.log('⚠️  飞书数据采集部分失败，继续...') }

    console.log('📊 采集 Git 数据...')
    try { execSync('npx tsx scripts/collect-git.ts', { stdio: 'inherit' }) } catch { console.log('⚠️  Git 数据采集部分失败，继续...') }

    const data = this.prepareReportData()
    await this.sendReportMessage(data)

    return { success: true, message: '数据采集完成，请让 AI 读取并分析', data }
  }

  private static async sendReportMessage(report: any): Promise<void> {
    try {
      const output = execSync('lark-cli user get --user_id me', { encoding: 'utf-8' })
      const currentOpenId = output.match(/open_id:\s*(.+)/)?.[1]?.trim()
      if (!currentOpenId) {
        console.log('⚠️  无法获取当前用户open_id，跳过飞书消息推送')
        return
      }

      const message = `📋 周报已生成完成\n\n` +
        `✅ 本周完成: ${report.completed}\n\n` +
        `📝 OA 草稿: https://oa.feishu.cn/report/record/detail?ruleId=${process.env.FEISHU_REPORT_RULE_ID}&routeFrom=/record/list\n\n` +
        `🤖 由AI自动分析生成`;

      const args = ['im', '+messages-send', '--user_id', currentOpenId, '--message', message]
      execSync(`lark-cli ${args.join(' ')}`, { stdio: 'ignore' })
      console.log('✅ 飞书消息已推送至个人端')
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
      const output = execSync('lark-cli user get --user_id me', { encoding: 'utf-8' })
      const openId = output.match(/open_id:\s*(.+)/)?.[1]?.trim()
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
    return data
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
