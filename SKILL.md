---
name: weekly-report-auto
description: "Use when the user says they want to write/auto-generate/fill a weekly report, especially Feishu/Lark weekly report. Also triggers on: '帮我写周报', '生成周报', '周报自动', 'weekly report', '飞书周报', '写日报'."
---

# Weekly Report Auto

## When to Use

- 用户说"写周报"、"生成周报"、"帮我填周报"
- 需要自动采集飞书消息并归纳为周报内容
- 需要自动填入飞书 OA 周报草稿页面

## When NOT to Use

- 用户只想手动写周报，不需要自动化
- 非飞书平台的周报系统（如 Jira、Notion）
- 用户没有飞书企业应用权限

## Setup

### 自动安装依赖

首次运行前，检查 `node_modules` 是否存在。若无则自动安装：

```bash
SKILL_DIR="$HOME/.agents/skills/weekly-report-auto"
cd "$SKILL_DIR"
PM=$(command -v bun && echo "bun" || command -v pnpm && echo "pnpm" || command -v yarn && echo "yarn" || echo "npm")
$PM install
$PM exec playwright install chromium 2>/dev/null || npx playwright install chromium 2>/dev/null
```

### 交互式配置

检查 `$SKILL_DIR/.env` 是否存在。若无，使用 `question` 工具向用户收集配置：

| 变量 | 必填 | 交互方式 | 默认值 |
|------|------|----------|--------|
| `FEISHU_APP_ID` | 是 | 必须输入 | 无 |
| `FEISHU_APP_SECRET` | 是 | 必须输入 | 无 |
| `FEISHU_REPORT_RULE_ID` | 是 | 可输入或使用默认值 | `7179489743821406210` |
| `FEISHU_OPEN_ID` | 否 | 可跳过 | 空 |

收集完成后写入 `$SKILL_DIR/.env`：

```
FEISHU_APP_ID="用户输入的值"
FEISHU_APP_SECRET="用户输入的值"
FEISHU_REPORT_RULE_ID="用户输入的值或默认值"
FEISHU_OPEN_ID="用户输入的值或留空"
```

### 初始化源码

首次运行时，检查 `$SKILL_DIR/types.ts` 是否存在。若无，将以下源码文件写入 `$SKILL_DIR/`：

#### types.ts

```typescript
export interface FeishuConfig {
  appId: string
  appSecret: string
}

export interface UserConfig {
  openId: string
  reportRuleId: string
  cookiePath: string
}

export interface WeeklyReport {
  completed: string
  uncompleted: string
  nextPlan: string
  help: string
  reflection: string
}

export interface FeishuMessage {
  messageId: string
  content: string
  createTime: string
  chatId: string
}
```

#### feishu-client.ts

```typescript
import type { FeishuConfig } from './types.ts'

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
```

#### playwright-fill.ts

```typescript
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { setTimeout } from 'timers/promises'

const RULE_ID = process.env.FEISHU_REPORT_RULE_ID
if (!RULE_ID) { console.error('请配置 FEISHU_REPORT_RULE_ID'); process.exit(1) }
const REPORT_URL = `https://oa.feishu.cn/report/record/detail?ruleId=${RULE_ID}&routeFrom=/record/list`
const COOKIE_PATH = process.env.COOKIE_PATH || new URL('./.feishu-cookies.json', import.meta.url).pathname

interface ReportContent {
  completed: string
  uncompleted: string
  nextPlan: string
  help: string
  reflection: string
}

async function fillReport(content: ReportContent) {
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()

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

  console.log('等待自动保存...')
  await setTimeout(8000)

  if (savedRequests.some(r => r.url.includes('Draft'))) {
    console.log('✅ Draft 保存请求已发出')
  }

  await page.screenshot({ path: '/tmp/weekly-report-result.png', fullPage: true })
  console.log('截图已保存')

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
```

#### notify.ts

```typescript
async function sendCard(openId: string, content: {
  completed: string
  uncompleted: string
  nextPlan: string
  help: string
  reflection: string
}) {
  const appId = process.env.FEISHU_APP_ID!
  const appSecret = process.env.FEISHU_APP_SECRET!
  const ruleId = process.env.FEISHU_REPORT_RULE_ID!

  const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  })
  const { tenant_access_token: token } = await tokenRes.json() as { tenant_access_token: string }

  const card = {
    elements: [
      { tag: 'markdown', content: `**本周完成工作**\n${content.completed || '（无）'}` },
      { tag: 'markdown', content: `**本周未完成工作及原因**\n${content.uncompleted || '（无）'}` },
      { tag: 'markdown', content: `**下周工作计划**\n${content.nextPlan || '（无）'}` },
      { tag: 'markdown', content: `**需要协调与帮助**\n${content.help || '（无）'}` },
      { tag: 'markdown', content: `**学习和反思**\n${content.reflection || '（无）'}` },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '✏️ 编辑草稿' },
            url: `https://oa.feishu.cn/report/record/detail?ruleId=${ruleId}&routeFrom=/record/list`,
            type: 'default'
          }
        ]
      }
    ],
    header: {
      title: { tag: 'plain_text', content: '本周周报已生成' },
      template: 'blue'
    }
  }

  const body = {
    receive_id: openId,
    msg_type: 'interactive',
    content: JSON.stringify(card)
  }

  const res = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  const data = await res.json() as { code: number }
  if (data.code !== 0) {
    console.error('通知发送失败:', JSON.stringify(data))
    process.exit(1)
  }
  console.log('通知已发送')
}

