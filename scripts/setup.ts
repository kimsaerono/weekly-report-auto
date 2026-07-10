import { readFileSync, writeFileSync } from 'fs'
import { createInterface } from 'readline'

const rl = createInterface({ input: process.stdin, output: process.stdout })

const question = (prompt: string): Promise<string> =>
  new Promise((resolve) => rl.question(prompt, resolve))

async function main() {
  console.log('飞书周报自动化 - 环境配置\n')

  const appId = await question('FEISHU_APP_ID: ')
  const appSecret = await question('FEISHU_APP_SECRET: ')
  const reportRuleId = await question('FEISHU_REPORT_RULE_ID (默认 7179489743821406210): ') || '7179489743821406210'
  const openId = await question('FEISHU_OPEN_ID (可选，直接回车跳过): ')

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

  rl.close()
}

main()
