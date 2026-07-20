import type { FeishuConfig } from './types.ts'
import { readFileSync, writeFileSync, existsSync } from 'fs'

const TOKEN_PATH = new URL('../.feishu-user-token.json', import.meta.url).pathname
const REQUIRED_SCOPES = [
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

export class FeishuClient {
  private config: FeishuConfig
  private tenantToken: string | null = null
  private tenantTokenExpire: number = 0
  private userToken: UserToken | null = null

  constructor(config: FeishuConfig) {
    this.config = config
    this.loadUserToken()
  }

  private loadUserToken(): void {
    if (!existsSync(TOKEN_PATH)) return
    try {
      this.userToken = JSON.parse(readFileSync(TOKEN_PATH, 'utf-8'))
    } catch {
      this.userToken = null
    }
  }

  private saveUserToken(): void {
    if (this.userToken) {
      writeFileSync(TOKEN_PATH, JSON.stringify(this.userToken, null, 2))
    }
  }

  async getTenantToken(): Promise<string> {
    if (this.tenantToken && Date.now() < this.tenantTokenExpire) return this.tenantToken!
    const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: this.config.appId, app_secret: this.config.appSecret })
    })
    const data = await res.json() as { code: number; tenant_access_token: string; expire: number }
    if (data.code !== 0) throw new Error(`获取 token 失败: ${JSON.stringify(data)}`)
    this.tenantToken = data.tenant_access_token
    this.tenantTokenExpire = Date.now() + (data.expire - 60) * 1000
    return this.tenantToken!
  }

  async getUserToken(): Promise<string | null> {
    if (!this.userToken) return null

    // 检查 scope 是否包含所有需要的权限
    const grantedScopes = this.userToken.scope?.split(' ') || []
    const missingScopes = REQUIRED_SCOPES.filter(s => !grantedScopes.includes(s))
    if (missingScopes.length > 0) {
      console.log(`Token 缺少权限: ${missingScopes.join(', ')}，需要重新授权`)
      this.userToken = null
      return null
    }

    if (Date.now() < this.userToken.expires_at - 60_000) {
      return this.userToken.access_token
    }

    // 尝试刷新
    try {
      await this.refreshUserToken()
      return this.userToken!.access_token
    } catch {
      console.log('用户 Token 刷新失败，需要重新授权')
      this.userToken = null
      return null
    }
  }

  private async refreshUserToken(): Promise<void> {
    if (!this.userToken) throw new Error('无用户 Token')

    const appTokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: this.config.appId, app_secret: this.config.appSecret }),
    })
    const { app_access_token } = await appTokenRes.json() as { app_access_token: string }

    const res = await fetch('https://open.feishu.cn/open-apis/authen/v1/oidc/refresh_access_token', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${app_access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: this.userToken.refresh_token,
      }),
    })
    const data = await res.json() as any

    if (data.code !== 0) {
      throw new Error(`刷新失败: ${data.msg}`)
    }

    this.userToken = {
      access_token: data.data.access_token,
      refresh_token: data.data.refresh_token,
      expires_at: Date.now() + data.data.expires_in * 1000,
      token_type: data.data.token_type,
      scope: data.data.scope,
    }
    this.saveUserToken()
    console.log('用户 Token 已刷新')
  }

  async getBestToken(): Promise<string> {
    const userToken = await this.getUserToken()
    if (userToken) return userToken
    return this.getTenantToken()
  }

  async searchMessages(openId: string, startTime: number, endTime: number): Promise<string[]> {
    const token = await this.getBestToken()
    const keywords = ['上线', '需求', 'bug', '修复', '项目', '任务', '推进', '发布', '问题', '优化', '完成', '提测', '合并', '部署']
    const allMessageIds = new Set<string>()
    for (const keyword of keywords) {
      const res = await fetch('https://open.feishu.cn/open-apis/search/v2/message', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: keyword,
          from_ids: [openId],
          start_time: String(Math.floor(startTime / 1000)),
          end_time: String(Math.floor(endTime / 1000)),
          page_size: 50
        })
      })
      const data = await res.json() as { code: number; data?: { items?: string[] } }
      if (data.code === 0 && data.data?.items) {
        data.data.items.forEach(id => allMessageIds.add(id))
      }
    }
    return Array.from(allMessageIds)
  }

  async getMessageContent(messageId: string): Promise<string> {
    const token = await this.getBestToken()
    const res = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages/${messageId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    const data = await res.json() as { code: number; data?: { items?: Array<{ body?: { content?: string }; msg_type?: string }> } }
    if (data.code !== 0 || !data.data?.items?.[0]) return ''
    const msg = data.data.items[0]
    const content = msg.body?.content || ''
    if (msg.msg_type === 'text') {
      try { return JSON.parse(content).text || content } catch { return content }
    }
    return content
  }

  async getChatList(): Promise<Array<{ chat_id: string; name: string }>> {
    const token = await this.getBestToken()
    const res = await fetch('https://open.feishu.cn/open-apis/im/v1/chats?page_size=100', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    const data = await res.json() as { code: number; data?: { items?: Array<{ chat_id: string; name: string }> } }
    if (data.code !== 0 || !data.data?.items) return []
    return data.data.items
  }

  async getChatMessages(chatId: string, startTime: string, endTime: string): Promise<Array<{ body?: { content?: string }; msg_type?: string; sender?: { id?: string; id_type?: string; sender_type?: string }; create_time?: string }>> {
    const token = await this.getBestToken()
    const allItems: Array<any> = []
    let pageToken: string | undefined
    do {
      const url = `https://open.feishu.cn/open-apis/im/v1/messages?container_id_type=chat&container_id=${chatId}&start_time=${startTime}&end_time=${endTime}&page_size=50${pageToken ? `&page_token=${pageToken}` : ''}`
      const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
      const data = await res.json() as { code: number; data?: { items?: any[]; has_more?: boolean; page_token?: string } }
      if (data.code !== 0) break
      if (data.data?.items) allItems.push(...data.data.items)
      pageToken = data.data?.has_more ? data.data?.page_token : undefined
    } while (pageToken)
    return allItems
  }

  async getRecentDocTitles(_openId: string): Promise<string[]> {
    return []
  }
}
