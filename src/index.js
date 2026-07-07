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

// ---- 发消息到群（纯文本）----
async function sendText(chatId, text) {
  await client.im.v1.message.create({
    params: { receive_id_type: 'chat_id' },
    data: {
      receive_id: chatId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    },
  });
}

// ---- 后台异步处理一条提问：生成回复并发回群 ----
async function handleQuestion(chatId, chatType, question) {
  try {
    const { answer, isBug, bugSummary } = await askLLM(question);
    await sendText(chatId, answer);

    // 记录这条提问，供每日汇总反馈（无论是否 bug 都记）
    logQuestion({ question, chatType, chatId, answer, isBug });

    // LLM 判定为产品 bug 时，转发到 OnlyRouter 内部群（如已配 Webhook）
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

    // 只处理文本消息
    if (message_type !== 'text') return;

    // 群聊里必须 @ 机器人才回答；单聊（p2p）直接回答
    if (chat_type === 'group') {
      const mentioned = Array.isArray(mentions) && mentions.length > 0;
      if (!mentioned) return;
    }

    const question = extractQuestion(content, mentions);
    if (!question) {
      // 只 @ 了机器人没说话
      sendText(chat_id, '在的，关于 OnlyRouter 有什么想问的？比如怎么拿 Key、怎么配 VS Code、有哪些模型、报错怎么办。').catch(() => {});
      return;
    }

    console.log(`[msg] ${chat_type} 提问: ${question.slice(0, 80)}`);
    // 关键：不 await，立即返回让 handler 在 3 秒内结束，避免 Lark 超时重推
    handleQuestion(chat_id, chat_type, question);
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
