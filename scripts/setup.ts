import { writeFileSync } from 'fs'
import { createInterface } from 'readline'

const rl = createInterface({ input: process.stdin, output: process.stdout })

const question = (prompt: string): Promise<string> =>
  new Promise((resolve) => rl.question(prompt, resolve))

async function askRequired(label: string, hint: string): Promise<string> {
  while (true) {
    const value = (await question(`${label}${hint ? ` (${hint})` : ''}: `)).trim()
    if (value) return value
    console.log(`  ⚠ ${label} 为必填项，请输入`)
  }
}

async function askOptional(label: string, hint: string): Promise<string> {
  const value = (await question(`${label}${hint ? ` (${hint})` : ''} [可跳过]: `)).trim()
  return value
}

async function main() {
  console.log('飞书周报自动化 - 环境配置\n')

  const appId = await askRequired('FEISHU_APP_ID', '飞书应用 App ID')
  const appSecret = await askRequired('FEISHU_APP_SECRET', '飞书应用 App Secret')
  const reportRuleId = (await askOptional('FEISHU_REPORT_RULE_ID', '周报表 ID，默认 7179489743821406210')) || '7179489743821406210'
  const openId = await askOptional('FEISHU_OPEN_ID', '飞书 Open ID，后续可在 .env 中添加')

  const env = `# 飞书应用凭证
FEISHU_APP_ID="${appId}"
FEISHU_APP_SECRET="${appSecret}"

# 飞书周报表 ID
FEISHU_REPORT_RULE_ID="${reportRuleId}"

# 飞书 Open ID（可选）
${openId ? `FEISHU_OPEN_ID="${openId}"` : '# FEISHU_OPEN_ID=""'}
`

  writeFileSync('.env', env)
  console.log('\n✓ .env 文件已生成')

  if (!openId) {
    console.log('  提示: FEISHU_OPEN_ID 未配置，通知功能暂不可用。')
    console.log('  后续获取到 Open ID 后，直接编辑 .env 文件添加即可，无需重新初始化。')
    console.log('  获取方式：飞书搜索"飞书小助手"发送 /myopenid')
  }

  // OAuth 配置提示
  console.log('\n========== 用户授权配置（可选）==========')
  console.log('为了采集所有群的消息（不限于机器人所在群），需要配置用户授权：')
  console.log('')
  console.log('1. 在飞书开放平台 > 你的应用 > 安全设置 中添加重定向 URL：')
  console.log('   http://127.0.0.1')
  console.log('')
  console.log('2. 确保应用已开通以下权限：')
  console.log('   - im:message:readonly（读取消息）')
  console.log('   - contact:user.base:readonly（读取用户信息）')
  console.log('')
  console.log('3. 运行以下命令进行用户授权：')
  console.log('   npx tsx scripts/oauth.ts')
  console.log('')
  console.log('4. 授权后 Token 自动保存，后续采集会使用用户身份')
  console.log('========================================\n')

  rl.close()
}

main()
