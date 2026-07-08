// OnlyRouter Lark 群机器人 —— 长连接（WebSocket）模式入口。
//
// 为什么用长连接而不是 Webhook：
//   - 无需公网域名、回调地址、签名验签，本地或任意服务器常驻进程即可跑。
//   - 官方 SDK 1.24+ 原生支持。
// 关键约束：长连接事件 handler 必须在 3 秒内返回，否则 Lark 判超时并「重推同一条消息」。
//   而 LLM 生成回复远超 3 秒。所以策略是：
//     1) handler 立即 return（秒回，不 await LLM）
//     2) 按 message_id 去重（防超时重推导致重复回答）
//     3) 后台异步生成回复并 client.im.message.create 发回群里
import 'dotenv/config';
import * as Lark from '@larksuiteoapi/node-sdk';
import { askLLM } from './llm.js';
import { reportBug, bugReportEnabled } from './bug-report.js';
import { logQuestion, startDigestSchedule } from './feedback.js';
import { reflect } from './distill.js';
import { buildCards, buildSimpleCard } from './message.js';

const { LARK_APP_ID, LARK_APP_SECRET } = process.env;

if (!LARK_APP_ID || !LARK_APP_SECRET) {
  console.error('❌ 缺少 LARK_APP_ID / LARK_APP_SECRET，请先填好 .env（见 .env.example）');
  process.exit(1);
}

// Lark 国际版用默认 domain（open.larksuite.com）；如果是飞书国内版需改 domain: Lark.Domain.Feishu
const baseConfig = {
  appId: LARK_APP_ID,
  appSecret: LARK_APP_SECRET,
  domain: process.env.LARK_DOMAIN === 'feishu' ? Lark.Domain.Feishu : Lark.Domain.Lark,
};

const client = new Lark.Client(baseConfig);
const wsClient = new Lark.WSClient({ ...baseConfig, loggerLevel: Lark.LoggerLevel.info });

// ---- 去重：Lark 超时会重推同一 message_id，用 LRU set 记住已处理过的 ----
const seen = new Set();
const SEEN_MAX = 1000;
function alreadyHandled(messageId) {
  if (seen.has(messageId)) return true;
  seen.add(messageId);
  if (seen.size > SEEN_MAX) {
    // 简单清理：删掉最早插入的一批
    const drop = seen.size - SEEN_MAX;
    let i = 0;
    for (const k of seen) {
      seen.delete(k);
      if (++i >= drop) break;
    }
  }
  return false;
}

// ---- 从消息内容里剥掉 @机器人 的提及，取出纯文本问题 ----
function extractQuestion(content, mentions) {
  let text = '';
  try {
    text = JSON.parse(content).text || '';
  } catch {
    text = '';
  }
  // Lark 富文本里 @ 用 @_user_1 这类占位符表示，逐个替换掉
  if (Array.isArray(mentions)) {
    for (const m of mentions) {
      if (m.key) text = text.replaceAll(m.key, '');
    }
  }
  return text.trim();
}

// ---- 从消息内容解析出图片的 image_key 列表 ----
// image 类型：{ image_key }；post 图文混排：content 里嵌 img 标签 { tag:'img', image_key }
function extractImageKeys(messageType, content) {
  const keys = [];
  try {
    const obj = JSON.parse(content);
    if (messageType === 'image' && obj.image_key) {
      keys.push(obj.image_key);
    } else if (messageType === 'post') {
      // post 的 content 是二维数组：[[{tag,...}, ...], ...]
      const walk = (node) => {
        if (Array.isArray(node)) return node.forEach(walk);
        if (node && node.tag === 'img' && node.image_key) keys.push(node.image_key);
      };
      walk(obj.content);
    }
  } catch {
    // 解析失败返回空
  }
  return keys;
}

// ---- 从 post 图文消息里提取纯文字 ----
function extractPostText(content) {
  try {
    const obj = JSON.parse(content);
    const parts = [];
    const walk = (node) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && node.tag === 'text' && node.text) parts.push(node.text);
    };
    walk(obj.content);
    return parts.join(' ').trim();
  } catch {
    return '';
  }
}

// ---- 下载消息里的图片，转成 base64（供视觉模型读图）----
async function downloadImages(messageId, imageKeys) {
  const images = [];
  for (const key of imageKeys.slice(0, 3)) { // 最多取 3 张，控制体积
    try {
      const resp = await client.im.v1.messageResource.get({
        path: { message_id: messageId, file_key: key },
        params: { type: 'image' },
      });
      // SDK 返回可写流/Buffer，统一转 base64
      const buf = await resourceToBuffer(resp);
      if (buf && buf.length) {
        images.push({ media_type: 'image/png', data: buf.toString('base64') });
      }
    } catch (e) {
      console.error('[image] 下载失败:', e.message);
    }
  }
  return images;
}

