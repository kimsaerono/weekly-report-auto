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
├── scripts/           # 全部脚本（skill-auto 主入口、config 配置中心、采集器、生成、oa-fill 填单共享模块、通知）
├── references/        # 参考文档（本 skill 的分层说明）
├── REPORT_TEMPLATE.md # 周报内容模板（分类与写作风格）
├── config.local.example.json # 个性化配置示例（复制为 config.local.json）
├── SKILL.md           # 入口索引（本文件）
├── package.json
├── .env / .env.example
└── .gitignore
```

### 个性化配置（scripts/config.ts）

因人/因环境而异的配置统一集中在 `scripts/config.ts` 的 `DEFAULT_CONFIG`：
OA ruleId、表单字段标签与顺序、lark-cli 授权域、项目名直出忽略目录与**业务归并列表**（`project.businesses`，仓库名/目录段命中 → L1=业务名，同业务多仓库合并为三级层级）、Git 仓库扫描目录/作者、AI 工具清单与路径、生成规则（噪音/动词/消息过滤）。

**扩展方式：** 在 skill 根目录新建 `config.local.json`（gitignored，参考 `config.local.example.json`）只写想覆盖的键即可，运行时深度合并；数组整体替换、对象逐字段合并、路径支持 `~`。什么都不建则用内置默认值（即现行为）。

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

### 2. AI 分析（核心步骤，agent 模式）

**agent 模式（推荐做语义层）**：
1. 采集数据后，`collect-lark.ts` 自动产出 `messages-candidates.json`（结构预过滤：剥 URL、长度、本人、去重、上限，**零语义规则**）
2. **agent 读取** `collected-data.json` / `messages-candidates.json` / `git-commits.json` / `ai-data.json` / `notes-data.json`
   - **语义拦截**（自然语言判断，非词表）：丢弃 疑问/预测/跟进/客套/纯链接/私人闲聊
   - **归一化**：口语 → 「动词 + 对象 + 结果」工作条目（如「mini的一键部署脚本我加了prod分支直通车」→「为 mini 一键部署脚本新增 prod 分支直通车」）
   - **Git 提交以 `files[].path/status` 为准归纳**，提交 message 仅作参考（message 含糊/不符时按改动文件还原真实工作，不照抄 message）
   - 同义合并、限条数、按业务归并三级排版（结构由 oa-fill 落实）
   - 写 `report.json`（结构化 `{title,level,text}`，无序号）
3. 填入 OA 草稿：`npx tsx scripts/playwright-fill.ts`

**自动化兜底（`skill-auto.ts` 全自动）**：规则引擎只聚合 git + sessions + tasks，**不含聊天消息**（语义层必须由 agent 完成）。若 `report.json` 已由 agent 写入且为最新，`skill-auto.ts` 会跳过规则引擎兜底。

### 3. 填入草稿

```bash
npx tsx scripts/playwright-fill.ts
```

读取 `report.json` 填入飞书 OA 周报草稿，自动处理分级编号（标题不编号、列表项编号、Tab 降级/Shift+Tab 升级）。填单逻辑统一在 `scripts/oa-fill.ts`，`skill-auto.ts` 第 9 步与 `playwright-fill.ts` 共用同一份实现。

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