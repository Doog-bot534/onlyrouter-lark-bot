// 多租户 Lark bot 工厂：给一套凭证，返回一个可 start/stop 的独立 bot 实例。
// 从原 index.js 抽取，每个租户一条独立 WSClient 长连接，互不干扰。
// 复用同一套问答大脑（llm/knowledge/message/distill/feedback），bug 统一回流官方。
import * as Lark from '@larksuiteoapi/node-sdk';
import { askLLM } from './llm.js';
import { reportBug, bugReportEnabled } from './bug-report.js';
import { logQuestion } from './feedback.js';
import { reflect } from './distill.js';
import { buildCards, buildSimpleCard } from './message.js';

// cfg: { appId, appSecret, domain('lark'|'feishu'), tenantId, label }
export function createTenantBot(cfg) {
  const { appId, appSecret, tenantId = 'default', label = tenantId } = cfg;
  const baseConfig = {
    appId,
    appSecret,
    domain: cfg.domain === 'feishu' ? Lark.Domain.Feishu : Lark.Domain.Lark,
  };
  const client = new Lark.Client(baseConfig);
  let wsClient = null;

  // 去重：Lark 超时会重推同一 message_id（本实例独享）
  const seen = new Set();
  const SEEN_MAX = 1000;
  function alreadyHandled(messageId) {
    if (seen.has(messageId)) return true;
    seen.add(messageId);
    if (seen.size > SEEN_MAX) {
      const drop = seen.size - SEEN_MAX;
      let i = 0;
      for (const k of seen) { seen.delete(k); if (++i >= drop) break; }
    }
    return false;
  }

  function extractQuestion(content, mentions) {
    let text = '';
    try { text = JSON.parse(content).text || ''; } catch { text = ''; }
    if (Array.isArray(mentions)) for (const m of mentions) if (m.key) text = text.replaceAll(m.key, '');
    return text.trim();
  }

  function extractImageKeys(messageType, content) {
    const keys = [];
    try {
      const obj = JSON.parse(content);
      if (messageType === 'image' && obj.image_key) keys.push(obj.image_key);
      else if (messageType === 'post') {
        const walk = (node) => {
          if (Array.isArray(node)) return node.forEach(walk);
          if (node && node.tag === 'img' && node.image_key) keys.push(node.image_key);
        };
        walk(obj.content);
      }
    } catch {}
    return keys;
  }

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
    } catch { return ''; }
  }

  async function resourceToBuffer(resp) {
    if (!resp) return null;
    if (Buffer.isBuffer(resp)) return resp;
    const stream = typeof resp.getReadableStream === 'function' ? resp.getReadableStream() : resp;
    if (stream && typeof stream[Symbol.asyncIterator] === 'function') {
      const chunks = [];
      for await (const c of stream) chunks.push(c);
      return Buffer.concat(chunks);
    }
    return null;
  }

  async function downloadImages(messageId, imageKeys) {
    const images = [];
    for (const key of imageKeys.slice(0, 3)) {
      try {
        const resp = await client.im.v1.messageResource.get({
          path: { message_id: messageId, file_key: key },
          params: { type: 'image' },
        });
        const buf = await resourceToBuffer(resp);
        if (buf && buf.length) images.push({ media_type: 'image/png', data: buf.toString('base64') });
      } catch (e) {
        console.error(`[${label}][image] 下载失败:`, e.message);
      }
    }
    return images;
  }
  async function sendCard(chatId, cardContent) {
    await client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: chatId, msg_type: 'interactive', content: cardContent },
    });
  }
  async function sendText(chatId, text) {
    await sendCard(chatId, buildSimpleCard(text));
  }
  async function sendAnswer(chatId, answer) {
    for (const c of buildCards(answer)) await sendCard(chatId, c);
  }

  async function handleQuestion(chatId, chatType, question, messageId, imageKeys = []) {
    try {
      let images = [];
      if (imageKeys.length) images = await downloadImages(messageId, imageKeys);
      const q = question || (images.length ? '看看这张图，帮我分析下（如果是报错截图，说明原因和解决办法）。' : '');
      const { answer, isBug, bugSummary } = await askLLM(q, images);
      await sendAnswer(chatId, answer);

      // 提问记录带 tenantId，便于官方按租户看反馈
      logQuestion({ question: q + (images.length ? ` [含${images.length}图]` : ''), chatType, chatId, answer, isBug, tenantId });

      reflect({ question: q, answer, isBug });

      // bug 统一回流官方（带租户标识，不进客户群）
      if (isBug && bugReportEnabled()) {
        await reportBug({ summary: bugSummary || answer.slice(0, 200), question: q, chatType, tenantId: label });
      }
    } catch (e) {
      console.error(`[${label}][handle] 生成回复失败:`, e.message);
      let hint = '抱歉，出了点问题没能回答，请稍后再试。';
      if (e.message.includes('401') || e.message.includes('未配置')) hint = '抱歉，服务端配置有点问题，我们会尽快处理。';
      await sendText(chatId, hint).catch(() => {});
    }
  }

  const eventDispatcher = new Lark.EventDispatcher({}).register({
    'im.message.receive_v1': async (data) => {
      const { message } = data;
      const { message_id, chat_id, chat_type, content, mentions, message_type } = message;
      if (alreadyHandled(message_id)) return;
      if (chat_type === 'group') {
        const mentioned = Array.isArray(mentions) && mentions.length > 0;
        if (!mentioned) return;
      }
      if (!['text', 'image', 'post'].includes(message_type)) {
        sendText(chat_id, '我目前只能看文字和图片，还看不了视频/文件/语音这类内容 🙇 麻烦把问题用文字描述，或者截个图发我～').catch(() => {});
        return;
      }
      let question = message_type === 'post' ? extractPostText(content) : extractQuestion(content, mentions);
      if (Array.isArray(mentions)) for (const m of mentions) if (m.key) question = question.replaceAll(m.key, '').trim();
      const imageKeys = extractImageKeys(message_type, content);
      if (!question && imageKeys.length === 0) {
        sendText(chat_id, [
          '在的 👋 我是 OnlyRouter 助手，可以帮你解决这些：',
          '',
          '**🔌 配置接入** — Codex / Claude Code / VS Code 怎么接、Switch 一键配置',
          '**🐛 报错排查** — 401 / 400 / 协议不通 / 模型不可用等',
          '**💰 模型选择** — 哪个模型便宜、写代码用哪个、各渠道价格',
          '**🚀 AI 提效** — 用 AI 整理纪要、处理表格、写文案等',
          '',
          '直接把问题发我就行，报错可以发**截图**，也可以接着**追问**～',
        ].join('\n')).catch(() => {});
        return;
      }
      console.log(`[${label}][msg] ${chat_type} ${message_type}: ${question.slice(0, 50)}${imageKeys.length ? ` [${imageKeys.length}图]` : ''}`);
      handleQuestion(chat_id, chat_type, question, message_id, imageKeys);
    },
  });

  return {
    tenantId,
    label,
    start() {
      wsClient = new Lark.WSClient({ ...baseConfig, loggerLevel: Lark.LoggerLevel.warn });
      wsClient.start({ eventDispatcher });
      console.log(`✅ [${label}] bot 已启动（长连接）`);
    },
    stop() {
      // SDK 无显式 close，置空让长连接随实例回收；重连由新实例接管
      try { wsClient?.ws?.close?.(); } catch {}
      wsClient = null;
      console.log(`🛑 [${label}] bot 已停止`);
    },
  };
}

