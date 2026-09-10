# 数据源与采集器

## 采集器一览

| 采集器 | 独立运行 | 输出文件 | 内容 |
|--------|---------|---------|------|
| 飞书数据 | `npx tsx scripts/collect-lark.ts` | `collected-data.json` | 消息、日历事件、任务 |
| Git 数据 | `npx tsx scripts/collect-git.ts` | `git-commits.json` | 全仓库本周提交（含改动文件明细）、整理为工作项 |
| AI 工具会话 | `npx tsx scripts/collect-ai-tools.ts` | `ai-data.json` | 6 个 AI 工具会话历史（自动发现） |
| 飞书文档笔记 | `npx tsx scripts/collect-notes.ts` | `notes-data.json` | 备忘/随手记类文档（需授权） |

## Git 提交文件明细

每个提交额外记录改动文件：`commit.files[] = { path, status, isDoc }`。

- `path` 文件路径；`status` 变更状态（A 新增 / M 修改 / D 删除 / R 重命名 / C 复制）；`isDoc` 文档类标记。
- `summary`：采集时为文档文件自动提取内容摘要（首标题 + 主要二级章节），供周报「文档更新」分组展示。
- 文档判定：文件名命中 `README`/`CHANGELOG`/`LICENSE`/`NOTICE`/`CONTRIBUTING` 等，或扩展名为 `.md/.txt/.rst/.adoc/.docx/.pdf`（大小写不敏感）。
- 周报「文档更新」分组按 commit 聚合：一条展示一个改动文档的提交，格式 `提交语义（文件清单）`，跨提交重复文件自动去重、文件名简化为 basename、**按项目独立去重**（同名文件在不同仓库各自保留，不会串到别的项目下），避免逐文件罗列。

### Git 扫描范围（mac/windows 全局）

| 平台 | 扫描范围 |
|------|---------|
| macOS | `~` 全局 + `/Volumes/*`（外部分区，`Macintosh HD` 除外），最深 5 层 |
| Windows | 自动枚举所有盘符（`fsutil fsinfo drives`，回退 `wmic`），每盘最深 4 层 |

排除目录：`node_modules`、`.hermes`、`.agents`、`.opencode`、`Library`、`.cache`、`.Trash`、`Applications`、`.pyvenv`；Windows 额外排除 `Windows`、`Program Files`、`ProgramData`、`$Recycle.Bin`、`System Volume Information`、`PerfLogs`、`AppData`。

### 提交过滤

- `--no-merges` 排除合并提交；噪音提交（`merge`/`revert`/`bump version`/`wip`/`tmp`）在分析阶段过滤。
- 按 `git user.name` 过滤作者（不按邮箱），同名不同邮箱也会计入。

### 项目名直出

- 周报一级标签 = 业务名/仓库名直出（详见 `references/report-rules.md`）：路径统一做跨平台解析（正斜杠归一化、忽略盘符/用户名/`config.project.skipDirs`），`config.project.businesses` 命中时 L1=业务名（多仓库合并，可三级），未命中取最后一段仓库名。
- Git 的 `repo` 字段存储时以 `toPosix(relative(homedir, repoPath))` 归一化（Windows 上即使跨盘也不会存成 `E:\...` 绝对路径），`generate-report.ts`/`check-git-mapping.ts` 消费同一解析。
- AI 会话的 `project` 字段按 `cleanProjectPath` 清洗（`collect-ai-tools.ts`，用户名探测兼容 Windows 分隔符），生成端以会话 `directory` 走与 Git 相同的 `resolveBusiness`，保证会话与提交落在同一业务。
- **新增仓库/项目不需要任何配置**，归类完全数据驱动（默认配置不含业务名）。

### 对应关系校验

- `npx tsx scripts/check-git-mapping.ts`：输出仓库↔提交↔文件对照，告警「提交缺 repo / 提交无文件明细」等归问题，并内置 Windows 驱动盘路径样例断言语义名解析结果（含 businesses 归并/多仓库三级），用于回归确认 L1 不出现磁盘路径。

### 个性化覆盖（scripts/config.ts）

- `git.searchOverride`：指定要扫描的目录（默认自动：homedir + 卷 + cwd）。
- `git.authorOverride`：指定作者名（默认读 `git config user.name`）。
- `git.pruneDirs`：扫描时剪枝的目录名。
- 覆盖方式：`config.local.json`（见 SKILL.md 之「个性化配置」）。

## AI 工具会话采集（自动发现）

采集器检测本地目录，**已安装的工具才采集，其余自动跳过**。

| 工具 | 存储位置（macOS） | 格式 |
|------|-----------------|------|
| opencode | `~/.local/share/opencode/opencode.db` | SQLite |
| Claude Code | `~/.claude/projects/*/*.jsonl` | JSONL |
| Cursor | `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` | SQLite |
| Windsurf | `~/Library/Application Support/Windsurf/.../state.vscdb` | SQLite |
| Trae | `~/Library/Application Support/Trae/.../state.vscdb` | SQLite |
| Codeium | `~/.codeium/`（随 Windsurf 存储） | — |

Windows 对应路径：Cursor/Windsurf/Trae 在 `%APPDATA%\...`。采集器按周范围过滤会话，统计进「本周完成」。

## 飞书文档笔记采集

通过 `lark-cli drive +search` 检索备忘/随手记类文档。需要 `search:docs:read` scope；未授权时优雅跳过并提示授权命令，不阻塞主流程。

授权命令：

```bash
lark-cli auth login --scope "search:docs:read drive:drive:readonly drive:drive opt_space_doc:read"
```

## 采集与回退机制

- `skill-auto.ts` 顺序执行：飞书 → Git → AI 工具 → 笔记。
- 任一采集器失败（如未授权）时**优雅跳过并继续**，不阻塞主流程。
- 单步调用可用 `scripts/skill-auto.ts` 内的 `--step` 或直接运行各采集器脚本。
- 本周**无任何数据**时自动回退读取**上周**数据生成报告；有数据则用本周数据。