---
name: weekly-report-auto
description: "Use when the user says they want to write/auto-generate/fill a weekly report, especially Feishu/Lark weekly report. Also triggers on: '帮我写周报', '生成周报', '周报自动', 'weekly report'. Requires Feishu API + Playwright browser automation."
---

# Weekly Report Auto

## Setup (auto-run by AI, user does nothing)

**Step 0 — Auto-install:** Before anything else, check if `node_modules` exists. If not, detect package manager (`bun` > `pnpm` > `yarn` > `npm`) and install:

```bash
cd .agents/skills/weekly-report-auto
# 自动选择可用的包管理器
PM=$(command -v bun && echo "bun" || command -v pnpm && echo "pnpm" || command -v yarn && echo "yarn" || echo "npm")
$PM install
# 安装 Playwright 浏览器
$PM exec playwright install chromium 2>/dev/null || npx playwright install chromium 2>/dev/null
```

If `.env` doesn't exist, copy from `.env.example` and tell user to fill in credentials.

## Overview

1. Read `.env` for `FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `FEISHU_OPEN_ID`
2. Collect this week's messages via IM API
3. AI analyzes messages into 5 report dimensions
4. Playwright fills Feishu draft page (keyboard.type) — auto-saves, no submit button
5. Send card notification via Feishu bot

## Config (.env)

| Variable | Required | Shared? |
|----------|----------|---------|
| `FEISHU_APP_ID` | ✅ | Team |
| `FEISHU_APP_SECRET` | ✅ | Team |
| `FEISHU_REPORT_RULE_ID` | ✅ | Team（周报表 ID） |
| `FEISHU_OPEN_ID` | ❌ | Per user（填了才发通知） |

Get Open ID: search "飞书小助手" in Feishu, send `/myopenid`.

## Execution

### 1. Collect messages

Use `client.im.chat.list()` → `client.im.message.list()` for each chat this week via `src/feishu-client.ts`.

### 2. AI generates report

Categorize into: completed / uncompleted / next plan / help needed / reflection.

### 3. Fill draft

```bash
cd .agents/skills/weekly-report-auto
set -a && source .env && set +a
REPORT_COMPLETED="..." REPORT_UNCOMPLETED="..." REPORT_NEXT_PLAN="..." REPORT_HELP="..." REPORT_REFLECTION="..." npx tsx src/playwright-fill.ts
```

### 4. Notify

```bash
set -a && source .env && set +a
REPORT_COMPLETED="..." REPORT_UNCOMPLETED="..." REPORT_NEXT_PLAN="..." REPORT_HELP="..." REPORT_REFLECTION="..." npx tsx src/notify.ts
```
