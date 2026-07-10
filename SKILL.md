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

收集完成后写入 `$SKILL_DIR/.env`。格式参考 `$SKILL_DIR/.env.example`。

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
