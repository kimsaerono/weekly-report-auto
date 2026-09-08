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

## 参考索引

| 需要什么 | 参考文档 |
|---------|---------|
| 数据源与采集器（4 类采集器、AI 工具自动发现表、笔记授权） | [references/data-sources.md](references/data-sources.md) |
| 报告内容与 OA 自动编号规则 | [references/report-rules.md](references/report-rules.md) |
| 安装、lark-cli 登录、补充授权、数据文件清单 | [references/setup.md](references/setup.md) |
| 常见错误修复与历史踩坑 | [references/common-mistakes.md](references/common-mistakes.md) |

## 项目结构

```
weekly-report-auto/
├── scripts/           # 全部脚本（skill-auto 主入口、采集器、填入、通知）
├── references/        # 参考文档（本 skill 的分层说明）
├── REPORT_TEMPLATE.md # 周报内容模板（分类与写作风格）
├── SKILL.md           # 入口索引（本文件）
├── package.json
├── .env / .env.example
└── .gitignore
```

## Execution

所有命令在项目根目录 `~/.agents/skills/weekly-report-auto` 执行。

流程：`采集数据 → AI 分析 → 写入 report.json → 填入草稿 → 发送通知`

### 1. 采集数据

```bash
npx tsx scripts/skill-auto.ts
```

或单独采集，详见 [references/data-sources.md](references/data-sources.md)：

```bash
npx tsx scripts/collect-lark.ts        # 飞书数据
npx tsx scripts/collect-git.ts         # Git 数据
npx tsx scripts/collect-ai-tools.ts    # AI 工具会话（自动发现已安装工具）
npx tsx scripts/collect-notes.ts       # 飞书文档笔记（需 search:docs:read 授权）
```

### 2. AI 分析（核心步骤）

AI 读取采集到的数据文件，分析生成周报内容，写入 `report.json`。分析规则与 report.json 结构详见 [references/report-rules.md](references/report-rules.md)。

**核心要点：** 每个维度至少 1-3 条；内容精简有整合；**report.json 不带序号**（OA 自动编号，序号前缀由 fill 脚本处理）；优先使用任务数据；忽略闲聊。

### 3. 填入草稿

```bash
npx tsx scripts/playwright-fill.ts
```

读取 `report.json` 填入飞书 OA 周报草稿，自动处理分级编号（标题不编号、列表项编号、Tab 降级/Shift+Tab 升级）。

### 4. 发送通知

```bash
npx tsx scripts/notify-final.ts
```

## Common Mistakes

详见 [references/common-mistakes.md](references/common-mistakes.md)。

| 错误 | 修复 |
|------|------|
| Playwright 打不开浏览器 | `npx playwright install chromium` |
| Cookie 过期 | 删除 `.feishu-cookies.json` 重新扫码 |
| lark-cli 未登录 | `lark-cli auth login` |
| `FEISHU_REPORT_RULE_ID` 报错 | 从周报 URL 中 `ruleId=` 后取数字 |

## Setup

见 [references/setup.md](references/setup.md)：npm install、lark-cli 二次扫码、补充授权。