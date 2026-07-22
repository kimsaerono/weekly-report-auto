import { execSync } from 'child_process'

export class LarkCLI {
  static getCurrentUser(): { open_id: string; name: string } {
    const output = execSync('lark-cli contact +get-user', { encoding: 'utf-8' })
    const result = JSON.parse(output)
    const openId = result?.data?.user?.open_id
    const name = result?.data?.user?.name
    if (!openId) throw new Error('无法获取 OpenID')
    return { open_id: openId, name: name || 'Unknown' }
  }

  static getMessages(options: { startTime?: string; endTime?: string; limit?: number } = {}): any {
    try {
      const searchArgs = ['im', '+messages-search', '--page-size', String(options.limit || 50), '--page-all']
      if (options.startTime) searchArgs.push('--start', options.startTime)
      if (options.endTime) searchArgs.push('--end', options.endTime)
      
      const searchOutput = execSync(`lark-cli ${searchArgs.join(' ')}`, { encoding: 'utf-8' })
      const searchData = JSON.parse(searchOutput)
      const messageIds = searchData?.data?.message_ids || []
      
      if (messageIds.length === 0) {
        return { data: { messages: [] } }
      }
      
      const BATCH_SIZE = 50
      const allMessages: any[] = []
      
      for (let i = 0; i < messageIds.length; i += BATCH_SIZE) {
        const batch = messageIds.slice(i, i + BATCH_SIZE)
        try {
          const mgetArgs = ['im', '+messages-mget', '--message-ids', batch.join(',')]
          const mgetOutput = execSync(`lark-cli ${mgetArgs.join(' ')}`, { encoding: 'utf-8' })
          const mgetData = JSON.parse(mgetOutput)
          if (mgetData?.data?.messages) {
            allMessages.push(...mgetData.data.messages)
          }
        } catch (e) {
          // Skip failed batches
        }
      }
      
      return { data: { messages: allMessages } }
    } catch (error: any) {
      console.log(`⚠️  消息采集失败（机器人权限未激活）: ${error.message}`)
      return { data: { messages: [] } }
    }
  }

  static getCalendarEvents(options: { startTime: string; endTime: string }): any {
    const args = ['calendar', '+search-event', '--start', options.startTime, '--end', options.endTime, '--page-size', '30']
    const output = execSync(`lark-cli ${args.join(' ')}`, { encoding: 'utf-8' })
    return JSON.parse(output)
  }

  static getTasks(options: { status?: 'completed' | 'incomplete' } = {}): any {
    const args = ['task', '+get-my-tasks', '--page-all']
    if (options.status === 'completed') args.push('--complete')
    const output = execSync(`lark-cli ${args.join(' ')}`, { encoding: 'utf-8' })
    return JSON.parse(output)
  }
}
