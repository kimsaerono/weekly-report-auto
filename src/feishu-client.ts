import type { FeishuConfig } from './types.js'

export class FeishuClient {
  private config: FeishuConfig
  private token: string | null = null
  private tokenExpire: number = 0

  constructor(config: FeishuConfig) {
    this.config = config
  }

  async getTenantToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpire) return this.token!
    const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: this.config.appId, app_secret: this.config.appSecret })
    })
    const data = await res.json() as { code: number; tenant_access_token: string; expire: number }
    if (data.code !== 0) throw new Error(`获取 token 失败: ${JSON.stringify(data)}`)
    this.token = data.tenant_access_token
    this.tokenExpire = Date.now() + (data.expire - 60) * 1000
    return this.token!
  }

  async searchMessages(openId: string, startTime: number, endTime: number): Promise<string[]> {
    const token = await this.getTenantToken()
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
    const token = await this.getTenantToken()
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

  async getRecentDocTitles(_openId: string): Promise<string[]> {
    return []
  }
}
