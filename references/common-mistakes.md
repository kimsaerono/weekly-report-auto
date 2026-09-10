# 常见错误与修复

| 错误 | 原因 | 修复 |
|------|------|------|
| Playwright 打不开浏览器 | 未安装 Chromium | 运行 `npx playwright install chromium` |
| Cookie 过期 / 需重新扫码 | 长时间未使用 | 删除 `.feishu-cookies.json` 重新扫码 |
| lark-cli 未登录 | 首次使用 | 运行 `lark-cli auth login` |
| `FEISHU_REPORT_RULE_ID` 报错 | 未配置 | 从周报页面 URL 中 `ruleId=` 后获取数字 |
| 飞书文档搜索未授权 | 缺 `search:docs:read` scope | `lark-cli auth login --scope "search:docs:read drive:drive:readonly drive:drive opt_space_doc:read"` |
| OA 编号未生效 | 未激活编号列表 | 填入时用「编号列表」按钮或 Markdown `1. ` 触发；标题段落不编号 |
| 层级不对 | 没用 Tab/Shift+Tab | 用 `Tab` 降级为 `a./b.` 子层、`Shift+Tab` 升级 |
| report.json 出现手写序号 | 生成端写了 `1.`/`a.` 前缀 | `generate-report.ts` 输出结构化 `{title,level}`+无序号文本；手写时取消除前缀 |
| OA 出现混排 `2.` + `a.` | 结构层级与文本前缀冲突 | 依赖 `report.json` 的 `title/level` 字段，不用文本前缀表达层级 |
| 新项目/新仓库不进周报 | 引擎里没有该项目的业务映射（旧版写死 `REPO_TO_DOMAIN`） | 通用引擎已删掉全部业务映射，业务名/仓库名直出，无需配置改动 |
| 同一业务在周报出现多个 L1（如三四个 `汇元（…）`） | L1 按仓库逐个生成，同目录多仓库不归并 | `config.project.businesses` 把 `repos`/`roots` 映射到同一 `label`，多仓库归并为一个 L1（三级排版） |
| Windows 上 L1 标题变成磁盘路径（`E:\hy\...`） | 旧 `extractProjectName` 只 `split('/')`，切不开反斜杠；跨盘时 `relative(homedir(), repo)` 直接返回绝对路径 | 统一走 `scripts/project-name.ts` 的 `toPosix` + 盘符/用户名过滤；`git-collector.ts` 存 `repo` 时先 `toPosix` |
| 不同仓库的同名文档被算到同一项目下（内容串了） | `collectDocItems` 用跨项目全局 `seenFiles` 按文件名去重，后入库的同名文件被整体丢弃并挂在先出现的项目下 | 改为**按项目独立去重**（`Map<项目,Set<文件名>>`），同名文件只在各自仓库内去重 |

## 历史踩坑（不要回退）

- **OA 编号快捷键 `Meta+Shift+7` 只对首个字段首行生效**，后续字段失效——已被 `fieldListButtonIndex()` 按钮激活方案替代，不要改回去。
- **`ed.click()` 会导致字段 0 的 fix 行退回普通段落（plain）**——按钮激活后需用键盘操作（Enter/Tab/Shift+Tab），不要再对列表项本身 `click()`。
- **「字段首行即列表项」时编号按钮点击可能不生效（间歇性 L0）**——典型场景：下周工作计划/学习和反思字段第一行没有 `title:true` 前导段，清空后的空编辑器上点「编号列表」按钮偶发不应用。`oa-fill.ts` 已用「点击后校验编辑器内是否出现 `<ol>`，未出现带 `ed.focus()` 重试最多 3 次」兜底，不要删掉这段校验直接无脑 click。重试时用 `ed.focus()`（不移动光标），不要用 `ed.click()`（会点到编辑器中部、把光标挪进已有内容导致字段 0 文本串行）。
- **报告数据量小是正常的**：若本周数据少（如只有 1-2 条），`hasWeekData()` 判定有数据即不回退上周，生成的 report.json 行数少不是 bug。
- **填单逻辑只有一份**：统一在 `scripts/oa-fill.ts`，`skill-auto.ts` 与 `playwright-fill.ts` 都调用它。不要在两处各自改，避免实现漂移（曾出现过两套 Playwright 填单实现并存）。
- **项目名解析统一走 `scripts/project-name.ts`**：`generate-report.ts`、`git-collector.ts`、`collect-ai-tools.ts` 都复用 `toPosix`/`deriveProjectName`/`resolveBusiness`，不要各自再 `split('/')` 或 `homedir().split('/')`（Windows 反斜杠下会失效）。业务归并靠 `config.project.businesses` 显式配置，不做自动推断。

## 通用化（旧版业务映射已删除）

- `REPO_TO_DOMAIN` / `DOMAIN_TO_CATEGORY` / `SUB_DOMAIN_RULES` / `BIZ_SUB_ORDER` / `EFF_SUB_ORDER` / `NEXT_PLAN_VERBS` / `NEXT_PLAN_ORDER` 已全部删除——这些是写死的公司/项目声明，换个人或加新项目就会失效，需要重新手动收集整理。
- 归类改为**数据驱动**：一级 = 业务名/仓库名直出（`config.project.businesses` 命中时 L1=业务名，多仓库合并三级；未命中仓库名直出）；git 类型（feat/fix/refactor/docs…）映射动词前缀；分类取自模板；默认配置无任何业务名。新增代码/文档无需改本工具。