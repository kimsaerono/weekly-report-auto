# 常见错误与修复

| 错误 | 原因 | 修复 |
|------|------|------|
| Playwright 打不开浏览器 | 未安装 Chromium | 运行 `npx playwright install chromium` |
| Cookie 过期 / 需重新扫码 | 长时间未使用 | 删除 `.feishu-cookies.json` 重新扫码 |
| lark-cli 未登录 | 首次使用 | 运行 `lark-cli auth login` |
| `FEISHU_REPORT_RULE_ID` 报错 | 未配置 | 从周报页面 URL 中 `ruleId=` 后获取数字 |
| 飞书文档搜索未授权 | 缺 `search:docs:read` scope | `lark-cli auth login --scope "search:docs:read drive:drive:readonly drive:drive opt_space_doc:read"` |
| OA 编号未生效 | 未激活编号列表 | 填入时用 `1.` 列表项触发编号；标题段落不编号 |
| 层级不对 | 没用 Tab/Shift+Tab | 用 `Tab` 降级为 `a./b.` 子层、`Shift+Tab` 升级 |

## 历史踩坑（不要回退）

- **OA 编号快捷键 `Meta+Shift+7` 只对首个字段首行生效**，后续字段失效——已被 `fieldListButtonIndex()` 按钮激活方案替代，不要改回去。
- **`ed.click()` 会导致字段 0 的 fix 行退回普通段落（plain）**——按钮激活后需用键盘操作（Enter/Tab/Shift+Tab），不要再对列表项本身 `click()`。
- **报告数据量小是正常的**：若本周数据少（如只有 1-2 条），`hasWeekData()` 判定有数据即不回退上周，生成的 report.json 行数少不是 bug。