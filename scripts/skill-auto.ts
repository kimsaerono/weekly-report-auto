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

    // 7. 生成周报内容
    console.log('🤖 生成周报内容...')
    try { execSync('npx tsx scripts/generate-report.ts', { stdio: 'inherit' }) } catch { console.log('⚠️  报告生成部分失败，继续...') }

    // 8. 飞书消息推送
    const data = this.prepareReportData()
    await this.sendReportMessage(data)

    // 9. 填入 OA 草稿
    console.log('📝 填入飞书 OA 草稿...')
    try {
      execSync('npx tsx scripts/playwright-fill.ts', { stdio: 'inherit' })
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
