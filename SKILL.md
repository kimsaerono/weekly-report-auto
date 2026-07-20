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

### 项目根目录

所有操作在此仓库根目录执行：`~/.agents/skills/weekly-report-auto`

### 飞书应用前置配置

在 [飞书开放平台](https://open.feishu.cn/app) 创建企业自建应用，开通权限：

| 权限 | 用途 |
|------|------|
| `im:message:readonly` | 读取群聊消息（必须） |
| `contact:user.base:readonly` | 读取用户信息（OAuth 必须） |
| `calendar:calendar:readonly` | 读取日历事件（可选） |
| `task:task:read` | 读取任务（可选） |
| `docs:doc:readonly` | 读取文档（可选） |
| `im:message:send_as_bot` | 发送周报通知（可选） |

发布应用后，将 App ID 和 App Secret 填入 `.env`。

### 项目结构

```
weekly-report-auto/
├── scripts/                  # TS 源码
│   ├── feishu-client.ts      # 飞书 API 封装
│   ├── collect-im.ts         # 采集本人发送的消息
│   ├── collect-all.ts        # 采集所有群文本消息
│   ├── collect-calendar.ts   # 采集日历事件
│   ├── collect-tasks.ts      # 采集任务
│   ├── collect-docs.ts       # 采集文档
│   ├── oauth.ts              # 用户授权流程
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
| `FEISHU_REPORT_RULE_ID` | "请提供周报表 ID（在周报页面 URL 中 ruleId= 后面的数字），默认 7179489743821406210" | 可回车跳过使用默认值 |
| `FEISHU_OPEN_ID` | "请提供你的飞书 Open ID（飞书搜索'飞书小助手'发送 /myopenid 获取），可回车跳过" | 可回车跳过，后续在 .env 中添加即可 |

`.env` 文件模板：

```
FEISHU_APP_ID="用户提供的值"
FEISHU_APP_SECRET="用户提供的值"
FEISHU_REPORT_RULE_ID="用户提供的值或默认值"
# FEISHU_OPEN_ID=""  （如果用户跳过则注释掉）
```

**如果 `.env` 已存在且 `FEISHU_APP_ID` 有值：** 直接进入下一步，不要重复询问。

**注意：** 如果用户在配置时跳过了 `FEISHU_OPEN_ID`，后续获取到后直接编辑 `.env` 文件添加即可，无需重新配置。通知步骤在 `FEISHU_OPEN_ID` 未配置时会自动静默跳过。

### 1. 采集消息

```bash
set -a && source .env && set +a
npx tsx scripts/collect-im.ts
```

或采集所有群消息（不限本人）：

```bash
set -a && source .env && set +a
npx tsx scripts/collect-all.ts
```

同时可采集日历、任务、文档（可选）：

```bash
set -a && source .env && set +a
npx tsx scripts/collect-calendar.ts
npx tsx scripts/collect-tasks.ts
npx tsx scripts/collect-docs.ts
```

### 2. AI 生成周报（核心步骤）

**AI 读取采集到的数据文件，自己分析生成周报内容。**

读取以下文件：
- `messages.json` — 群聊消息（主要数据源）
- `tasks.json` — 飞书任务
- `calendar.json` — 日历事件
- `docs.json` — 编辑的文档

然后将消息归纳为 5 个维度：
- **本周完成工作**：提取工作相关内容，去除闲聊、表情、链接
- **本周未完成工作及原因**
- **下周工作计划**
- **需要协调与帮助**
- **学习和反思**

**生成规则：**
1. 每个维度至少 1-3 条
2. 内容要精简、有整合，不要原文照搬
3. 不要带序号（不要写 1. 2. 3.），直接写内容
4. 优先使用任务和日历数据作为"完成工作"来源
5. 从消息中提取工作相关内容，忽略闲聊

生成后将内容写入 `report.json`：

```json
{
  "completed": "内容1\n内容2",
  "uncompleted": "内容1",
  "nextPlan": "内容1",
  "help": "内容1",
  "reflection": "内容1"
}
```

### 3. 填入草稿（自动执行，无需确认）

生成周报后**直接填入飞书草稿**，不要询问用户是否需要填入。

```bash
set -a && source .env && set +a
npx tsx scripts/playwright-fill.ts
```

`playwright-fill.ts` 会优先读取 `report.json`，其次读取 `template.md`，最后使用环境变量。

### 4. 发送通知（自动执行，无需确认）

填入草稿后**自动发送飞书通知**，不要询问用户是否需要发送。如果 `FEISHU_OPEN_ID` 未配置则静默跳过。

```bash
set -a && source .env && set +a
npx tsx scripts/notify.ts
```

## Common Mistakes

| 错误 | 原因 | 修复 |
|------|------|------|
| Playwright 打不开浏览器 | 未安装 Chromium | 运行 `npx playwright install chromium` |
| Cookie 过期 / 需重新扫码 | 长时间未使用 | 删除 `.feishu-cookies.json` 重新扫码 |
| API 报权限错误 | 飞书应用未开通权限 | 在飞书开放平台添加 `im:message:readonly` |
| `FEISHU_REPORT_RULE_ID` 报错 | 未配置 | 从周报页面 URL 中 `ruleId=` 后获取数字 |
| 通知发送失败 | `FEISHU_OPEN_ID` 为空或错误 | 飞书搜索"飞书小助手"发送 `/myopenid` 获取 |
