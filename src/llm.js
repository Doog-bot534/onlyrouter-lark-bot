// 调用 OnlyRouter 自家平台生成回复。bot 用 gpt-5.5-ab 回答关于 OnlyRouter 的问题——吃自家狗粮。
// 协议自适应：模型名以 -ab 结尾走 Anthropic 协议(/v1/messages)，其余走 OpenAI 协议(/v1/chat/completions)。
//   这正是 OnlyRouter 的规则——-ab 模型是 Anthropic 协议专用，填进 OpenAI 端点会直接 400。
import { buildSystemPrompt } from './knowledge.js';
import { maybeSearch } from './search.js';

const API_KEY = process.env.ONLYROUTER_API_KEY;
const MODEL = process.env.ONLYROUTER_MODEL || 'gpt-5.5-ab';
// 根地址（不带 /v1）。容错：用户填了带 /v1 的也能正确归一化。
const ROOT = (process.env.ONLYROUTER_BASE_URL || 'https://api.onlyrouter.ai')
  .replace(/\/v1\/?$/, '')
  .replace(/\/$/, '');

const isAnthropic = MODEL.endsWith('-ab');

// images: 可选的图片数组 [{ media_type, data(base64) }]，用于「看图回答」。
// 目前仅 Anthropic 协议(-ab 模型，已验证 gpt-5.5-ab 支持视觉)带图；OpenAI 协议忽略图片。
export async function askLLM(question, images = []) {
  if (!API_KEY) {
    throw new Error('未配置 ONLYROUTER_API_KEY，请在 .env 里填上 OnlyRouter 的 Key');
  }
  const system = await buildSystemPrompt();
  // 带图时不做联网搜索（图片问题一般是看图排查，搜索无益还拖慢）
  const searchCtx = images.length ? '' : await maybeSearch(question);
  const userMsg = searchCtx ? `${searchCtx}\n\n---\n\n用户问题：${question}` : question;
  const raw = isAnthropic
    ? await callAnthropic(system, userMsg, images)
    : await callOpenAI(system, userMsg);
  return parseResult(raw);
}

// 通用纯文本对话（供每日汇总等内部功能复用，不走结构化解析）
export async function chat(system, user) {
  if (!API_KEY) throw new Error('未配置 ONLYROUTER_API_KEY');
  return isAnthropic ? callAnthropic(system, user) : callOpenAI(system, user);
}

// Anthropic Messages 协议（-ab 模型走这条）
async function callAnthropic(system, question, images = []) {
  // 有图片时用多模态 content（图在前、文字在后）；无图则纯文本
  const userContent = images.length
    ? [
        ...images.map((img) => ({
          type: 'image',
          source: { type: 'base64', media_type: img.media_type || 'image/png', data: img.data },
        })),
        { type: 'text', text: question },
      ]
    : question;
  const res = await fetch(`${ROOT}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // 两种鉴权头都带：OnlyRouter 网关认哪个都能过（Claude Code 用 Bearer，原生 Anthropic 用 x-api-key）
      'x-api-key': API_KEY,
      authorization: `Bearer ${API_KEY}`,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 3000,
      temperature: 0.3,
      system,
      messages: [{ role: 'user', content: userContent }],
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OnlyRouter API ${res.status}: ${errText.slice(0, 500)}`);
  }
  const json = await res.json();
  const text = json.content?.map((b) => b.text).filter(Boolean).join('').trim();
  if (!text) throw new Error(`OnlyRouter 返回空内容: ${JSON.stringify(json).slice(0, 300)}`);
  return text;
}
// OpenAI Chat Completions 协议（gpt / deepseek / -openrouter 等走这条）
async function callOpenAI(system, question) {
  const res = await fetch(`${ROOT}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: question },
      ],
      temperature: 0.3,
      max_tokens: 3000,
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OnlyRouter API ${res.status}: ${errText.slice(0, 500)}`);
  }
  const json = await res.json();
  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error(`OnlyRouter 返回空内容: ${JSON.stringify(json).slice(0, 300)}`);
  return text;
}

// LLM 被要求输出结构化 JSON（回答 + bug 判定）。多级容错解析，保证用户永远看到干净答案：
//   1) 标准 JSON.parse
//   2) 抠出 answer 字段（应对被 max_tokens 截断、JSON 没闭合的情况）
//   3) 实在不是 JSON，原样返回（纯文本回复也 OK）
function parseResult(raw) {
  let s = raw.trim();
  // 仅当整段被代码块包裹时才剥外壳（如模型把 JSON 放进 ```json ```）。
  // 注意：不能用宽松正则匹配中间任意代码块——answer 内容里常含 ```bash``` 等示例代码块，
  // 那会把示例代码误当成 JSON 外壳抠出来，导致解析失败、把 JSON 壳暴露给用户。
  if (s.startsWith('```')) {
    const fence = s.match(/^```(?:json)?\s*([\s\S]*?)```$/);
    if (fence) s = fence[1].trim();
  }

  // 1) 标准解析
  try {
    const obj = JSON.parse(s);
    if (typeof obj.answer === 'string' && obj.answer.trim()) {
      return {
        answer: obj.answer.trim(),
        isBug: obj.is_bug === true,
        bugSummary: typeof obj.bug_summary === 'string' ? obj.bug_summary.trim() : '',
      };
    }
  } catch {
    // 落到下面的字段抠取
  }

  // 2) 是 JSON 壳但解析失败（多半被截断）：手动抠 answer 字段的字符串值
  if (s.startsWith('{') && /"answer"\s*:/.test(s)) {
    const answer = extractJsonString(s, 'answer');
    if (answer) {
      const isBug = /"is_bug"\s*:\s*true/.test(s);
      const bugSummary = extractJsonString(s, 'bug_summary') || '';
      return { answer, isBug, bugSummary };
    }
  }

  // 3) 纯文本，原样返回
  return { answer: raw, isBug: false, bugSummary: '' };
}

// 从（可能不完整的）JSON 文本里抠出某个字符串字段的值，正确处理转义。
// 截断时返回到目前为止的内容，避免把 JSON 壳暴露给用户。
function extractJsonString(text, key) {
  const m = text.match(new RegExp(`"${key}"\\s*:\\s*"`));
  if (!m) return '';
  let i = m.index + m[0].length;
  let out = '';
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') {
      const next = text[i + 1];
      const map = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', '/': '/' };
      out += map[next] ?? next ?? '';
      i += 2;
      continue;
    }
    if (c === '"') break; // 字符串正常结束
    out += c;
    i++;
  }
  return out.trim();
}
