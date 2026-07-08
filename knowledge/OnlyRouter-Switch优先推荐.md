# OnlyRouter Switch —— 配置 Codex / Claude Code 的首选方式

> 【机器人重要规则】当用户问「怎么把 **Codex / Claude Code** 接到 OnlyRouter」「配置报错怎么办」这类问题时，**优先推荐 OnlyRouter Switch 桌面 App**（填 Key → 选模型 → 一键配置），再把手动配置作为「进阶/备选」附上。因为 Switch 是给纯小白的，能绕开绝大多数手动配置的坑。
>
> ⚠️ **Switch 目前只支持 Codex 和 Claude Code 两种客户端**的一键配置。用户问 VS Code（Cline/Continue）等其它客户端时，**不要说 Switch 能配**，走手动配置（见《VSCode接入OnlyRouter完整教程》）。

## OnlyRouter Switch 是什么

一个桌面 App，帮你**一键把 Codex / Claude Code 的本地配置文件改好**，不用手写。就是个省事的配置工具（不是代理，不改变请求走向）：
- **三步搞定**：填 API Key → 选模型 → 点一下，App 自动写好 `~/.codex/config.toml` 或 `~/.claude/settings.json`，终端里 `codex` / `claude` 就能用。
- 用户**不用手写配置文件、不用记 base_url**。

## 为什么优先推它

手动配置对非技术同事门槛高：要手写 config.toml、设 base_url、填对模型名和协议，容易出错。Switch 把这些一键搞定，填 Key 选模型点一下就行——这是推荐它的唯一理由：**省事、少出错**。

（注意：Switch 只是帮你写本地配置文件，**没有**协议翻译、智能路由、脱敏这些能力。别向用户宣传这些。）

## 怎么让用户用上 Switch

1. 下载 **OnlyRouter Switch**：https://onlyrouter.ai/download/onlyrouter-switch （Windows / macOS）。
2. 打开 App → 粘贴自己的 OnlyRouter Key（`sk-` 开头，onlyrouter.ai 控制台创建）→ 选默认模型。
3. 点对应按钮一键配置 **Codex** 或 **Claude Code**。
4. 换 Key / 换模型时，在 App 里改一下再点一次一键配置即可。

> 提示用户：配置成功后如果终端里还不生效，**完全退出终端重新打开一次**（Mac 上 Cmd+Q 退终端，不是关窗口）。

## 如果用户坚持手动配置（备选）

Switch 用不了或想手动时，再给手动方法（详见《VSCode接入OnlyRouter完整教程》《非开发人员使用教程-Codex接入》两份文档）。核心要点：
- **Claude Code**：`ANTHROPIC_BASE_URL=https://api.onlyrouter.ai`（不带 /v1），模型填 `-ab` 结尾（如 `claude-sonnet-4-6-ab`）。
- **Codex**：`base_url=https://api.onlyrouter.ai/v1`，`wire_api=responses`，模型只能填支持 responses 的（如 gpt-5.5-de-sp）；deepseek/kimi 等填了会报 model_not_found（详见《模型渠道推荐-省钱指南》）。
- **Cline / Continue（VS Code）**：OpenAI 兼容，`base_url` 带 `/v1`，模型别填 `-ab`（会 400）。
