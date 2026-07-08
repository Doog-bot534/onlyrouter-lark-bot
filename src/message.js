// Lark 消息格式化：把机器人的 markdown 回答渲染成好看的 interactive 卡片。
// - 卡片用 lark_md，支持加粗、代码块、分割线、列表、链接（纯文本不渲染 markdown，故弃用）。
// - 超长回答（>SPLIT_THRESHOLD 字）按段落拆成多条卡片发，避免一大坨刷屏。
const SPLIT_THRESHOLD = 1500; // 超过此字数才拆分
const HEADER_TITLE = 'OnlyRouter.Ai 助手';
const HEADER_COLOR = 'blue'; // 卡片标题栏颜色

// 把一段 markdown 文本包装成一张卡片的 content 对象（未 stringify）
function buildCard(mdText, { title = HEADER_TITLE, showHeader = true, part } = {}) {
  const elements = [
    {
      tag: 'div',
      text: { tag: 'lark_md', content: mdText },
    },
  ];
  const card = {
    config: { wide_screen_mode: true },
    elements,
  };
  if (showHeader) {
    card.header = {
      template: HEADER_COLOR,
      title: { tag: 'plain_text', content: part ? `${title}（${part}）` : title },
    };
  }
  return card;
}

// 按段落把长文本切成不超过 maxLen 的若干块，尽量在段落/换行处断开，不切碎代码块。
function splitIntoChunks(text, maxLen) {
  if (text.length <= maxLen) return [text];

  const chunks = [];
  const paragraphs = text.split(/\n\n+/); // 以空行分段
  let buf = '';

  const flush = () => {
    if (buf.trim()) chunks.push(buf.trim());
    buf = '';
  };

  for (const para of paragraphs) {
    // 单段就超长（多半是超大代码块）：硬切
    if (para.length > maxLen) {
      flush();
      for (let i = 0; i < para.length; i += maxLen) {
        chunks.push(para.slice(i, i + maxLen));
      }
      continue;
    }
    // 加上这段会超长，先把已有的发出去
    if (buf.length + para.length + 2 > maxLen) {
      flush();
    }
    buf += (buf ? '\n\n' : '') + para;
  }
  flush();
  return chunks;
}
// 返回一个或多个卡片的 content 字符串数组（供 im.message.create 逐条发送）。
// msgType 固定 'interactive'。
export function buildCards(answer) {
  const text = (answer || '').trim();
  if (!text) return [];

  const chunks = splitIntoChunks(text, SPLIT_THRESHOLD);
  // 修复分片可能切断代码块：若某片内 ``` 数量为奇数，补一个收尾 / 开头
  const fixed = balanceFences(chunks);

  return fixed.map((chunk, i) => {
    const part = fixed.length > 1 ? `${i + 1}/${fixed.length}` : undefined;
    return JSON.stringify(buildCard(chunk, { part }));
  });
}

// 保证每一片内部的 ``` 成对：奇数个则该片末尾补 ```，下一片开头补 ```。
function balanceFences(chunks) {
  const out = [];
  let carryOpen = false; // 上一片是否遗留了未闭合的代码块
  for (let chunk of chunks) {
    if (carryOpen) chunk = '```\n' + chunk; // 续上上一片的代码块
    const fenceCount = (chunk.match(/```/g) || []).length;
    if (fenceCount % 2 === 1) {
      chunk = chunk + '\n```';
      carryOpen = true;
    } else {
      carryOpen = false;
    }
    out.push(chunk);
  }
  return out;
}

// 简单纯文本卡片（用于错误提示、简短应答，也走卡片保持风格统一）
export function buildSimpleCard(text) {
  return JSON.stringify(buildCard(text));
}

