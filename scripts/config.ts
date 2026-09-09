// 个性化配置中心：所有因人/因环境而异的配置统一放这里。
// - DEFAULT_CONFIG = 内置默认值（现行为）
// - 扩展方式：在 skill 根目录新建 scripts/config.local.json（gitignored），
//   只写想覆盖的键，运行时与默认值深度合并；数组整体替换，对象逐字段合并。
// - 路径支持 `~` 前缀（自动展开为 home）；值为空数组/空串表示"用自动发现/默认行为"。
import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { fileURLToPath } from 'node:url'

export interface AiToolDef {
  name: string
  enabled: boolean
  adapter: 'opencode' | 'claude-code' | 'vscode-family' | 'codeium'
  paths: string[] // `~` 展开后的候选路径
}

export interface OaFieldDef {
  key: string // report.json 字段名
  label: string // OA 表单标签
}

export interface Config {
  feishu: {
    reportRuleId: string // OA 周报表 ruleId（env FEISHU_REPORT_RULE_ID 优先于此默认值）
    oaReportUrlBase: string // 表单详情页 URL 前缀（ruleId 追加在后）
    oaReportQuery: string // 表单详情页查询参数
    loginDomains: string[] // lark-cli 授权所需业务域
  }
  oa: {
    fields: OaFieldDef[] // 表单字段标签与顺序
  }
  project: {
    skipDirs: string[] // 项目名直出时忽略的目录（自动追加本机用户名）
  }
  git: {
    searchOverride: string[] // 空 = 自动发现（homedir + 卷 + cwd）
    pruneDirs: string[] // 仓库扫描时剪枝的目录名
    authorOverride: string // 空 = 读 git config user.name
  }
  aiTools: {
    tools: AiToolDef[] // 支持的 AI 工具（可增删改路径）
    titleSkipKeywords: string[] // 会话标题过滤关键词（如 subagent/explore）
  }
  generate: {
    noisePatterns: string[] // 提交/标题噪音正则源串
    commitVerbs: Record<string, string> // git 类型 → 动词前缀
    workVerbs: string[] // 已带动词的条目不再加前缀
    sessionDoneMarkers: string[] // 会话命中标记词 → 用「完成」
    sessionDefaultVerb: string // 会话默认动词（推进）
    sessionSkipPattern: string // 会话标题跳过正则源串
    messageNoiseWords: string[] // 消息噪音词
    messageStrongVerbs: string[] // 消息强动词
  }
}

const home = homedir()

export const DEFAULT_CONFIG: Config = {
  feishu: {
    reportRuleId: '7179489743821406210',
    oaReportUrlBase: 'https://oa.feishu.cn/report/record/detail?ruleId=',
    oaReportQuery: '&routeFrom=/record/list',
    loginDomains: ['im', 'calendar', 'task', 'contact'],
  },
  oa: {
    fields: [
      { key: 'completed', label: '本周完成工作' },
      { key: 'uncompleted', label: '本周未完成工作及原因' },
      { key: 'nextPlan', label: '下周工作计划' },
      { key: 'help', label: '需要协调与帮助' },
      { key: 'reflection', label: '学习和反思' },
    ],
  },
  project: {
    skipDirs: ['Users', 'home', 'workspace', 'GitHub', 'folders'],
  },
  git: {
    searchOverride: [],
    pruneDirs: ['node_modules', '.hermes', '.agents', '.opencode', 'Library', '.cache', '.Trash', 'Applications', '.vscode', 'Windows', 'Program Files', 'Program Files (x86)', 'ProgramData', '$Recycle.Bin', 'System Volume Information', 'PerfLogs', 'AppData'],
    authorOverride: '',
  },
  aiTools: {
    tools: [
      { name: 'opencode', enabled: true, adapter: 'opencode', paths: ['~/.local/share/opencode/opencode.db'] },
      { name: 'claude-code', enabled: true, adapter: 'claude-code', paths: ['~/.claude'] },
      { name: 'cursor', enabled: true, adapter: 'vscode-family', paths: ['~/Library/Application Support/Cursor'] },
      { name: 'windsurf', enabled: true, adapter: 'vscode-family', paths: ['~/Library/Application Support/Windsurf'] },
      { name: 'trae', enabled: true, adapter: 'vscode-family', paths: ['~/Library/Application Support/Trae'] },
      { name: 'codeium', enabled: true, adapter: 'codeium', paths: ['~/.codeium'] },
    ],
    titleSkipKeywords: ['subagent', 'explore', 'analyze'],
  },
  generate: {
    noisePatterns: [
      '^Merge branch',
      '^Revert',
      '^\\s*(readme|README|Readme)\\b',
      '^\\s*greeting\\b',
      '^\\s*Restoring',
      '^\\s*$',
      '^\\s*更新\\s*$',
      '^\\s*readme\\s*$',
      'fear:',
    ],
    commitVerbs: { feat: '实现', fix: '修复', refactor: '重构', docs: '完善文档', chore: '维护', style: '优化', test: '补充测试', perf: '优化', build: '构建维护' },
    workVerbs: ['实现', '推进', '完成', '修复', '优化', '完善', '重构', '接入', '开发', '维护', '整理', '补充', '升级', '部署', '联调', '调研', '产出', '梳理', '推动', '配合', '参与', '支持', '打通', '适配', '创建', '规划', '上线'],
    sessionDoneMarkers: ['实现', '完成', '上线', '闭环'],
    sessionDefaultVerb: '推进',
    sessionSkipPattern: 'subagent|Explore|Analyze|Load|greeting|Restoring|New session|撰写周报',
    messageNoiseWords: ['需要', '吗', '吧', '呢', '还是', '其实', '感觉', '觉得', '你看', '我认为', '我理解', '提示词', '架构', '模型', '框架', '训练', '推理', '引擎', '你觉得', '怎么样', '怎么', '什么', '哪', '可以', '过来', '一下', '帮我', '帮忙', '评估', '对应', '方面', '这些', '那些', '这块', '那个', '这坨', '工资', '加班', '吃饭', '下班', '放假', '考勤'],
    messageStrongVerbs: ['已完成', '推进', '实现', '修复', '上线', '发布', '部署', '验收', '联调', '对接', '接入', '打通', '排期', '立项', '提测', '迭代'],
  },
}

const CONFIG_LOCAL_PATH = fileURLToPath(new URL('../config.local.json', import.meta.url))

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function deepMerge(base: any, over: any): any {
  if (!over) return base
  if (Array.isArray(over)) return over // 数组整体替换
  if (isPlainObject(base) && isPlainObject(over)) {
    const out: Record<string, any> = { ...base }
    for (const k of Object.keys(over)) {
      out[k] = deepMerge(base[k], over[k])
    }
    return out
  }
  return over
}

export function expandHome(p: string): string {
  if (p === '~') return home
  if (p.startsWith('~/')) return p.replace(/^~/, home)
  return p
}

export function resolvePaths(paths: string[]): string[] {
  return (paths || []).map(expandHome)
}

function loadLocal(): Config {
  if (!existsSync(CONFIG_LOCAL_PATH)) return DEFAULT_CONFIG
  try {
    const raw = JSON.parse(readFileSync(CONFIG_LOCAL_PATH, 'utf-8'))
    console.log(`◇ 加载个性化配置 config.local.json`)
    return deepMerge(DEFAULT_CONFIG, raw) as Config
  } catch (e: any) {
    console.log(`⚠️ config.local.json 解析失败，使用默认配置: ${e.message}`)
    return DEFAULT_CONFIG
  }
}

export const CONFIG: Config = loadLocal()