// SDK messageResource.get 的返回体转 Buffer（兼容 stream / getReadableStream / Buffer）
async function resourceToBuffer(resp) {
  if (!resp) return null;
  if (Buffer.isBuffer(resp)) return resp;
  // 新版 SDK 返回带 getReadableStream() 的对象
  const stream = typeof resp.getReadableStream === 'function' ? resp.getReadableStream() : resp;
  if (stream && typeof stream[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    return Buffer.concat(chunks);
  }
  return null;
}

// ---- 发一张卡片 ----
async function sendCard(chatId, cardContent) {
  await client.im.v1.message.create({
    params: { receive_id_type: 'chat_id' },
    data: {
      receive_id: chatId,
      msg_type: 'interactive',
      content: cardContent,
    },
  });
}

// ---- 发简短提示（错误、招呼等），走卡片保持风格统一 ----
async function sendText(chatId, text) {
  await sendCard(chatId, buildSimpleCard(text));
}

// ---- 发正式回答：markdown 渲染成卡片，超长自动拆成多条按序发 ----
async function sendAnswer(chatId, answer) {
  const cards = buildCards(answer);
  for (const c of cards) {
    await sendCard(chatId, c);
  }
}

// ---- 后台异步处理一条提问：生成回复并发回群 ----
async function handleQuestion(chatId, chatType, question, messageId, imageKeys = []) {
  try {
    // 有图片则先下载转 base64，让视觉模型看图回答
    let images = [];
    if (imageKeys.length) {
      images = await downloadImages(messageId, imageKeys);
    }
    // 只发了图没配文字时，给个默认引导，让模型描述/分析图片
    const q = question || (images.length ? '看看这张图，帮我分析下（如果是报错截图，说明原因和解决办法）。' : '');
    const { answer, isBug, bugSummary } = await askLLM(q, images);
    await sendAnswer(chatId, answer);

    // 记录这条提问，供每周总结反馈（无论是否 bug 都记）
    logQuestion({ question: q + (images.length ? ` [含${images.length}图]` : ''), chatType, chatId, answer, isBug });

    // 自我蒸馏：异步反思本次问答，沉淀可复用经验（不 await，不拖慢后续）
    reflect({ question: q, answer, isBug });

    // LLM 判定为产品 bug 时，转发到反馈群（如已配 Webhook）
    if (isBug && bugReportEnabled()) {
      await reportBug({ summary: bugSummary || answer.slice(0, 200), question, chatType });
    }
  } catch (e) {
    console.error('[handle] 生成回复失败:', e.message);
    // 把人话解释 + 原始报错都给出去，方便群里排查（小白也能截图问）
    let hint = '抱歉，出了点问题没能回答。';
    if (e.message.includes('401')) hint = '抱歉，机器人自己的 OnlyRouter Key 无效或过期了，麻烦管理员检查 .env 里的 ONLYROUTER_API_KEY。';
    else if (e.message.includes('400') || e.message.includes('404')) hint = '抱歉，机器人请求模型时报错了，可能是 ONLYROUTER_MODEL 填的模型名不对或该模型没开通，麻烦管理员检查。';
    else if (e.message.includes('未配置')) hint = '抱歉，机器人还没配置 OnlyRouter Key，请管理员填好 .env 再重启。';
    await sendText(chatId, `${hint}\n\n（技术细节：${e.message.slice(0, 300)}）`).catch(() => {});
  }
}

// ---- 注册事件 ----
const eventDispatcher = new Lark.EventDispatcher({}).register({
  'im.message.receive_v1': async (data) => {
    const { message } = data;
    const { message_id, chat_id, chat_type, content, mentions, message_type } = message;

    // 去重：超时重推的同一条消息直接跳过
    if (alreadyHandled(message_id)) return;

    // 先判是否该响应：群聊必须 @ 机器人；单聊（p2p）都响应。
    // （放在类型判断之前，这样收到看不了的类型也能在该响应时给提示，而不打扰未 @ 的群消息）
    if (chat_type === 'group') {
      const mentioned = Array.isArray(mentions) && mentions.length > 0;
      if (!mentioned) return;
    }

    // 只处理文本、图片、图文混排；其它类型（视频/文件/语音等）给友好提示，不装死
    if (!['text', 'image', 'post'].includes(message_type)) {
      sendText(chat_id, '我目前只能看文字和图片，还看不了视频/文件/语音这类内容 🙇 麻烦把问题用文字描述，或者截个图发我～').catch(() => {});
      return;
    }

    // 取文字：text 从 content.text，post 从富文本里的 text 节点
    let question = message_type === 'post' ? extractPostText(content) : extractQuestion(content, mentions);
    if (Array.isArray(mentions)) {
      for (const m of mentions) if (m.key) question = question.replaceAll(m.key, '').trim();
    }

    // 取图片 key
    const imageKeys = extractImageKeys(message_type, content);

    // 纯 @ 没内容也没图
    if (!question && imageKeys.length === 0) {
      sendText(chat_id, '在的，关于 OnlyRouter 有什么想问的？比如怎么拿 Key、怎么配 VS Code、有哪些模型、报错怎么办。').catch(() => {});
      return;
    }

    console.log(`[msg] ${chat_type} ${message_type} 提问: ${question.slice(0, 60)}${imageKeys.length ? ` [含${imageKeys.length}图]` : ''}`);
    // 关键：不 await，立即返回让 handler 在 3 秒内结束，避免 Lark 超时重推
    handleQuestion(chat_id, chat_type, question, message_id, imageKeys);
  },
});

// ---- 启动长连接 ----
wsClient.start({ eventDispatcher });
console.log('✅ OnlyRouter Lark 机器人已启动（长连接模式），等待群消息…');

// 启动每日提问汇总定时任务
startDigestSchedule();

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n👋 收到退出信号，关闭中…');
  process.exit(0);
});
