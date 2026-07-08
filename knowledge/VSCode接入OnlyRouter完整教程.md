# 在 VS Code 里用上 OnlyRouter：全客户端配置教程

> 把 VS Code 接到公司 [onlyrouter.ai](https://onlyrouter.ai)，一份 Key 用上 Claude / GPT / DeepSeek / Kimi 全系列模型。
> 国内直连，免 VPN。

---

## 先选路线（30 秒看懂）

VS Code 里用 AI 编程，本质是装一个**扩展**当客户端，让它指向 OnlyRouter。扩展不同，能用的模型和体验也不同。按你的需求选一条：

| 路线 | 扩展 | 体验 | 能用哪些模型 | 适合谁 |
|------|------|------|--------------|--------|
| **A** | **Claude Code**（Anthropic 官方） | agentic 编程天花板，最丝滑 | 仅 `claude-*-ab` 系 | 主力写 Claude、要最强编码体验 |
| **B** | **Cline / Roo Code** | 强 agent，读写文件、跑命令 | **全部模型**（GPT/DeepSeek/Kimi/GLM…） | 想发挥 OnlyRouter 多模型聚合优势 |
| **C** | **Continue** | 轻量，代码补全 + 侧边对话 | 全部 OpenAI 协议模型 | 只要补全和问答，要轻 |

> ⚠️ **最容易踩的坑**：A 和 B/C 走的是**两套协议**，模型不能混填。
> - 路线 A 用 Anthropic 协议，只能填 `claude-opus-4-8-ab` 这类 **`-ab` 结尾**的模型。
> - 路线 B/C 用 OpenAI 协议，填 `gpt-5.5`、`deepseek-v4-pro`、`kimi-k2.6` 或 `claude-opus-4-8-openrouter` 这类，**填 `-ab` 会直接报 400**。
> 详见文末[模型对照表](#模型对照表填错协议会报错)。

每条路线都有**手动配置**（最稳，纯文档照抄）和 **OnlyRouter Switch 一键配置**（填 Key→选模型→点一下）两种方式，下面分别给出。

---

## 通用前置：拿到你的 Key

三条路线都要这一步，只做一次。

1. 打开 [onlyrouter.ai](https://onlyrouter.ai)，右上角**注册**并登录
2. 把账号发给管理员领取内部额度
3. 进**控制台 → 密钥管理 → 创建新 Key**，复制 `sk-` 开头的字符串

> ⚠️ Key 只显示一次，立刻存到备忘录。Key 等于账户里的钱，**不要发群里、不要发给任何人**。
> 没装 VS Code 的先到 [code.visualstudio.com](https://code.visualstudio.com) 下载。

---

## 路线 A · Claude Code 官方扩展（编码体验最强）

Anthropic 官方扩展，agentic 能力最强。代价：只能用 `claude-*-ab` 系模型。

### A-1 装扩展

VS Code 左侧点**扩展**图标（`Cmd/Ctrl+Shift+X`）→ 搜 **Claude Code** → 认准 Anthropic 官方 → 安装。

> 扩展依赖 Claude Code 本体。没装先装（需 Node.js 18+）：
> ```bash
> npm install -g @anthropic-ai/claude-code --registry=https://registry.npmmirror.com
> ```
> （国内镜像，免 VPN）

### A-2 写配置（手动，推荐）

把下面整段里的 `sk-粘贴你的Key` 换成自己的 Key，整段粘贴到终端回车。

**Mac（终端）：**

```bash
MY_KEY="sk-粘贴你的Key"

mkdir -p ~/.claude
cat > ~/.claude/settings.json << EOF
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.onlyrouter.ai",
    "ANTHROPIC_AUTH_TOKEN": "$MY_KEY",
    "ANTHROPIC_MODEL": "claude-sonnet-4-6-ab"
  }
}
EOF
echo "✅ 配置完成"
```

**Windows（PowerShell）：**

```powershell
$MY_KEY = "sk-粘贴你的Key"

New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude" | Out-Null
@"
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.onlyrouter.ai",
    "ANTHROPIC_AUTH_TOKEN": "$MY_KEY",
    "ANTHROPIC_MODEL": "claude-sonnet-4-6-ab"
  }
}
"@ | Set-Content "$env:USERPROFILE\.claude\settings.json"
Write-Host "✅ 配置完成"
```

字段说明：

| 字段 | 填什么 |
|------|--------|
| `ANTHROPIC_BASE_URL` | `https://api.onlyrouter.ai` —— **根地址，结尾没有 `/v1`**，Claude Code 自己补 `/v1/messages` |
| `ANTHROPIC_AUTH_TOKEN` | 你的 Key（`sk-` 开头） |
| `ANTHROPIC_MODEL` | 默认模型，性价比填 `claude-sonnet-4-6-ab`，旗舰填 `claude-opus-4-8-ab` |

### A-3 在 VS Code 里用

1. 装好后侧边栏出现 Claude 图标，点开**直接能用**——已配好，**不需要再登录 Anthropic**
2. 若仍让你登录 / 要 Key：**完全退出 VS Code 重开一次**（退整个程序，不是关窗口）
3. 切模型：对话框输 `/model`，或改 `settings.json` 的 `ANTHROPIC_MODEL`

---

## 路线 B · Cline / Roo Code（用上全部模型）

开源 agent 扩展，能读写文件、跑终端命令，且走 OpenAI 协议，**OnlyRouter 上所有模型都能用**——这是发挥多模型聚合优势的路线。Roo Code 是 Cline 的分支，配置几乎一致，下面以 **Cline** 为例。

### B-1 装扩展

扩展面板搜 **Cline**（或 **Roo Code**）→ 安装。装好后侧边栏出现机器人图标。

### B-2 配置（界面填写，无配置文件）

Cline/Roo 没有配置文件，全靠扩展内 UI 填——所以**无法被一键脚本写入**，只能手填一次（或用下面的 Switch App 引导）。

1. 点侧边栏 Cline 图标 → 右上角**齿轮**（Settings）
2. **API Provider** 选 **OpenAI Compatible**
3. 按下表填：

| 字段 | 填什么 |
|------|--------|
| **Base URL** | `https://api.onlyrouter.ai/v1` —— **注意带 `/v1`**（和路线 A 不同） |
| **API Key** | 你的 Key（`sk-` 开头） |
| **Model ID** | 手填，比如 `gpt-5.5`、`deepseek-v4-pro`、`kimi-k2.6`。⚠️ **不要填 `-ab` 结尾的**，会 400 |

4. 保存。回到对话框，描述需求即可，它会自己读文件、改代码、跑命令。

> Roo Code 操作相同：Settings → Provider 选 **OpenAI Compatible** → 同样三个字段。

### B-3 推荐模型

| 模型 ID | 适合场景 |
|---------|----------|
| `claude-opus-4-8-openrouter` | 想用 Claude 又要 agent 全模型路线，填这个（openrouter 渠道走 OpenAI 协议） |
| `gpt-5.5` | 综合最强，复杂任务 |
| `deepseek-v4-pro` | 性价比之王，国产、便宜、够强 |
| `kimi-k2.7-code` | 专为编码优化 |

---

## 路线 C · Continue（轻量补全 + 问答）

轻量，主打代码补全和侧边对话。支持配置文件，所以**能被一键写入**（OnlyRouter Switch 走的就是这条）。

### C-1 装扩展

扩展面板搜 **Continue** → 安装。

### C-2 写配置（手动）

Continue 读 `~/.continue/config.yaml`。把 `sk-粘贴你的Key` 换成你的 Key，整段粘贴到终端回车。

**Mac / Linux：**

```bash
MY_KEY="sk-粘贴你的Key"

mkdir -p ~/.continue
cat > ~/.continue/config.yaml << EOF
name: OnlyRouter
version: 1.0.0
schema: v1
models:
  - name: OnlyRouter (gpt-5.5)
    provider: openai
    model: gpt-5.5
    apiBase: https://api.onlyrouter.ai/v1
    apiKey: $MY_KEY
    roles:
      - chat
      - edit
      - apply
EOF
echo "✅ 配置完成"
```

**Windows（PowerShell）：**

```powershell
$MY_KEY = "sk-粘贴你的Key"

New-Item -ItemType Directory -Force "$env:USERPROFILE\.continue" | Out-Null
@"
name: OnlyRouter
version: 1.0.0
schema: v1
models:
  - name: OnlyRouter (gpt-5.5)
    provider: openai
    model: gpt-5.5
    apiBase: https://api.onlyrouter.ai/v1
    apiKey: $MY_KEY
    roles:
      - chat
      - edit
      - apply
"@ | Set-Content "$env:USERPROFILE\.continue\config.yaml"
Write-Host "✅ 配置完成"
```

> `provider` 固定 `openai`（OpenAI 兼容），`apiBase` 带 `/v1`，`model` 同样**不能填 `-ab`**。
> 改完 Continue 自动热加载，最多 `Cmd/Ctrl+Shift+P` → **Reload Window** 一次。

---

## 更省心的方式 · OnlyRouter Switch 一键配置

不想碰任何配置文件，可以用我们自研的 **OnlyRouter Switch** 桌面 App：**填 Key → 选模型 → 点一下**，自动写好上面 A / C 路线的配置文件，还附带智能路由（省钱保质）和安全脱敏（防 Key/隐私泄露）。

> 路线 B（Cline/Roo）因为没有配置文件、只能 UI 手填，App 无法自动写入，仍需照 B-2 手动填一次。

1. 下载安装 OnlyRouter Switch：https://onlyrouter.ai/download/onlyrouter-switch
2. 打开 → 粘贴你的 Key → 选默认模型
3. 点对应按钮一键配置 **Claude Code** 或 **VS Code（Continue）**
4. App 常驻托盘，换 Key / 换模型免重开终端

App 内置本地代理（`127.0.0.1`），所有请求经它中转：自动协议翻译、智能路由比价、出站脱敏。原理详见 OnlyRouter Switch 项目 README。

---

## 模型对照表（填错协议会报错）

OnlyRouter 上模型按**名字后缀**分两套协议，模型表里没有字段标识，只能看名字：

| 后缀 / 类型 | 协议 | 用在哪条路线 | 例子 |
|------------|------|-------------|------|
| **`-ab` 结尾的 Claude** | Anthropic（`/v1/messages`） | **只能路线 A** | `claude-opus-4-8-ab`、`claude-sonnet-4-6-ab` |
| **`-openrouter` 结尾** | OpenAI（`/chat/completions`） | 路线 B / C | `claude-opus-4-8-openrouter` |
| **gpt / deepseek / kimi / glm / qwen 等** | OpenAI | 路线 B / C | `gpt-5.5`、`deepseek-v4-pro`、`kimi-k2.7-code` |

**一句话记忆**：路线 A 填 `-ab`，路线 B/C 填别的（要 Claude 就用 `-openrouter`）。完整列表见 [onlyrouter.ai/models](https://onlyrouter.ai/models)。

---

## 常见问题

| 现象 | 原因 / 解决 |
|------|------------|
| 报 **400** `not configured for openai/responses protocol` | 在路线 B/C 里填了 `-ab` 模型。换成 `gpt-5.5` 或 `-openrouter` 模型 |
| 报 **401** `invalid_api_key` | Key 没配对：检查是否粘错、是否带了多余空格 |
| 扩展一直让我登录 Anthropic | 路线 A：配置没生效，**完全退出 VS Code 重开**。⚠️ Mac 要按 `Cmd+Q`（关窗口程序还在后台驻留，不算退）；Windows 关掉窗口即可 |
| Windows 装完输 `claude` 提示"不是命令" | npm 全局目录没进 PATH：**关掉 PowerShell 重新打开一个**再试；仍不行重启电脑 |
| Base URL 到底带不带 `/v1` | 路线 A（Claude）**不带**；路线 B/C（OpenAI）**带** |
| 改了 Key/模型不生效 | 路线 A 改 `settings.json` 后重开；Continue 自动热加载；Switch App 换 Key 免重启 |
| 还剩多少额度 | 登录 onlyrouter.ai 控制台看余额，用完找管理员续 |

---

> 配套阅读：非开发同事用 Codex 接 OnlyRouter 见《非开发人员使用教程-Codex接入.md》；Switch App 原理与开发见 onlyrouter-setup 项目 README。

