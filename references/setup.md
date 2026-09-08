# 安装与授权

## 项目根目录

所有操作在此仓库根目录执行：`~/.agents/skills/weekly-report-auto`

## 安装依赖

```bash
cd ~/.agents/skills/weekly-report-auto
npm install
```

## 飞书 CLI 登录

需要安装并登录 `@larksuite/cli`：

```bash
npx @larksuite/cli@latest install
lark-cli config init --new           # 扫码 1：配置应用
lark-cli auth login --domain im,calendar,task  # 扫码 2：一次性授权所有域
```

登录后 Token 自动保存，后续无需重复登录。

> **首次配置需扫码 2 次**（config + auth），后续运行 **0 次**。不要用 `--recommend`（权限不全，后续会再要求扫码补权限）。

## 补充授权

- 飞书文档笔记采集需 `search:docs:read` scope：

```bash
lark-cli auth login --scope "search:docs:read drive:drive:readonly drive:drive opt_space_doc:read"
```

## 数据文件清单

| 文件 | 采集器 | 内容 |
|------|--------|------|
| `collected-data.json` | collect-lark | 飞书消息/日历/任务 |
| `git-commits.json` | collect-git | Git 本周提交 |
| `ai-data.json` | collect-ai-tools | AI 工具会话 |
| `notes-data.json` | collect-notes | 飞书文档笔记 |
| `report.json` | generate-report | 生成的周报内容 |
| `.feishu-cookies.json` | playwright-fill | OA 登录 Cookie |

这些文件均为采集生成的中间产物，不入 git（见 `.gitignore`）。