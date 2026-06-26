// 调用 OnlyRouter 自家平台生成回复。bot 用 gpt-5.5-ab 回答关于 OnlyRouter 的问题——吃自家狗粮。
// 协议自适应：模型名以 -ab 结尾走 Anthropic 协议(/v1/messages)，其余走 OpenAI 协议(/v1/chat/completions)。
//   这正是 OnlyRouter 的规则——-ab 模型是 Anthropic 协议专用，填进 OpenAI 端点会直接 400。
import { buildSystemPrompt } from './knowledge.js';

const API_KEY = process.env.ONLYROUTER_API_KEY;
const MODEL = process.env.ONLYROUTER_MODEL || 'gpt-5.5-ab';
// 根地址（不带 /v1）。容错：用户填了带 /v1 的也能正确归一化。
const ROOT = (process.env.ONLYROUTER_BASE_URL || 'https://api.onlyrouter.ai')
  .replace(/\/v1\/?$/, '')
  .replace(/\/$/, '');

const isAnthropic = MODEL.endsWith('-ab');

export async function askLLM(question) {
  if (!API_KEY) {
    throw new Error('未配置 ONLYROUTER_API_KEY，请在 .env 里填上 OnlyRouter 的 Key');
  }
  const system = await buildSystemPrompt();
  const raw = isAnthropic
    ? await callAnthropic(system, question)
    : await callOpenAI(system, question);
  return parseResult(raw);
}

// Anthropic Messages 协议（-ab 模型走这条）
async function callAnthropic(system, question) {
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
      max_tokens: 2000,
      temperature: 0.3,
      system,
      messages: [{ role: 'user', content: question }],
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
      max_tokens: 2000,
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

// LLM 被要求输出结构化 JSON（回答 + bug 判定）。容错解析：
// 万一它没按格式来（裹了代码块、或纯文本），就降级成「纯回答、非 bug」。
function parseResult(raw) {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
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
    // 不是合法 JSON，降级处理
  }
  return { answer: raw, isBug: false, bugSummary: '' };
}
