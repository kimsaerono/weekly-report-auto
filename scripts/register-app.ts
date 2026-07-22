#!/usr/bin/env node
import * as lark from '@larksuiteoapi/node-sdk'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'node:url'
import { execSync } from 'child_process'

interface AppConfig {
  appId: string
  appSecret: string
  openId?: string
  createdAt?: string
}

function loadConfig(): AppConfig | null {
  const appId = process.env.FEISHU_APP_ID
  const appSecret = process.env.FEISHU_APP_SECRET
  if (appId && appSecret) {
    return {
      appId,
      appSecret,
      openId: process.env.FEISHU_OPEN_ID,
      createdAt: process.env.FEISHU_APP_CREATED_AT,
    }
  }
  return null
}

function saveConfig(config: AppConfig): void {
  const envPath = fileURLToPath(new URL('../.env', import.meta.url))
  let content = ''
  try {
    content = readFileSync(envPath, 'utf-8')
  } catch {}

  const updates = [
    { key: 'FEISHU_APP_ID', value: config.appId },
    { key: 'FEISHU_APP_SECRET', value: config.appSecret },
    { key: 'FEISHU_OPEN_ID', value: config.openId || '' },
    { key: 'FEISHU_APP_CREATED_AT', value: config.createdAt || new Date().toISOString() },
  ]

  for (const { key, value } of updates) {
    if (!value) continue
    if (content.includes(`${key}=`)) {
      content = content.replace(new RegExp(`${key}=.*`), `${key}="${value}"`)
    } else {
      content += `\n${key}="${value}"`
    }
  }

  writeFileSync(envPath, content.trim() + '\n')
}

function generateQRCode(url: string): void {
  try {
    execSync(`lark-cli auth qrcode "${url}" --output ./lark-qr.png --size 200`, { stdio: 'pipe' })
    console.log('📸 二维码已保存到 lark-qr.png')
  } catch {}
}

function openBrowser(url: string): void {
  try {
    console.log('🚀 正在打开浏览器...')
    const platform = process.platform
    if (platform === 'darwin') {
      execSync(`open "${url}"`, { stdio: 'pipe' })
    } else if (platform === 'win32') {
      execSync(`start "" "${url}"`, { stdio: 'pipe' })
    } else {
      execSync(`xdg-open "${url}"`, { stdio: 'pipe' })
    }
    console.log('✅ 已打开浏览器')
  } catch (e) {
    console.error('❌ 打开浏览器失败:', e)
  }
}

export async function registerApp(): Promise<AppConfig> {
  const existing = loadConfig()
  if (existing?.appId && existing?.appSecret) {
    console.log('✅ 已有应用配置，跳过创建')
    return existing
  }

  console.log('🚀 创建飞书应用（扫码授权）...\n')

  const result = await lark.registerApp({
    createOnly: true,
    appPreset: {
      name: '周报自动化-{user}',
      desc: '自动采集飞书数据，生成周报并填入OA',
    },
    addons: {
      preset: true,
      scopes: {
        tenant: [
          'im:message',
          'im:message:send_as_bot',
          'im:message:send_as_user',
          'im:message.group_msg:get_as_user',
          'im:message.p2p_msg:get_as_user',
          'im:message:readonly',
          'im:chat:readonly',
          'im:chat.members:read',
          'im:resource',
          'search:message',
          'contact:user.base:readonly',
          'contact:user.employee_id:readonly',
          'calendar:calendar:read',
          'calendar:calendar.event:read',
          'calendar:calendar.free_busy:read',
          'task:task:read',
          'task:tasklist:read',
          'task:task:write',
          'task:tasklist:write',
          'task:section:read',
          'task:section:write',
          'task:comment:write',
          'task:custom_field:read',
          'task:attachment:write',
          'docs:doc:readonly',
          'drive:drive:readonly',
          'auth:user.id:read',
          'offline_access',
        ],
        user: [
          'calendar:calendar.event:read',
          'calendar:calendar:read',
          'task:task:read',
          'task:tasklist:read',
          'im:message',
          'im:message:readonly',
        ],
      },
    },
    onQRCodeReady(info) {
      console.log('\n📱 请在浏览器中扫描二维码创建飞书应用：\n')
      console.log('🔗 URL:', info.url)
      openBrowser(info.url)
      console.log(`⏰ 二维码 ${info.expireIn} 秒后过期\n`)
    },
    onStatusChange(info) {
      if (info.status === 'slow_down') {
        console.log('⏳ 轮询中...')
      }
    },
  })

  const config: AppConfig = {
    appId: result.client_id,
    appSecret: result.client_secret,
    openId: result.user_info?.open_id,
    createdAt: new Date().toISOString(),
  }

  saveConfig(config)
  console.log('\n✅ 应用创建成功！')
  console.log(`  App ID: ${config.appId}`)
  console.log(`  Open ID: ${config.openId || '未获取'}`)

  return config
}

export async function configureLarkCli(config: AppConfig): Promise<void> {
  console.log('\n🔧 配置 lark-cli...')

  try {
    const cmd = `echo "${config.appSecret}" | lark-cli config init --app-id ${config.appId} --app-secret-stdin --new`
    execSync(cmd, { stdio: 'pipe' })
    console.log('✅ lark-cli 已配置')
  } catch (error: any) {
    console.log(`⚠️  lark-cli 配置失败: ${error.message}`)
  }
}

export async function loginLarkCli(): Promise<void> {
  console.log('\n🔐 登录飞书...')

  try {
    // 先获取 device code
    const loginResult = execSync('lark-cli auth login --domain im,calendar,task,contact --no-wait --json', { encoding: 'utf-8' })
    const loginInfo = JSON.parse(loginResult)
    
    if (!loginInfo.device_code || !loginInfo.verification_url) {
      throw new Error('获取登录信息失败')
    }

    // 打开浏览器
    console.log('🌐 正在打开浏览器...')
    const platform = process.platform
    if (platform === 'darwin') {
      execSync(`open "${loginInfo.verification_url}"`, { stdio: 'pipe' })
    } else if (platform === 'win32') {
      execSync(`start "" "${loginInfo.verification_url}"`, { stdio: 'pipe' })
    } else {
      execSync(`xdg-open "${loginInfo.verification_url}"`, { stdio: 'pipe' })
    }
    console.log('✅ 已打开浏览器，请扫码授权')
    console.log(`⏰ 授权码 ${loginInfo.expires_in} 秒后过期`)

    // 使用阻塞命令等待用户授权完成
    console.log('⏳ 等待授权中...')
    try {
      execSync(`lark-cli auth login --device-code ${loginInfo.device_code}`, { encoding: 'utf-8', timeout: loginInfo.expires_in * 1000 })
      console.log('✅ 登录成功')
    } catch (error: any) {
      throw new Error('授权超时或失败')
    }
  } catch (error: any) {
    console.log(`⚠️  登录失败: ${error.message}`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  registerApp()
    .then(config => configureLarkCli(config))
    .then(() => loginLarkCli())
    .then(() => console.log('\n✅ 初始化完成'))
    .catch(err => {
      console.error('❌ 失败:', err.message)
      process.exit(1)
    })
}
