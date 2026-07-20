---
name: weekly-report-auto
description: "Use when the user says they want to write/auto-generate/fill a weekly report, especially Feishu/Lark weekly report. Also triggers on: '帮我写周报', '生成周报', '周报自动', 'weekly report', '飞书周报', '写日报'."
---

# Weekly Report Auto

## When to Use

- 用户说"写周报"、"生成周报"、"帮我填周报"
- 需要自动采集飞书消息并归纳为周报内容
- 需要自动填入飞书 OA 周报草稿页面
- 需要预防周报内容中避免重复序号和多余前缀标签

## When NOT to Use

- 用户只想手动写周报，不需要自动化
- 非飞书平台的周报系统（如 Jira、Notion）
- 用户没有飞书企业应用权限

## Setup

### 项目根目录

所有操作在此仓库根目录执行：`~/.agents/skills/weekly-report-auto`

### 飞书应用前置配置

在 [飞书开放平台](https://open.feishu.cn/app) 创建企业自建应用，开通权限：

| 权限 | 用途 | 关联脚本 |
|------|------|----------|
| `im:message:readonly` | 读取群聊消息 | `collect-im.ts` / `collect-all.ts` / `collect.ts`（必须） |
| `im:message:send_as_bot` | 发送周报通知 | `notify.ts`（可选） |
| `contact:user.base:readonly` | OAuth 用户授权 | `oauth.ts`（推荐） |
| `calendar:calendar:readonly` | 采集日历事件 | `collect-calendar.ts`（可选） |
| `task:task:readonly` | 采集飞书任务 | `collect-tasks.ts`（可选） |
| `docs:doc:readonly` | 采集编辑的文档 | `collect-docs.ts`（可选） |

> 采集日历/任务/文档推荐使用**用户身份授权**（`npm run oauth`），tenant_token 可能无权限。

发布应用后，将 App ID 和 App Secret 填入 `.env`。

> **AI 自动分析依赖：** `npm run start` 的自动分析步骤（`analyze.ts`）依赖飞书 Aily 智能伙伴 API。如需自动生成规范化周报内容，需将 Aily 应用发布到飞书机器人渠道。未配置时，AI 会使用关键词提取作为兜底，或由对话中的 AI 代理手动分析生成。

### 项目结构

```
weekly-report-auto/
├── scripts/                  # TS 源码
│   ├── feishu-client.ts      # 飞书 API 封装（支持用户/机器人身份）
│   ├── oauth.ts              # 用户 OAuth 授权
│   ├── collect.ts            # 按关键词采集本人消息
│   ├── collect-all.ts        # 采集所有群文本消息
│   ├── collect-im.ts         # 采集本人发送的全部消息
│   ├── collect-calendar.ts   # 采集日历事件
│   ├── collect-tasks.ts      # 采集飞书任务
│   ├── collect-docs.ts       # 采集编辑的文档
│   ├── analyze.ts            # AI 分析生成周报
│   ├── playwright-fill.ts    # 自动填入周报草稿
│   ├── notify.ts             # 飞书通知
│   └── types.ts              # 类型定义
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── SKILL.md
└── README.md
```

## Execution

所有命令在项目根目录 `~/.agents/skills/weekly-report-auto` 执行。

### 前置检查（每次执行前必须完成）

**按以下顺序逐步检查，缺少什么补什么：**

#### 1. 检查依赖安装

```bash
cd ~/.agents/skills/weekly-report-auto
if [ ! -d node_modules ]; then npm install; fi
```

#### 2. 检查 .env 配置

读取 `.env` 文件，检查 `FEISHU_APP_ID` 是否有值。**不要使用 `npm run setup`**（它是交互式脚本，AI 终端无法输入）。

**如果 `.env` 不存在或 `FEISHU_APP_ID` 为空：**

用自然语言**逐个**向用户询问以下配置项，然后**直接用 Write 工具写入 `.env` 文件**：

| 变量 | 询问方式 | 备注 |
|------|----------|------|
| `FEISHU_APP_ID` | "请提供飞书应用的 App ID" | 必填，不能为空 |
| `FEISHU_APP_SECRET` | "请提供飞书应用的 App Secret" | 必填，不能为空 |
| `FEISHU_OPEN_ID` | "请提供你的飞书 Open ID（飞书搜索'飞书小助手'发送 /myopenid 获取）" | 必填，采集本人消息需要 |
| `FEISHU_REPORT_RULE_ID` | "请提供周报表 ID（在周报页面 URL 中 ruleId= 后面的数字），默认 7179489743821406210" | 可回车跳过使用默认值 |

`.env` 文件模板：

```
FEISHU_APP_ID="用户提供的值"
FEISHU_APP_SECRET="用户提供的值"
FEISHU_OPEN_ID="用户提供的值"
FEISHU_REPORT_RULE_ID="用户提供的值或默认值"
```

**如果 `.env` 已存在且 `FEISHU_APP_ID` 有值：** 直接进入下一步，不要重复询问。

**注意：** 通知步骤在 `FEISHU_OPEN_ID` 未配置时会自动静默跳过。用户后续获取到 Open ID 后直接编辑 `.env` 文件添加即可。

#### 3. 用户授权（自动执行，无需询问）

**不要询问用户是否需要授权，直接进入采集流程。** `npm run start` 会自动检测并触发 OAuth：

- 如果 `.feishu-user-token.json` 不存在 → 自动打开浏览器进行用户授权
- 如果已存在且有效 → 跳过，直接使用
- 如果 Token 缺少权限（如新增了日历/任务采集）→ 自动重新授权
- 如果授权失败 → 降级为机器人身份采集，不阻塞流程

**前置条件（用户首次使用时需确认）：**

飞书应用已在开放平台 > 安全设置中添加重定向 URL：`http://127.0.0.1:18765`

**授权时用户需操作：** 浏览器弹出后扫码/登录飞书，无需复制粘贴任何内容，授权完成后浏览器自动关闭。

**当新增应用权限（如日历、任务、文档）后，需要重新授权获取 scope：**

```bash
npm run oauth:renew
```

### 1. 采集消息（自动执行，无需确认）

**推荐直接运行 `npm run start`，它会自动完成 OAuth 授权 + 采集（仅本人消息） + AI 生成 + 填入草稿 + 通知的全流程。**

> 消息采集默认使用 `collect-im.ts`（仅采集本人发送的文本消息），不混入他人的群聊内容。
> 如需采集群内所有人的消息（全局视角），可指定运行 `collect-all.ts`。

如果需要单独执行采集步骤：

```bash
set -a && source .env && set +a
npx tsx scripts/collect-im.ts
```

或采集群内所有人的消息（全局参考）：

```bash
set -a && source .env && set +a
npx tsx scripts/collect-all.ts
```

### 2. AI 生成周报

将采集到的消息归纳为 5 个维度：本周完成 / 未完成 / 下周计划 / 需要协调 / 学习反思。

### 3. 填入草稿（自动执行，无需确认）

生成周报后**直接填入飞书草稿**，不要询问用户是否需要填入。

```bash
set -a && source .env && set +a
REPORT_COMPLETED="..." REPORT_UNCOMPLETED="..." REPORT_NEXT_PLAN="..." REPORT_HELP="..." REPORT_REFLECTION="..." npx tsx scripts/playwright-fill.ts
```

### 4. 发送通知（自动执行，无需确认）

填入草稿后**自动发送飞书通知**，不要询问用户是否需要发送。如果 `FEISHU_OPEN_ID` 未配置则静默跳过，不要提示用户配置。用户后续获取到 Open ID 后直接编辑 `.env` 文件添加即可。

```bash
set -a && source .env && set +a
REPORT_COMPLETED="..." REPORT_UNCOMPLETED="..." REPORT_NEXT_PLAN="..." REPORT_HELP="..." REPORT_REFLECTION="..." npx tsx scripts/notify.ts
```

## Common Mistakes

| 错误 | 原因 | 修复 |
|------|------|------|
| Playwright 打不开浏览器 | 未安装 Chromium | 运行 `npx playwright install chromium` |
| Cookie 过期 / 需重新扫码 | 长时间未使用 | 删除 `.feishu-cookies.json` 重新扫码 |
| API 报权限错误 | 飞书应用未开通权限 | 在飞书开放平台添加 `im:message:readonly` |
| `FEISHU_REPORT_RULE_ID` 报错 | 未配置 | 从周报页面 URL 中 `ruleId=` 后获取数字 |
| 通知发送失败 | `FEISHU_OPEN_ID` 为空或错误 | 飞书搜索"飞书小助手"发送 `/myopenid` 获取 |
| 用户授权失败 | 未配置重定向 URL | 在飞书开放平台 > 安全设置添加 `http://127.0.0.1:18765` |
| Token 刷新失败 | 授权已过期 | 重新运行 `npx tsx scripts/oauth.ts` |
| API 返回 403 权限错误 | 应用未开通对应权限 | 在飞书开放平台添加权限并重新发布应用 |
| Token 缺少权限（日历/任务采集失败） | OAuth 授权后新增了权限 | 重新运行 `npm run oauth:renew` |