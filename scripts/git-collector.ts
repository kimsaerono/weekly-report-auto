import { execSync } from 'child_process'
import { existsSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { join, relative } from 'path'

function formatLocal(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export class GitCollector {
  static isGitRepo(path?: string): boolean {
    return existsSync(path ? join(path, '.git') : '.git')
  }

  static getGitUserInfo(): { name: string; email: string } | null {
    try {
      const name = execSync('git config user.name', { encoding: 'utf-8' }).trim()
      const email = execSync('git config user.email', { encoding: 'utf-8' }).trim()
      return { name, email }
    } catch {
      return null
    }
  }

  static discoverRepos(searchDirs: string[]): string[] {
    const repoSet = new Set<string>()
    const isWin = process.platform === 'win32'

    for (const dir of searchDirs) {
      if (!existsSync(dir)) continue
      try {
        if (isWin) {
          this.walkForRepos(dir, repoSet, 0, 4)
        } else {
          const output = execSync(
            `find "${dir}" -maxdepth 5 -type d \\( -path "*/node_modules" -o -path "*/.hermes" -o -path "*/.agents" -o -path "*/.opencode" -o -path "*/Library" -o -path "*/.cache" -o -path "*/.Trash" -o -path "*/Applications" -o -path "*/.vscode" -o -path "*/.pyvenv" \\) -prune -o -name ".git" -print 2>/dev/null`,
            { encoding: 'utf-8', timeout: 30000 }
          )
          for (const line of output.trim().split('\n').filter(Boolean)) {
            const repoPath = line.replace(/\/\.git$/, '').replace(/\\\.git$/, '')
            if (!repoPath.includes('/node_modules/') && !repoPath.includes('/.hermes/') && !repoPath.includes('/.agents/') && !repoPath.includes('/.opencode/') && !repoPath.includes('/Library/')) {
              repoSet.add(repoPath)
            }
          }
        }
      } catch { continue }
    }
    return [...repoSet].sort()
  }

  private static enumerateWindowsDrives(): string[] {
    const drives = new Set<string>()
    try {
      const output = execSync('fsutil fsinfo drives', { encoding: 'utf-8', timeout: 10000 })
      const match = output.match(/[A-Za-z]:[\\\/]?/g)
      if (match) for (const d of match) drives.add(d.replace(/[\\\/]/, ''))
    } catch {
      try {
        const output = execSync('wmic logicaldisk get name', { encoding: 'utf-8', timeout: 10000 })
        for (const line of output.trim().split('\n')) {
          const m = line.trim().match(/^([A-Za-z]):/) 
          if (m) drives.add(`${m[1]}:`)
        }
      } catch { /* 枚举失败则仅保留 cwd */ }
    }
    if (drives.size === 0) drives.add(process.cwd())
    return [...drives]
  }

  private static enumerateVolumes(): string[] {
    const volumes = []
    try {
      const output = execSync('ls /Volumes', { encoding: 'utf-8', timeout: 10000 })
      for (const name of output.trim().split('\n').filter(Boolean)) {
        const p = join('/Volumes', name)
        if (existsSync(p) && name !== 'Macintosh HD') volumes.push(p)
      }
    } catch { /* 无 /Volumes 可忽略 */ }
    return volumes
  }

  private static walkForRepos(dir: string, repos: Set<string>, depth: number, maxDepth: number): void {
    if (depth > maxDepth) return
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.hermes' || entry.name === '.agents' || entry.name === '.opencode' || entry.name === 'Library' || entry.name === '.cache' || entry.name === '.Trash' || entry.name === 'Applications' || entry.name === '.vscode' || entry.name === 'Windows' || entry.name === 'Program Files' || entry.name === 'Program Files (x86)' || entry.name === 'ProgramData' || entry.name === '$Recycle.Bin' || entry.name === 'System Volume Information' || entry.name === 'PerfLogs' || entry.name === 'AppData') continue
        if (entry.name === '.git' && entry.isDirectory()) {
          repos.add(dir)
          continue
        }
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          this.walkForRepos(join(dir, entry.name), repos, depth + 1, maxDepth)
        }
      }
    } catch { return }
  }

  static collectFromRepo(repoPath: string, authorName: string, since: string, until: string): GitCommit[] {
    try {
      const marker = '==C=='
      const sep = '\u001F'
      const format = `${marker}%H${sep}%s${sep}%ad${sep}%an${sep}%ae`
      const output = execSync(
        `git log --since="${since}" --until="${until}" --author="${authorName}" --no-merges --name-status --format="${format}" --date=short`,
        { encoding: 'utf-8', cwd: repoPath }
      )
      if (!output.trim()) return []

      const commits: GitCommit[] = []
      let current: Partial<GitCommit> | null = null
      for (const line of output.trim().split('\n')) {
        if (line.startsWith(marker)) {
          const parts = line.slice(marker.length).split(sep)
          if (parts.length < 5) continue
          if (current?.hash) commits.push(current as GitCommit)
          current = {
            hash: parts[0].substring(0, 8),
            message: parts[1],
            date: parts[2],
            author: parts[3],
            email: parts[4],
            repo: relative(homedir(), repoPath),
            files: [],
          }
        } else if (current) {
          const parsed = this.parseNameStatusLine(line)
          if (parsed && current.files) current.files.push(parsed)
        }
      }
      if (current?.hash) commits.push(current as GitCommit)
      return commits
    } catch {
      return []
    }
  }

  private static parseNameStatusLine(line: string): GitFile | null {
    const trimmed = line.trim()
    if (!trimmed) return null
    const statusMatch = trimmed.match(/^([AMDRCT])\d*\t(.+)$/)
    if (!statusMatch) return null
    const status = statusMatch[1] as GitFile['status']
    let path = statusMatch[2]
    if (status === 'R' || status === 'C') {
      const tabs = path.split('\t')
      path = tabs[tabs.length - 1]
    }
    return { path, status, isDoc: this.isDocFile(path) }
  }

  private static isDocFile(path: string): boolean {
    const lower = path.toLowerCase().split('/').pop() || path.toLowerCase()
    const docExts = ['.md', '.txt', '.rst', '.adoc', '.docx', '.pdf']
    if (docExts.some(ext => lower.endsWith(ext))) return true
    return /^(readme|changelog|license|notice|contributing|authors|security)(\.|$)/i.test(path)
  }

  static collectAllCommits(searchDirs?: string[]): { commits: GitCommit[]; repoCount: number; repos: string[] } {
    const userInfo = this.getGitUserInfo()
    if (!userInfo) {
      return { commits: [], repoCount: 0, repos: [] }
    }

    const now = new Date()
    const day = now.getDay() || 7
    const weekOffset = Number(process.env.WEEK_OFFSET || 0)
    const monday = new Date(now)
    monday.setDate(now.getDate() - day + 1 - weekOffset * 7)
    monday.setHours(0, 0, 0, 0)
    const since = formatLocal(monday)

    const sunday = new Date(now)
    sunday.setDate(now.getDate() - day + 7 - weekOffset * 7)
    sunday.setHours(23, 59, 59, 999)
    const until = formatLocal(sunday)

    const isWin = process.platform === 'win32'
    const defaultDirs = isWin ? this.enumerateWindowsDrives() : [...new Set([homedir(), ...this.enumerateVolumes(), process.cwd()])]
    const repos = this.discoverRepos(searchDirs || defaultDirs)
    console.log(`🔍 找到 ${repos.length} 个 Git 仓库`)
    console.log(`👤 作者: ${userInfo.name} <${userInfo.email}>`)
    console.log(`📅 时间范围: ${since} ~ ${until}\n`)

    const allCommits: GitCommit[] = []
    let validRepoCount = 0

    for (const repo of repos) {
      const commits = this.collectFromRepo(repo, userInfo.name, since, until)
      if (commits.length > 0) {
        console.log(`  ${relative(homedir(), repo)} → ${commits.length} 条提交`)
        allCommits.push(...commits)
        validRepoCount++
      }
    }

    if (validRepoCount === 0) {
      console.log('ℹ️  本周暂无提交')
    } else {
      console.log(`\n✅ 共 ${validRepoCount} 个仓库有提交，${allCommits.length} 条记录`)
    }

    return {
      commits: allCommits,
      repoCount: repos.length,
      repos: repos.map(r => relative(homedir(), r)),
    }
  }

  static analyzeCommits(commits: GitCommit[]): GitWorkItem[] {
    const workItems: GitWorkItem[] = []
    for (const commit of commits) {
      const item = this.categorizeCommit(commit)
      if (item) workItems.push(item)
    }
    return this.mergeSimilarItems(workItems)
  }

  private static categorizeCommit(commit: GitCommit): GitWorkItem | null {
    const msg = commit.message.toLowerCase()
    if (this.isNoiseCommit(msg)) return null
    let type: GitWorkItem['type'] = 'other'
    let priority: GitWorkItem['priority'] = 'medium'
    if (msg.includes('fix') || msg.includes('bug') || msg.includes('修复')) {
      type = 'bugfix'; priority = 'high'
    } else if (msg.includes('feat') || msg.includes('feature') || msg.includes('新增')) {
      type = 'feature'; priority = 'high'
    } else if (msg.includes('refactor') || msg.includes('重构')) {
      type = 'refactor'
    } else if (msg.includes('docs') || msg.includes('文档')) {
      type = 'docs'; priority = 'low'
    } else if (msg.includes('test') || msg.includes('测试')) {
      type = 'test'
    }
    return { type, description: commit.message, commitHash: commit.hash, date: commit.date, priority, repo: commit.repo }
  }

  private static isNoiseCommit(message: string): boolean {
    const noisePatterns = [/^merge\s/i, /^revert\s/i, /^bump\sversion/i, /^wip$/i, /^tmp$/i]
    return noisePatterns.some(p => p.test(message))
  }

  private static mergeSimilarItems(items: GitWorkItem[]): GitWorkItem[] {
    const groups = new Map<string, GitWorkItem[]>()
    for (const item of items) {
      const key = `${item.type}-${this.simplifyDescription(item.description)}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(item)
    }
    const merged: GitWorkItem[] = []
    for (const [_, group] of groups) {
      if (group.length === 1) {
        merged.push(group[0])
      } else {
        merged.push({ ...group[0], description: `${group[0].description} (共 ${group.length} 次提交)` })
      }
    }
    return merged
  }

  private static simplifyDescription(desc: string): string {
    return desc.toLowerCase().replace(/\s+/g, ' ').replace(/[^\w\u4e00-\u9fa5]/g, '').substring(0, 20)
  }

  static generateReportText(items: GitWorkItem[], commits: GitCommit[] = []): string {
    if (items.length === 0 && commits.length === 0) return ''
    const lines: string[] = ['【代码提交】']
    const byType = this.groupByType(items)
    for (const [type, typeItems] of Object.entries(byType)) {
      const typeName = this.getTypeName(type as GitWorkItem['type'])
      if (typeItems.length === 0) continue
      lines.push(`\n${typeName}:`)
      for (const item of typeItems) {
        lines.push(`  • ${item.description}`)
      }
    }
    const docPaths = this.extractDocPaths(commits)
    if (docPaths.length > 0) {
      lines.push(`\n文档更新:`)
      for (const p of docPaths) lines.push(`  • ${p}`)
    }
    return lines.join('\n')
  }

  private static extractDocPaths(commits: GitCommit[]): string[] {
    const seen = new Set<string>()
    const paths: string[] = []
    for (const c of commits) {
      for (const f of c.files || []) {
        if (f.isDoc && f.status !== 'D' && !seen.has(f.path)) {
          seen.add(f.path)
          paths.push(f.path)
        }
      }
    }
    return paths.slice(0, 10)
  }

  private static groupByType(items: GitWorkItem[]): Record<string, GitWorkItem[]> {
    return items.reduce((acc, item) => {
      if (!acc[item.type]) acc[item.type] = []
      acc[item.type].push(item)
      return acc
    }, {} as Record<string, GitWorkItem[]>)
  }

  private static getTypeName(type: GitWorkItem['type']): string {
    const names: Record<string, string> = {
      feature: '功能开发', bugfix: 'Bug 修复', refactor: '代码重构', docs: '文档更新', test: '测试相关', other: '其他工作',
    }
    return names[type] || '其他'
  }
}

export interface GitCommit {
  hash: string
  message: string
  date: string
  author: string
  email: string
  repo?: string
  files?: GitFile[]
}

export interface GitFile {
  path: string
  status: 'A' | 'M' | 'D' | 'R' | 'C'
  isDoc: boolean
}

export interface GitWorkItem {
  type: 'feature' | 'bugfix' | 'refactor' | 'docs' | 'test' | 'other'
  description: string
  commitHash: string
  date: string
  priority: 'high' | 'medium' | 'low'
  repo?: string
}
