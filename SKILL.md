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

所有操作在此仓库根目录执行。

### 安装依赖

```bash
npm install
npx playwright install chromium
```

### 配置环境变量（自动检测）

**在执行任何操作前，先检查 `.env` 文件是否存在且 `FEISHU_APP_ID` 不为空：**

```bash
# 检查 .env 是否存在且有效
if [ ! -f .env ] || ! grep -q "FEISHU_APP_ID=\"[^\"]\+\"" .env 2>/dev/null; then
  echo "检测到未配置环境变量，启动交互式配置..."
  npm run setup
fi
```

如果未配置，自动运行 `npm run setup`，交互式输入以下变量：

| 变量 | 必填 | 说明 |
|------|------|------|
| `FEISHU_APP_ID` | 是 | 飞书应用 App ID |
| `FEISHU_APP_SECRET` | 是 | 飞书应用 App Secret |
| `FEISHU_REPORT_RULE_ID` | 否 | 周报表 ID（默认 `7179489743821406210`） |
| `FEISHU_OPEN_ID` | 否 | 飞书 Open ID（填了可发通知） |

### 飞书应用前置配置

在 [飞书开放平台](https://open.feishu.cn/app) 创建企业自建应用，开通权限：

| 权限 | 用途 |
|------|------|
| `im:message:readonly` | 读取群聊消息（必须） |
| `im:message:send_as_bot` | 发送周报通知（可选） |

发布应用后，将 App ID 和 App Secret 填入 `.env`。

### 项目结构

```
weekly-report-auto/
├── scripts/                  # TS 源码
│   ├── feishu-client.ts      # 飞书 API 封装
│   ├── collect.ts            # 按关键词采集本人消息
│   ├── collect-all.ts        # 采集所有群文本消息
│   ├── collect-im.ts         # 采集本人发送的全部消息
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

所有命令在项目根目录执行。

### 前置检查

每次执行前，确保环境已配置：

```bash
cd ~/.agents/skills/weekly-report-auto
if [ ! -f .env ] || ! grep -q "FEISHU_APP_ID=\"[^\"]\+\"" .env 2>/dev/null; then
  npm run setup
fi
```

### 1. 采集消息

```bash
set -a && source .env && set +a
npx tsx scripts/collect-all.ts
```

或按关键词搜索本人消息：

```bash
set -a && source .env && set +a
npx tsx scripts/collect.ts
```

### 2. AI 生成周报

将采集到的消息归纳为 5 个维度：本周完成 / 未完成 / 下周计划 / 需要协调 / 学习反思。

### 3. 填入草稿

```bash
set -a && source .env && set +a
REPORT_COMPLETED="..." REPORT_UNCOMPLETED="..." REPORT_NEXT_PLAN="..." REPORT_HELP="..." REPORT_REFLECTION="..." npx tsx scripts/playwright-fill.ts
```

### 4. 发送通知（可选）

仅在配置了 `FEISHU_OPEN_ID` 时执行：

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
