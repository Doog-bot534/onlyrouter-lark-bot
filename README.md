# OnlyRouter Lark 机器人

放进 Lark 群里的问答机器人：群里有人 **@ 它**，它就用 OnlyRouter 自家的 GPT-5.5 模型，结合产品教程文档和实时模型列表，解答 OnlyRouter 相关问题（怎么拿 Key、怎么配 VS Code / Codex、有哪些模型、报错怎么办……）。

## 它是怎么工作的

- **长连接模式**：不需要公网域名、不需要服务器回调地址。一台能上网的电脑或服务器，跑起来就行。
- **知识来源**：把 `knowledge/` 目录下的教程文档 + 实时拉取的 `onlyrouter.ai` 模型列表，一起喂给大模型来回答。不靠模型自己瞎编。
- **吃自家狗粮**：机器人自己也是调 OnlyRouter 的 `gpt-5.5` 来生成回答。
- **群里 @ 才答**，单聊直接答，不打扰群聊。

---

## 部署步骤

### 第 1 步：申请一个 Lark 机器人应用

1. 打开 [open.larksuite.com](https://open.larksuite.com)（飞书国内版是 [open.feishu.cn](https://open.feishu.cn)），登录。
2. 点 **创建企业自建应用**，填个名字（比如「OnlyRouter 助手」）和图标。
3. 进应用后，左侧 **凭证与基础信息**，记下 **App ID** 和 **App Secret**（两串字符，等下要填）。
4. 左侧 **添加应用能力 → 机器人**，开启「机器人」能力。
5. 左侧 **事件与回调**：
   - 订阅方式选 **长连接**（很重要，不要选「将事件发送至开发者服务器」）。
   - 添加事件 **接收消息 `im.message.receive_v1`**。
6. 左侧 **权限管理**，搜索并开通以下权限：
   - `im:message`（获取与发送单聊、群组消息）
   - `im:message.group_at_msg`（接收群里 @ 机器人的消息）
   - `im:message:send_as_bot`（以应用身份发消息）
7. 右上角 **创建版本 / 发布**，提交审核（自建应用一般秒过或管理员一键通过）。

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
| `ONLYROUTER_MODEL` | 默认 `gpt-5.5`，不用改。⚠️ 别填 `-ab` 结尾的 |

看到 `✅ OnlyRouter Lark 机器人已启动` 就成了。去群里 @ 它问一句试试。

---

## 长期运行（关掉终端也不停）

`npm start` 一关终端就停了。要让它常驻，用 pm2：

```bash
npm install -g pm2
pm2 start src/index.js --name onlyrouter-lark-bot
pm2 save          # 保存进程列表
pm2 startup       # 跟着提示做一次，开机自启
```

常用：`pm2 logs onlyrouter-lark-bot` 看日志，`pm2 restart onlyrouter-lark-bot` 重启。

---

## 更新知识库

机器人的回答依据放在 `knowledge/` 目录（`.md` 文档）和实时模型列表里：

- **模型列表**自动从 `onlyrouter.ai/api/models` 拉取，10 分钟刷新一次，不用管。
- **教程文档**：往 `knowledge/` 里加 / 改 `.md` 文件即可，重启机器人生效。文档越全，回答越准。

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

