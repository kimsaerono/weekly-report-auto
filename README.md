# Weekly Report Auto

自动采集飞书消息 → AI 分析 → 填入飞书周报草稿 → 可选通知。

兼容 OpenCode、Cursor、Claude Code、Cline、Windsurf 等主流 AI 编程工具，也可独立运行。

---

## 快速安装

```bash
git clone https://github.com/kimsaerono/weekly-report-auto.git ~/.agents/skills/weekly-report-auto/
cd ~/.agents/skills/weekly-report-auto && cp .env.example .env
# 然后编辑 .env 填入配置
```

OpenCode 中下次对话说"写周报"即可，依赖首次自动安装。

---

## 先配好飞书应用

在 [飞书开放平台](https://open.feishu.cn/app) 创建企业自建应用，开通权限：

| 权限 | 用途 |
|------|------|
| `im:message:readonly` | 读取群聊消息（必须） |
| `im:message:send_as_bot` | 发送周报通知（可选） |

发布应用后，将 App ID 和 App Secret 给团队成员。

> **团队共享：** 同一个 App 可供多人使用，每个人只需填写自己的 Open ID。
> 获取 Open ID：飞书搜索「飞书小助手」→ 发送 `/myopenid`

---

## 配置

复制 `.env.example` 为 `.env`：

```bash
cp .env.example .env
```

填入参数：

| 变量 | 必填 | 说明 |
|------|------|------|
| `FEISHU_APP_ID` | ✅ | 飞书应用的 App ID，团队共享 |
| `FEISHU_APP_SECRET` | ✅ | 飞书应用的 Secret，团队共享 |
| `FEISHU_REPORT_RULE_ID` | ✅ | 周报表 ID（URL 里 `ruleId=` 后面的数字）|
| `FEISHU_OPEN_ID` | ❌ | 你的飞书 Open ID，填了才会发通知 |

---

## 平台接入

### OpenCode

Skill 已就绪，新对话中说"帮我写周报"即可自动执行（依赖首次自动安装）。

可选：在 `~/.config/opencode/opencode.jsonc` 的 `command` 中添加：

```json
"weekly-report": {
  "template": "执行周报自动生成流程...",
  "description": "自动采集飞书消息并填入周报草稿",
  "agent": "build"
}
```

之后可用 `/weekly-report` 快速触发。

### Cursor

在项目 `.cursor/rules/` 目录创建 `weekly-report.mdc`：

```yaml
---
description: 自动采集飞书消息并填入周报草稿
globs: []
---
```

内容参考 `SKILL.md` 的执行流程。对话中说"写周报"即可。

### Claude Code

在项目根目录创建 `CLAUDE.md`，添加：

```markdown
## 周报自动生成

我有一个飞书周报自动生成工具，位于 path/to/weekly-report-auto/。
当我说"写周报"时：
1. 读取 `.env` 获取飞书配置
2. 用 `bunx tsx src/feishu-client.ts` 采集本周消息
3. AI 分析生成周报内容
4. 将内容设为环境变量后运行 `bunx tsx src/playwright-fill.ts`
5. 可选运行 `bunx tsx src/notify.ts` 发送通知
```

### Cline / Roo Code

在 `.clinerules` 或项目规则中添加与 Claude Code 类似的描述。

### Windsurf

在 `.windsurfrules` 中添加规则声明。

### 独立运行

不依赖 AI 工具，直接终端执行：

```bash
# 1. 安装依赖
bun install && bunx playwright install chromium

# 2. 配置 .env

# 3. 填入周报内容并执行
cd path/to/weekly-report-auto
set -a && source .env && set +a
REPORT_COMPLETED="本周完成工作" \
REPORT_UNCOMPLETED="未完成工作" \
REPORT_NEXT_PLAN="下周计划" \
REPORT_HELP="需要协调" \
REPORT_REFLECTION="学习反思" \
bunx tsx src/playwright-fill.ts

# 4. 发送通知
set -a && source .env && set +a
REPORT_COMPLETED="..." \
REPORT_UNCOMPLETED="..." \
REPORT_NEXT_PLAN="..." \
REPORT_HELP="..." \
REPORT_REFLECTION="..." \
bunx tsx src/notify.ts
```

---

## 首次运行

Playwright 会打开浏览器，首次需用飞书 App 扫码登录。
登录成功后 cookie 保存在 skill 目录下的 `.feishu-cookies.json`，后续自动复用。

> 只保存草稿，绝不提交/发布。

---

## 文件结构

```
weekly-report-auto/
├── README.md                   # 本文件
├── SKILL.md                    # AI 指令（OpenCode 自动发现）
├── .env.example                # 配置模板（复制为 .env）
├── .gitignore
├── package.json
├── tsconfig.json
└── src/
    ├── types.ts                # 类型定义
    ├── feishu-client.ts        # 飞书 API 封装
    ├── playwright-fill.ts      # Playwright 自动填表
    └── notify.ts               # 飞书卡片通知
```

## 更新

```bash
cd ~/.agents/skills/weekly-report-auto && git pull
```

---

## FAQ

**Q: 可以不填 Open ID 吗？**  
A: 可以，只是不发送通知通知。

**Q: 依赖需要手动装吗？**  
A: OpenCode 下首次执行自动安装（自动检测 `bun` > `pnpm` > `yarn` > `npm`）。其他平台需手动执行 `bun|pnpm|yarn|npm install && npx playwright install chromium`。

**Q: 多人使用同一份代码，cookie 会冲突吗？**  
A: 不会。cookie 保存在 skill 目录下的 `.feishu-cookies.json`，各人独立。已加入 `.gitignore`。

**Q: 可以用自己的飞书周报表吗？**  
A: 可以，`.env` 里填入你的 `FEISHU_REPORT_RULE_ID` 即可。

**Q: 哪些飞书权限是必需的？**  
A: `im:message:readonly`（读取消息）。`im:message:send_as_bot` 只在需要通知时才要。
