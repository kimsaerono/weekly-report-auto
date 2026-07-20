import { chromium } from 'playwright'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { createServer } from 'http'
import { config } from 'dotenv'

config()

const TOKEN_PATH = new URL('../.feishu-user-token.json', import.meta.url).pathname
const REDIRECT_PORT = 18765 // 固定端口，需在飞书应用安全设置中注册
const AUTH_URL = 'https://open.feishu.cn/open-apis/authen/v1/authorize'
const TOKEN_URL = 'https://open.feishu.cn/open-apis/authen/v1/oidc/access_token'
const REFRESH_URL = 'https://open.feishu.cn/open-apis/authen/v1/oidc/refresh_access_token'

const OAUTH_SCOPES = [
  'im:message:readonly',
  'contact:user.base:readonly',
  'calendar:calendar:readonly',
  'task:task:read',
  'docs:doc:readonly',
]

interface UserToken {
  access_token: string
  refresh_token: string
  expires_at: number
  token_type: string
  scope: string
}

function loadToken(): UserToken | null {
  if (!existsSync(TOKEN_PATH)) return null
  try {
    return JSON.parse(readFileSync(TOKEN_PATH, 'utf-8'))
  } catch {
    return null
  }
}

function saveToken(token: UserToken): void {
  writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2))
}

function isTokenExpired(token: UserToken): boolean {
  return Date.now() >= token.expires_at - 60_000 // 提前 60 秒刷新
}

export async function getValidUserToken(force = false): Promise<string | null> {
  if (force) return null

  const token = loadToken()
  if (!token) return null

  // 检查 scope 是否包含所有需要的权限
  const grantedScopes = token.scope?.split(' ') || []
  const missingScopes = OAUTH_SCOPES.filter(s => !grantedScopes.includes(s))
  if (missingScopes.length > 0) {
    console.log(`Token 缺少权限: ${missingScopes.join(', ')}，需要重新授权`)
    return null
  }

  if (!isTokenExpired(token)) {
    return token.access_token
  }

  // 尝试刷新
  try {
    const refreshed = await refreshUserToken(token.refresh_token)
    return refreshed.access_token
  } catch {
    console.log('Token 刷新失败，需要重新授权')
    return null
  }
}

async function refreshUserToken(refreshToken: string): Promise<UserToken> {
  const appSecret = process.env.FEISHU_APP_SECRET!
  const appId = process.env.FEISHU_APP_ID!

  // 先获取 app_access_token
  const appTokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  })
  const { app_access_token } = await appTokenRes.json() as { app_access_token: string }

  const res = await fetch(REFRESH_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${app_access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })
  const data = await res.json() as any

  if (data.code !== 0) {
    throw new Error(`刷新失败: ${data.msg}`)
  }

  const userToken: UserToken = {
    access_token: data.data.access_token,
    refresh_token: data.data.refresh_token,
    expires_at: Date.now() + data.data.expires_in * 1000,
    token_type: data.data.token_type,
    scope: data.data.scope,
  }
  saveToken(userToken)
  console.log('Token 已刷新')
  return userToken
}

async function exchangeCode(code: string): Promise<UserToken> {
  const appSecret = process.env.FEISHU_APP_SECRET!
  const appId = process.env.FEISHU_APP_ID!

  // 先获取 app_access_token
  const appTokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  })
  const { app_access_token } = await appTokenRes.json() as { app_access_token: string }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${app_access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
    }),
  })
  const data = await res.json() as any

  if (data.code !== 0) {
    throw new Error(`换取 token 失败: ${data.msg}`)
  }

  const userToken: UserToken = {
    access_token: data.data.access_token,
    refresh_token: data.data.refresh_token,
    expires_at: Date.now() + data.data.expires_in * 1000,
    token_type: data.data.token_type,
    scope: data.data.scope,
  }
  saveToken(userToken)
  return userToken
}

export async function runOAuthFlow(force = false): Promise<string> {
  const appId = process.env.FEISHU_APP_ID!
  if (!appId) {
    throw new Error('请先配置 FEISHU_APP_ID')
  }

  // 检查是否有有效 token（--renew 时跳过）
  if (!force) {
    const existingToken = await getValidUserToken()
    if (existingToken) {
      console.log('已有有效的用户 Token')
      return existingToken
    }
  } else {
    console.log('强制重新授权...')
  }

  console.log('启动 OAuth 授权流程...')
  console.log(`请求权限: ${OAUTH_SCOPES.join(', ')}`)

  // 启动本地 HTTP 服务器接收回调
  let callbackResolve: ((code: string) => void) | null = null
  const callbackPromise = new Promise<string>((resolve) => {
    callbackResolve = resolve
  })

  const server = createServer((req, res) => {
    const url = new URL(req.url!, `http://localhost`)
    const code = url.searchParams.get('code')

    if (code) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<h1>授权成功</h1><p>可以关闭此页面</p><script>setTimeout(() => window.close(), 1000)</script>')
      callbackResolve!(code)
    } else {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<h1>授权失败</h1><p>未收到授权码</p>')
    }
  })

  await new Promise<void>((resolve) => server.listen(REDIRECT_PORT, '127.0.0.1', () => resolve()))
  const redirectUri = `http://127.0.0.1:${REDIRECT_PORT}`

  console.log(`回调地址: ${redirectUri}`)

  const scopes = encodeURIComponent(OAUTH_SCOPES.join(' '))
  const authUrl = `${AUTH_URL}?app_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}`
  console.log(`授权 URL: ${authUrl}`)

  // 打开浏览器让用户授权
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto(authUrl)

  console.log('请在浏览器中完成授权...')

  // 等待回调
  const code = await callbackPromise

  // 关闭服务器和浏览器
  server.close()
  await browser.close()

  console.log('收到授权码，换取 Token...')

  const userToken = await exchangeCode(code)
  console.log('✓ 用户授权成功')
  console.log(`  Token 有效期: ${Math.floor((userToken.expires_at - Date.now()) / 1000 / 60)} 分钟`)

  return userToken.access_token
}

// 直接运行时执行授权流程
if (import.meta.url === `file://${process.argv[1]}`) {
  const force = process.argv.includes('--renew')
  runOAuthFlow(force).then((token) => {
    console.log(`\nAccess Token: ${token.substring(0, 20)}...`)
    console.log(`Token 已保存到 ${TOKEN_PATH}`)
  }).catch((err) => {
    console.error('授权失败:', err.message)
    process.exit(1)
  })
}
