// 跨平台项目名解析：统一处理 Windows 反斜杠路径、盘符、用户名、语义化业务名（titleRoots）。
// 语义名由 config.local.json 的 project.titleRoots 显式指定（精确匹配目录段，取最深层命中），
// 命中时 L1 = 语义名（真实仓库名），未命中回退仓库名直出，保证永不以磁盘路径为题。
// 归属原则：会话/改动按「实际所属的 git 仓库」归因（locateRepo），定位不到视为非项目 → 其他。
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { CONFIG } from './config.ts'
import type { BusinessDef } from './config.ts'

// 路径统一为正斜杠（git-collector 存库、generate-report 解析都基于此）
export function toPosix(p: string): string {
  return (p || '').replace(/\\/g, '/')
}

const USERNAME = (toPosix(homedir()).split('/').pop() || '').toLowerCase()
const DEFAULT_IGNORED = new Set([...CONFIG.project.skipDirs, USERNAME])

function isDriveSegment(seg: string): boolean {
  return /^[a-zA-Z]:$/.test(seg)
}

// 取路径的最后一段目录名（过滤盘符/.. /用户名/忽略目录），绝对不含磁盘路径
export function repoBaseName(pathOrRepo: string): string {
  const segs = splitSegments(pathOrRepo)
  const meaningful = segs.filter(s => !isDriveSegment(s) && s !== '..' && !DEFAULT_IGNORED.has(s))
  return meaningful[meaningful.length - 1] || '其他'
}

// 向上找第一个含 .git 的祖先目录 = 该路径所属的真实仓库；找不到返回 null。
// 用于把「在任意目录（容器根/下载目录/home）里产生的改动」归因到实际项目仓库。
export function locateRepo(abs: string): string | null {
  const raw = toPosix(abs || '')
  if (!raw) return null
  const segs = raw.split('/').filter(Boolean)
  if (segs.length === 0) return null
  const drive = isDriveSegment(segs[0]) ? segs[0] : null
  const start = drive ? 1 : 0
  for (let i = segs.length; i > start; i--) {
    const body = segs.slice(start, i).join('/')
    const cand = drive ? `${drive}/${body}` : `/${body}`
    try {
      if (existsSync(join(cand, '.git'))) return cand
    } catch { /* 权限或路径无效，继续向上 */ }
  }
  return null
}

// 业务归属解析：仓库名命中 repos 最优先，其次目录段命中 roots（跨业务取最深层、同层按配置序），
// 未命中回退仓库名。返回「业务名 label（分组键） + 来源仓库 repo」，供 L1=业务、多仓库三级排版使用。
export interface BusinessResolve {
  label: string
  repo: string
}

export function resolveBusiness(
  pathOrRepo: string,
  businesses: BusinessDef[] = CONFIG.project.businesses,
): BusinessResolve {
  const repo = repoBaseName(pathOrRepo)
  if (!pathOrRepo) return { label: repo, repo }
  const segs = splitSegments(pathOrRepo)
  const meaningful = segs.filter(s => !isDriveSegment(s) && s !== '..' && !DEFAULT_IGNORED.has(s))

  // 1) 仓库名精确命中（最优先）
  for (const b of businesses || []) {
    if ((b.repos || []).some(r => r.toLowerCase() === repo.toLowerCase())) return { label: b.label, repo }
  }
  // 2) 目录段命中（取最深层段；同深度按配置序）
  const rootHits: Array<{ label: string; depth: number }> = []
  for (const b of businesses || []) {
    for (const seg of meaningful.slice(0, -1)) {
      if ((b.roots || []).some(r => r.toLowerCase() === seg.toLowerCase())) {
        rootHits.push({ label: b.label, depth: meaningful.indexOf(seg) })
      }
    }
  }
  if (rootHits.length > 0) {
    rootHits.sort((a, b) => b.depth - a.depth)
    return { label: rootHits[0].label, repo }
  }
  // 3) 兜底：仓库名直出
  return { label: repo, repo }
}

// 语义化 L1：返回业务名（分组键）。会话/提交/文档统一调用，保证同业务落到同一 L1
export function deriveProjectName(pathOrRepo: string, businesses: BusinessDef[] = CONFIG.project.businesses): string {
  return resolveBusiness(pathOrRepo, businesses).label
}

function splitSegments(pathOrRepo: string): string[] {
  return toPosix(pathOrRepo)
    .split('/')
    .filter(Boolean)
}