# 报告内容规则（双层架构：结构预过滤 + AI 分析层）

## report.json 结构（结构化 schema）

`report.json` 为**显式标注层级/标题的行数组**，编号由填单端生成：
- `title: true` → 分类标题（一、业务 & 开发），填为普通段落不编号
- `level: 1` → OA 一级（业务/模块名）
- `level: 2` → OA 二级（仓库名/具体事项）
- `level: 3` → OA 三级（多仓库业务下的条目）

```json
{
  "completed": [
    { "title": true, "text": "一、业务 & 开发" },
    { "level": 1, "text": "跨境" },
    { "level": 2, "text": "cross-pay-ui" },
    { "level": 3, "text": "实现 兼容h5的打包" },
    { "level": 1, "text": "文档更新" },
    { "level": 2, "text": "完善周报自动化 Skill 文档（数据源、Git 扫描、填单示例）" }
  ],
  "uncompleted": [],
  "nextPlan": [],
  "help": [],
  "reflection": []
}
```

字段：`completed` 本周完成 / `uncompleted` 本周未完成及原因 / `nextPlan` 下周计划 / `help` 需要协调与帮助 / `reflection` 学习和反思。无内容用空数组，不要写"无"以外占位。

## 双层架构（核心设计）

### 第 1 层：结构预过滤（代码层，仅有限结构规则，零语义、零业务词）

**`scripts/message-filter.ts`** / `collect-lark.ts` 产出 `messages-candidates.json`：
1. 剥 URL/IP（`https?://`、`IP:port`）
2. 长度上下界（`messageMinLen`~`messageMaxLen`，默认 8~50）
3. 本人消息（需 `FEISHU_OPEN_ID`；未配置则全留，交由 agent 判断）
4. 去重（前缀哈希）
5. 上限条数（`messageMaxCandidates`，默认 200）

**这是代码里唯一保留的过滤逻辑**，天然有限、不包含任何语义词表、不含业务名，**永远不需要"写不完"**。语义层完全下沉。

### 第 2 层：AI 分析层（agent 模式，自然语言指令，无正则）

**`skill-auto.ts` 运行前，或手工模式下**，agent 读取：
- `collected-data.json`（全量原始数据）
- `messages-candidates.json`（结构预过滤后的候选）
- `git-commits.json` / `ai-data.json` / `notes-data.json`

并按自然语言指令执行（无正则、无词表）：
1. **语义拦截**：丢弃 疑问/预测/跟进/客套/纯链接/私人闲聊（描述类型，不枚举词）
2. **归一化**：口语 → 「动词 + 对象 + 结果」标准工作条目
   - 例：「mini的一键部署脚本我加了prod分支直通车」→「为 mini 一键部署脚本新增 prod 分支直通车」
   - 例：「差不多十分钟应该部署完」→ 丢弃（预测/不确定）
   - 例：「我想看看部署的代码是不是最新的」→ 丢弃（疑问/打听）
3. 同义合并、限条数、按业务归并三级排版（结构由 oa-fill 落实）
4. 写 `report.json`（结构化 `{title,level,text}`，无序号）

**规则引擎（`generate-report.ts`）作为兜底**：
- 仅聚合 Git 提交 + AI 会话 + 飞书任务，**不含聊天消息**（语义层必须由 agent 完成）
- 若 `report.json` 已由 agent 写入且比所有数据源新，`skill-auto.ts` 跳过规则引擎

## 通用归类（数据驱动，无公司/项目写死声明）

- **一级标签 = 业务名/仓库名直出**：对 Git 仓库路径、AI 会话目录统一作跨平台解析（正斜杠归一化、忽略盘符/`..`/用户名/`config.project.skipDirs`），末段为仓库名。未命中业务配置时仓库名即 L1。
- **业务归并（可选 `config.project.businesses`）**：`businesses` 为 `{label, roots?, repos?}` 列表——`repos` 精确命中仓库名最优先，其次 `roots` 精确匹配目录段（跨业务取最深层、同层按配置序），命中后 L1=业务名。例如 `E:\hy\业务板块A\repo-uni` + `roots:["业务板块A"]` → L1=`业务板块A`。**同业务多个仓库/会话归并为一个 L1**；多仓库业务排版为三级（L1 业务名 → L2 仓库名 → L3 条目），单仓库业务排版为两级（L1 业务名 → L2 条目）。未命中回退仓库名直出，**绝不显示磁盘路径**；**默认配置不含任何业务名**，具体业务根由开发者在自己本地的 `config.local.json` 中补充。
- **git 类型字段被使用**：`feat`→实现、`fix`→修复、`refactor`→重构、`docs`→完善文档、`test`→补充测试、`perf`→优化、`chore`→维护 等（映射见 `config.generate.commitVerbs`），作为条目的动词前缀。
- **分类来自模板**：分类标题（一、业务 & 开发 / 二、团队效能与基础建设）从 `REPORT_TEMPLATE.md` 的「分类结构」读取；用户改模板即改分类，代码不写死。
- **通用归类规则**：项目/任务 → 第一个分类；文档/笔记 → 第二个分类（若模板只有 1 个分类则并入）。
- **可调规则**：结构预过滤参数集中在 `scripts/config.ts` 的 `CONFIG.generate`（`messageMinLen`/`messageMaxLen`/`messageMaxCandidates`），支持 `config.local.json` 覆盖。

