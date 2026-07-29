import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join, relative } from 'path'

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
    for (const dir of searchDirs) {
      if (!existsSync(dir)) continue
      try {
        const output = execSync(
          `find "${dir}" -name ".git" -maxdepth 4 -type d 2>/dev/null`,
          { encoding: 'utf-8', timeout: 15000 }
        )
        for (const line of output.trim().split('\n').filter(Boolean)) {
          const repoPath = line.replace(/\/\.git$/, '')
          if (!repoPath.includes('/node_modules/') && !repoPath.includes('/.hermes/') && !repoPath.includes('/.agents/') && !repoPath.includes('/.opencode/')) {
            repoSet.add(repoPath)
          }
        }
      } catch { continue }
    }
    return [...repoSet].sort()
  }

  static collectFromRepo(repoPath: string, authorName: string, since: string, until: string): GitCommit[] {
    try {
      const format = '%H|%s|%ad|%an|%ae'
      const output = execSync(
        `git log --since="${since}" --until="${until}" --author="${authorName}" --format="${format}" --date=short`,
        { encoding: 'utf-8', cwd: repoPath }
      )
      if (!output.trim()) return []
      return output.trim().split('\n').map(line => {
        const parts = line.split('|')
        if (parts.length < 5) return null
        return {
          hash: parts[0].substring(0, 8),
          message: parts[1],
          date: parts[2],
          author: parts[3],
          email: parts[4],
          repo: relative(homedir(), repoPath),
        }
      }).filter(Boolean) as GitCommit[]
    } catch {
      return []
    }
  }

  static collectAllCommits(searchDirs?: string[]): { commits: GitCommit[]; repoCount: number; repos: string[] } {
    const userInfo = this.getGitUserInfo()
    if (!userInfo) {
      return { commits: [], repoCount: 0, repos: [] }
    }

    const now = new Date()
    const day = now.getDay() || 7
    const monday = new Date(now)
    monday.setDate(now.getDate() - day + 1)
    monday.setHours(0, 0, 0, 0)
    const since = monday.toISOString().split('T')[0]

    const sunday = new Date(now)
    sunday.setDate(now.getDate() - day + 7)
    sunday.setHours(23, 59, 59, 999)
    const until = sunday.toISOString().split('T')[0]

    const defaultDirs = [join(homedir(), 'workspace'), process.cwd()]
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

  static generateReportText(items: GitWorkItem[]): string {
    if (items.length === 0) return ''
    const byType = this.groupByType(items)
    const lines: string[] = ['【代码提交】']
    for (const [type, typeItems] of Object.entries(byType)) {
      const typeName = this.getTypeName(type as GitWorkItem['type'])
      lines.push(`\n${typeName}:`)
      for (const item of typeItems) {
        lines.push(`  • ${item.description}`)
      }
    }
    return lines.join('\n')
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
}

export interface GitWorkItem {
  type: 'feature' | 'bugfix' | 'refactor' | 'docs' | 'test' | 'other'
  description: string
  commitHash: string
  date: string
  priority: 'high' | 'medium' | 'low'
  repo?: string
}
