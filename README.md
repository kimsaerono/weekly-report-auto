# Weekly Report Auto

自动采集飞书消息 → AI 分析 → 填入飞书周报草稿 → 可选通知。

兼容 OpenCode、Cursor、Claude Code、Cline、Windsurf 等主流 AI 编程工具，也可独立运行。

---

## 安装

```bash
npx skills add kimsaerono/weekly-report-auto -g
```

安装后位于 `~/.agents/skills/weekly-report-auto/`。首次对话时 AI 会自动安装依赖并引导配置。

---

## 飞书应用前置配置

在 [飞书开放平台](https://open.feishu.cn/app) 创建企业自建应用，开通权限：

| 权限 | 用途 |
|------|------|
| `im:message:readonly` | 读取群聊消息（必须） |
| `im:message:send_as_bot` | 发送周报通知（可选） |
| `contact:user.base:readonly` | 用户授权后读取用户信息（推荐） |

发布应用后，将 App ID 和 App Secret 给团队成员。

> **团队共享：** 同一个 App 可供多人使用，每个人只需填写自己的 Open ID。
> 获取 Open ID：飞书搜索「飞书小助手」→ 发送 `/myopenid`

---

## 配置

安装后运行交互式配置：

```bash
cd ~/.agents/skills/weekly-report-auto
npm run setup
```

按提示输入飞书应用凭证，自动生成 `.env` 文件。

| 变量 | 必填 | 说明 |
|------|------|------|
| `FEISHU_APP_ID` | ✅ | 飞书应用的 App ID，团队共享 |
| `FEISHU_APP_SECRET` | ✅ | 飞书应用的 Secret，团队共享 |
| `FEISHU_REPORT_RULE_ID` | ❌ | 周报表 ID（默认 `7179489743821406210`） |
| `FEISHU_OPEN_ID` | ❌ | 你的飞书 Open ID，填了才会发通知 |

---

## 用户授权（推荐）

为了采集**所有群**的消息（不限于机器人所在群），需要配置用户授权：

1. 在飞书开放平台 > 你的应用 > **安全设置** 中添加重定向 URL：
   ```
   http://127.0.0.1:18765
   ```

2. 确保应用已开通以下权限：
   - `im:message:readonly`（读取消息）
   - `contact:user.base:readonly`（读取用户信息）

3. 运行授权命令：
   ```bash
   npm run oauth
   ```

4. 浏览器会打开飞书授权页面，登录后自动完成授权

5. Token 自动保存到 `.feishu-user-token.json`，后续采集会使用用户身份

> **无用户授权时**：工具会降级为机器人身份采集，只能读取机器人所在群的消息。

---

## 使用

### OpenCode

安装后在新对话中说"写周报"即可自动执行。AI 会：

1. 采集本周飞书消息
2. 归纳为 5 个维度的周报内容
3. 自动填入飞书 OA 周报草稿
4. 可选发送飞书通知

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

工具位于 ~/.agents/skills/weekly-report-auto/。
当我说"写周报"时，按 SKILL.md 执行。
```

### Cline / Roo Code / Windsurf

在 `.clinerules` 或 `.windsurfrules` 中添加类似声明。

### 独立运行

不依赖 AI 工具，直接终端执行：

```bash
cd ~/.agents/skills/weekly-report-auto

# 1. 安装依赖
bun install && bunx playwright install chromium

# 2. 配置 .env（交互式输入）
npm run setup

# 3. 用户授权（可选，推荐）
npm run oauth

# 4. 填入周报内容并执行
set -a && source .env && set +a
REPORT_COMPLETED="本周完成工作" \
REPORT_UNCOMPLETED="未完成工作" \
REPORT_NEXT_PLAN="下周计划" \
REPORT_HELP="需要协调" \
REPORT_REFLECTION="学习反思" \
npx tsx scripts/playwright-fill.ts

# 4. 发送通知（可选）
set -a && source .env && set +a
REPORT_COMPLETED="..." \
REPORT_UNCOMPLETED="..." \
REPORT_NEXT_PLAN="..." \
REPORT_HELP="..." \
REPORT_REFLECTION="..." \
npx tsx scripts/notify.ts
```

---

## 首次运行

Playwright 会打开浏览器，首次需用飞书 App 扫码登录。
登录成功后 cookie 保存在 `.feishu-cookies.json`，后续自动复用。

> 只保存草稿，绝不提交/发布。

---

## 文件结构

```
weekly-report-auto/
├── SKILL.md                    # AI 指令
├── README.md                   # 本文件
├── .env                        # 环境配置（npm run setup 生成）
├── package.json
├── tsconfig.json
├── scripts/
│   ├── setup.ts                # 交互式配置
│   ├── oauth.ts                # 用户 OAuth 授权
│   ├── feishu-client.ts        # 飞书 API 封装
│   ├── collect.ts              # 按关键词采集消息
│   ├── collect-all.ts          # 采集所有群消息
│   ├── collect-im.ts           # 采集本人消息
│   ├── collect-calendar.ts     # 采集日历事件
│   ├── collect-tasks.ts        # 采集任务
│   ├── collect-docs.ts         # 采集文档
│   ├── analyze.ts              # AI 分析生成周报
│   ├── playwright-fill.ts      # Playwright 自动填表
│   ├── notify.ts               # 飞书卡片通知
│   └── types.ts                # 类型定义
```

## 更新

```bash
npx skills add kimsaerono/weekly-report-auto -g
```

---

## FAQ

**Q: 可以不填 Open ID 吗？**
A: 可以，只是不发送通知。

**Q: 依赖需要手动装吗？**
A: OpenCode 下首次执行自动安装。其他平台需手动执行 `bun install && npx playwright install chromium`。

**Q: 多人使用同一份代码，cookie 会冲突吗？**
A: 不会。cookie 保存在各人自己的 skill 目录下，已加入 `.gitignore`。

**Q: 可以用自己的飞书周报表吗？**
A: 可以，`.env` 里填入你的 `FEISHU_REPORT_RULE_ID` 即可。

**Q: 哪些飞书权限是必需的？**
A: `im:message:readonly`（读取消息）。`im:message:send_as_bot` 只在需要通知时才要。
