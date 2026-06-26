# 🚀 人人都能用上 AI：OnlyRouter 全员使用教程

> 本周我们的平台 [onlyrouter.ai](https://onlyrouter.ai) 上新了**图片生成模型**和**语音合成（TTS）模型**，加上原有的 Claude / GPT / DeepSeek 等全系列对话模型，现在写文案、画图、配音都能一站搞定。
> 这份教程**专为非开发同事准备**：不需要会写代码，跟着做一次配置（约 10 分钟），以后每天打开就能用。
> 📅 预告：**下周还会上线视频生成模型**，现在配好环境，下周直接用。

---

## 整体思路（30 秒看懂）

我们会安装一个叫 **Codex** 的 AI 助手程序，把它连接到公司的 OnlyRouter 平台。之后你只需要**用大白话和它对话**，它就能帮你：

- 💬 写文案、改方案、做翻译、整理表格（对话模型）
- 🎨 生成图片（本周新上线）
- 🔊 把文字变成语音（本周新上线）
- 🎙️ 把会议录音变成文字（附赠技能）

一共 4 步：**注册账号 → 领额度建 Key → 安装 Codex → 粘贴配置**。

---

## 第 1 步：注册账号

1. 打开 [https://onlyrouter.ai](https://onlyrouter.ai)
2. 点击右上角 **「立即注册」**，完成注册并登录

## 第 2 步：领取内部额度 + 创建 API Key

1. 注册完成后，**把你的注册账号发给管理员**（@TODO：填写对接人姓名/群内@方式），管理员会给你的账户充入内部使用额度
2. 登录后进入**控制台 → 密钥管理**，点击 **「创建新 Key」**
3. 复制生成的 Key（`sk-` 开头的一串字符）

> ⚠️ **Key 只显示这一次**，请立刻粘贴到自己的备忘录里保存。丢了也不要慌，删掉旧的再建一个新的就行。
> ⚠️ Key 等于你账户里的钱，**不要发到群里、不要发给任何人**。

## 第 3 步：安装 Codex

**Mac 用户：**

1. 打开「启动台」，搜索 **「终端」**（Terminal）并打开 —— 就是一个黑色/白色的命令窗口，后面我们都在这里操作
2. 复制下面这行，粘贴到终端，按回车：

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
```

**Windows 用户：**

1. 点开始菜单，搜索 **PowerShell**，打开
2. 复制下面这行，粘贴进去，按回车：

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"
```

装完后输入 `codex --version` 回车，能看到版本号就说明装好了。

## 第 4 步：连接到 OnlyRouter（一次性配置）

**Mac 用户**：把下面整段复制出来，**先把第一行的 `sk-粘贴你的Key` 换成你第 2 步保存的 Key**，然后整段粘贴到终端，按回车：

```bash
MY_KEY="sk-粘贴你的Key"

mkdir -p ~/.codex
cat > ~/.codex/config.toml << 'EOF'
model = "gpt-5.5"
model_provider = "onlyrouter"

[model_providers.onlyrouter]
name = "OnlyRouter"
base_url = "https://onlyrouter.ai/v1"
env_key = "ONLYROUTER_API_KEY"
wire_api = "responses"
EOF
echo "export ONLYROUTER_API_KEY=\"$MY_KEY\"" >> ~/.zshrc
source ~/.zshrc
echo "✅ 配置完成"
```

**Windows 用户**：同样先把第一行的 Key 换成自己的，再整段粘贴到 PowerShell，按回车：

```powershell
$MY_KEY = "sk-粘贴你的Key"

New-Item -ItemType Directory -Force "$env:USERPROFILE\.codex" | Out-Null
@"
model = "gpt-5.5"
model_provider = "onlyrouter"

[model_providers.onlyrouter]
name = "OnlyRouter"
base_url = "https://onlyrouter.ai/v1"
env_key = "ONLYROUTER_API_KEY"
wire_api = "responses"
"@ | Set-Content "$env:USERPROFILE\.codex\config.toml"
[Environment]::SetEnvironmentVariable("ONLYROUTER_API_KEY", $MY_KEY, "User")
Write-Host "✅ 配置完成，请关闭本窗口再重新打开 PowerShell"
```

> Windows 同事注意：配置完**要关掉 PowerShell 重新打开一次**，环境变量才生效。

---

## 开始使用 🎉

在终端输入 `codex` 回车，进入对话界面。**直接打字提需求就行**，比如：

> 帮我写一封给客户的节日问候邮件，正式一点，200 字左右

### 🎨 画图（本周新功能）

把下面这段直接粘贴给 Codex，只改引号里的描述：

> 帮我生成一张图片：调用 https://onlyrouter.ai/v1/images/generations 接口，model 填 "qwen-image-2.0"，API Key 从环境变量 ONLYROUTER_API_KEY 读取，图片描述是「一只橘猫戴着安全帽在工地搬砖，卡通风格」。返回结果里 data[0].url 是图片链接，帮我下载保存到桌面并打开。

- 默认用 `qwen-image-2.0`，便宜出图快（约 ¥0.2/张）
- 想要更高质量可以把 model 换成 `gpt-image-2-2026-04-21`（注意：这个模型返回的是 data[0].b64_json 的 Base64 图片数据，不是链接，Codex 知道怎么处理）
- 全部图片模型见 [onlyrouter.ai/models](https://onlyrouter.ai/models)

### 🔊 文字转语音（本周新功能）

同样粘贴给 Codex，改最后的文字内容：

> 帮我把一段文字转成语音：调用 https://onlyrouter.ai/v1/audio/speech 接口，model 填 "qwen3-tts-flash"，voice 填 "Cherry"，response_format 填 "mp3"，API Key 从环境变量 ONLYROUTER_API_KEY 读取，把返回的音频保存到桌面 speech.mp3 并播放。文字内容是：「大家好，欢迎收听本周产品快报。」

- 按字数计费，一千字大约 ¥0.08，随便用
- 想要 OpenAI 的音色可以把 model 换成 `gpt-4o-mini-tts-2025-12-15`

### 🎙️ 附赠：录音转文字

开会的录音、采访的音频，扔给它变成文字稿：

> 帮我把桌面上的 会议录音.m4a 转成文字：调用 https://onlyrouter.ai/v1/audio/transcriptions 接口（multipart/form-data 上传），model 填 "whisper-1"，API Key 从环境变量 ONLYROUTER_API_KEY 读取，把转写结果保存为桌面 会议纪要.txt。

（单个文件限 10MB，太大的话让 Codex 先帮你切分。）

---

## 常见问题

| 问题 | 解决办法 |
|------|----------|
| 想换个对话模型 | 在 Codex 里输入 `/model` 即可切换；可用模型 ID 在 [onlyrouter.ai/models](https://onlyrouter.ai/models) 查看复制 |
| Key 忘了/丢了 | 到控制台密钥管理删掉旧 Key，新建一个，重新执行第 4 步 |
| 还剩多少额度 | 登录 onlyrouter.ai 控制台查看余额；用完找管理员续 |
| Codex 启动时让我登录 ChatGPT | 不需要登录，我们走的是公司平台。确认第 4 步配置执行成功即可；仍有问题在群里喊一声 |
| 提示 401 / invalid_api_key | Key 没配上：检查第 4 步里 Key 是否替换正确，Windows 记得重开 PowerShell |
| 我是开发，想直接调 API | 看 [onlyrouter.ai/docs](https://onlyrouter.ai/docs)，OpenAI / Anthropic 两种协议都兼容，Claude Code 配置方法文档里也有 |

---

## 📅 下周预告

视频生成模型即将上线，到时候只需要在画图的提示词里换个接口和模型名，**现在配好的环境届时直接能用**。本周先把账号注册了、环境配上，遇到问题随时在群里问！
