async function sendCard(openId: string, content: {
  completed: string
  uncompleted: string
  nextPlan: string
  help: string
  reflection: string
}) {
  const appId = process.env.FEISHU_APP_ID!
  const appSecret = process.env.FEISHU_APP_SECRET!
  const ruleId = process.env.FEISHU_REPORT_RULE_ID!

  const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  })
  const { tenant_access_token: token } = await tokenRes.json() as { tenant_access_token: string }

  const card = {
    elements: [
      { tag: 'markdown', content: `**本周完成工作**\n${content.completed || '（无）'}` },
      { tag: 'markdown', content: `**本周未完成工作及原因**\n${content.uncompleted || '（无）'}` },
      { tag: 'markdown', content: `**下周工作计划**\n${content.nextPlan || '（无）'}` },
      { tag: 'markdown', content: `**需要协调与帮助**\n${content.help || '（无）'}` },
      { tag: 'markdown', content: `**学习和反思**\n${content.reflection || '（无）'}` },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '✏️ 编辑草稿' },
            url: `https://oa.feishu.cn/report/record/detail?ruleId=${ruleId}&routeFrom=/record/list`,
            type: 'default'
          }
        ]
      }
    ],
    header: {
      title: { tag: 'plain_text', content: '本周周报已生成' },
      template: 'blue'
    }
  }

  const body = {
    receive_id: openId,
    msg_type: 'interactive',
    content: JSON.stringify(card)
  }

  const res = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  const data = await res.json() as { code: number }
  if (data.code !== 0) {
    console.error('通知发送失败:', JSON.stringify(data))
    process.exit(1)
  }
  console.log('通知已发送')
}

const content = {
  completed: process.env.REPORT_COMPLETED || '',
  uncompleted: process.env.REPORT_UNCOMPLETED || '',
  nextPlan: process.env.REPORT_NEXT_PLAN || '',
  help: process.env.REPORT_HELP || '',
  reflection: process.env.REPORT_REFLECTION || '',
}

const openId = process.env.FEISHU_OPEN_ID
if (!openId) {
  console.log('FEISHU_OPEN_ID 未配置，跳过通知')
  process.exit(0)
}
sendCard(openId, content)