## 分析规则（agent 模式）

- 每个维度至少 1-3 条（无数据可不写）
- 内容精简、**有整合**，不要原文照搬 commit message/会话标题
- **严禁写序号**（`1.` / `a.` / `i.` / `一二三、`），编号由 OA 自动生成
- 优先使用任务数据作为"完成工作"来源
- 聊天消息**只在 AI 分析层**处理：语义拦截 → 归一化 → 写入 `report.json`
- 规则引擎兜底**不再接入聊天**，仅聚合 git/sessions/tasks
- **Git 提交以实际改动文件为准归纳，提交 message 仅作参考**：
  - 读取 `git-commits.json` 中每条的 `files[].path/status`（A 新增 / M 修改 / D 删除 / R 重命名），结合 message 还原真实工作内容
  - message 与文件不符或 message 含糊时，**以文件路径/文件名推断**为准（如 `src/pages/order/checkout.tsx` + A → "新增下单结算页"，`package.json` + M → "调整依赖与构建配置"）
  - 不要照抄 message 原名；同一仓库多条提交聚合为 1-2 条完整句子
  - message 离谱（如"测试"、`wip`）但文件改动明确 → 按文件归纳；文件也看不出语义时才保留 message 原意

## 去重与合并规则

- **归一化比对**：内容转小写、去掉标点/空格后相同 → 判定重复，只保留一条
- **包含合并**：同组内若一条完整包含另一条（归一化后子串），保留更长的一条
- **跨来源合并**：同一事项同时出现在 Git 提交、AI 会话、任务中 → 只保留一条最完整的
- **文档归属**：文档更新按 commit 聚合为「完善 {项目} 文档：…」，同名文件（如 `README.md`）在不同仓库各自保留，不做跨项目去重
- Git 多条提交归属同一项目 → 聚合为 1-2 条完整句子（动词开头），不逐条照搬；归纳时以 `files[].path/status` 为准、message 仅参考

## OA 自动编号机制（重要）

- 填入 OA 草稿时，**标题（一、业务 & 开发）作为普通段落不编号**；列表项由 OA 原生列表自动编号。
- 层级由 `report.json` 的 `title/level` 字段精确决定，填单端用 `Tab`(降级)/`Shift+Tab`(升级) 落到对应层级。
- `Enter` 续行自动递增编号；`Tab` 降级为 `a./b.` 子层；`Shift+Tab` 升级。
- 最终层级示例：`一、业务 & 开发`（标题）→ `1.` 一级 → `a.` 二级 → `i.` 三级。
- 填入前填单端 `stripResidualNumber` 会清理文本行首残留的 `1.`/`a.` 等序号（防止重复编号）。

## 填单实现（单一共享模块）

填单逻辑统一在 `scripts/oa-fill.ts`，两个入口共用同一份实现：
- `skill-auto.ts` 第 9 步
- `playwright-fill.ts`（`npm run fill` 独立入口）

共享逻辑包含：编号按钮激活（`div[adit-key="list"][adit-value="number"]`，按字段容器定位避免 nth 顺序漂移）、`Enter` 续行、`Tab`/`Shift+Tab` 落层级、`verifyHierarchy` DOM 回读校验层级、截图留存。

## 写作风格（对齐 REPORT_TEMPLATE.md）

- 每条以动词开头：实现、推进、完成、修复、优化、完善、重构、接入、开发
- 一句话说清楚，不加修饰语
- 技术术语直接使用（如 vue3、elementplus 等）
- 无编号，一条一行
- 不要写"本周完成了xxx工作"这种废话，直接说事
- 不要加"等"字结尾（除非确实有省略）
- 可以用逗号连接相关事项

## 生成方式

- 仅使用内置通用规则引擎。`generate-report.ts` 按 **业务名/仓库名（`resolveBusiness`）** 聚合 Git 提交与 AI 会话（同一目录源走同一解析，保证会话与提交落在同一业务 L1），接入飞书任务的完成项，产出符合 schema 的结构化内容。同一业务下多仓库展示为三级结构；同一仓库的多条提交自动合并为整合叙事，文档更新跨 commit 合并、**按项目独立去重**（同名文档文件在不同仓库互不串项），同内容按 `normalizeKey` 去重 + 包含合并，分类标题取自 `REPORT_TEMPLATE.md` 的「分类结构」。