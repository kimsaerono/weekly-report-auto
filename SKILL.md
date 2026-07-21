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

### 安装依赖

```bash
cd ~/.agents/skills/weekly-report-auto
npm install
```

### 飞书 CLI 登录

需要安装并登录 `@larksuite/cli`：

```bash
npx @larksuite/cli@latest install
lark-cli config init --new           # 扫码 1：配置应用
lark-cli auth login --domain im,calendar,task  # 扫码 2：一次性授权所有域
```

登录后 Token 自动保存，后续无需重复登录。

> **首次配置需扫码 2 次**（config + auth），后续运行 **0 次**。不要用 `--recommend`（权限不全，后续会再要求扫码补权限）。

### 项目结构

```
weekly-report-auto/
├── scripts/
│   ├── skill-auto.ts          # 主入口（采集数据）
│   ├── collect-lark.ts        # 采集飞书数据
│   ├── collect-git.ts         # 采集 Git 数据
│   ├── playwright-fill.ts     # 自动填入周报草稿
│   ├── notify-final.ts        # 飞书通知
│   ├── lark-cli-wrapper.ts    # lark-cli 封装
│   ├── git-collector.ts       # git 收集器
│   ├── time-utils.ts          # 时间工具
│   └── notify-system.ts       # 通知系统
├── package.json
├── .env
├── .env.example
├── .gitignore
└── SKILL.md
```

## Execution

所有命令在项目根目录 `~/.agents/skills/weekly-report-auto` 执行。

### 流程说明

```
采集数据 → AI 分析 → 写入 report.json → 填入草稿 → 发送通知
```

### 1. 采集数据

```bash
npx tsx scripts/skill-auto.ts
```

或单独采集：

```bash
npx tsx scripts/collect-lark.ts    # 飞书数据
npx tsx scripts/collect-git.ts     # Git 数据
```

采集结果保存到 `collected-data.json` 和 `git-commits.json`。

### 2. AI 分析（核心步骤）

AI 读取采集到的数据文件，分析生成周报内容，写入 `report.json`：

```json
{
  "completed": "内容1\n内容2",
  "uncompleted": "内容1",
  "nextPlan": "内容1",
  "help": "内容1",
  "reflection": "内容1"
}
```

**分析规则：**
- 每个维度至少 1-3 条
- 内容精简、有整合，不要原文照搬
- **不要带序号**（OA 系统会自动编号，加序号会重复）
- 优先使用任务数据作为"完成工作"来源
- 从消息中提取工作相关内容，忽略闲聊

### 3. 填入草稿

```bash
npx tsx scripts/playwright-fill.ts
```

`playwright-fill.ts` 读取 `report.json` 填入飞书 OA 周报草稿。

### 4. 发送通知

```bash
npx tsx scripts/notify-final.ts
```

## Common Mistakes

| 错误 | 原因 | 修复 |
|------|------|------|
| Playwright 打不开浏览器 | 未安装 Chromium | 运行 `npx playwright install chromium` |
| Cookie 过期 / 需重新扫码 | 长时间未使用 | 删除 `.feishu-cookies.json` 重新扫码 |
| lark-cli 未登录 | 首次使用 | 运行 `lark-cli auth login` |
| `FEISHU_REPORT_RULE_ID` 报错 | 未配置 | 从周报页面 URL 中 `ruleId=` 后获取数字 |
