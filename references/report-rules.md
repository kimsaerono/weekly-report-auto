# 报告内容规则（AI 分析）

## report.json 结构

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

字段：`completed` 本周完成 / `uncompleted` 本周未完成及原因 / `nextPlan` 下周计划 / `help` 需要协调与帮助 / `reflection` 学习和反思。

## 分析规则

- 每个维度至少 1-3 条
- 内容精简、有整合，不要原文照搬
- **不要带序号**（OA 系统会自动编号，见下节）
- 优先使用任务数据作为"完成工作"来源
- 从消息中提取工作相关内容，忽略闲聊

## OA 自动编号机制（重要）

- 填入 OA 草稿时，**标题（一、二、…）作为普通段落不编号**；列表项由 OA 原生列表自动编号。
- 编号通过工具栏「编号列表」激活或 Markdown `1. ` 触发。
- `Enter` 续行自动递增编号；`Tab` 降级为 `a./b.` 子层；`Shift+Tab` 升级。
- `report.json` **保持无序号干净数据**；序号前缀由 fill 脚本处理，填入前清理内容中已有序号（防止重复），层级靠 Tab/Shift+Tab 表达（`scripts/skill-auto.ts` 的 `fillField` 与 `scripts/playwright-fill.ts` 已实现）。
- 最终层级示例：`一、业务 & 开发`（标题）→ `1.` 一级 → `a.` 二级 → `i.` 三级。

## 写作风格（对齐 REPORT_TEMPLATE.md）

- 每条以动词开头：开展、推进、完成、实现、优化、推动、配合、参与、梳理、产出
- 一句话说清楚，不加修饰语
- 技术术语直接使用（如 vue3、elementplus、hyfe 等）
- 无编号，一条一行
- 不要写"本周完成了xxx工作"这种废话，直接说事
- 不要加"等"字结尾（除非确实有省略）
- 可以用逗号连接相关事项

## 分类结构（取自 REPORT_TEMPLATE.md）

- 一、业务 & 开发
- 二、团队效能与基础建设
- （可根据实际内容增减分类）

`scripts/generate-report.ts` 会自动读取 `REPORT_TEMPLATE.md` 的分类顺序格式化输出。