const content = {
  completed: process.env.REPORT_COMPLETED || '',
  uncompleted: process.env.REPORT_UNCOMPLETED || '',
  nextPlan: process.env.REPORT_NEXT_PLAN || '',
  help: process.env.REPORT_HELP || '',
  reflection: process.env.REPORT_REFLECTION || '',
}

const openId = process.env.FEISHU_OPEN_ID
if (!openId) {
  console.log('FEISHU_OPEN_ID 未配置，跳过通知')
  process.exit(0)
}
sendCard(openId, content)
```

#### package.json

```json
{
  "name": "weekly-report-auto",
  "type": "module",
  "private": true,
  "scripts": {
    "fill-report": "npx tsx playwright-fill.ts",
    "notify": "npx tsx notify.ts"
  },
  "dependencies": {
    "@larksuiteoapi/node-sdk": "^1.35.0",
    "playwright": "^1.48.0"
  },
  "devDependencies": {
    "@playwright/browser-chromium": "^1.48.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "@types/node": "^22.0.0"
  }
}
```

#### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["."]
}
```

#### .env.example

```
# 飞书应用凭证（团队共享，找管理员获取）
FEISHU_APP_ID=""
FEISHU_APP_SECRET=""

# 飞书周报表 ID（在周报页面 URL 中 ruleId= 后面的数字）
FEISHU_REPORT_RULE_ID="7179489743821406210"

# 你的飞书 Open ID（可选，填了会发飞书通知）
# 获取：飞书搜"飞书小助手"发送 /myopenid
# FEISHU_OPEN_ID=""
```

#### .gitignore

```
.env
.feishu-cookies.json
node_modules/
```

### 飞书应用前置配置

在 [飞书开放平台](https://open.feishu.cn/app) 创建企业自建应用，开通权限：

| 权限 | 用途 |
|------|------|
| `im:message:readonly` | 读取群聊消息（必须） |
| `im:message:send_as_bot` | 发送周报通知（可选） |

发布应用后，将 App ID 和 App Secret 填入 `.env`。

## Execution

所有命令在 `$HOME/.agents/skills/weekly-report-auto` 目录下执行。

### 1. 采集消息

```bash
set -a && source .env && set +a
npx tsx feishu-client.ts
```

### 2. AI 生成周报

将采集到的消息归纳为 5 个维度：本周完成 / 未完成 / 下周计划 / 需要协调 / 学习反思。

### 3. 填入草稿

```bash
set -a && source .env && set +a
REPORT_COMPLETED="..." REPORT_UNCOMPLETED="..." REPORT_NEXT_PLAN="..." REPORT_HELP="..." REPORT_REFLECTION="..." npx tsx playwright-fill.ts
```

### 4. 发送通知（可选）

仅在配置了 `FEISHU_OPEN_ID` 时执行：

```bash
set -a && source .env && set +a
REPORT_COMPLETED="..." REPORT_UNCOMPLETED="..." REPORT_NEXT_PLAN="..." REPORT_HELP="..." REPORT_REFLECTION="..." npx tsx notify.ts
```

## Common Mistakes

| 错误 | 原因 | 修复 |
|------|------|------|
| Playwright 打不开浏览器 | 未安装 Chromium | 运行 `npx playwright install chromium` |
| Cookie 过期 / 需重新扫码 | 长时间未使用 | 删除 `.feishu-cookies.json` 重新扫码 |
| API 报权限错误 | 飞书应用未开通权限 | 在飞书开放平台添加 `im:message:readonly` |
| `FEISHU_REPORT_RULE_ID` 报错 | 未配置 | 从周报页面 URL 中 `ruleId=` 后获取数字 |
| 通知发送失败 | `FEISHU_OPEN_ID` 为空或错误 | 飞书搜索"飞书小助手"发送 `/myopenid` 获取 |
