# OnlyRouter Lark 机器人

放进 Lark 群里的 AI 助手：群里有人 **@ 它**，它就用 OnlyRouter 平台的模型来解答问题、指导用 AI 提效，并把大家的提问定期汇总反馈给团队做产品迭代。

## 三大能力

1. **解答 OnlyRouter 使用问题** —— 注册、拿 Key、在 VS Code / Codex / Claude Code 里配置、模型选型、报错排查。依据 `knowledge/` 里的教程文档 + 实时拉取的模型列表回答，不靠模型瞎编。
2. **指导用 AI 提效（FDE 助手）** —— 不限于写代码：写周报/邮件、整理表格、翻译、生成图片/语音、录音转文字等，给出能马上照做的方法和可直接抄的提示词。
3. **信息反馈** —— 记录每条提问，**每天定时汇总**（热门问题/难点/改进建议）发到产品反馈群，帮团队做迭代；其中**判定为真 bug 的问题即时推到开发群**。

## 它是怎么工作的

- **长连接模式**：不需要公网域名、不需要服务器回调地址。一台能上网的机器，跑起来就行。
- **知识来源**：`knowledge/` 目录下的教程文档 + 实时拉取的 `onlyrouter.ai` 模型列表，一起喂给大模型来回答。
- **吃自家狗粮**：机器人自己也是调 OnlyRouter 的模型（默认 `gpt-5.5-ab`）来生成回答。
- **群里 @ 才答**，单聊直接答，不打扰群聊。
- **联网搜索**：接入 Firecrawl，文档答不上来时先联网检索再回答（填 key 即启用，默认已选 firecrawl）。

> ⚠️ 说明：通过 API 调用模型**本身不自带联网**（不像 ChatGPT 网页版），本项目用 Firecrawl 补上这一环。没填搜索 key 时，就只用模型知识 + 本项目文档回答。

---

## 部署步骤

### 第 1 步：申请一个 Lark 机器人应用

