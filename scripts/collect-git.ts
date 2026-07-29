#!/usr/bin/env node
import { GitCollector } from './git-collector.ts'
import { writeFileSync } from 'fs'

console.log('🔍 扫描 Git 仓库...\n')

const userInfo = GitCollector.getGitUserInfo()
if (!userInfo) {
  console.log('⚠️  未配置 Git 用户信息，跳过代码采集\n')
  writeFileSync('git-commits.json', JSON.stringify({ hasGit: true, hasUser: false, commits: [], workItems: [], reportText: '' }, null, 2))
  process.exit(0)
}

const result = GitCollector.collectAllCommits()
const commits = result.commits

if (commits.length === 0) {
  console.log('\nℹ️  本周暂无代码提交\n')
  writeFileSync('git-commits.json', JSON.stringify({ hasGit: true, hasUser: true, commits: [], workItems: [], reportText: '', scannedRepos: result.repos, repoCount: result.repoCount, userInfo }, null, 2))
  process.exit(0)
}

console.log(`\n🤖 分析提交内容...`)
const workItems = GitCollector.analyzeCommits(commits)
console.log(`✅ 整理为 ${workItems.length} 个工作项\n`)

const reportText = GitCollector.generateReportText(workItems)

const data = {
  hasGit: true, hasUser: true, userInfo,
  commits, workItems, reportText,
  scannedRepos: result.repos,
  repoCount: result.repoCount,
  summary: {
    totalCommits: commits.length,
    workItems: workItems.length,
    byType: workItems.reduce((acc, item) => { acc[item.type] = (acc[item.type] || 0) + 1; return acc }, {} as Record<string, number>),
  },
}

writeFileSync('git-commits.json', JSON.stringify(data, null, 2))

console.log('📄 提交分类:')
const typeNames: Record<string, string> = { feature: '功能开发', bugfix: 'Bug 修复', refactor: '代码重构', docs: '文档更新', test: '测试相关', other: '其他工作' }
for (const [type, count] of Object.entries(data.summary.byType)) {
  console.log(`   ${typeNames[type] || type}: ${count} 项`)
}
console.log('\n✅ Git 数据采集完成！\n')
