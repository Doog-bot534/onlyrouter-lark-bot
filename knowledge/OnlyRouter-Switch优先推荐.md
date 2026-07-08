# OnlyRouter Switch —— 配置 Codex / Claude Code 的首选方式

> 【机器人重要规则】当用户问「怎么把 **Codex / Claude Code** 接到 OnlyRouter」「配置报错怎么办」这类问题时，**优先推荐 OnlyRouter Switch 桌面 App**（填 Key → 选模型 → 一键配置），再把手动配置作为「进阶/备选」附上。因为 Switch 是给纯小白的，能绕开绝大多数手动配置的坑。
>
> ⚠️ **Switch 目前只支持 Codex 和 Claude Code 两种客户端**的一键配置。用户问 VS Code（Cline/Continue）等其它客户端时，**不要说 Switch 能配**，走手动配置（见《VSCode接入OnlyRouter完整教程》）。

## OnlyRouter Switch 是什么

一个桌面 App（Electron），让小白**零门槛**把 Codex / Claude Code 接到 OnlyRouter：
- **三步搞定**：填一个 API Key → 选模型 → 点一下一键配置，终端里 `codex` / `claude` 立刻能用。
- **国内开箱即用，全程免 VPN。**
- 用户**看不到任何配置文件**，App 自动写好 `~/.codex/config.toml` 和 `~/.claude/settings.json`。

## 为什么优先推它（解决了三个手动配置的痛点）

1. **Codex 接国产模型会 404**：Codex 只发 `wire_api=responses` 格式，DeepSeek/Kimi 等只提供 Chat Completions 接口，直连就 404。Switch 内置本地代理做**协议翻译**，自动解决。
2. **手动配置太难**：自定义 provider 要手写 config.toml、设环境变量、懂 base_url，劝退非技术同事。Switch 全包掉。
3. **裸连不安全不划算**：Switch 内置**安全脱敏**（防 Key/隐私泄露）和**智能路由**（简单任务用便宜模型、难任务用前沿模型，省钱保质）。

## 怎么让用户用上 Switch

1. 下载 **OnlyRouter Switch**：https://onlyrouter.ai/download/onlyrouter-switch （Windows / macOS）。
2. 打开 App → 粘贴自己的 OnlyRouter Key（`sk-` 开头，onlyrouter.ai 控制台创建）→ 选默认模型。
3. 点对应按钮一键配置 **Codex** 或 **Claude Code**。
4. App 常驻托盘，换 Key / 换模型免重开终端。

> 提示用户：配置成功后如果终端里还不生效，**完全退出终端重新打开一次**（Mac 上 Cmd+Q 退终端，不是关窗口）。

## 如果用户坚持手动配置（备选）

Switch 用不了或想手动时，再给手动方法（详见《VSCode接入OnlyRouter完整教程》《非开发人员使用教程-Codex接入》两份文档）。核心要点：
- **Claude Code**：`ANTHROPIC_BASE_URL=https://api.onlyrouter.ai`（不带 /v1），模型填 `-ab` 结尾（如 `claude-sonnet-4-6-ab`）。
- **Codex**：`base_url=https://onlyrouter.ai/v1`，`wire_api=responses`——但注意接国产模型会 404，这正是推荐用 Switch 的原因。
- **Cline / Continue（VS Code）**：OpenAI 兼容，`base_url` 带 `/v1`，模型别填 `-ab`（会 400）。