1. 打开 [open.larksuite.com](https://open.larksuite.com)（飞书国内版是 [open.feishu.cn](https://open.feishu.cn)），登录。
2. 点 **创建企业自建应用**，填个名字（比如「OnlyRouter 助手」）和图标。
3. 进应用后，左侧 **凭证与基础信息**，记下 **App ID** 和 **App Secret**（两串字符，等下要填）。
4. 左侧 **添加应用能力 → 机器人**，开启「机器人」能力。这里可以填**机器人名称、头像和描述**（描述文案见下方「机器人描述」章节，可直接抄）。
5. 左侧 **事件与回调**：
   - 订阅方式选 **长连接**（很重要，不要选「将事件发送至开发者服务器」）。
   - 添加事件 **接收消息 `im.message.receive_v1`**。
6. 左侧 **权限管理**，搜索并开通下面这些权限（也可用 `deploy/lark-permissions.json` 批量导入）：

   | 权限 code | 作用 | 必需 |
   |-----------|------|------|
   | `im:message` | 收发消息（群聊和单聊都覆盖） | ✅ 必需 |
   | `im:message:send_as_bot` | 以机器人身份主动发消息 | ✅ 必需 |
   | `im:resource` | 读取用户发的图片/文件 | 建议 |

   > **接收群 @ 消息和单聊消息不需要单独的权限**——那是靠下一步的「事件订阅」实现的，不是权限。只要开了 `im:message` + 订阅 `im.message.receive_v1` 事件即可。（早期文档里的 `im:message.group_at_msg`、`im:message.p2p_msg` 等 code 已不存在，后台搜不到是正常的。）

7. 右上角 **创建版本 / 发布**，提交审核（企业自建应用一般管理员一键通过）。

> **注意：改了权限或事件订阅后，必须重新「创建版本并发布」才生效。** 这是最容易漏的一步——权限加了没发版，机器人依旧收不到消息。

### 第 2 步：把机器人拉进群

在目标 Lark 群里：**群设置 → 群机器人 → 添加机器人 → 选你刚建的应用**。

### 第 3 步：拿一个 OnlyRouter 的 Key 给机器人用

机器人自己要调模型来回答，所以需要一个 OnlyRouter 的 Key：

1. 打开 [onlyrouter.ai](https://onlyrouter.ai) 注册登录，找管理员领额度。
2. 控制台 → 密钥管理 → 创建新 Key，复制 `sk-` 开头那串。

### 第 4 步：配置并启动

```bash
# 1. 装依赖（需要 Node.js 18+）
npm install

# 2. 复制配置模板，填上你的凭证
cp .env.example .env
# 然后用编辑器打开 .env，把 4 个值填好（见下）

# 3. 启动
npm start
```

`.env` 要填的内容：

| 字段 | 填什么 |
|------|--------|
| `LARK_APP_ID` | 第 1 步拿到的 App ID |
| `LARK_APP_SECRET` | 第 1 步拿到的 App Secret |
| `LARK_DOMAIN` | 国际版 Lark 留 `lark`；飞书国内版填 `feishu` |
| `ONLYROUTER_API_KEY` | 第 3 步拿到的 `sk-` 开头的 Key |
| `ONLYROUTER_MODEL` | 默认 `gpt-5.5-ab`，不用改。协议会按模型名自动适配 |

看到 `✅ OnlyRouter Lark 机器人已启动` 就成了。去群里 @ 它问一句试试。

---

## 机器人描述（填 Lark 后台用，可直接抄）

在 Lark 后台「机器人」设置里填名称和描述时用。按位置长短选一个：

**名称建议**：`OnlyRouter 助手`

**一句话简介**（简介框，20 字内）：
> 你的 AI 提效搭子，@我问 OnlyRouter 用法、报错、怎么用 AI 干活。

**标准描述**（描述框）：
> 我是 OnlyRouter 群助手 🤖。@我可以：
> ① 解答 OnlyRouter 使用问题——注册拿 Key、在 VS Code / Codex / Claude Code 里配置、模型怎么选、报错怎么修；
> ② 教你用 AI 提效——写周报邮件、整理表格、翻译、生成图片语音、录音转文字，给你能直接抄的做法；
> ③ 遇到平台 bug 我会转给开发，日常问题我也会汇总反馈帮产品改进。
> 群里直接 @我 提问就行，别把 API Key 发群里哦～

**群内欢迎语**（可选，进群/被添加时发）：
> 大家好，我是 OnlyRouter 助手 👋 有 OnlyRouter 使用问题、或想用 AI 帮忙干活，随时 @我 就行～

---

## 服务器部署（常驻运行）

`npm start` 一关终端就停。上服务器常驻，三选一：

### 方式 A：一键脚本（Linux + systemd，推荐）

```bash
# 项目已上传/clone 到服务器后：
cp .env.example .env && vim .env     # 填好凭证
sudo bash deploy/deploy.sh
```

脚本自动：装 Node（如缺）→ 装依赖 → 注册 systemd 服务 → 开机自启 → 启动。之后：

```bash
journalctl -u onlyrouter-lark-bot -f        # 看实时日志
systemctl restart onlyrouter-lark-bot       # 改了 .env 后重启
systemctl stop onlyrouter-lark-bot          # 停止
```

### 方式 B：Docker

```bash
cp .env.example .env && vim .env
docker compose up -d
docker compose logs -f          # 看日志
```

提问记录持久化在 `./data`，知识库 `./knowledge` 挂载进容器，改文档后 `docker compose restart` 生效。

### 方式 C：pm2（快速起，适合本机/测试）

```bash
npm install -g pm2
pm2 start src/index.js --name onlyrouter-lark-bot
pm2 save && pm2 startup        # 开机自启（跟提示做一次）
```

---

## 更新知识库

机器人的回答依据放在 `knowledge/` 目录（`.md` 文档）和实时模型列表里：

- **模型列表**自动从 `onlyrouter.ai/api/models` 拉取，10 分钟刷新一次，不用管。
- **教程文档 / AI 提效指南**：往 `knowledge/` 里加 / 改 `.md` 文件即可，重启机器人生效。文档越全，回答越准。

---

## 常见报错排查

| 现象 | 原因 / 解决 |
|------|------------|
| 启动报 `invalid appId` | `.env` 里 `LARK_APP_ID` 填错，或国内版/国际版的 `LARK_DOMAIN` 填反了 |
| 启动报 `缺少 LARK_APP_ID` | 没创建 `.env`，或没填值。先 `cp .env.example .env` 再填 |
| 群里 @ 它没反应 | ① 机器人没拉进群；② 没开 `im.message.receive_v1` 事件订阅；③ 订阅方式没选「长连接」；④ 看终端日志有没有收到 `[msg]` |
| 它回复「Key 无效或过期」(401) | `ONLYROUTER_API_KEY` 填错或没额度，去 onlyrouter.ai 控制台查 |
| 它回复「模型名配错」(400) | `ONLYROUTER_MODEL` 填了 `-ab` 结尾的模型，文本对话要走 OpenAI 协议，换回 `gpt-5.5` |
| 回答慢 | 正常，LLM 生成要几秒到十几秒；机器人会先静默，答好了一次性发出来 |

> 长连接模式下事件处理有 3 秒超时限制，所以机器人收到消息后**立即应答 Lark、后台异步生成回复**，并按消息 ID 去重，避免超时重推导致重复回答。这块逻辑在 `src/index.js`，一般不用动。

---

## Bug 自动上报（可选）

机器人在回答的同时会判断：用户遇到的是**自己配错/用法问题**，还是**OnlyRouter 平台本身的 bug**。只有判定为真 bug 时，才会把问题转发到指定的 OnlyRouter 内部群——用法问题（Key 填错、漏带 `/v1` 等）不会去打扰内部群。

开启方式：

1. 在要接收 bug 的 OnlyRouter 内部群里：**群设置 → 群机器人 → 添加机器人 → 自定义机器人**，复制它的 **Webhook 地址**。
2. 把地址填到 `.env` 的 `LARK_BUG_WEBHOOK_URL`，重启机器人。

留空则不上报。判定偏保守（拿不准就不报），避免误报刷屏。上报内容包含：用户原话、机器人的判断、来源和时间。

---

## 每日提问汇总反馈（可选）

机器人记录每条提问（存在 `data/questions.jsonl`），**每天定时**用 LLM 汇总成一份产品反馈日报——热门问题、用户卡点、改进建议——发到你指定的产品反馈群，帮团队做迭代。这和上面的 bug 上报是两条线：bug 即时推开发群，汇总每天推产品群。

开启方式：

1. 在产品反馈群加个**自定义机器人**，复制 Webhook 地址，填到 `.env` 的 `LARK_FEEDBACK_WEBHOOK_URL`。
2. 汇总时间默认每天 18:03（`FEEDBACK_DIGEST_CRON`，时区 Asia/Shanghai），可改。
3. 重启生效。留空则汇总只打印到日志、不发送。

手动立即汇总当天（测试用）：`npm run digest`

---

## 联网搜索（默认启用 firecrawl）

通过 API 调模型本身不自带联网，本项目接了 [Firecrawl](https://firecrawl.dev) 补上：文档 + 模型知识答不上来时，先联网检索再回答。

1. 注册 [Firecrawl](https://firecrawl.dev)（**每月 1000 免费额度，约 5000 条搜索结果/月，无需信用卡**），拿 `fc-` 开头的 key。
2. 填到 `.env` 的 `FIRECRAWL_API_KEY`（`SEARCH_PROVIDER` 已默认 `firecrawl`）。
3. 重启即生效。

> 没填真实 key（还是 `fc-xxxx` 占位）时，机器人会自动当作没开搜索，只靠文档回答，不会报错。想彻底关掉把 `SEARCH_PROVIDER` 改成 `none`。备选 Tavily / Brave：改 `SEARCH_PROVIDER` 并填对应 key。

