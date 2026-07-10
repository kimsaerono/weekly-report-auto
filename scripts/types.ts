export interface FeishuConfig {
  appId: string
  appSecret: string
}

export interface UserConfig {
  openId: string
  reportRuleId: string
  cookiePath: string
}

export interface WeeklyReport {
  completed: string
  uncompleted: string
  nextPlan: string
  help: string
  reflection: string
}

export interface FeishuMessage {
  messageId: string
  content: string
  createTime: string
  chatId: string
}
