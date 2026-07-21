import { execSync } from 'child_process'

export class LarkCLI {
  static getCurrentUser(): { open_id: string; name: string } {
    const output = execSync('lark-cli user get --user_id me', { encoding: 'utf-8' })
    const openId = output.match(/open_id:\s*(.+)/)?.[1]?.trim()
    const name = output.match(/name:\s*(.+)/)?.[1]?.trim()
    if (!openId) throw new Error('无法获取 OpenID')
    return { open_id: openId, name: name || 'Unknown' }
  }

  static getMessages(options: { startTime?: string; endTime?: string; limit?: number } = {}): any[] {
    const args = ['im', '+messages-search', '--page-size', String(options.limit || 50), '--page-all']
    if (options.startTime) args.push('--start', options.startTime)
    if (options.endTime) args.push('--end', options.endTime)
    const output = execSync(`lark-cli ${args.join(' ')}`, { encoding: 'utf-8' })
    return JSON.parse(output)
  }

  static getCalendarEvents(options: { startTime: string; endTime: string }): any[] {
    const args = ['calendar', '+search-event', '--start', options.startTime, '--end', options.endTime, '--page-size', '30']
    const output = execSync(`lark-cli ${args.join(' ')}`, { encoding: 'utf-8' })
    return JSON.parse(output)
  }

  static getTasks(options: { status?: 'completed' | 'incomplete' } = {}): any[] {
    const args = ['task', '+get-my-tasks', '--page-all']
    if (options.status === 'completed') args.push('--complete')
    const output = execSync(`lark-cli ${args.join(' ')}`, { encoding: 'utf-8' })
    return JSON.parse(output)
  }
}
